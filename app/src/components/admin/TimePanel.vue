<script setup lang="ts">
// The box's clock next to this device's, in the box's own time zone. The
// clock ticks locally from the last read. Moving the clock by more than an
// hour is confirmed first: a step back breaks TLS validity and apt. "Set
// from this device" only exists while the box is not synchronised, so a
// wrong browser clock cannot overwrite a good NTP time by accident. A time
// typed by hand is read in the box's zone, never the browser's, and turns
// NTP off in the same request: the daemon refuses a time while it is on.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { TIME_STEP_CONFIRM_MS, clockDrift, filterZones, fromLocalInput, toLocalInput, toTimeParam } from '../../protocol/admin-time';
import type { TimeChange } from '../../protocol/admin-time';
import type { AdminError } from '../../protocol/admin';
import { SELF_SERVICE_ID } from '../../protocol/admin-services';
import { useAdminStore } from '../../stores/admin';
import { useAdminServicesStore } from '../../stores/adminServices';
import { useAdminTimeStore } from '../../stores/adminTime';
import { useAdminText } from '../../composables/useAdminText';
import BaseDialog from '../ui/BaseDialog.vue';
import AdminButton from './AdminButton.vue';

/** Below this the two clocks agree, as far as a round trip can tell. */
const DRIFT_WARN_MS = 5_000;
const KIOSK_ID = 'calaos-home';

const { t, locale } = useI18n();
const admin = useAdminStore();
const time = useAdminTimeStore();
const services = useAdminServicesStore();
const { errorText } = useAdminText();

const now = ref(Date.now());
const zone = ref('');
const confirming = ref<'device' | 'ntp' | 'manual' | null>(null);
const zoneFilter = ref('');
/** The typed time, in the box's zone; follows the box's clock until edited. */
const manual = ref('');
const manualTouched = ref(false);
const manualProblem = ref<'invalid' | 'range' | 'nonexistent' | null>(null);
const manualMs = ref(NaN);
const failure = ref<AdminError | null>(null);
/** Services restarted from the notice, so their button goes. */
const restarted = ref<string[]>([]);
const selfRestarting = ref(false);
let ticker: ReturnType<typeof setInterval> | null = null;

const box = computed(() => time.time);
const busy = computed(() => admin.busy !== null);
const setting = computed(() => admin.busy === 'time_set');

/** Box clock minus this device's, from the last read; NaN before one. */
const drift = computed(() => (box.value === null ? NaN : clockDrift(box.value, time.readAt)));
const driftLevel = computed<'ok' | 'warn' | 'strong'>(() => {
    const off = Math.abs(drift.value);
    if (!Number.isFinite(off) || off <= DRIFT_WARN_MS) return 'ok';
    return off > TIME_STEP_CONFIRM_MS ? 'strong' : 'warn';
});
const boxNowMs = computed(() => (box.value === null ? NaN : Date.parse(box.value.now) + (now.value - time.readAt)));

function formatter(options: Intl.DateTimeFormatOptions, timeZone: string): Intl.DateTimeFormat {
    try {
        return new Intl.DateTimeFormat(locale.value, { ...options, timeZone: timeZone || undefined });
    } catch {
        // A zone this browser does not know: say the time in UTC rather than nothing.
        return new Intl.DateTimeFormat(locale.value, { ...options, timeZone: 'UTC' });
    }
}

const clockText = computed(() =>
    Number.isFinite(boxNowMs.value)
        ? formatter({ hour: '2-digit', minute: '2-digit', second: '2-digit' }, box.value?.timezone ?? '').format(boxNowMs.value)
        : '',
);
const dateText = computed(() =>
    Number.isFinite(boxNowMs.value)
        ? formatter({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }, box.value?.timezone ?? '').format(boxNowMs.value)
        : '',
);
const deviceText = computed(() =>
    formatter({ hour: '2-digit', minute: '2-digit', second: '2-digit', day: 'numeric', month: 'short' }, box.value?.timezone ?? '').format(now.value),
);

/** "12 s", "3 min", "2 h", "4 d": enough to judge, not a stopwatch. */
function amount(ms: number): string {
    const seconds = Math.round(Math.abs(ms) / 1000);
    if (seconds < 120) return t('admin.time.unit.seconds', { n: seconds });
    if (seconds < 7_200) return t('admin.time.unit.minutes', { n: Math.round(seconds / 60) });
    if (seconds < 172_800) return t('admin.time.unit.hours', { n: Math.round(seconds / 3600) });
    return t('admin.time.unit.days', { n: Math.round(seconds / 86_400) });
}

const driftText = computed(() => {
    if (driftLevel.value === 'ok') return t('admin.time.inStep');
    const key = drift.value > 0 ? 'admin.time.ahead' : 'admin.time.behind';
    return t(key, { amount: amount(drift.value) });
});

const ntpText = computed(() => {
    if (box.value === null) return '';
    if (!box.value.ntp) return t('admin.time.manual');
    return box.value.synchronized ? t('admin.time.synchronized') : t('admin.time.notSynchronized');
});

const zones = computed(() => {
    const list = time.zones ?? [];
    const current = box.value?.timezone ?? '';
    return current !== '' && !list.includes(current) ? [current, ...list] : list;
});
const shownZones = computed(() => filterZones(zones.value, zoneFilter.value));
const zoneChanged = computed(() => box.value !== null && zone.value !== '' && zone.value !== box.value.timezone);

const stepNames = (steps: string[]) => steps.map((step) => t(`admin.time.step.${step}`)).join(', ');
const failureText = computed(() => {
    const error = failure.value;
    if (error === null) return '';
    return errorText(error);
});
const partialText = computed(() => {
    const error = failure.value;
    if (error === null || error.applied.length === 0) return '';
    return t('admin.time.partial', {
        applied: stepNames(error.applied),
        failed: error.failed === '' ? '?' : stepNames([error.failed]),
    });
});
const loadText = computed(() =>
    time.error !== null && failure.value === null && time.unconfirmed === null ? errorText(time.error) : '',
);
/** Until then, the change may still land: no invitation to apply it again. */
const settled = computed(() => time.unconfirmed !== 'unread' && (time.unconfirmed?.settled ?? true));
const unconfirmedText = computed(() => {
    const read = time.unconfirmed;
    if (read === null) return '';
    if (read === 'unread') return t('admin.time.unconfirmed.unread');
    if (read.unchanged.length === 0) return t('admin.time.unconfirmed.changed', { changed: stepNames(read.changed) });
    const found =
        read.changed.length === 0
            ? t(read.settled ? 'admin.time.unconfirmed.unchanged' : 'admin.time.unconfirmed.unchangedSoFar')
            : t('admin.time.partial', { applied: stepNames(read.changed), failed: stepNames(read.unchanged) });
    return read.settled ? found : `${found} ${t('admin.time.unconfirmed.stillApplying')}`;
});

const kioskPresent = computed(() => {
    const kiosk = services.services?.find((service) => service.id === KIOSK_ID);
    return kiosk !== undefined && kiosk.activeState !== 'not-found';
});
const offerServer = computed(() => !restarted.value.includes(SELF_SERVICE_ID));
const offerKiosk = computed(() => kioskPresent.value && !restarted.value.includes(KIOSK_ID));

watch(
    () => box.value?.timezone,
    (current) => {
        if (current !== undefined) zone.value = current;
    },
    { immediate: true },
);

function fillManual(): void {
    if (box.value !== null && Number.isFinite(boxNowMs.value)) {
        manual.value = toLocalInput(boxNowMs.value, box.value.timezone || 'UTC');
    }
}

watch(
    () => box.value === null,
    (missing) => {
        if (!missing && !manualTouched.value) fillManual();
    },
    { immediate: true },
);

watch(
    () => time.readAt,
    () => {
        if (!manualTouched.value) fillManual();
    },
);

watch(
    () => time.restartRequired,
    (required) => {
        if (!required) return;
        restarted.value = [];
        selfRestarting.value = false;
        if (services.services === null) void services.load();
    },
    { immediate: true },
);

async function apply(change: TimeChange): Promise<void> {
    failure.value = null;
    const error = await time.set(change);
    if (error !== null && error.code !== 'busy') failure.value = error;
}

function applyZone(): void {
    if (zoneChanged.value) void apply({ timezone: zone.value });
}

function askNtp(): void {
    if (driftLevel.value === 'strong') confirming.value = 'ntp';
    else void apply({ ntp: true });
}

function stopNtp(): void {
    void apply({ ntp: false });
}

/** Wall-clock text in the box's zone to the exact request, or what is wrong with it. */
function askManual(): void {
    if (box.value === null) return;
    const parsed = fromLocalInput(manual.value, box.value.timezone || 'UTC');
    if ('error' in parsed) {
        manualProblem.value = parsed.error;
        return;
    }
    manualProblem.value = null;
    manualMs.value = parsed.ms;
    const step = parsed.ms - boxNowMs.value;
    if (box.value.ntp || Math.abs(step) > TIME_STEP_CONFIRM_MS) confirming.value = 'manual';
    else void applyManual();
}

async function applyManual(): Promise<void> {
    const change: TimeChange = { time: toTimeParam(manualMs.value) };
    // NTP first: the daemon refuses a time while it is on.
    if (box.value?.ntp) change.ntp = false;
    manualTouched.value = false;
    await apply(change);
}

const manualStep = computed(() => manualMs.value - boxNowMs.value);

function confirm(): void {
    const what = confirming.value;
    confirming.value = null;
    if (what === 'manual') void applyManual();
    if (what === 'ntp') void apply({ ntp: true });
    if (what === 'device') {
        // NTP first: the daemon refuses a time while it is on.
        const change: TimeChange = { time: toTimeParam(Date.now()) };
        if (box.value?.ntp) change.ntp = false;
        void apply(change);
    }
}

async function restart(id: string): Promise<void> {
    const { outcome, error } = await services.restart(id);
    if (outcome === 'failed') {
        if (error !== null && error.code !== 'busy') failure.value = error;
        return;
    }
    restarted.value = [...restarted.value, id];
    if (outcome === 'self_restarting') selfRestarting.value = true;
    if (!offerServer.value && !offerKiosk.value) time.dismissRestart();
}

onMounted(() => {
    void time.load();
    void time.loadZones();
    ticker = setInterval(() => {
        now.value = Date.now();
    }, 1000);
});

onBeforeUnmount(() => {
    if (ticker !== null) clearInterval(ticker);
});
</script>

<template>
    <section class="time" :aria-label="t('admin.time.title')">
        <div class="time__face" :class="`time__face--${driftLevel}`">
            <template v-if="box !== null">
                <p class="time__clock" data-testid="box-clock">
                    <time :datetime="box.now">{{ clockText }}</time>
                </p>
                <p class="time__date">{{ dateText }}</p>
                <p class="time__meta">
                    <span class="time__zone">{{ box.timezone || t('admin.time.noZone') }}</span>
                    <span
                        class="time__ntp"
                        :class="{ 'time__ntp--ok': box.ntp && box.synchronized, 'time__ntp--off': !box.ntp || !box.synchronized }"
                    >
                        {{ ntpText }}
                    </span>
                </p>
                <p class="time__drift" :role="driftLevel === 'ok' ? undefined : 'alert'">
                    <span>{{ driftText }}</span>
                    <span class="time__device">{{ t('admin.time.device', { time: deviceText }) }}</span>
                </p>
                <p v-if="driftLevel === 'strong'" class="time__strong">{{ t('admin.time.strongHint') }}</p>
            </template>
            <p v-else-if="loadText === ''" class="time__loading">{{ t('admin.time.loading') }}</p>
        </div>

        <ul v-if="box !== null" class="time__list">
            <li class="time__row">
                <label class="time__text" for="time-zone">
                    <span class="time__name">{{ t('admin.time.timezone') }}</span>
                    <span class="time__hint">{{ t('admin.time.timezoneHint') }}</span>
                </label>
                <div class="time__controls">
                    <input
                        v-model="zoneFilter"
                        type="search"
                        class="time__select time__filter"
                        :aria-label="t('admin.time.zoneFilter')"
                        :placeholder="t('admin.time.zoneFilter')"
                        :disabled="busy || zones.length === 0"
                    />
                    <select id="time-zone" v-model="zone" class="time__select" :disabled="busy || zones.length === 0">
                        <option v-if="shownZones.length === 0" disabled value="">{{ t('admin.time.zoneNone') }}</option>
                        <option v-for="name in shownZones" :key="name" :value="name">{{ name }}</option>
                    </select>
                    <AdminButton
                        v-if="zoneChanged"
                        variant="quiet"
                        :disabled="busy"
                        :busy="setting"
                        @click="applyZone"
                    >
                        {{ t('admin.time.applyZone') }}
                    </AdminButton>
                </div>
            </li>

            <li class="time__row">
                <div class="time__text">
                    <span class="time__name">{{ t('admin.time.ntp') }}</span>
                    <span class="time__hint">{{ t('admin.time.ntpHint') }}</span>
                </div>
                <AdminButton
                    v-if="!box.ntp"
                    variant="quiet"
                    :disabled="busy"
                    :busy="setting && confirming === null"
                    @click="askNtp"
                >
                    {{ t('admin.time.useNtp') }}
                </AdminButton>
                <AdminButton v-else variant="quiet" :disabled="busy" :busy="setting" @click="stopNtp">
                    {{ t('admin.time.stopNtp') }}
                </AdminButton>
            </li>

            <li class="time__row">
                <label class="time__text" for="time-manual">
                    <span class="time__name">{{ t('admin.time.manualTitle') }}</span>
                    <span class="time__hint">
                        {{ t('admin.time.manualHint', { zone: box.timezone || t('admin.time.noZone') }) }}
                    </span>
                    <span v-if="manualProblem !== null" class="time__problem" role="alert">
                        {{ t(`admin.time.manualProblem.${manualProblem}`, { zone: box.timezone }) }}
                    </span>
                </label>
                <div class="time__controls">
                    <input
                        id="time-manual"
                        v-model="manual"
                        type="datetime-local"
                        step="1"
                        class="time__select"
                        min="2020-01-01T00:00"
                        :disabled="busy"
                        @input="manualTouched = true"
                    />
                    <AdminButton variant="quiet" :disabled="busy || manual === ''" :busy="setting" @click="askManual">
                        {{ t('admin.time.manualSet') }}
                    </AdminButton>
                </div>
            </li>

            <li v-if="!box.synchronized" class="time__row">
                <div class="time__text">
                    <span class="time__name">{{ t('admin.time.setFromDevice') }}</span>
                    <span class="time__hint">{{ t('admin.time.setFromDeviceHint') }}</span>
                </div>
                <AdminButton variant="quiet" :disabled="busy" @click="confirming = 'device'">
                    {{ t('admin.time.setFromDevice') }}
                </AdminButton>
            </li>
        </ul>

        <div v-if="time.restartRequired" class="time__note time__restart fade-in" role="status">
            <p class="time__note-title">{{ t('admin.time.restartRequired') }}</p>
            <p class="time__note-hint">
                {{ selfRestarting ? t('admin.time.serverRestarting') : t('admin.time.restartHint') }}
            </p>
            <div class="time__note-actions">
                <AdminButton
                    v-if="offerServer"
                    :disabled="busy"
                    :busy="admin.busy === 'services_restart'"
                    @click="restart(SELF_SERVICE_ID)"
                >
                    {{ t('admin.time.restartServer') }}
                </AdminButton>
                <AdminButton v-if="offerKiosk" variant="quiet" :disabled="busy" @click="restart(KIOSK_ID)">
                    {{ t('admin.time.restartKiosk') }}
                </AdminButton>
                <AdminButton variant="quiet" :disabled="busy" @click="time.dismissRestart()">
                    {{ t('admin.time.later') }}
                </AdminButton>
            </div>
        </div>

        <div v-if="unconfirmedText !== ''" class="time__note time__unconfirmed fade-in" role="status">
            <p class="time__note-title">{{ t('admin.time.unconfirmed.title') }}</p>
            <p class="time__note-hint">{{ unconfirmedText }}</p>
            <div class="time__note-actions">
                <AdminButton v-if="!settled" variant="quiet" :disabled="busy" @click="time.checkAgain()">
                    {{ t('admin.time.unconfirmed.check') }}
                </AdminButton>
                <AdminButton v-else variant="quiet" @click="time.dismissUnconfirmed()">
                    {{ t('admin.time.unconfirmed.dismiss') }}
                </AdminButton>
            </div>
        </div>

        <div v-if="failureText !== '' || loadText !== ''" class="time__error fade-in" role="alert">
            <p v-if="partialText !== ''" class="time__partial">{{ partialText }}</p>
            <p>{{ failureText || loadText }}</p>
        </div>

        <BaseDialog
            :open="confirming === 'device'"
            :title="t('admin.time.deviceConfirmTitle')"
            :confirm-label="t('admin.time.deviceConfirm')"
            :cancel-label="t('dialog.cancel')"
            @confirm="confirm"
            @cancel="confirming = null"
        >
            <p class="time__dialog-hint">{{ t('admin.time.deviceConfirmHint', { time: deviceText }) }}</p>
            <p v-if="driftLevel === 'strong'" class="time__dialog-strong">
                {{ t('admin.time.stepWarning', { amount: amount(drift) }) }}
            </p>
        </BaseDialog>

        <BaseDialog
            :open="confirming === 'manual'"
            :title="t('admin.time.manualConfirmTitle')"
            :confirm-label="t('admin.time.manualConfirm')"
            :cancel-label="t('dialog.cancel')"
            @confirm="confirm"
            @cancel="confirming = null"
        >
            <p class="time__dialog-hint">
                {{ t('admin.time.manualConfirmHint', { time: manual.replace('T', ' '), zone: box?.timezone ?? '' }) }}
            </p>
            <p v-if="box?.ntp" class="time__dialog-strong">{{ t('admin.time.manualNtpOff') }}</p>
            <p v-if="Math.abs(manualStep) > TIME_STEP_CONFIRM_MS" class="time__dialog-strong">
                {{ t('admin.time.stepWarning', { amount: amount(manualStep) }) }}
            </p>
        </BaseDialog>

        <BaseDialog
            :open="confirming === 'ntp'"
            :title="t('admin.time.ntpConfirmTitle')"
            :confirm-label="t('admin.time.useNtp')"
            :cancel-label="t('dialog.cancel')"
            @confirm="confirm"
            @cancel="confirming = null"
        >
            <p class="time__dialog-strong">{{ t('admin.time.stepWarning', { amount: amount(drift) }) }}</p>
        </BaseDialog>
    </section>
</template>

<style scoped>
/* The clock face: the one large thing in the card. Its left rule takes the
   drift's colour, so the state reads before any sentence does. */
.time__face {
    display: grid;
    gap: var(--space-1);
    margin-block-start: var(--space-2);
    padding: var(--space-4) var(--space-4) var(--space-4) calc(var(--space-4) + 2px);
    border-inline-start: 2px solid var(--c-border-strong);
    background-image: linear-gradient(90deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0) 70%);
}

.time__face--warn {
    border-inline-start-color: var(--c-warn);
}

.time__face--strong {
    border-inline-start-color: var(--c-danger);
    background-image: linear-gradient(90deg, rgba(224, 86, 86, 0.12), rgba(224, 86, 86, 0) 75%);
}

.time__clock {
    font-size: clamp(2.25rem, 9vw, 3rem);
    font-weight: 300;
    letter-spacing: var(--tracking-tight);
    line-height: 1;
    font-variant-numeric: tabular-nums;
}

.time__date {
    color: var(--c-text-muted);
    font-size: 0.9375rem;
}

.time__meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    margin-block-start: var(--space-2);
    font-size: 0.875rem;
}

.time__ntp {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--c-text-muted);
}

.time__ntp::before {
    content: '';
    inline-size: 0.5rem;
    block-size: 0.5rem;
    border-radius: 50%;
    background-color: var(--c-text-muted);
}

.time__ntp--ok::before {
    background-color: var(--c-success);
}

.time__ntp--off::before {
    background-color: var(--c-warn);
}

.time__drift {
    display: grid;
    gap: var(--space-1);
    margin-block-start: var(--space-2);
    color: var(--c-text-muted);
    font-size: 0.875rem;
    line-height: 1.4;
}

.time__face--warn .time__drift > :first-child {
    color: var(--c-warn);
}

.time__face--strong .time__drift > :first-child {
    color: var(--c-danger-text);
    font-weight: 500;
}

.time__device {
    font-variant-numeric: tabular-nums;
}

.time__strong {
    margin-block-start: var(--space-1);
    color: var(--c-danger-text);
    font-size: 0.875rem;
    line-height: 1.4;
}

.time__loading {
    color: var(--c-text-muted);
    font-size: 0.875rem;
}

.time__list {
    margin-block-start: var(--space-2);
    border-block-start: 1px solid var(--c-border);
}

.time__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-2);
    border-block-end: 1px solid var(--c-border);
}

.time__text {
    display: grid;
    gap: var(--space-1);
    min-inline-size: 0;
}

.time__name {
    font-size: 1rem;
}

.time__hint {
    color: var(--c-text-muted);
    font-size: 0.875rem;
    line-height: 1.4;
}

.time__controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
}

.time__select {
    min-block-size: 2.75rem;
    max-inline-size: 14rem;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--radius-md);
    background-color: var(--c-surface);
    color: var(--c-text);
    font: inherit;
    font-size: 0.9375rem;
}

.time__filter {
    max-inline-size: 9rem;
}

.time__problem {
    color: var(--c-danger-text);
    font-size: 0.875rem;
}

.time__select:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
}

.time__note {
    display: grid;
    gap: var(--space-2);
    margin-block-start: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid rgba(224, 163, 86, 0.35);
    border-radius: var(--radius-md);
    background-color: rgba(52, 38, 20, 0.6);
}

.time__note-title {
    color: var(--c-warn);
    font-weight: 500;
}

.time__note-hint {
    color: var(--c-text-muted);
    font-size: 0.875rem;
    line-height: 1.4;
}

.time__note-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-block-start: var(--space-2);
}

.time__error {
    display: grid;
    gap: var(--space-1);
    margin-block-start: var(--space-3);
    padding-inline: var(--space-2);
    color: var(--c-danger-text);
    font-size: 0.875rem;
    line-height: 1.4;
}

.time__partial {
    color: var(--c-warn);
}

.time__dialog-hint {
    color: var(--c-text-muted);
    font-size: 0.9375rem;
    line-height: 1.45;
}

.time__dialog-strong {
    margin-block-start: var(--space-3);
    color: var(--c-danger-text);
    font-size: 0.9375rem;
    line-height: 1.45;
}

@media (max-width: 479px) {
    .time__row {
        flex-direction: column;
        align-items: stretch;
    }

    .time__controls {
        justify-content: stretch;
    }

    .time__select,
    .time__filter {
        flex: 1;
        max-inline-size: none;
    }
}
</style>
