// The Events page's data: the box's event log, 50 per page like the mobile app,
// walked back page by page. No filter and no live feed (the log is a plain
// request/answer); the view calls refresh() to see newer events.

import { ref } from 'vue';
import { defineStore } from 'pinia';
import { decodeEventLogDetail, decodeEventLogPage, encodeEventDetail } from '../protocol/eventlog';
import type { EventLogEvent } from '../protocol/eventlog';
import { encodeEventLog } from '../protocol/alerts';
import type { EventLogMessage } from '../protocol/types';
import type { FrameSender } from './admin';

export const EVENTS_PAGE_SIZE = 50;
export const EVENTS_MSG_ID_PREFIX = 'events:';
/** HistLogger.cpp's refusal of a page past the end. */
const OUT_OF_RANGE = 'page is out of range';

export const useEventsStore = defineStore('events', () => {
    const events = ref<EventLogEvent[]>([]);
    const loading = ref(false);
    const error = ref('');
    /** True once the last page has been read: loadMore() then does nothing. */
    const endReached = ref(false);
    const detail = ref<EventLogEvent | null>(null);
    const detailLoading = ref(false);
    const detailError = ref('');

    let send: FrameSender = () => false;
    /** Answers of an older walk (refresh, sign-out) carry an older generation. */
    let generation = 0;
    let nextPage = 0;
    let pendingPage = -1;
    let detailSeq = 0;

    function attachTransport(sender: FrameSender): void {
        send = sender;
    }

    function requestPage(page: number): void {
        loading.value = true;
        error.value = '';
        pendingPage = page;
        if (!send(encodeEventLog(`${EVENTS_MSG_ID_PREFIX}${generation}:page:${page}`, page, EVENTS_PAGE_SIZE))) {
            loading.value = false;
            error.value = 'not connected';
        }
    }

    /** Restarts from the newest event; what is shown stays until page 0 answers. */
    function refresh(): void {
        generation += 1;
        nextPage = 0;
        endReached.value = false;
        requestPage(0);
    }

    function loadMore(): void {
        if (loading.value || endReached.value) return;
        requestPage(nextPage);
    }

    function openDetail(uuid: string): void {
        detailSeq += 1;
        detail.value = null;
        detailError.value = '';
        detailLoading.value = true;
        if (!send(encodeEventDetail(`${EVENTS_MSG_ID_PREFIX}${generation}:detail:${detailSeq}`, uuid))) {
            detailLoading.value = false;
            detailError.value = 'not connected';
        }
    }

    function closeDetail(): void {
        detailSeq += 1;
        detail.value = null;
        detailError.value = '';
        detailLoading.value = false;
    }

    function onPage(page: number, msg: EventLogMessage): void {
        // Only the page asked for, and only while waiting for it.
        if (!loading.value || page !== pendingPage) return;
        const result = decodeEventLogPage(msg.data);
        loading.value = false;
        if (!result.ok) {
            // The log was purged during the walk: the page we want no longer exists.
            if (page > 0 && result.error === OUT_OF_RANGE) endReached.value = true;
            else error.value = result.error;
            return;
        }
        // nextPage >= totalPages ends a complete walk; the empty-page test covers
        // a stale total_page (log purged mid-walk), which the server answers empty.
        // The log moves under a walk, so a page can repeat an event: keep one.
        const base = page === 0 ? [] : events.value;
        const known = new Set(base.map((event) => event.id));
        events.value = [...base, ...result.events.filter((event) => !known.has(event.id))];
        nextPage = page + 1;
        endReached.value = result.events.length === 0 || nextPage >= result.totalPages;
    }

    /** True when the answer was ours (adminAlerts reads the same message type). */
    function handleEventLog(msg: EventLogMessage): boolean {
        if (!msg.msgId.startsWith(EVENTS_MSG_ID_PREFIX)) return false;
        const [gen, kind, arg] = msg.msgId.slice(EVENTS_MSG_ID_PREFIX.length).split(':');
        // Only pages belong to a walk; a detail is guarded by detailSeq alone, so
        // a refresh() does not strand a detail already requested.
        if (kind === 'page') {
            if (Number(gen) === generation) onPage(Number(arg), msg);
        } else if (kind === 'detail' && Number(arg) === detailSeq) {
            const result = decodeEventLogDetail(msg.data);
            detailLoading.value = false;
            if (result.ok) detail.value = result.event;
            else detailError.value = result.error;
        }
        return true;
    }

    /** The socket dropped: answers in flight will never come. */
    function handleTransportLost(): void {
        if (loading.value) {
            generation += 1;
            loading.value = false;
            error.value = 'not connected';
        }
        if (detailLoading.value) {
            detailSeq += 1;
            detailLoading.value = false;
            detailError.value = 'not connected';
        }
    }

    /** Sign-out: the next account must not see this one's log. */
    function reset(): void {
        generation += 1;
        detailSeq += 1;
        nextPage = 0;
        events.value = [];
        loading.value = false;
        error.value = '';
        endReached.value = false;
        detail.value = null;
        detailLoading.value = false;
        detailError.value = '';
    }

    return {
        events,
        loading,
        error,
        endReached,
        detail,
        detailLoading,
        detailError,
        attachTransport,
        refresh,
        loadMore,
        openDetail,
        closeDetail,
        handleEventLog,
        handleTransportLost,
        reset,
    };
});
