<!--
    Modal sheet: copy one day onto other days. The parent writes; this only
    collects the targets and the confirmation when days would be replaced.
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { WEEKDAYS, WEEKEND, WORKDAYS } from '../../protocol/schedule';

const props = defineProps<{
    day: number;
    /** Number of periods each day holds now, by ISO day. */
    counts: Record<number, number>;
    locked: boolean;
    busy: boolean;
    /** Failure of the last attempt: the sheet hides the editor banner, so it is repeated here. */
    error?: string;
}>();

const emit = defineEmits<{ cancel: []; copy: [targets: number[]] }>();

const { t, locale } = useI18n();

const targets = ref<number[]>([]);
const confirming = ref(false);
const sheet = ref<HTMLElement | null>(null);

function dayName(d: number): string {
    return t(`schedule.dayName.${d}`);
}

function toggle(d: number): void {
    confirming.value = false;
    targets.value = targets.value.includes(d) ? targets.value.filter((x) => x !== d) : [...targets.value, d].sort();
}

function pick(list: readonly number[]): void {
    confirming.value = false;
    targets.value = list.filter((d) => d !== props.day);
}

const occupied = computed(() => targets.value.filter((d) => (props.counts[d] ?? 0) > 0));

const confirmText = computed(() => {
    const parts = occupied.value.map((d) => t('schedule.copy.periods', { day: dayName(d), count: props.counts[d] }, props.counts[d]));
    const list = parts.length > 1 ? t('schedule.copy.and', { list: parts.slice(0, -1).join(', '), last: parts.at(-1) }) : (parts[0] ?? '');
    const text = t('schedule.copy.confirm', { targets: list, source: dayName(props.day) }, parts.length);
    return text.charAt(0).toLocaleUpperCase(locale.value) + text.slice(1);
});

function submit(): void {
    if (occupied.value.length > 0 && !confirming.value) {
        confirming.value = true;
        return;
    }
    emit('copy', [...targets.value]);
}

function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        emit('cancel');
        return;
    }
    if (event.key !== 'Tab' || !sheet.value) return;
    const items = [...sheet.value.querySelectorAll<HTMLElement>('button:not(:disabled)')];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

onMounted(() => void nextTick(() => sheet.value?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()));
</script>

<template>
    <div class="sheet" @click.self="emit('cancel')" @keydown="onKey">
        <section ref="sheet" class="sheet__box" role="dialog" aria-modal="true" aria-labelledby="copy-title">
            <h3 id="copy-title" class="sheet__title">{{ t('schedule.copy.title', { day: dayName(day) }) }}</h3>

            <div class="sheet__days">
                <button
                    v-for="d in WEEKDAYS"
                    :key="d"
                    type="button"
                    class="sheet__day"
                    :class="{ 'sheet__day--source': d === day }"
                    :aria-pressed="targets.includes(d)"
                    :aria-label="d === day ? `${dayName(d)}, ${t('schedule.copy.source')}` : dayName(d)"
                    :disabled="d === day || locked || busy"
                    @click="toggle(d)"
                >
                    <span>{{ targets.includes(d) ? '✓ ' : '' }}{{ t(`schedule.dayShort.${d}`) }}</span>
                    <small v-if="d === day" aria-hidden="true">{{ t('schedule.copy.source') }}</small>
                </button>
            </div>

            <div class="sheet__shortcuts">
                <button type="button" class="sheet__chip" :disabled="locked || busy" @click="pick(WORKDAYS)">{{ t('schedule.copy.workdays') }}</button>
                <button type="button" class="sheet__chip" :disabled="locked || busy" @click="pick(WEEKEND)">{{ t('schedule.copy.weekend') }}</button>
                <button type="button" class="sheet__chip" :disabled="locked || busy" @click="pick(WEEKDAYS)">{{ t('schedule.copy.all') }}</button>
            </div>

            <p class="sheet__warn">{{ t('schedule.copy.warning') }}</p>

            <div v-if="confirming" class="sheet__confirm" role="alert">
                <strong>{{ t('schedule.copy.confirmTitle') }}</strong>
                <p>{{ confirmText }}</p>
            </div>

            <p v-if="error" class="sheet__error" role="alert">{{ error }}</p>

            <div class="sheet__actions">
                <button type="button" class="sheet__button" @click="confirming ? (confirming = false) : emit('cancel')">
                    {{ t('schedule.copy.cancel') }}
                </button>
                <button type="button" class="sheet__button sheet__button--primary" :disabled="locked || busy || targets.length === 0" @click="submit">
                    {{ confirming ? t('schedule.copy.replace') : t('schedule.copy.submit', { n: targets.length }, targets.length) }}
                </button>
            </div>
        </section>
    </div>
</template>

<style scoped>
.sheet__error {
    margin: 0;
    color: var(--c-danger-text);
    font-size: 0.9rem;
}

.sheet {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-3);
    background: var(--c-scrim);
}

.sheet__box {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    inline-size: min(100%, 28rem);
    padding: var(--space-4);
    background: var(--c-surface-raised);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--radius-md);
}

.sheet__title {
    margin: 0;
    font-size: 1.125rem;
}

.sheet__days,
.sheet__shortcuts,
.sheet__actions {
    display: flex;
    gap: var(--space-1);
}

.sheet__days {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
}

.sheet__shortcuts {
    flex-wrap: wrap;
}

.sheet__actions {
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
}

.sheet__day,
.sheet__chip,
.sheet__button {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-block-size: 44px;
    min-inline-size: 44px;
    padding: 0 var(--space-2);
    font: inherit;
    color: var(--c-text);
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    cursor: pointer;
}

.sheet__day {
    min-inline-size: 0;
    padding: 0;
}

.sheet__day small {
    font-size: 0.625rem;
}

.sheet__day--source {
    color: var(--c-text-muted);
    background: var(--c-track);
}

.sheet__day[aria-pressed='true'],
.sheet__button--primary {
    color: var(--c-on-accent);
    background: var(--c-accent);
    border-color: var(--c-accent);
}

.sheet__day:focus-visible,
.sheet__chip:focus-visible,
.sheet__button:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
}

button:disabled {
    cursor: not-allowed;
    opacity: 0.65;
}

.sheet__warn,
.sheet__confirm p {
    margin: 0;
    font-size: 0.875rem;
    color: var(--c-text-muted);
}

.sheet__confirm {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    background: var(--c-warn-bg);
    border: 1px solid var(--c-warn-border);
    border-radius: var(--radius-md);
}

@media (max-width: 40rem) {
    .sheet {
        align-items: flex-end;
        padding: 0;
    }

    .sheet__box {
        inline-size: 100%;
        border-end-end-radius: 0;
        border-end-start-radius: 0;
    }
}
</style>
