import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { EVENTS_PAGE_SIZE, useEventsStore } from './events';

type Sent = { msg: string; msg_id: string; data: Record<string, string> };
let sent: Sent[];
let online: boolean;

function event(id: string): Record<string, unknown> {
    return { id, event_type: '3', io_id: 'io_0', io_state: 'true', pic_uid: '', created_at: '2026-01-01 12:00:00', event_raw: {} };
}

function page(ids: string[], pageNo: number, totalPages: number): unknown {
    return { total_page: totalPages, total_count: 0, page: pageNo, per_page: EVENTS_PAGE_SIZE, events: ids.map(event) };
}

function store(): ReturnType<typeof useEventsStore> {
    const events = useEventsStore();
    events.attachTransport((frame) => {
        if (!online) return false;
        sent.push(JSON.parse(frame) as Sent);
        return true;
    });
    return events;
}

function answer(events: ReturnType<typeof useEventsStore>, data: unknown, msgId = sent[sent.length - 1].msg_id): boolean {
    return events.handleEventLog({ kind: 'eventlog', msgId, data });
}

beforeEach(() => {
    setActivePinia(createPinia());
    sent = [];
    online = true;
});

describe('events store', () => {
    it('reads pages of 50 and appends them', () => {
        const events = store();
        events.refresh();
        expect(sent[0]).toMatchObject({ msg: 'eventlog', data: { page: '0', per_page: '50' } });
        expect(events.loading).toBe(true);
        answer(events, page(['a', 'b'], 0, 2));
        expect(events.loading).toBe(false);
        expect(events.endReached).toBe(false);

        events.loadMore();
        expect(sent[1].data).toEqual({ page: '1', per_page: '50' });
        answer(events, page(['c'], 1, 2));
        expect(events.events.map((e) => e.id)).toEqual(['a', 'b', 'c']);
        expect(events.endReached).toBe(true);
    });

    it('stops at the last page and never asks for page == total_page', () => {
        const events = store();
        events.refresh();
        answer(events, page(['a'], 0, 1));
        events.loadMore();
        expect(sent).toHaveLength(1);
    });

    it('stops on an empty page even when total_page says more', () => {
        const events = store();
        events.refresh();
        answer(events, page(['a'], 0, 5));
        events.loadMore();
        answer(events, page([], 1, 5));
        expect(events.endReached).toBe(true);
        events.loadMore();
        expect(sent).toHaveLength(2);
    });

    it('keeps a detail requested before a refresh and answered after it', () => {
        const events = store();
        events.openDetail('u1');
        const detailId = sent[0].msg_id;
        events.refresh();
        answer(events, { ...event('u1') }, detailId);
        expect(events.detailLoading).toBe(false);
        expect(events.detail?.id).toBe('u1');
    });

    it('drops what is in flight when the transport is lost', () => {
        const events = store();
        events.refresh();
        events.openDetail('u1');
        const [pageId, detailId] = [sent[0].msg_id, sent[1].msg_id];
        events.handleTransportLost();
        expect(events.loading).toBe(false);
        expect(events.error).toBe('not connected');
        expect(events.detailLoading).toBe(false);
        expect(events.detailError).toBe('not connected');

        answer(events, page(['a'], 0, 1), pageId);
        answer(events, event('u1'), detailId);
        expect(events.events).toEqual([]);
        expect(events.detail).toBeNull();

        events.loadMore();
        expect(sent).toHaveLength(3);
    });

    it('leaves an idle store untouched when the transport is lost', () => {
        const events = store();
        events.handleTransportLost();
        expect(events.error).toBe('');
        expect(events.detailError).toBe('');
    });

    it('does not ask twice while a page is in flight', () => {
        const events = store();
        events.refresh();
        events.loadMore();
        expect(sent).toHaveLength(1);
    });

    it('keeps one copy of an event the log moved under the walk', () => {
        const events = store();
        events.refresh();
        answer(events, page(['a', 'b'], 0, 2));
        events.loadMore();
        answer(events, page(['b', 'c'], 1, 2));
        expect(events.events.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    });

    it('refresh restarts from page 0 and drops the answer of the older walk', () => {
        const events = store();
        events.refresh();
        const stale = sent[0].msg_id;
        events.refresh();
        answer(events, page(['old'], 0, 1), stale);
        expect(events.events).toEqual([]);
        expect(events.loading).toBe(true);
        answer(events, page(['new'], 0, 1));
        expect(events.events.map((e) => e.id)).toEqual(['new']);
    });

    it('a refresh replaces the list and rewinds the walk', () => {
        const events = store();
        events.refresh();
        answer(events, page(['a'], 0, 3));
        events.loadMore();
        answer(events, page(['b'], 1, 3));
        events.refresh();
        expect(sent[2].data.page).toBe('0');
        answer(events, page(['z'], 0, 3));
        expect(events.events.map((e) => e.id)).toEqual(['z']);
        events.loadMore();
        expect(sent[3].data.page).toBe('1');
    });

    it('reports a server error and lets loadMore retry the same page', () => {
        const events = store();
        events.refresh();
        answer(events, page(['a'], 0, 3));
        events.loadMore();
        answer(events, { error: 'history is disabled' });
        expect(events.error).toBe('history is disabled');
        expect(events.loading).toBe(false);
        expect(events.events).toHaveLength(1);
        events.loadMore();
        expect(sent[2].data.page).toBe('1');
        expect(events.error).toBe('');
    });

    it('reports a dead transport instead of waiting for ever', () => {
        const events = store();
        online = false;
        events.refresh();
        expect(events.loading).toBe(false);
        expect(events.error).toBe('not connected');
    });

    it('opens one event by uuid, and errors on an unknown one', () => {
        const events = store();
        events.openDetail('u1');
        expect(sent[0]).toMatchObject({ msg: 'eventlog', data: { uuid: 'u1' } });
        expect(events.detailLoading).toBe(true);
        answer(events, event('u1'));
        expect(events.detail?.id).toBe('u1');
        expect(events.detailLoading).toBe(false);

        events.openDetail('nope');
        answer(events, { error: 'uuid not found' });
        expect(events.detail).toBeNull();
        expect(events.detailError).toBe('uuid not found');
    });

    it('ignores the answer of a detail that was closed or replaced', () => {
        const events = store();
        events.openDetail('u1');
        const first = sent[0].msg_id;
        events.openDetail('u2');
        answer(events, event('u1'), first);
        expect(events.detail).toBeNull();
        events.closeDetail();
        answer(events, event('u2'));
        expect(events.detail).toBeNull();
    });

    it('claims only its own msg_id and forgets everything on reset', () => {
        const events = store();
        expect(answer(events, page(['x'], 0, 1), 'admin_alerts:1:0')).toBe(false);
        events.refresh();
        answer(events, page(['a'], 0, 1));
        events.reset();
        expect(events.events).toEqual([]);
        expect(events.endReached).toBe(false);
    });
});
