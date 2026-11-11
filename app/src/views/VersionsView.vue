<script setup lang="ts">
// Household page: what runs in this house, with a Copy button for bug reports.
// Needs no admin password, so the same page works for every signed-in user.

import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import IconLoading from '~icons/mdi/loading';
import AppButton from '../components/ui/AppButton.vue';
import { isRecord } from '../protocol/guards';
import { formatVersionsText, toVersions } from '../protocol/versions';
import type { Versions } from '../protocol/versions';
import { useAdminStore } from '../stores/admin';

const { t } = useI18n();
const admin = useAdminStore();

const CLIENT = { name: 'calaos-web-app', version: __APP_VERSION__ };

// Codes that mean the server cannot answer `versions`: an old one ignores the
// unknown message, so it times out instead of refusing.
const OLD_SERVER_CODES = ['invalid_request', 'not_allowed', 'old_server', 'timeout'];

const loading = ref(true);
const failed = ref(false);
const oldServer = ref(false);
const versions = ref<Versions | null>(null);
const copyState = ref<'idle' | 'done' | 'failed'>('idle');
let lastLoad = 0;

const system = computed(() => versions.value?.system ?? null);
const daemonTooOld = computed(() => system.value === null && versions.value?.error === 'daemon_too_old');
const unreachable = computed(
    () => versions.value !== null && system.value === null && !oldServer.value && !daemonTooOld.value,
);
const text = computed(() => formatVersionsText(CLIENT, versions.value, new Date()));

async function load(): Promise<void> {
    const mine = ++lastLoad;
    loading.value = true;
    copyState.value = 'idle';
    const outcome = await admin.readVersions();
    if (mine !== lastLoad) return;
    failed.value = false;
    oldServer.value = false;
    if (!outcome.ok) {
        if (OLD_SERVER_CODES.includes(outcome.error.code)) {
            oldServer.value = true;
            versions.value = { server: '', system: null, error: 'old_server' };
        } else {
            failed.value = true;
            versions.value = null;
        }
    } else if (!isRecord(outcome.data.result)) {
        failed.value = true;
        versions.value = null;
    } else {
        versions.value = toVersions(outcome.data.result);
    }
    loading.value = false;
}

// navigator.clipboard only exists in a secure context, and the app is served over HTTP on the LAN.
function copyWithSelection(value: string): boolean {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    try {
        area.select();
        return document.execCommand('copy');
    } catch {
        return false;
    } finally {
        area.remove();
    }
}

async function copy(): Promise<void> {
    let done: boolean;
    try {
        await navigator.clipboard.writeText(text.value);
        done = true;
    } catch {
        done = copyWithSelection(text.value);
    }
    copyState.value = done ? 'done' : 'failed';
}

onMounted(load);
</script>

<template>
    <div class="versions">
        <div class="versions__body">
            <header class="versions__head fade-in-down">
                <h1 class="versions__heading">{{ t('versions.title') }}</h1>
                <p class="versions__hint">{{ t('versions.hint') }}</p>
            </header>

            <p v-if="loading" class="versions__state" role="status" data-testid="versions-loading">
                <IconLoading class="versions__spin" aria-hidden="true" />
                {{ t('versions.loading') }}
            </p>

            <template v-else>
                <p v-if="failed" class="versions__alert" role="alert" data-testid="versions-failed">
                    {{ t('versions.failed') }}
                </p>

                <p v-if="oldServer" class="versions__alert" role="alert" data-testid="versions-old-server">
                    {{ t('versions.oldServer') }}
                </p>

                <section class="versions__card fade-in" data-testid="versions-client">
                    <dl class="versions__list">
                        <div>
                            <dt>{{ t('versions.webApp') }}</dt>
                            <dd data-testid="versions-client-value">{{ CLIENT.version }}</dd>
                        </div>
                        <div v-if="versions !== null && versions.server !== ''">
                            <dt>{{ t('versions.server') }}</dt>
                            <dd data-testid="versions-server">{{ versions.server }}</dd>
                        </div>
                        <div v-if="system !== null && system.container !== ''">
                            <dt>{{ t('versions.container') }}</dt>
                            <dd data-testid="versions-container">{{ system.container }}</dd>
                        </div>
                        <div v-if="system !== null && system.calaosOs !== ''">
                            <dt>{{ t('versions.os') }}</dt>
                            <dd data-testid="versions-os">{{ system.calaosOs }}</dd>
                        </div>
                        <div v-if="system !== null && system.debian !== ''">
                            <dt>{{ t('versions.debian') }}</dt>
                            <dd data-testid="versions-debian">{{ system.debian }}</dd>
                        </div>
                        <div v-if="system !== null && system.kernel !== ''">
                            <dt>{{ t('versions.kernel') }}</dt>
                            <dd data-testid="versions-kernel">{{ system.kernel }}</dd>
                        </div>
                    </dl>
                </section>

                <p v-if="daemonTooOld" class="versions__alert" role="alert" data-testid="versions-daemon-too-old">
                    {{ t('versions.daemonTooOld') }}
                </p>

                <p v-if="unreachable" class="versions__alert" role="alert" data-testid="versions-unreachable">
                    {{ t('versions.unreachable') }}
                    <span v-if="versions !== null && versions.error !== ''" class="versions__why">
                        {{ t('versions.unreachableWhy', { error: versions.error }) }}
                    </span>
                </p>

                <section
                    v-if="system !== null && system.packages.length > 0"
                    class="versions__card fade-in"
                    data-testid="versions-packages"
                >
                    <h2 class="versions__sub">{{ t('versions.packages') }}</h2>
                    <dl class="versions__list">
                        <div v-for="pkg in system.packages" :key="pkg.name" data-testid="versions-package">
                            <dt>{{ pkg.name }}</dt>
                            <dd>{{ pkg.version }}</dd>
                        </div>
                    </dl>
                </section>

                <div class="versions__actions">
                    <AppButton data-testid="versions-copy" :disabled="failed" @click="copy">
                        {{ t('versions.copy') }}
                    </AppButton>
                    <AppButton variant="quiet" data-testid="versions-refresh" @click="load">
                        {{ t('versions.refresh') }}
                    </AppButton>
                    <span
                        v-if="copyState !== 'idle'"
                        class="versions__copied"
                        role="status"
                        data-testid="versions-copy-state"
                    >
                        {{ copyState === 'done' ? t('versions.copied') : t('versions.copyFailed') }}
                    </span>
                </div>
            </template>
        </div>
    </div>
</template>

<style scoped>
.versions {
    display: flex;
    justify-content: center;
    padding: var(--space-4);
}

.versions__body {
    display: grid;
    gap: var(--space-4);
    inline-size: min(100%, 40rem);
    align-content: start;
}

.versions__head {
    display: grid;
    gap: var(--space-1);
}

.versions__heading {
    margin: 0;
    font-size: clamp(1.5rem, 6vw, 1.875rem);
    font-weight: 400;
    letter-spacing: var(--tracking-tight);
}

.versions__hint {
    margin: 0;
    color: var(--c-text-muted, var(--c-text));
}

.versions__state {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
}

.versions__spin {
    animation: versions-spin 1s linear infinite;
}

@keyframes versions-spin {
    to {
        transform: rotate(360deg);
    }
}

@media (prefers-reduced-motion: reduce) {
    .versions__spin {
        animation: none;
    }
}

.versions__card,
.versions__alert {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-4);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    background-color: color-mix(in srgb, var(--c-surface) 85%, transparent);
}

.versions__alert {
    border-color: var(--c-accent);
}

.versions__why {
    color: var(--c-text-muted, var(--c-text));
    overflow-wrap: anywhere;
}

.versions__sub {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
}

.versions__list {
    display: grid;
    gap: var(--space-2);
    margin: 0;
}

.versions__list > div {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
}

.versions__list dt {
    color: var(--c-text-muted, var(--c-text));
    overflow-wrap: anywhere;
}

.versions__list dd {
    margin: 0;
    font-weight: 600;
    text-align: end;
    overflow-wrap: anywhere;
}

.versions__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
}
</style>
