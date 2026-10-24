import { describe, expect, it } from 'vitest';
import { encodeEventLog, toAdminAlerts } from './alerts';

function pushEvent(id: string, message: string, createdAt = '2026-10-24 08:00:00'): Record<string, unknown> {
    return { id, event_type: '22', io_id: '', io_state: '', pic_uid: '', created_at: createdAt, event_raw: { message, pic_uid: '' } };
}

describe('approver alerts in the event log', () => {
    it('asks for the first page only', () => {
        expect(encodeEventLog('admin_alerts:1', 50)).toBe(
            '{"msg":"eventlog","msg_id":"admin_alerts:1","data":{"page":"0","per_page":"50"}}',
        );
    });

    it('reads the kind, the name between the quotes and the UTC date', () => {
        const alerts = toAdminAlerts({
            events: [
                pushEvent('e2', 'Approver phone removed from your Calaos box: "iPhone"'),
                pushEvent('e1', 'New approver phone on your Calaos box: "Raoul\'s Pixel"', '2026-10-23 21:15:30'),
            ],
        });
        expect(alerts).toEqual([
            { id: 'e2', kind: 'approver_removed', deviceName: 'iPhone', at: Date.UTC(2026, 9, 24, 8, 0, 0) },
            { id: 'e1', kind: 'approver_set', deviceName: "Raoul's Pixel", at: Date.UTC(2026, 9, 23, 21, 15, 30) },
        ]);
    });

    it('ignores every other event, a rule push that mimics only part of the text, and error answers', () => {
        expect(
            toAdminAlerts({
                events: [
                    pushEvent('a', 'Admin password set on your Calaos box'),
                    pushEvent('b', 'Someone: New approver phone on your Calaos box: "x"'),
                    pushEvent('c', 'New approver phone on your Calaos box: "unterminated'),
                    { ...pushEvent('d', 'New approver phone on your Calaos box: "x"'), event_type: '3' },
                    'garbage',
                ],
            }),
        ).toEqual([]);
        expect(toAdminAlerts({ error: 'history is disabled' })).toEqual([]);
        expect(toAdminAlerts(null)).toEqual([]);
    });
});
