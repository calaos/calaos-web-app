<script setup lang="ts">
// The Admin hub: one tile per sub-page. The updates and network tiles also
// read the box's state: someone back after a reload, or at the box's new
// address, lands here first and must see what is waiting for them.

import { computed, onMounted } from 'vue';
import type { Component } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import IconChevron from '~icons/mdi/chevron-right';
import IconLogs from '~icons/mdi/text-box-search-outline';
import IconMcp from '~icons/mdi/robot-outline';
import IconNetwork from '~icons/mdi/lan';
import IconSecurity from '~icons/mdi/shield-lock-outline';
import IconServices from '~icons/mdi/application-cog-outline';
import IconSettings from '~icons/mdi/tune-variant';
import IconSystem from '~icons/mdi/server';
import IconTime from '~icons/mdi/clock-outline';
import IconUpdates from '~icons/mdi/update';
import { useAdminStore } from '../../stores/admin';
import { useAdminNetworkStore } from '../../stores/adminNetwork';
import { useAdminText } from '../../composables/useAdminText';
import { useNetworkCountdown } from '../../composables/useNetworkCountdown';
import { useUpdatesPhase } from '../../composables/useUpdatesPhase';
import type { UpdatesPhase } from '../../composables/useUpdatesPhase';

interface Tile {
    id: string;
    route: string;
    icon: Component;
    name: string;
    hint: string;
    tone: 'muted' | 'warn';
    disabled: boolean;
}

const { t } = useI18n();
const admin = useAdminStore();
const network = useAdminNetworkStore();
const { errorText } = useAdminText();
const { phase, headline } = useUpdatesPhase();

/** Something for the admin to act on or follow. */
const UPDATES_WARN: readonly UpdatesPhase[] = ['available', 'upgrading', 'failed', 'doneReboot'];

const countdown = useNetworkCountdown(() => network.pending?.deadline ?? null);
const waiting = computed(() => network.pending !== null && (countdown.seconds.value ?? 0) > 0);
/** An older daemon, say: this tile only, the rest of the page works. */
const networkProblem = computed(() => (network.error === null ? '' : errorText(network.error)));
/** A status read refused here has no other place on the hub to say so. */
const updatesProblem = computed(() =>
    admin.notice !== null && admin.noticeSource === 'updates' ? errorText(admin.notice) : '',
);

onMounted(() => {
    if (admin.isUnlocked) void network.load();
});

const tiles = computed<Tile[]>(() => {
    let networkHint = t('admin.network.entry.hint');
    if (waiting.value) {
        networkHint = t('admin.network.entry.pending', {
            intf: network.pending?.intf ?? '',
            time: countdown.clock.value,
        });
    } else if (networkProblem.value !== '') {
        networkHint = networkProblem.value;
    }
    let updatesHint = phase.value === 'unknown' ? t('admin.updates.entryHint') : headline.value;
    if (updatesProblem.value !== '') updatesHint = updatesProblem.value;
    return [
        {
            id: 'updates',
            route: 'adminUpdates',
            icon: IconUpdates,
            name: t('admin.updates.title'),
            hint: updatesHint,
            tone: updatesProblem.value !== '' || UPDATES_WARN.includes(phase.value) ? 'warn' : 'muted',
            disabled: false,
        },
        {
            id: 'network',
            route: 'adminNetwork',
            icon: IconNetwork,
            name: t('admin.network.entry.name'),
            hint: networkHint,
            tone: waiting.value || networkProblem.value !== '' ? 'warn' : 'muted',
            disabled: false,
        },
        {
            id: 'services',
            route: 'adminServices',
            icon: IconServices,
            name: t('admin.services.title'),
            hint: t('admin.services.entryHint'),
            tone: 'muted',
            disabled: false,
        },
        {
            id: 'logs',
            route: 'adminLogs',
            icon: IconLogs,
            name: t('admin.logs.title'),
            hint: t('admin.logs.openHint'),
            tone: 'muted',
            disabled: admin.busy !== null,
        },
        {
            id: 'time',
            route: 'adminTime',
            icon: IconTime,
            name: t('admin.time.title'),
            hint: t('admin.time.entryHint'),
            tone: 'muted',
            disabled: false,
        },
        {
            id: 'mcp',
            route: 'adminMcp',
            icon: IconMcp,
            name: t('admin.mcp.title'),
            hint: t('admin.mcp.entryHint'),
            tone: 'muted',
            disabled: false,
        },
        {
            id: 'security',
            route: 'adminSecurity',
            icon: IconSecurity,
            name: t('admin.security.title'),
            hint: t('admin.security.entryHint'),
            tone: 'muted',
            disabled: false,
        },
        {
            id: 'system',
            route: 'adminSystem',
            icon: IconSystem,
            name: t('admin.system.title'),
            hint: t('admin.system.entryHint'),
            tone: 'muted',
            disabled: false,
        },
        {
            id: 'settings',
            route: 'adminSettings',
            icon: IconSettings,
            name: t('admin.config.title'),
            hint: t('admin.config.entryHint'),
            tone: 'muted',
            disabled: false,
        },
    ];
});
</script>

<template>
    <nav class="pages" :aria-label="t('admin.pages.label')">
        <ul class="pages__grid">
            <li v-for="tile in tiles" :key="tile.id">
                <component
                    :is="tile.disabled ? 'span' : RouterLink"
                    class="pages__tile"
                    :class="{ 'pages__tile--warn': tile.tone === 'warn', 'pages__tile--off': tile.disabled }"
                    :data-page="tile.id"
                    :to="tile.disabled ? undefined : { name: tile.route }"
                    :aria-disabled="tile.disabled || undefined"
                >
                    <component :is="tile.icon" class="pages__icon" aria-hidden="true" />
                    <span class="pages__text">
                        <span class="pages__name">{{ tile.name }}</span>
                        <span class="pages__hint">{{ tile.hint }}</span>
                    </span>
                    <IconChevron class="pages__chevron" aria-hidden="true" />
                </component>
            </li>
        </ul>
    </nav>
</template>

<style scoped>
.pages__grid {
    display: grid;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
}

@media (min-width: 560px) {
    .pages__grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

.pages__tile {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--space-3);
    block-size: 100%;
    padding: var(--space-4);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    background-color: color-mix(in srgb, var(--c-surface) 85%, transparent);
    color: var(--c-text);
    text-decoration: none;
    transition:
        border-color var(--duration-fade) ease,
        box-shadow var(--duration-fade) ease;
}

a.pages__tile:hover {
    border-color: var(--c-accent);
    box-shadow: 0 0 14px var(--c-accent-glow);
}

a.pages__tile:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
}

.pages__tile--warn {
    border-color: color-mix(in srgb, var(--c-warn) 60%, transparent);
}

.pages__tile--off {
    opacity: 0.5;
    cursor: not-allowed;
}

.pages__icon {
    font-size: 1.75rem;
    color: var(--c-accent);
}

.pages__tile--warn .pages__icon {
    color: var(--c-warn);
}

.pages__text {
    display: grid;
    gap: var(--space-1);
    min-inline-size: 0;
}

.pages__name {
    font-size: 1.0625rem;
}

.pages__hint {
    color: var(--c-text-muted);
    font-size: 0.875rem;
    line-height: 1.4;
}

.pages__tile--warn .pages__hint {
    color: var(--c-warn);
    font-variant-numeric: tabular-nums;
}

.pages__chevron {
    font-size: 1.25rem;
    color: var(--c-text-muted);
}

@media (prefers-reduced-motion: reduce) {
    .pages__tile {
        transition: none;
    }
}
</style>
