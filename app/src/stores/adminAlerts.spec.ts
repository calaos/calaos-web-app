import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAdminAlertsStore } from './adminAlerts';

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
const DAY = 86_400_000;
let sent: { msg: string; msg_id: string; data: { page: string; per_page: string } }[];

type Row = [string, 'approver_set' | 'approver_removed' | 'io', string, number];

function sqlite(ms: number): string {
    return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function page(rows: Row[], totalPages = 1): unknown {
    const prefix = {
        approver_set: 'New approver phone on your Calaos box: ',
        approver_removed: 'Approver phone removed from your Calaos box: ',
    };
    return {
        total_page: totalPages,
        events: rows.map(([id, kind, name, at]) =>
            kind === 'io'
                ? { id, event_type: '3', created_at: sqlite(at), event_raw: { type_str: 'io_changed' } }
                : { id, event_type: '22', created_at: sqlite(at), event_raw: { message: `${prefix[kind]}"${name}"` } },
        ),
    };
}

function store(): ReturnType<typeof useAdminAlertsStore> {
    const alerts = useAdminAlertsStore();
    alerts.attachTransport((frame) => {
        sent.push(JSON.parse(frame));
        return true;
    });
    return alerts;
}

/** Answers the last request. */
function deliver(alerts: ReturnType<typeof useAdminAlertsStore>, data: unknown): boolean {
    return alerts.handleEventLog({ kind: 'eventlog', msgId: sent[sent.length - 1].msg_id, data });
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    setActivePinia(createPinia());
    localStorage.clear();
    sent = [];
});

afterEach(() => {
    vi.useRealTimers();
});

describe('admin alerts', () => {
    it('shows unseen alerts of the last 30 days, newest first, until dismissed', () => {
        const alerts = store();
        alerts.refresh();
        expect(sent[0]).toMatchObject({ msg: 'eventlog', msg_id: 'admin_alerts:1:0', data: { page: '0', per_page: '100' } });
        expect(
            deliver(
                alerts,
                page([
                    ['e3', 'approver_set', 'iPhone', NOW - 60_000],
                    ['e2', 'approver_removed', 'Pixel 8', NOW - DAY],
                    ['e1', 'approver_set', 'Old', NOW - 40 * DAY],
                ]),
            ),
        ).toBe(true);
        expect(alerts.alerts.map((alert) => alert.id)).toEqual(['e3', 'e2']);

        alerts.dismiss();
        expect(alerts.alerts).toEqual([]);
        expect(JSON.parse(localStorage.getItem('calaos.adminAlerts.seen')!)).toEqual(['e3', 'e2']);

        // Another sign-in on this browser: still dismissed.
        setActivePinia(createPinia());
        const again = store();
        again.refresh();
        deliver(again, page([['e3', 'approver_set', 'iPhone', NOW - 60_000]]));
        expect(again.alerts).toEqual([]);
    });

    it('walks back past the IO history until the 30 days are covered', () => {
        const alerts = store();
        alerts.refresh();
        const noise = (from: number): Row[] =>
            Array.from({ length: 100 }, (_, i) => [`io${from + i}`, 'io', '', NOW - (from + i) * 60_000] as Row);
        deliver(alerts, page(noise(0), 5));
        expect(sent.at(-1)).toMatchObject({ msg_id: 'admin_alerts:1:1', data: { page: '1' } });
        expect(alerts.alerts).toEqual([]);
        deliver(alerts, page([...noise(100).slice(0, 99), ['buried', 'approver_set', 'Squatter', NOW - 2 * DAY]], 5));
        expect(sent.at(-1)).toMatchObject({ data: { page: '2' } });
        // A page that reaches past the window ends the walk.
        deliver(alerts, page([['io-old', 'io', '', NOW - 31 * DAY]], 5));
        expect(sent).toHaveLength(3);
        expect(alerts.alerts.map((alert) => alert.id)).toEqual(['buried']);
    });

    it('stops at 20 pages, and drops the answers of an older walk', () => {
        const alerts = store();
        alerts.refresh();
        for (let i = 0; i < 25; i += 1) deliver(alerts, page([[`io${i}`, 'io', '', NOW - i * 1000]], 100));
        expect(sent).toHaveLength(20);

        alerts.refresh();
        const stale = { kind: 'eventlog' as const, msgId: 'admin_alerts:1:3', data: page([['x', 'approver_set', 'a', NOW]]) };
        expect(alerts.handleEventLog(stale)).toBe(true);
        deliver(alerts, page([]));
        expect(alerts.alerts).toEqual([]);
    });

    it('does not report our own change back to us, under the name the box wrote', () => {
        const alerts = store();
        alerts.refresh();
        deliver(alerts, page([['before', 'approver_set', "Raoul's phone", NOW - 5000]]));
        alerts.expectOwn('approver_set', 'Raoul"s phone');
        alerts.handleEvent('approver_set');
        deliver(
            alerts,
            page([
                ['later', 'approver_set', "Raoul's phone", NOW + 2000],
                ['mine', 'approver_set', "Raoul's phone", NOW + 1000],
                ['before', 'approver_set', "Raoul's phone", NOW - 5000],
            ]),
        );
        // The one already there and a later one of the same name are not ours.
        expect(alerts.alerts.map((alert) => alert.id)).toEqual(['later', 'before']);
    });

    it('forgets a change that failed', () => {
        const alerts = store();
        alerts.expectOwn('approver_removed', 'iPhone');
        alerts.dropOwn('approver_removed', 'iPhone');
        alerts.refresh();
        deliver(alerts, page([['x', 'approver_removed', 'iPhone', NOW]]));
        expect(alerts.alerts.map((alert) => alert.id)).toEqual(['x']);
    });

    it('leaves the event log answers of other readers alone', () => {
        const alerts = store();
        expect(alerts.handleEventLog({ kind: 'eventlog', msgId: 'eventlog_page:1:0', data: page([['x', 'approver_set', 'a', NOW]]) })).toBe(false);
        expect(alerts.alerts).toEqual([]);
    });

    it('re-reads the log on a live approver alert only', () => {
        const alerts = store();
        alerts.handleEvent('upgrade_progress');
        alerts.handleEvent('admin_set');
        expect(sent).toEqual([]);
        alerts.handleEvent('approver_removed');
        expect(sent).toHaveLength(1);
    });
});
