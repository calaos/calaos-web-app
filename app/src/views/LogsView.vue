<script setup lang="ts">
// The box's journal: filters, paging by cursor and follow. Every filter
// change is a fresh search (a cursor only continues its own query). Follow
// stops when the page goes or the tab is hidden, and resumes from the same
// cursor when the tab comes back, so nothing is missed.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import IconChevron from '~icons/mdi/chevron-down';
import IconDownload from '~icons/mdi/download-outline';
import IconFilter from '~icons/mdi/filter-variant';
import IconLock from '~icons/mdi/lock-outline';
import { LOG_PRIORITIES, LOG_SOURCES_MAX, LOG_TEXT_MAX, logQueryProblem, logsFileName, logsText } from '../protocol/admin-logs';
import type { LogPriorityName } from '../protocol/admin-logs';
import { toTimeParam } from '../protocol/admin-time';
import { LOG_ROWS_MAX, useAdminLogsStore } from '../stores/adminLogs';
import type { LogFilter } from '../stores/adminLogs';
import { useAdminStore } from '../stores/admin';
import { useAdminText } from '../composables/useAdminText';
import AdminButton from '../components/admin/AdminButton.vue';
import AdminPageHeader from '../components/admin/AdminPageHeader.vue';
import LogRow from '../components/admin/LogRow.vue';

type Range = 'min15' | 'hour1' | 'hours24' | 'days7' | 'custom';

const RANGES: { id: Range; ms: number }[] = [
    { id: 'min15', ms: 15 * 60_000 },
    { id: 'hour1', ms: 3_600_000 },
    { id: 'hours24', ms: 86_400_000 },
    { id: 'days7', ms: 7 * 86_400_000 },
    { id: 'custom', ms: 0 },
];
const TEXT_DEBOUNCE_MS = 400;
/** Closer than this to the bottom counts as "at the live edge". */
const STICK_PX = 48;

const { t, te, locale } = useI18n();
const router = useRouter();
const admin = useAdminStore();
const logs = useAdminLogsStore();
const { errorText } = useAdminText();

const selected = ref<string[]>(['system']);
const priority = ref<LogPriorityName>('info');
const range = ref<Range>('hours24');
const customSince = ref('');
const customUntil = ref('');
const text = ref('');
const searchText = ref('');

const scroller = ref<HTMLElement | null>(null);
const stick = ref(true);
const unseen = ref(0);
let textTimer: ReturnType<typeof setTimeout> | null = null;
/** Follow was on when the tab was hidden: it comes back with the tab. */
const resumeOnShow = ref(false);
const loadingOlder = ref(false);
/** Narrow screens only: on wide ones the filters always sit beside the journal. */
const filtersOpen = ref(false);
let leaving = false;

const sourceIds = computed(() => logs.sources?.map((source) => source.id) ?? []);
const full = computed(() => selected.value.length >= LOG_SOURCES_MAX);

function sourceLabel(id: string): string {
    const key = `admin.logs.source.${id}`;
    if (te(key)) return t(key);
    return logs.sources?.find((source) => source.id === id)?.label || id;
}

const labels = computed(() => {
    void locale.value;
    return Object.fromEntries(sourceIds.value.map((id) => [id, sourceLabel(id)]));
});

/** Under "Whole system" every row says `system`: its unit tells more. */
function rowLabel(source: string, unit: string): string {
    if (source === 'system' && unit !== '') return unit.replace(/\.service$/, '');
    return labels.value[source] ?? source;
}

/** "Whole system" stands alone; picking any other source replaces it. */
function toggleSource(id: string): void {
    const current = selected.value;
    if (id === 'system') {
        selected.value = ['system'];
        return;
    }
    const rest = current.filter((s) => s !== 'system');
    if (rest.includes(id)) {
        const next = rest.filter((s) => s !== id);
        selected.value = next.length === 0 ? ['system'] : next;
    } else if (rest.length < LOG_SOURCES_MAX) {
        selected.value = [...rest, id];
    }
}

/** `datetime-local` is the browser's local time; the box wants UTC. */
function fromLocalInput(value: string): string | undefined {
    if (value === '') return undefined;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? toTimeParam(ms) : undefined;
}

const filter = computed<LogFilter>(() => {
    const next: LogFilter = { sources: [...selected.value], priority: priority.value };
    if (range.value === 'custom') {
        next.since = fromLocalInput(customSince.value);
        next.until = fromLocalInput(customUntil.value);
    } else {
        const ms = RANGES.find((r) => r.id === range.value)?.ms ?? 0;
        next.since = toTimeParam(Date.now() - ms);
    }
    if (searchText.value !== '') next.text = searchText.value;
    return next;
});

const problem = computed(() => logQueryProblem(filter.value));

/** What the folded filter bar still says: which sources, over which period. */
const filterSummary = computed(() =>
    t('admin.logs.filtersSummary', {
        sources: selected.value.map((id) => labels.value[id] ?? id).join(', '),
        range: t(`admin.logs.range.${range.value}`),
    }),
);
/** A range that ends in the past has no live edge. */
const canFollow = computed(() => filter.value.until === undefined && problem.value === '');

const showHaproxyHint = computed(() => selected.value.includes('haproxy'));

const errorLine = computed(() => {
    const error = logs.error;
    if (error === null) return '';
    // While following, a refusal is the box asking to slow down: the status says so.
    if (error.code === 'rate_limited' && logs.following) return '';
    return errorText(error);
});

const statusLine = computed(() => {
    if (logs.following && logs.backoffMs > 0) {
        return t('admin.logs.slowedDown', { seconds: Math.round(logs.backoffMs / 1000) });
    }
    if (logs.following) return t('admin.logs.live');
    if (resumeOnShow.value) return t('admin.logs.paused');
    return '';
});

const countLine = computed(() => t('admin.logs.count', { count: logs.entries.length }, logs.entries.length));

/** The line above the first row: why there is nothing older, or what to do. */
const topLine = computed(() => {
    if (logs.capped) return t('admin.logs.capped', { max: LOG_ROWS_MAX });
    if (logs.olderExhausted) return logs.hasEntries ? t('admin.logs.start') : '';
    if (logs.truncated) return t('admin.logs.truncated');
    if (logs.incomplete) return t('admin.logs.incomplete');
    return '';
});

function atBottom(el: HTMLElement): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
}

function onScroll(): void {
    const el = scroller.value;
    if (el === null) return;
    stick.value = atBottom(el);
    if (stick.value) unseen.value = 0;
}

function scrollToEnd(): void {
    const el = scroller.value;
    if (el !== null) el.scrollTop = el.scrollHeight;
    stick.value = true;
    unseen.value = 0;
}

async function runSearch(): Promise<void> {
    if (problem.value !== '') return;
    if (!canFollow.value) stopFollowing();
    stick.value = true;
    unseen.value = 0;
    await logs.search(filter.value);
    await nextTick();
    scrollToEnd();
}

async function loadOlder(): Promise<void> {
    const el = scroller.value;
    const before = el === null ? 0 : el.scrollHeight - el.scrollTop;
    loadingOlder.value = true;
    await logs.loadOlder();
    loadingOlder.value = false;
    await nextTick();
    // Keep the rows that were on screen where they were.
    if (el !== null) el.scrollTop = el.scrollHeight - before;
}

function startFollowing(): void {
    if (!canFollow.value) return;
    resumeOnShow.value = false;
    logs.startFollow();
    scrollToEnd();
}

function stopFollowing(): void {
    resumeOnShow.value = false;
    logs.stopFollow();
}

function toggleFollow(): void {
    if (logs.following) stopFollowing();
    else startFollowing();
}

function download(): void {
    const blob = new Blob([logsText(logs.entries)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = logsFileName(new Date());
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

function onVisibility(): void {
    if (document.visibilityState === 'hidden') {
        if (logs.following) {
            logs.stopFollow();
            resumeOnShow.value = true;
        }
    } else if (resumeOnShow.value) {
        resumeOnShow.value = false;
        if (canFollow.value) logs.startFollow();
    }
}

watch(text, (value) => {
    if (textTimer !== null) clearTimeout(textTimer);
    textTimer = setTimeout(() => {
        textTimer = null;
        searchText.value = value.trim();
    }, TEXT_DEBOUNCE_MS);
});

watch([selected, priority, range, customSince, customUntil, searchText], () => {
    void runSearch();
});

// New rows at the bottom: follow them, or count them while the user reads above.
watch(
    () => logs.entries,
    (next, prev) => {
        const lastBefore = prev.at(-1)?.cursor;
        if (lastBefore === undefined || next.at(-1)?.cursor === lastBefore) return;
        if (stick.value) {
            void nextTick(scrollToEnd);
            return;
        }
        const index = next.findIndex((entry) => entry.cursor === lastBefore);
        unseen.value += index < 0 ? next.length : next.length - 1 - index;
    },
);

watch(
    () => admin.gate,
    (gate) => {
        if (gate !== 'unlocked' && gate !== 'idle' && gate !== 'probing' && !leaving) {
            void router.replace({ name: 'admin' });
        }
    },
);

onMounted(() => {
    document.addEventListener('visibilitychange', onVisibility);
    if (logs.sources === null) void logs.loadSources();
    void runSearch();
});

onBeforeUnmount(() => {
    leaving = true;
    document.removeEventListener('visibilitychange', onVisibility);
    if (textTimer !== null) clearTimeout(textTimer);
    logs.reset();
});
</script>

<template>
    <div class="logs-view">
        <AdminPageHeader class="logs-view__head" :title="t('admin.logs.title')" />

        <aside class="logs-side fade-in" :aria-label="t('admin.logs.filters')">
            <div class="logs-side__bar">
                <p class="logs__status" role="status" aria-live="polite">
                    <span class="logs__count">{{ countLine }}</span>
                    <span
                        v-if="statusLine !== ''"
                        class="logs__live"
                        :class="{ 'logs__live--on': logs.following && logs.backoffMs === 0, 'logs__live--slow': logs.backoffMs > 0 }"
                    >
                        {{ statusLine }}
                    </span>
                </p>
                <div class="logs__actions">
                    <button
                        type="button"
                        class="logs__follow pressable"
                        :aria-pressed="logs.following"
                        :disabled="!canFollow"
                        :title="canFollow ? undefined : t('admin.logs.followNeedsNow')"
                        @click="toggleFollow"
                    >
                        <span class="logs__follow-dot" aria-hidden="true" />
                        {{ t('admin.logs.follow') }}
                    </button>
                    <AdminButton
                        v-if="logs.canLoadOlder && (logs.hasEntries || logs.incomplete)"
                        variant="quiet"
                        :busy="loadingOlder"
                        @click="loadOlder"
                    >
                        {{ t('admin.logs.loadOlder') }}
                    </AdminButton>
                    <AdminButton
                        class="logs__download"
                        variant="quiet"
                        :disabled="!logs.hasEntries"
                        :title="t('admin.logs.download')"
                        @click="download"
                    >
                        <IconDownload aria-hidden="true" class="logs__icon" />
                        <span class="logs__download-label">{{ t('admin.logs.download') }}</span>
                    </AdminButton>
                </div>
                <button
                    type="button"
                    class="logs__filters-toggle"
                    :aria-expanded="filtersOpen"
                    aria-controls="logs-filters"
                    @click="filtersOpen = !filtersOpen"
                >
                    <IconFilter aria-hidden="true" class="logs__icon" />
                    <span class="logs__filters-text">
                        <span class="logs__filters-name">{{ filtersOpen ? t('admin.logs.filtersHide') : t('admin.logs.filters') }}</span>
                        <span class="logs__filters-summary">{{ filterSummary }}</span>
                    </span>
                    <IconChevron aria-hidden="true" class="logs__chevron" :class="{ 'logs__chevron--open': filtersOpen }" />
                </button>
            </div>

            <div id="logs-filters" class="logs__filters" :class="{ 'logs__filters--open': filtersOpen }">
                <fieldset class="logs__group logs__sources">
                    <legend class="logs__label">{{ t('admin.logs.sources', { max: LOG_SOURCES_MAX }) }}</legend>
                    <div class="logs__chips">
                        <button
                            v-for="id in sourceIds"
                            :key="id"
                            type="button"
                            class="logs__chip pressable"
                            :aria-pressed="selected.includes(id)"
                            :disabled="!selected.includes(id) && id !== 'system' && full"
                            @click="toggleSource(id)"
                        >
                            {{ labels[id] }}
                        </button>
                    </div>
                </fieldset>

                <label class="logs__group">
                    <span class="logs__label">{{ t('admin.logs.priorityLabel') }}</span>
                    <select v-model="priority" class="logs__select">
                        <option v-for="name in LOG_PRIORITIES" :key="name" :value="name">
                            {{ t(`admin.logs.priorityUpTo.${name}`) }}
                        </option>
                    </select>
                </label>

                <div class="logs__group">
                    <span id="logs-range-label" class="logs__label">{{ t('admin.logs.rangeLabel') }}</span>
                    <div class="logs__ranges" role="radiogroup" aria-labelledby="logs-range-label">
                        <button
                            v-for="item in RANGES"
                            :key="item.id"
                            type="button"
                            role="radio"
                            class="logs__range pressable"
                            :aria-checked="range === item.id"
                            @click="range = item.id"
                        >
                            {{ t(`admin.logs.range.${item.id}`) }}
                        </button>
                    </div>
                    <div v-if="range === 'custom'" class="logs__custom">
                        <label class="logs__date">
                            <span class="logs__label">{{ t('admin.logs.since') }}</span>
                            <input v-model="customSince" type="datetime-local" class="logs__input logs__input--date" step="1" />
                        </label>
                        <label class="logs__date">
                            <span class="logs__label">{{ t('admin.logs.until') }}</span>
                            <input v-model="customUntil" type="datetime-local" class="logs__input logs__input--date" step="1" />
                        </label>
                        <p v-if="problem === 'since'" class="logs__problem" role="alert">{{ t('admin.logs.badRange') }}</p>
                    </div>
                </div>

                <label class="logs__group">
                    <span class="visually-hidden">{{ t('admin.logs.searchLabel') }}</span>
                    <input
                        v-model="text"
                        type="search"
                        class="logs__input"
                        :maxlength="LOG_TEXT_MAX"
                        :placeholder="t('admin.logs.searchPlaceholder')"
                        autocomplete="off"
                        spellcheck="false"
                    />
                </label>

                <div class="logs__notes">
                    <p class="logs__masked">
                        <IconLock aria-hidden="true" class="logs__icon" />
                        <span>{{ t('admin.logs.masked') }}</span>
                    </p>
                    <p v-if="showHaproxyHint" class="logs__hint">{{ t('admin.logs.haproxyHint') }}</p>
                </div>
            </div>
        </aside>

        <section class="logs fade-in" :aria-label="t('admin.logs.title')">
            <div ref="scroller" class="logs__scroller" tabindex="0" :aria-label="t('admin.logs.listLabel')" @scroll.passive="onScroll">
                <p v-if="topLine !== ''" class="logs__top-line" :class="{ 'logs__top-line--warn': logs.incomplete || logs.truncated }">
                    {{ topLine }}
                </p>

                <ol v-if="logs.hasEntries" class="logs__list">
                    <LogRow
                        v-for="entry in logs.entries"
                        :key="entry.cursor"
                        v-memo="[entry, labels]"
                        :entry="entry"
                        :source-label="rowLabel(entry.source, entry.unit)"
                    />
                </ol>
                <p v-else-if="logs.loading || logs.waiting" class="logs__empty">{{ t('admin.logs.loading') }}</p>
                <p v-else-if="logs.error === null" class="logs__empty">{{ t('admin.logs.empty') }}</p>

                <span v-if="logs.following" class="logs__edge" aria-hidden="true" />
            </div>

            <button v-if="logs.following && !stick" type="button" class="logs__jump pressable" @click="scrollToEnd">
                {{ unseen > 0 ? t('admin.logs.jumpCount', { count: unseen }, unseen) : t('admin.logs.jump') }}
            </button>

            <p v-if="errorLine !== ''" class="logs__error fade-in" role="alert">{{ errorLine }}</p>
        </section>
    </div>
</template>

<style scoped>
/* Narrow first: title, a compact bar whose filters fold away, then the
   journal taking the rest of the height. From 1024px the bar and the filters
   become a column beside a journal that runs the full height. */
.logs-view {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto minmax(0, 1fr);
    grid-template-areas:
        'head'
        'side'
        'journal';
    gap: var(--space-3);
    block-size: 100%;
    inline-size: 100%;
    max-inline-size: 120rem;
    margin-inline: auto;
    padding: var(--space-3) var(--space-4) var(--space-4);
}

.logs-view__head {
    grid-area: head;
}

/* The trail already says where this is; the big title would cost the journal a line. */
.logs-view__head :deep(.page-head__title) {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}

.logs-side {
    grid-area: side;
    display: flex;
    flex-direction: column;
    min-block-size: 0;
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    background-color: var(--c-surface);
    overflow: hidden;
}

.logs-side__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-2) var(--space-3);
    background-image: linear-gradient(var(--c-chrome-top), var(--c-chrome-bottom));
}

.logs__status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-3);
    margin-inline-end: auto;
    font-size: 0.875rem;
    color: var(--c-text-muted);
}

.logs__count {
    font-variant-numeric: tabular-nums;
}

.logs__live--on {
    color: var(--c-accent);
}

.logs__live--slow {
    color: var(--c-warn);
}

.logs__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}

.logs__icon {
    font-size: 1.125rem;
    flex: none;
}

/* Follow is a state, not an action: it stays lit while on. */
.logs__follow {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-block-size: 2.75rem;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--radius-md);
    background: none;
    color: var(--c-text);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    transition:
        border-color var(--duration-fade) ease,
        color var(--duration-fade) ease,
        box-shadow var(--duration-fade) ease;
}

.logs__follow-dot {
    inline-size: 0.5rem;
    block-size: 0.5rem;
    border-radius: 50%;
    background-color: var(--c-text-muted);
}

.logs__follow[aria-pressed='true'] {
    border-color: var(--c-accent);
    color: var(--c-accent);
    box-shadow: 0 0 14px var(--c-accent-glow);
}

.logs__follow[aria-pressed='true'] .logs__follow-dot {
    background-color: var(--c-accent);
    box-shadow: 0 0 6px var(--c-accent);
}

.logs__follow:disabled {
    border-color: var(--c-border);
    color: var(--c-text-muted);
    cursor: not-allowed;
}

.logs__filters-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex: 1 1 100%;
    min-block-size: 2.75rem;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--radius-md);
    background-color: var(--c-bg);
    color: var(--c-text);
    font: inherit;
    text-align: start;
    cursor: pointer;
}

.logs__filters-text {
    display: grid;
    flex: 1;
    min-inline-size: 0;
}

.logs__filters-name {
    font-size: 0.9375rem;
    font-weight: 500;
}

.logs__filters-summary {
    overflow: hidden;
    color: var(--c-text-muted);
    font-size: 0.8125rem;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.logs__chevron {
    flex: none;
    font-size: 1.375rem;
    color: var(--c-text-muted);
    transition: transform var(--duration-slide) cubic-bezier(0.22, 0.61, 0.36, 1);
}

.logs__chevron--open {
    transform: rotate(180deg);
}

/* ---- filters ---------------------------------------------------------- */

.logs__filters {
    display: none;
    gap: var(--space-4);
    max-block-size: 55dvh;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--space-4);
    border-block-start: 1px solid var(--c-chrome-hairline);
}

.logs__filters--open {
    display: grid;
}

.logs__group {
    display: grid;
    gap: var(--space-2);
    min-inline-size: 0;
    margin: 0;
    padding: 0;
    border: 0;
}

.logs__label {
    padding: 0;
    color: var(--c-text-muted);
    font-size: 0.8125rem;
}

.logs__chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}

.logs__chip {
    flex: none;
    min-block-size: 2.25rem;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--c-border-strong);
    border-radius: 999px;
    background: none;
    color: var(--c-text-muted);
    font: inherit;
    font-size: 0.875rem;
    cursor: pointer;
    white-space: nowrap;
}

.logs__chip:hover:not(:disabled) {
    color: var(--c-text);
}

.logs__chip[aria-pressed='true'] {
    border-color: var(--c-accent);
    background-color: rgba(56, 176, 211, 0.14);
    color: var(--c-text);
}

.logs__chip:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}

.logs__select,
.logs__input {
    inline-size: 100%;
    min-inline-size: 0;
    min-block-size: 2.5rem;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--radius-md);
    background-color: var(--c-bg);
    color: var(--c-text);
    font: inherit;
    font-size: 0.9375rem;
}

.logs__input--date {
    color-scheme: dark;
}

/* Segments that wrap as whole cells: the hairlines are the gaps. */
.logs__ranges {
    display: flex;
    flex-wrap: wrap;
    gap: 1px;
    border: 1px solid var(--c-border-strong);
    border-radius: var(--radius-md);
    background-color: var(--c-border);
    overflow: hidden;
}

.logs__range {
    flex: 1 1 auto;
    min-block-size: 2.5rem;
    padding: var(--space-2) var(--space-3);
    border: 0;
    background-color: var(--c-bg);
    color: var(--c-text-muted);
    font: inherit;
    font-size: 0.875rem;
    cursor: pointer;
    white-space: nowrap;
}

.logs__range[aria-checked='true'] {
    background-color: color-mix(in srgb, var(--c-accent) 24%, var(--c-bg));
    color: var(--c-accent);
}

.logs__custom {
    display: grid;
    gap: var(--space-2);
    margin-block-start: var(--space-1);
}

.logs__date {
    display: grid;
    gap: var(--space-1);
}

.logs__chip:focus-visible,
.logs__range:focus-visible,
.logs__follow:focus-visible,
.logs__filters-toggle:focus-visible,
.logs__jump:focus-visible,
.logs__select:focus-visible,
.logs__input:focus-visible,
.logs__scroller:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
}

.logs__problem {
    color: var(--c-danger-text);
    font-size: 0.875rem;
}

.logs__notes {
    display: grid;
    gap: var(--space-2);
}

.logs__masked,
.logs__hint {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    color: var(--c-text-muted);
    font-size: 0.8125rem;
    line-height: 1.4;
}

/* ---- the journal ------------------------------------------------------ */

.logs {
    grid-area: journal;
    position: relative;
    display: flex;
    flex-direction: column;
    min-block-size: 16rem;
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    background-color: var(--c-bg);
    overflow: hidden;
}

.logs__scroller {
    position: relative;
    flex: 1;
    min-block-size: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding-block: var(--space-2) var(--space-4);
    font-family: ui-monospace, 'Ubuntu Mono', 'DejaVu Sans Mono', Menlo, Consolas, monospace;
    font-size: 0.8125rem;
    line-height: 1.55;
}

.logs__top-line {
    padding: var(--space-1) var(--space-3) var(--space-3);
    color: var(--c-text-muted);
    font-family: var(--font-sans);
    font-size: 0.8125rem;
    line-height: 1.4;
}

.logs__top-line--warn {
    color: var(--c-warn);
}

.logs__empty {
    padding: var(--space-6) var(--space-4);
    color: var(--c-text-muted);
    font-family: var(--font-sans);
    font-size: 0.9375rem;
}

/* The live edge: the filament the dialogs wear on top, here under the
   newest line, breathing while the box is being followed. */
.logs__edge {
    position: sticky;
    inset-block-end: calc(-1 * var(--space-4));
    display: block;
    block-size: 2px;
    margin-block-start: var(--space-2);
    background-image: linear-gradient(90deg, transparent, var(--c-accent) 30%, var(--c-accent) 70%, transparent);
    box-shadow: 0 0 12px var(--c-accent-glow);
    animation: logs-breathe 2s ease-in-out infinite;
}

@keyframes logs-breathe {
    50% {
        opacity: 0.35;
    }
}

.logs__jump {
    position: absolute;
    inset-block-end: var(--space-4);
    inset-inline-start: 50%;
    translate: -50% 0;
    padding: var(--space-2) var(--space-4);
    border: 0;
    border-radius: 999px;
    background-color: var(--c-accent);
    color: #04222b;
    font: inherit;
    font-size: 0.875rem;
    font-weight: 500;
    box-shadow: 0 0 18px var(--c-accent-glow);
    cursor: pointer;
}

.logs__error {
    padding: var(--space-2) var(--space-4);
    border-block-start: 1px solid rgba(224, 86, 86, 0.35);
    background-color: rgba(224, 86, 86, 0.08);
    color: var(--c-danger-text);
    font-size: 0.875rem;
}

@media (max-width: 639px) {
    .logs-view {
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3) var(--space-3);
    }

    .logs__actions {
        flex-wrap: nowrap;
    }

    .logs__follow,
    .logs__actions :deep(.admin-button) {
        padding-block: var(--space-2);
        padding-inline: var(--space-3);
    }

    /* The icon says it; the label stays for screen readers. */
    .logs__download-label {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
    }

    .logs__filters-toggle {
        padding-block: var(--space-1);
    }

    .logs__filters {
        max-block-size: 45dvh;
    }
}

@media (min-width: 1024px) {
    .logs-view {
        grid-template-columns: minmax(18rem, 24rem) minmax(0, 1fr);
        grid-template-rows: auto minmax(0, 1fr);
        grid-template-areas:
            'head journal'
            'side journal';
        gap: var(--space-4) var(--space-6);
        padding: var(--space-6);
    }

    .logs-view__head :deep(.page-head__title) {
        position: static;
        inline-size: auto;
        block-size: auto;
        overflow: visible;
        clip-path: none;
        white-space: normal;
    }

    .logs-side {
        overflow-y: auto;
    }

    .logs-side__bar {
        display: grid;
        gap: var(--space-3);
        padding: var(--space-4);
        border-block-end: 1px solid var(--c-chrome-hairline);
    }

    .logs__actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
    }

    .logs__follow {
        grid-column: 1 / -1;
    }

    .logs__filters-toggle {
        display: none;
    }

    .logs__filters,
    .logs__filters--open {
        display: grid;
        align-content: start;
        max-block-size: none;
        overflow: visible;
        border-block-start: 0;
    }
}

@media (prefers-reduced-motion: reduce) {
    .logs__edge {
        animation: none;
    }

    .logs__follow,
    .logs__chevron {
        transition: none;
    }
}
</style>
