import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAdminAlertsStore } from './adminAlerts';

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
let sent: { msg: string; msg_id: string }[];

function sqlite(ms: number): string {
    return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function page(events: [string, 'approver_set' | 'approver_removed', string, number][]): unknown {
    const prefix = { approver_set: 'New approver phone on your Calaos box: ', approver_removed: 'Approver phone removed from your Calaos box: ' };
    return {
        events: events.map(([id, kind, name, at]) => ({
            id,
            event_type: '22',
            created_at: sqlite(at),
            event_raw: { message: `${prefix[kind]}"${name}"` },
        })),
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
        expect(sent[0]).toMatchObject({ msg: 'eventlog' });
        expect(
            deliver(
                alerts,
                page([
                    ['e3', 'approver_set', 'iPhone', NOW - 60_000],
                    ['e2', 'approver_removed', 'Pixel 8', NOW - 86_400_000],
                    ['e1', 'approver_set', 'Old', NOW - 40 * 86_400_000],
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

    it('does not report our own enrolment back to us', () => {
        const alerts = store();
        alerts.expectOwn('approver_set', 'Pixel 8');
        alerts.handleEvent('approver_set');
        deliver(
            alerts,
            page([
                ['e2', 'approver_set', 'Pixel 8', NOW],
                ['e1', 'approver_set', 'iPhone', NOW - 1000],
            ]),
        );
        expect(alerts.alerts.map((alert) => alert.id)).toEqual(['e1']);
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
