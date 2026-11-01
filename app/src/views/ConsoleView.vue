<script setup lang="ts">
// A root shell on the box. A code goes to an approver phone, the user types
// it, and the code becomes a one-time right to open a console within 30 s:
// that is when the terminal is built and the socket opened. Leaving the page
// closes the console; a new one takes a new code.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { ConsoleConnection, endsAdminSession } from '../protocol/console';
import type { ConsoleEnd, ConsoleReady } from '../protocol/console';
import type { ConsoleTerminal } from '../components/admin/xterm';
import { useAdminStore } from '../stores/admin';
import { useApproversStore } from '../stores/approvers';
import { useAuthStore } from '../stores/auth';
import { useAdminText } from '../composables/useAdminText';
import AdminButton from '../components/admin/AdminButton.vue';
import AdminNotice from '../components/admin/AdminNotice.vue';
import CodeEntry from '../components/admin/CodeEntry.vue';

type Phase = 'starting' | 'no_approver' | 'code' | 'connecting' | 'open' | 'ended';

const { t } = useI18n();
const router = useRouter();
const admin = useAdminStore();
const approvers = useApproversStore();
const auth = useAuthStore();
const { errorText } = useAdminText();

const phase = ref<Phase>('starting');
const end = ref<ConsoleEnd | null>(null);
const ready = ref<ConsoleReady | null>(null);
const host = ref<HTMLElement | null>(null);
const now = ref(Date.now());
const openedAt = ref(0);
const lastInputAt = ref(0);

const term = shallowRef<ConsoleTerminal | null>(null);
let connection: ConsoleConnection | null = null;
let resizeObserver: ResizeObserver | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let leaving = false;

// Fetched while the code is on its way, so the terminal is there when it lands.
const loadTerminal = import('../components/admin/xterm');
// Handled where it is awaited; this only keeps an early failure from being "unhandled".
loadTerminal.catch(() => undefined);

const challenge = computed(() => (approvers.challenge?.step === 'console' ? approvers.challenge : null));

const lifetimeLeft = computed(() =>
    ready.value === null ? 0 : Math.max(0, ready.value.expiresIn - (now.value - openedAt.value) / 1000),
);
const idleLeft = computed(() =>
    ready.value === null ? 0 : Math.max(0, ready.value.idleTimeout - (now.value - lastInputAt.value) / 1000),
);
const fraction = computed(() => (ready.value === null ? 1 : lifetimeLeft.value / ready.value.expiresIn));

/** One line: the idle cut-off when it is near, else the hour. */
const clock = computed(() => {
    if (phase.value !== 'open') return '';
    if (idleLeft.value <= 60) return t('admin.console.idleSoon', { seconds: Math.ceil(idleLeft.value) });
    if (lifetimeLeft.value <= 60) return t('admin.console.endsInSeconds', { seconds: Math.ceil(lifetimeLeft.value) });
    return t('admin.console.endsIn', { minutes: Math.ceil(lifetimeLeft.value / 60) });
});
const clockLow = computed(() => phase.value === 'open' && Math.min(idleLeft.value, lifetimeLeft.value) <= 60);

const flowError = computed(() => (approvers.flowError === null ? '' : errorText(approvers.flowError)));

const httpsUrl = computed(() => `https://${window.location.hostname}${window.location.pathname}#/admin/console`);
const overHttp = window.location.protocol !== 'https:';

const endTitle = computed(() => {
    const kind = end.value?.kind;
    return kind === 'refused' || kind === 'handshake' ? t('admin.console.refusedTitle') : t('admin.console.closedTitle');
});

const endText = computed(() => {
    const value = end.value;
    if (value === null) return '';
    const minutes = (seconds: number | undefined, fallback: number): number =>
        Math.max(1, Math.round((seconds ?? fallback) / 60));
    switch (value.kind) {
        case 'refused':
            if (value.error.code === 'code_expired') return t('admin.console.end.codeExpired');
            return errorText(value.error);
        case 'handshake':
            return overHttp ? t('admin.console.end.https') : t('admin.console.end.handshake');
        case 'expired':
            return t('admin.console.end.expired', { minutes: minutes(ready.value?.expiresIn, 3600) });
        case 'idle':
            return t('admin.console.end.idle', { minutes: minutes(ready.value?.idleTimeout, 900) });
        default:
            return t(`admin.console.end.${value.kind}`);
    }
});

const loginRefused = computed(() => end.value?.kind === 'refused' && end.value.error.code === 'login_failed');

function stopTicker(): void {
    if (ticker !== null) clearInterval(ticker);
    ticker = null;
}

function teardown(): void {
    connection?.close();
    connection = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    term.value?.dispose();
    term.value = null;
    stopTicker();
}

async function start(): Promise<void> {
    // The admin session may have expired while a console was open: every
    // request would come back bad_session.
    if (!admin.isUnlocked) {
        void router.replace({ name: 'admin' });
        return;
    }
    teardown();
    end.value = null;
    ready.value = null;
    phase.value = 'starting';
    if (approvers.approvers === null) await approvers.load();
    if (leaving) return;
    if (approvers.approvers !== null && approvers.approvers.length === 0) {
        phase.value = 'no_approver';
        return;
    }
    await approvers.startConsole();
    if (leaving) return;
    phase.value = approvers.flowError?.code === 'approver_required' ? 'no_approver' : 'code';
}

function finish(result: ConsoleEnd): void {
    connection = null;
    stopTicker();
    end.value = result;
    phase.value = 'ended';
    term.value?.terminal.blur();
    if (result.kind === 'refused' && result.error.code === 'bad_session') {
        admin.dropSession(null);
        void router.replace({ name: 'admin' });
    } else if (endsAdminSession(result)) {
        // The message stays; "Open a new console" then lands on the password screen.
        admin.dropSession(
            result.kind === 'admin_set' ? 'session_invalidated' : result.kind === 'bad_code' ? 'code_locked' : null,
        );
    }
}

async function connect(codeId: string): Promise<void> {
    phase.value = 'connecting';
    let createTerminal: typeof import('../components/admin/xterm').createTerminal;
    try {
        ({ createTerminal } = await loadTerminal);
    } catch {
        finish({ kind: 'load_failed' });
        return;
    }
    await nextTick();
    const session = admin.session;
    if (leaving || host.value === null || session === null) return;
    const pane = createTerminal(host.value);
    term.value = pane;
    const { user, pass } = admin.householdCredentials();
    const opened = { columns: pane.terminal.cols, rows: pane.terminal.rows };
    const link: ConsoleConnection = new ConsoleConnection(
        { user, pass, session, codeId, ...opened },
        {
            onReady(info) {
                // Resizes before `ready` are not sent: catch up once.
                const { cols, rows } = pane.terminal;
                if (cols !== opened.columns || rows !== opened.rows) link.resize(cols, rows);
                ready.value = info;
                openedAt.value = Date.now();
                lastInputAt.value = openedAt.value;
                now.value = openedAt.value;
                phase.value = 'open';
                ticker = setInterval(() => {
                    now.value = Date.now();
                }, 1000);
                pane.terminal.focus();
            },
            onOutput(bytes) {
                pane.terminal.write(bytes);
            },
            onEnd: finish,
        },
    );
    connection = link;
    pane.terminal.onData((data) => {
        lastInputAt.value = Date.now();
        link.input(data);
    });
    pane.terminal.onBinary((data) => {
        lastInputAt.value = Date.now();
        link.binary(data);
    });
    pane.terminal.onResize(({ cols, rows }) => link.resize(cols, rows));
    resizeObserver = new ResizeObserver(() => pane.fit());
    resizeObserver.observe(host.value);
}

watch(
    () => approvers.done,
    (done) => {
        if (done !== 'console') return;
        approvers.dismissDone();
        const grant = approvers.takeConsoleGrant();
        if (grant !== null) void connect(grant);
    },
);

// A lost admin session before the console opened: back to the unlock screen.
// An open console outlives it (its limits are the daemon's own).
watch(
    () => admin.gate,
    (gate) => {
        if (gate !== 'unlocked' && phase.value !== 'open' && phase.value !== 'ended') {
            void router.replace({ name: 'admin' });
        }
    },
);

function backToAdmin(): void {
    void router.push({ name: 'adminSystem' });
}

function addPhone(): void {
    void router.push({ name: 'admin', query: { add: 'phone' } });
}

function closeConsole(): void {
    connection?.close();
    connection = null;
    finish({ kind: 'user' });
}

onMounted(() => {
    void start();
});

onBeforeUnmount(() => {
    leaving = true;
    teardown();
    approvers.cancel();
});
</script>

<template>
    <div class="console" :class="`console--${phase}`">
        <h1 class="visually-hidden">{{ t('admin.console.title') }}</h1>

        <!-- ---- before the console: a code, or why there is none -------- -->
        <div v-if="phase === 'starting' || phase === 'code' || phase === 'no_approver'" class="console__panel">
            <AdminNotice
                v-if="phase === 'starting' || (phase === 'code' && challenge === null && flowError === '')"
                tone="working"
                :title="t('admin.console.sending')"
                hint=""
            />

            <AdminNotice
                v-else-if="phase === 'no_approver'"
                tone="secure"
                :title="t('admin.console.noApprover.title')"
                :hint="t('admin.console.noApprover.hint')"
            >
                <AdminButton variant="quiet" @click="backToAdmin">{{ t('admin.console.back') }}</AdminButton>
                <AdminButton @click="addPhone">{{ t('admin.approvers.add') }}</AdminButton>
            </AdminNotice>

            <AdminNotice v-else-if="challenge === null" tone="warn" :title="t('admin.console.refusedTitle')" :hint="flowError">
                <AdminButton variant="quiet" @click="backToAdmin">{{ t('admin.console.back') }}</AdminButton>
                <AdminButton @click="start">{{ t('admin.console.again') }}</AdminButton>
            </AdminNotice>

            <CodeEntry
                v-else
                class="fade-in-up"
                :challenge="challenge"
                :working="approvers.working"
                :alternative="approvers.alternative?.deviceName ?? null"
                @submit="approvers.submit"
                @resend="approvers.resend()"
                @other="approvers.sendToOther()"
                @cancel="backToAdmin"
            />
        </div>

        <!-- ---- the console ---------------------------------------------- -->
        <section v-else class="console__frame fade-in" :aria-label="t('admin.console.title')">
            <header class="console__bar">
                <p class="console__status" role="status" aria-live="polite">
                    <span v-if="phase === 'connecting'">{{ t('admin.console.connecting') }}</span>
                    <span v-else-if="phase === 'open'" :class="{ 'console__status--low': clockLow }">{{ clock }}</span>
                    <span v-else>{{ endTitle }}</span>
                </p>
                <AdminButton v-if="phase === 'open'" variant="quiet" @click="closeConsole">
                    {{ t('admin.console.close') }}
                </AdminButton>
            </header>
            <span
                class="console__clock"
                :class="{ 'console__clock--low': clockLow, 'console__clock--off': phase !== 'open' }"
                :style="{ transform: `scaleX(${phase === 'open' ? fraction : 0})` }"
                aria-hidden="true"
            />

            <div
                v-if="phase === 'ended'"
                class="console__end fade-in"
                :class="{ 'console__end--refused': end?.kind === 'refused' || end?.kind === 'handshake' }"
                role="alert"
            >
                <p class="console__end-text">{{ endText }}</p>
                <div class="console__end-actions">
                    <AdminButton variant="quiet" @click="backToAdmin">{{ t('admin.console.back') }}</AdminButton>
                    <AdminButton v-if="end?.kind === 'handshake' && overHttp" :href="httpsUrl">
                        {{ t('admin.notice.httpsOpen') }}
                    </AdminButton>
                    <AdminButton v-else-if="loginRefused" @click="auth.signOut()">
                        {{ t('admin.console.signIn') }}
                    </AdminButton>
                    <AdminButton v-else @click="start">{{ t('admin.console.again') }}</AdminButton>
                </div>
            </div>

            <div ref="host" class="console__terminal" :class="{ 'console__terminal--ended': phase === 'ended' }" />
        </section>
    </div>
</template>

<style scoped>
.console {
    display: flex;
    flex-direction: column;
    block-size: 100%;
    padding: var(--space-4);
}

@media (min-width: 480px) {
    .console {
        padding: var(--space-6);
    }
}

/* ---- before: AdminView's gate panel --------------------------------- */

.console__panel {
    margin: auto;
    inline-size: min(22rem, 100%);
    position: relative;
    isolation: isolate;
}

.console__panel::before {
    content: '';
    position: absolute;
    inset: -20% -25%;
    background-image: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.78), rgba(0, 0, 0, 0) 70%);
    z-index: -1;
    pointer-events: none;
}

.console__panel :deep(.admin-notice__actions) {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
}

/* ---- the console ------------------------------------------------------ */

.console__frame {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-block-size: 16rem;
    inline-size: 100%;
    max-inline-size: 72rem;
    margin-inline: auto;
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    background-color: var(--c-bg);
    overflow: hidden;
}

.console__bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-block-size: 3rem;
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
    background-image: linear-gradient(var(--c-chrome-top), var(--c-chrome-bottom));
    border-block-end: 1px solid var(--c-chrome-hairline);
}

.console__status {
    color: var(--c-text-muted);
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
}

.console__status--low {
    color: var(--c-warn);
}

/* The hour the daemon gives a console: the code entry's filament, longer. */
.console__clock {
    display: block;
    block-size: 2px;
    background-color: var(--c-accent);
    box-shadow: 0 0 12px var(--c-accent-glow);
    transform-origin: left center;
    transition: transform 1s linear, background-color 400ms ease;
}

.console__clock--low {
    background-color: var(--c-warn);
    box-shadow: 0 0 12px rgba(224, 163, 86, 0.45);
}

.console__clock--off {
    box-shadow: none;
}

.console__terminal {
    flex: 1;
    min-block-size: 0;
    padding: var(--space-2) var(--space-3);
}

.console__terminal--ended {
    opacity: 0.45;
}

.console__end {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
    border-block-end: 1px solid rgba(224, 163, 86, 0.35);
    background-color: rgba(52, 38, 20, 0.6);
}

.console__end--refused {
    border-block-end-color: rgba(224, 86, 86, 0.4);
    background-color: rgba(60, 22, 22, 0.6);
}

.console__end-text {
    font-size: 0.9375rem;
    line-height: 1.45;
}

.console__end-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
}

@media (prefers-reduced-motion: reduce) {
    .console__clock {
        transition: none;
    }
}
</style>
