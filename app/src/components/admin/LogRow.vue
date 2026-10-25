<script lang="ts">
// One formatter per locale for every row: building one is the costly part.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(locale: string): Intl.DateTimeFormat {
    let format = formatters.get(locale);
    if (format === undefined) {
        format = new Intl.DateTimeFormat(locale, {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            fractionalSecondDigits: 3,
            hour12: false,
        });
        formatters.set(locale, format);
    }
    return format;
}
</script>

<script setup lang="ts">
// One journal entry. Rows never change once read, so the list memoises them
// and each row formats its own time once.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { priorityName } from '../../protocol/admin-logs';
import type { LogEntry } from '../../protocol/admin-logs';

const props = defineProps<{ entry: LogEntry; sourceLabel: string }>();

const { t, locale } = useI18n();

const level = computed(() => priorityName(props.entry.priority));
const tone = computed(() => {
    const p = props.entry.priority;
    if (p <= 3) return 'danger';
    if (p === 4) return 'warn';
    return p === 7 ? 'muted' : 'normal';
});
const when = computed(() => {
    const ms = Date.parse(props.entry.ts);
    if (!Number.isFinite(ms)) return props.entry.ts;
    return formatterFor(locale.value).format(ms);
});
</script>

<template>
    <li class="log-row" :class="`log-row--${tone}`">
        <time class="log-row__time" :datetime="entry.ts" :title="entry.ts">{{ when }}</time>
        <span class="log-row__source" :title="entry.unit">{{ sourceLabel }}<template v-if="entry.pid !== null">[{{ entry.pid }}]</template></span>
        <span class="log-row__message"><span class="log-row__level" :class="{ 'visually-hidden': entry.priority > 4 }">{{ t(`admin.logs.priority.${level}`) }}</span>{{ entry.message }}<span v-if="entry.cut" class="log-row__cut" :title="t('admin.logs.cut')">{{ ' ' }}[…]</span></span>
    </li>
</template>

<style scoped>
.log-row {
    display: grid;
    /* Each row is its own grid: fixed tracks keep the columns aligned. */
    grid-template-columns: auto 20ch 1fr;
    column-gap: var(--space-3);
    align-items: baseline;
    padding: 0.125rem var(--space-3) 0.125rem calc(var(--space-3) - 2px);
    border-inline-start: 2px solid transparent;
    /* Off-screen rows skip layout and paint: thousands stay cheap. */
    content-visibility: auto;
    contain-intrinsic-size: auto 1.375rem;
}

.log-row:hover {
    background-color: rgba(255, 255, 255, 0.04);
}

.log-row--danger {
    border-inline-start-color: var(--c-danger);
    background-color: rgba(224, 86, 86, 0.06);
}

.log-row--warn {
    border-inline-start-color: var(--c-warn);
}

.log-row__time {
    color: var(--c-text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.log-row__source {
    overflow: hidden;
    color: var(--c-accent);
    white-space: nowrap;
    text-overflow: ellipsis;
}

.log-row__level {
    margin-inline-end: 0.75ch;
    font-weight: 700;
}

.log-row--danger .log-row__level {
    color: var(--c-danger-text);
}

.log-row--warn .log-row__level {
    color: var(--c-warn);
}

.log-row__message {
    min-inline-size: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.log-row--danger .log-row__message {
    color: var(--c-danger-text);
}

.log-row--muted .log-row__message {
    color: var(--c-text-muted);
}

.log-row__cut {
    color: var(--c-text-muted);
}

@media (max-width: 639px) {
    .log-row {
        grid-template-columns: auto minmax(0, 1fr);
    }

    .log-row__message {
        grid-column: 1 / -1;
    }
}
</style>
