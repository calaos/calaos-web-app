import { describe, expect, it } from 'vitest';
import { decodeEventLogDetail, decodeEventLogPage, encodeEventDetail, toEventLogEvent } from './eventlog';

const IO_EVENT = {
    id: 'u1',
    event_type: '3',
    io_id: 'io_0',
    io_state: 'true',
    pic_uid: '',
    created_at: '2026-01-01 12:00:00',
    event_raw: { event_raw: 'io_changed id:io_0 state:true', type_str: 'io_changed' },
};

describe('event log codec', () => {
    it('asks for one event by uuid', () => {
        expect(encodeEventDetail('events:1:detail:2', 'u1')).toBe(
            '{"msg":"eventlog","msg_id":"events:1:detail:2","data":{"uuid":"u1"}}',
        );
    });

    it('reads an event, dating it as UTC', () => {
        expect(toEventLogEvent(IO_EVENT)).toEqual({
            id: 'u1',
            eventType: '3',
            ioId: 'io_0',
            ioState: 'true',
            picUid: '',
            at: Date.UTC(2026, 0, 1, 12, 0, 0),
            raw: IO_EVENT.event_raw,
        });
    });

    it('takes the picture uid from the row, else from event_raw', () => {
        expect(toEventLogEvent({ ...IO_EVENT, pic_uid: 'abc' })?.picUid).toBe('abc');
        expect(toEventLogEvent({ ...IO_EVENT, event_type: '22', event_raw: { pic_uid: 'def' } })?.picUid).toBe('def');
    });

    it('drops what has no id and survives a malformed event_raw', () => {
        expect(toEventLogEvent({ ...IO_EVENT, id: '' })).toBeNull();
        expect(toEventLogEvent('x')).toBeNull();
        expect(toEventLogEvent({ ...IO_EVENT, event_raw: 'not an object' })?.raw).toEqual({});
    });

    it('reads a page with its JSON integers, or as strings', () => {
        const wire = { total_page: 3, total_count: 271, page: 1, per_page: 100, events: [IO_EVENT, { nope: 1 }] };
        expect(decodeEventLogPage(wire)).toMatchObject({ ok: true, page: 1, totalPages: 3, totalCount: 271 });
        expect(decodeEventLogPage(wire)).toHaveProperty('events.length', 1);
        expect(decodeEventLogPage({ ...wire, total_page: '3' })).toMatchObject({ totalPages: 3 });
    });

    it('turns an error answer or garbage into an error', () => {
        expect(decodeEventLogPage({ error: 'per_page is out of range' })).toEqual({
            ok: false,
            error: 'per_page is out of range',
        });
        expect(decodeEventLogPage(null)).toMatchObject({ ok: false });
        expect(decodeEventLogDetail({ error: 'uuid not found' })).toEqual({ ok: false, error: 'uuid not found' });
        expect(decodeEventLogDetail({})).toMatchObject({ ok: false });
    });

    it('reads a detail answer: the event object alone', () => {
        expect(decodeEventLogDetail(IO_EVENT)).toMatchObject({ ok: true, event: { id: 'u1' } });
    });
});
