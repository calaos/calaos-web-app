import { describe, expect, it } from 'vitest';
import {
    ADMIN_REPLY_TIMEOUT_MS,
    adminReplyTimeoutMs,
    bareAdminError,
    encodeAdminAction,
    toAdminError,
    toApproverCandidates,
    toApprovers,
} from './admin';

describe('phase-3 additions to the admin codec', () => {
    it('waits a little longer than calaos_server for its slow actions', () => {
        expect(adminReplyTimeoutMs('logs_query')).toBe(12_000);
        expect(adminReplyTimeoutMs('time_set')).toBe(40_000);
        expect(adminReplyTimeoutMs('system_restart')).toBe(35_000);
        expect(adminReplyTimeoutMs('update_check')).toBe(125_000);
        expect(adminReplyTimeoutMs('services_restart')).toBe(ADMIN_REPLY_TIMEOUT_MS);
        expect(adminReplyTimeoutMs('network_apply')).toBe(40_000);
        expect(adminReplyTimeoutMs('network_confirm')).toBe(40_000);
        expect(adminReplyTimeoutMs('network_revert')).toBe(40_000);
        expect(adminReplyTimeoutMs('network_state')).toBe(ADMIN_REPLY_TIMEOUT_MS);
    });

    it('reads network_pending with its change and seconds left', () => {
        const error = toAdminError({
            success: 'false',
            error: 'network_pending',
            msg: 'pending',
            change_id: '5d0c8e1f2a3b4c6d',
            expires_in: '87',
        });
        expect(error).toMatchObject({ code: 'network_pending', changeId: '5d0c8e1f2a3b4c6d', expiresIn: 87 });
    });

    it('reads the steps of a partly applied time_set', () => {
        const error = toAdminError({
            success: 'false',
            error: 'internal',
            msg: 'x',
            applied: 'timezone',
            failed: 'ntp',
            restart_required: 'true',
        });
        expect(error).toMatchObject({ applied: ['timezone'], failed: 'ntp', restartRequired: true });
        expect(toAdminError({ error: 'internal', restart_required: 'false' })).toMatchObject({
            applied: [],
            failed: '',
            restartRequired: false,
        });
    });

    it('builds a detail-free error for refusals known before asking', () => {
        expect(bareAdminError('approver_last')).toEqual(toAdminError({ error: 'approver_last' }));
    });

    it('reads `secure` on approvers and candidates, false when absent', () => {
        expect(toApprovers([{ id: 'a', secure: true }, { id: 'b' }]).map((a) => a.secure)).toEqual([true, false]);
        expect(toApproverCandidates([{ token_id: 't', secure: true, approver: false }])[0].secure).toBe(true);
    });

    it('keeps the JSON types of phase-3 params on the wire', () => {
        const frame = JSON.parse(
            encodeAdminAction('logs_query', 'abc', '7', { sources: ['kernel'], priority: 3, lines: 20 }),
        );
        expect(frame.data.params).toEqual({ sources: ['kernel'], priority: 3, lines: 20 });
    });
});
