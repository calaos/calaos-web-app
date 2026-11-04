<script setup lang="ts">
// The box's event log, like the mobile app's Events page: newest first, 50 per
// page, a detail per event with its picture. No filter and no live feed.

import { computed, onMounted, onUnmounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import IconLoading from '~icons/mdi/loading';
import IconPicture from '~icons/mdi/image-off-outline';
import IconRefresh from '~icons/mdi/refresh';
import AdminButton from '../components/admin/AdminButton.vue';
import IconPhoto from '~icons/mdi/image-outline';
import IconPush from '~icons/mdi/bell-outline';
import { STATE_ICONS } from '../components/io/calaos-icons';
import { resolveLightStyle } from '../components/io/light-styles';
import type { EventLogEvent } from '../protocol/eventlog';
import { describeEvent } from '../services/event-describe';
import type { EventIcon, EventIoInfo } from '../services/event-describe';
import { useEventsStore } from '../stores/events';
import { useHomeStore } from '../stores/home';

const { t, locale } = useI18n();
const events = useEventsStore();
const home = useHomeStore();

onMounted(() => events.refresh());
onUnmounted(() => {
    events.closeDetail();
});

function ioInfo(event: EventLogEvent): EventIoInfo | null {
    const io = home.getIo(event.ioId);
    if (!io) return null;
    const room = home.rooms.find((candidate) => candidate.ioIds.includes(io.id));
    return { name: io.name, guiType: io.guiType, ioStyle: io.ioStyle, room: room?.name ?? '' };
}

function dateOf(at: number): string {
    if (Number.isNaN(at)) return '';
    const date = new Date(at);
    if (date.toDateString() === new Date().toDateString()) return t('events.today');
    return new Intl.DateTimeFormat(locale.value, { dateStyle: 'short' }).format(date);
}

function timeOf(at: number): string {
    if (Number.isNaN(at)) return '';
    return new Intl.DateTimeFormat(locale.value, { timeStyle: 'medium', hour12: false }).format(new Date(at));
}

interface Row {
    id: string;
    title: string;
    room: string;
    action: string;
    icon: EventIcon;
    iconSrc: string;
    message: string;
    date: string;
    time: string;
    picUid: string;
}

// The same glyph files the room tiles use, so a row looks like its appliance.
function iconSource(icon: EventIcon, ioStyle: string): string {
    switch (icon) {
        case 'lightOn':
            return resolveLightStyle(ioStyle).imageOn;
        case 'lightOff':
            return resolveLightStyle(ioStyle).imageOff;
        case 'temp':
        case 'shutterOn':
        case 'shutterOff':
        case 'scenario':
            return STATE_ICONS[icon];
        default:
            return '';
    }
}

function toRow(event: EventLogEvent): Row {
    const summary = describeEvent(event, ioInfo(event));
    return {
        id: event.id,
        title: summary.ioName !== '' ? summary.ioName : t(summary.titleKey),
        room: summary.room,
        action: summary.actionKey === '' ? '' : t(summary.actionKey),
        icon: summary.icon,
        iconSrc: iconSource(summary.icon, summary.ioStyle),
        message: summary.message,
        date: dateOf(event.at),
        time: timeOf(event.at),
        picUid: event.picUid,
    };
}

const rows = computed(() => events.events.map(toRow));
const detailRow = computed(() => (events.detail ? toRow(events.detail) : null));

// The server's own error texts are never shown: a known key per failure.
function errorText(raw: string): string {
    return raw === 'not connected' ? t('events.error.offline') : t('events.error.generic');
}

const listError = computed(() => (events.error === '' ? '' : errorText(events.error)));
const detailErrorText = computed(() => (events.detailError === '' ? '' : errorText(events.detailError)));
const showingDetail = computed(() => events.detailLoading || events.detail !== null || events.detailError !== '');

// One picture request per opened detail, never re-fired by a re-render.
watch(
    () => events.detail?.id ?? '',
    () => {
        const picUid = events.detail?.picUid ?? '';
        if (picUid !== '') void events.loadPicture(picUid);
    },
);
</script>

<template>
    <div class="events">
        <div class="events__body">
            <header class="events__head fade-in-down">
                <h1 class="events__heading">{{ t('events.title') }}</h1>
                <p class="events__hint">{{ t('events.hint') }}</p>
            </header>

            <section v-if="showingDetail" class="events__detail fade-in" data-testid="event-detail">
                <AdminButton variant="quiet" data-testid="event-back" @click="events.closeDetail()">
                    {{ t('events.back') }}
                </AdminButton>
                <p v-if="events.detailLoading" class="events__state" role="status">
                    <IconLoading class="events__spin" aria-hidden="true" />
                    {{ t('events.loading') }}
                </p>
                <p v-else-if="detailErrorText !== ''" class="events__state events__state--error" role="alert">
                    {{ detailErrorText }}
                </p>
                <article v-else-if="detailRow" class="events__card">
                    <h2 class="events__title">{{ detailRow.title }}</h2>
                    <p v-if="detailRow.room !== '' || detailRow.action !== ''" class="events__action">
                        {{ [detailRow.room, detailRow.action].filter((part) => part !== '').join(' · ') }}
                    </p>
                    <p class="events__meta">
                        <span data-testid="event-date">{{ detailRow.date }}</span>
                        <span>{{ detailRow.time }}</span>
                    </p>
                    <p v-if="detailRow.message !== ''" class="events__message">{{ detailRow.message }}</p>
                    <template v-if="detailRow.picUid !== ''">
                        <p v-if="events.pictureStatus === 'loading'" class="events__state" role="status">
                            <IconLoading class="events__spin" aria-hidden="true" />
                            {{ t('events.picture.loading') }}
                        </p>
                        <img
                            v-else-if="events.pictureStatus === 'ready' && events.pictureUrl !== ''"
                            class="events__picture"
                            data-testid="event-picture"
                            :src="events.pictureUrl"
                            :alt="t('events.picture.alt')"
                        />
                        <p v-else class="events__missing" data-testid="event-picture-missing">
                            <IconPicture aria-hidden="true" />
                            {{ t('events.picture.missing') }}
                        </p>
                    </template>
                </article>
            </section>

            <section v-show="!showingDetail" class="events__list" data-testid="event-list">
                <div class="events__bar">
                    <AdminButton variant="quiet" :busy="events.loading" data-testid="event-refresh" @click="events.refresh()">
                        <IconRefresh class="events__refresh" aria-hidden="true" />
                        {{ t('events.refresh') }}
                    </AdminButton>
                </div>

                <p v-if="listError !== ''" class="events__state events__state--error" role="alert">{{ listError }}</p>
                <p v-else-if="rows.length === 0 && !events.loading" class="events__state" data-testid="event-empty">
                    {{ t('events.empty') }}
                </p>

                <ul v-if="rows.length > 0" class="events__items">
                    <li v-for="row in rows" :key="row.id">
                        <button type="button" class="events__item pressable" data-testid="event-item" @click="events.openDetail(row.id)">
                            <span class="events__item-icon" aria-hidden="true">
                                <IconPush v-if="row.icon === 'push'" data-testid="event-icon-push" />
                                <img v-else-if="row.iconSrc !== ''" :src="row.iconSrc" alt="" data-testid="event-icon" />
                            </span>
                            <span class="events__item-main">
                                <span class="events__item-title">{{ row.title }}</span>
                                <span v-if="row.action !== '' || row.room !== ''" class="events__item-sub">
                                    {{ [row.room, row.action].filter((part) => part !== '').join(' · ') }}
                                </span>
                                <span v-if="row.message !== ''" class="events__item-sub">{{ row.message }}</span>
                            </span>
                            <span class="events__item-when">
                                <IconPhoto
                                    v-if="row.picUid !== ''"
                                    class="events__item-photo"
                                    role="img"
                                    :aria-label="t('events.hasPicture')"
                                    data-testid="event-has-picture"
                                />
                                <span>{{ row.date }}</span>
                                <span>{{ row.time }}</span>
                            </span>
                        </button>
                    </li>
                </ul>

                <div v-if="rows.length > 0 && !events.endReached" class="events__more">
                    <AdminButton variant="quiet" :busy="events.loading" data-testid="event-more" @click="events.loadMore()">
                        {{ t('events.more') }}
                    </AdminButton>
                </div>
            </section>
        </div>
    </div>
</template>

<style scoped>
.events {
    padding: var(--space-4);
}

@media (min-width: 480px) {
    .events {
        padding: var(--space-6);
    }
}

.events__body {
    display: grid;
    gap: var(--space-4);
    inline-size: 100%;
    max-inline-size: 48rem;
    margin-inline: auto;
}

.events__list,
.events__detail {
    display: grid;
    gap: var(--space-3);
    align-content: start;
}

.events__bar,
.events__more {
    display: flex;
    justify-content: flex-end;
}

.events__more {
    justify-content: center;
}

.events__refresh {
    inline-size: 1.1em;
    block-size: 1.1em;
    vertical-align: -0.2em;
    margin-inline-end: var(--space-1);
}

.events__items {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.events__item {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-3);
    inline-size: 100%;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    background-color: color-mix(in srgb, var(--c-surface) 85%, transparent);
    color: var(--c-text);
    font: inherit;
    text-align: start;
    cursor: pointer;
}

.events__item:hover {
    border-color: var(--c-accent);
    box-shadow: 0 0 14px var(--c-accent-glow);
}

.events__item:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
}

.events__head {
    display: grid;
    gap: var(--space-1);
}

.events__heading {
    margin: 0;
    font-size: clamp(1.5rem, 6vw, 1.875rem);
    font-weight: 400;
    letter-spacing: var(--tracking-tight);
}

.events__hint {
    margin: 0;
    color: var(--c-text-muted, var(--c-text));
}

.events__item {
    align-items: center;
}

.events__item-icon {
    flex: none;
    display: grid;
    place-items: center;
    inline-size: 2.5rem;
    block-size: 2.5rem;
    color: var(--c-accent);
    font-size: 1.5rem;
}

.events__item-icon img {
    inline-size: 100%;
    block-size: 100%;
    object-fit: contain;
}

.events__item-photo {
    justify-self: end;
    font-size: 1.125rem;
    color: var(--c-accent);
}

.events__item-main {
    flex: 1;
}

.events__item-main,
.events__item-when {
    display: grid;
    gap: var(--space-1);
    min-inline-size: 0;
}

.events__item-title {
    font-weight: 600;
    overflow-wrap: anywhere;
}

.events__item-sub,
.events__item-when,
.events__meta {
    color: var(--c-text-muted, var(--c-text));
    font-size: 0.875rem;
    overflow-wrap: anywhere;
}

.events__item-when {
    flex: none;
    text-align: end;
    white-space: nowrap;
}

.events__card {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-4);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    background-color: color-mix(in srgb, var(--c-surface) 85%, transparent);
}

.events__title {
    margin: 0;
    font-size: 1.25rem;
    overflow-wrap: anywhere;
}

.events__meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: 0;
}

.events__action,
.events__message {
    margin: 0;
    overflow-wrap: anywhere;
}

.events__picture {
    inline-size: 100%;
    max-block-size: 70vh;
    object-fit: contain;
    border-radius: var(--radius-md);
}

.events__missing,
.events__state {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    color: var(--c-text-muted, var(--c-text));
}

.events__state--error {
    color: var(--c-danger, var(--c-warn));
}

.events__spin {
    animation: events-spin 1s linear infinite;
}

@keyframes events-spin {
    to {
        transform: rotate(360deg);
    }
}

@media (prefers-reduced-motion: reduce) {
    .events__spin {
        animation: none;
    }
}
</style>
