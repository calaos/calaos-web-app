import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { decodeServerMessage } from '../protocol/messages';
import type { AdminReplyMessage } from '../protocol/types';
import { useAdminStore } from './admin';
import { useAdminAlertsStore } from './adminAlerts';
import { useApproversStore } from './approvers';

const SESSION = 'b'.repeat(64);
const PIXEL = { tokenId: '0c1d2e3f4a5b6c7d', deviceName: 'Pixel 8', platform: 'android', registeredAt: '', lastSeen: '', approver: false };
const IPHONE = { ...PIXEL, tokenId: 'a1b2c3d4e5f60718', deviceName: 'iPhone', platform: 'ios' };
const ENROLLED = { id: '1111111111111111', device_name: 'Pixel 8', token_id: PIXEL.tokenId, created_at: '2026-10-01T00:00:00Z' };

type Frame = { msg: string; msg_id: string; data: Record<string, unknown> };
let sent: Frame[];

function last(): Frame {
    const frame = sent[sent.length - 1];
    if (frame === undefined) throw new Error('nothing was sent');
    return frame;
}

function answer(data: Record<string, unknown>): void {
    const frame = last();
    useAdminStore().handleReply(
        decodeServerMessage({ msg: frame.msg, msg_id: frame.msg_id, data }) as AdminReplyMessage,
    );
}

const ok = (result: unknown): void => answer({ success: 'true', result });
const fail = (error: string, extra: Record<string, string> = {}): void =>
    answer({ success: 'false', error, msg: error, ...extra });

const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

/** An unlocked admin with the given approvers listed. */
async function unlocked(list: unknown[]): Promise<ReturnType<typeof useApproversStore>> {
    const admin = useAdminStore();
    admin.attachTransport((frame) => {
        sent.push(JSON.parse(frame));
        return true;
    });
    void admin.unlock('correct horse battery');
    answer({ success: 'true', admin_session: SESSION, expires_in: '900' });
    await flush();
    ok({ progress: { status: 'idle' }, job: null });
    await flush();
    const approvers = useApproversStore();
    void approvers.load();
    expect(last().data).toEqual({ action: 'approver_list', admin_session: SESSION });
    ok(list);
    await flush();
    sent = [];
    return approvers;
}

beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    sent = [];
    localStorage.clear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('enrolment', () => {
    it('the first phone needs no approval: its own code, then the list again', async () => {
        const approvers = await unlocked([]);
        const alerts = useAdminAlertsStore();
        const expectOwn = vi.spyOn(alerts, 'expectOwn');

        void approvers.startEnrolment(PIXEL);
        expect(last().data).toEqual({
            action: 'approver_enroll',
            admin_session: SESSION,
            params: { token_id: PIXEL.tokenId },
        });
        ok({ approver_id: '2222222222222222', code_id: 'c0c0c0c0c0c0c0c0', expires_in: 60 });
        await flush();
        expect(approvers.challenge).toMatchObject({ step: 'confirm_enroll', phone: 'Pixel 8', codeId: 'c0c0c0c0c0c0c0c0' });
        expect(approvers.challenge!.expiresAt - Date.now()).toBe(60_000);

        void approvers.submit('123456');
        expect(last().data).toEqual({
            action: 'approver_confirm',
            admin_session: SESSION,
            params: { code_id: 'c0c0c0c0c0c0c0c0', code: '123456' },
        });
        ok(ENROLLED);
        await flush();
        expect(approvers.challenge).toBeNull();
        expect(approvers.done).toBe('enrolled');
        expect(expectOwn).toHaveBeenCalledWith('approver_set', 'Pixel 8');
        expect(last().data.action).toBe('approver_list');
    });

    it('a second phone takes a code from the first one, then its own', async () => {
        const approvers = await unlocked([ENROLLED]);

        void approvers.startEnrolment(IPHONE);
        expect(last().data).toEqual({
            action: 'code_request',
            admin_session: SESSION,
            params: { code_action: 'approver_enroll', code_params: {}, approver_id: ENROLLED.id },
        });
        ok({ code_id: 'aaaaaaaaaaaaaaaa', approver_id: ENROLLED.id, expires_in: 60 });
        await flush();
        expect(approvers.challenge).toMatchObject({ step: 'approve_enroll', phone: 'Pixel 8' });

        void approvers.submit('654321');
        expect(last().data.params).toEqual({ token_id: IPHONE.tokenId, code_id: 'aaaaaaaaaaaaaaaa', code: '654321' });
        ok({ approver_id: '3333333333333333', code_id: 'bbbbbbbbbbbbbbbb', expires_in: 60 });
        await flush();
        expect(approvers.challenge).toMatchObject({ step: 'confirm_enroll', phone: 'iPhone', codeId: 'bbbbbbbbbbbbbbbb' });

        // A new enrolment code needs a new approval: back to the first phone.
        vi.advanceTimersByTime(10_000);
        void approvers.resend();
        expect(last().data.params).toEqual({ code_action: 'approver_enroll', code_params: {}, approver_id: ENROLLED.id });
        ok({ code_id: 'dddddddddddddddd', approver_id: ENROLLED.id, expires_in: 60 });
        await flush();
        expect(approvers.challenge).toMatchObject({ step: 'approve_enroll', codeId: 'dddddddddddddddd' });
    });
});

describe('enrolment races', () => {
    it('a phone enrolled elsewhere meanwhile: the first enrolment turns into an approval', async () => {
        const approvers = await unlocked([]);
        void approvers.startEnrolment(IPHONE);
        fail('code_required');
        await flush();
        expect(last().data.action).toBe('approver_list');
        ok([ENROLLED]);
        await flush();
        expect(last().data.params).toEqual({ code_action: 'approver_enroll', code_params: {}, approver_id: ENROLLED.id });
        ok({ code_id: 'aaaaaaaaaaaaaaaa', approver_id: ENROLLED.id, expires_in: 60 });
        await flush();
        expect(approvers.challenge).toMatchObject({ step: 'approve_enroll', phone: 'Pixel 8' });
        expect(approvers.flowError).toBeNull();
    });

    it('code_required at confirmation restarts from the approval, and a resend does not loop', async () => {
        const approvers = await unlocked([]);
        void approvers.startEnrolment(IPHONE);
        ok({ approver_id: '2222222222222222', code_id: 'c0c0c0c0c0c0c0c0', expires_in: 60 });
        await flush();
        void approvers.submit('123456');
        fail('code_required');
        await flush();
        ok([ENROLLED]);
        await flush();
        expect(last().data.params).toMatchObject({ code_action: 'approver_enroll', approver_id: ENROLLED.id });
        fail('rate_limited', { retry_after: '4' });
        await flush();
        // Nothing to type yet: the flow says why, and the next try asks the approver.
        expect(approvers.flowError?.code).toBe('rate_limited');
    });
});

describe('which phone gets the code', () => {
    const OLD_DEAD = { ...ENROLLED, id: '4444444444444444', device_name: 'Old phone', token_id: 'dddddddddddddddd' };
    const ALIVE = {
        ...ENROLLED,
        id: '5555555555555555',
        device_name: 'iPhone',
        token_id: IPHONE.tokenId,
        last_seen: new Date().toISOString(),
    };

    it('the phone seen most recently, never one whose token is gone', async () => {
        const approvers = await unlocked([OLD_DEAD, ALIVE]);
        void approvers.startPasswordChange('another long password');
        expect(last().data.params).toMatchObject({ approver_id: ALIVE.id });
        ok({ code_id: 'eeeeeeeeeeeeeeee', approver_id: ALIVE.id, expires_in: 60 });
        await flush();
        expect(approvers.challenge).toMatchObject({ approverId: ALIVE.id, phone: 'iPhone' });
        expect(approvers.alternative?.id).toBe(OLD_DEAD.id);

        // "Send it to the other phone" asks for a new code there.
        vi.advanceTimersByTime(10_000);
        void approvers.sendToOther();
        expect(last().data.params).toMatchObject({ code_action: 'admin_password', approver_id: OLD_DEAD.id });
    });

    it('a removal asks the phone that stays', async () => {
        const approvers = await unlocked([OLD_DEAD, ALIVE]);
        const [, alive] = approvers.approvers!;
        void approvers.startRemoval(alive);
        // The other one is dead: the code still goes where it can be read.
        expect(last().data.params).toMatchObject({ approver_id: ALIVE.id });
    });

    it('an unknown approver reloads the list it talks about', async () => {
        const approvers = await unlocked([OLD_DEAD, ALIVE]);
        void approvers.startPasswordChange('another long password');
        fail('approver_not_found');
        await flush();
        expect(sent.some((frame) => frame.data.action === 'approver_list')).toBe(true);
    });
});

describe('removal', () => {
    it('the last phone is explained without a round trip', async () => {
        const approvers = await unlocked([ENROLLED]);
        approvers.refuseLast();
        expect(sent).toEqual([]);
        expect(approvers.flowError?.code).toBe('approver_last');
    });

    it('the last phone is refused before any code is sent', async () => {
        const approvers = await unlocked([ENROLLED]);
        void approvers.startRemoval({
            id: ENROLLED.id,
            deviceName: 'Pixel 8',
            tokenId: PIXEL.tokenId,
            createdAt: '',
            platform: 'android',
            registeredAt: '',
            lastSeen: '',
        });
        expect(last().data.params).toEqual({
            code_action: 'approver_remove',
            code_params: { approver_id: ENROLLED.id },
            approver_id: ENROLLED.id,
        });
        fail('approver_last');
        await flush();
        expect(approvers.challenge).toBeNull();
        expect(approvers.flowError?.code).toBe('approver_last');
    });
});

describe('codes', () => {
    async function passwordChallenge(): Promise<ReturnType<typeof useApproversStore>> {
        const approvers = await unlocked([ENROLLED]);
        void approvers.startPasswordChange('another long password');
        expect(last().data.params).toEqual({
            code_action: 'admin_password',
            code_params: { password: 'another long password' },
            approver_id: ENROLLED.id,
        });
        ok({ code_id: 'eeeeeeeeeeeeeeee', approver_id: ENROLLED.id, expires_in: 60 });
        await flush();
        return approvers;
    }

    it('the password change carries the code, then unlocks with the new password', async () => {
        const approvers = await passwordChallenge();
        const admin = useAdminStore();
        void approvers.submit('112233');
        expect(last()).toMatchObject({
            msg: 'admin_set',
            data: { new_pass: 'another long password', admin_session: SESSION, code_id: 'eeeeeeeeeeeeeeee', code: '112233' },
        });
        answer({ success: 'true', mode: 'change' });
        await flush();
        expect(last()).toMatchObject({ msg: 'admin_unlock', data: { admin_pass: 'another long password' } });
        answer({ success: 'true', admin_session: 'c'.repeat(64), expires_in: '900' });
        await flush();
        expect(approvers.done).toBe('password');
        expect(admin.info).toBe('password_changed');
    });

    it('a wrong code says how many attempts are left and keeps the code entry', async () => {
        const approvers = await passwordChallenge();
        void approvers.submit('000000');
        fail('bad_code', { attempts_left: '3' });
        await flush();
        expect(approvers.challenge).toMatchObject({ step: 'password', attemptsLeft: 3, error: { code: 'bad_code' } });
        expect(useAdminStore().notice).toBeNull();
    });

    it('the fifth wrong code asks for the admin password again', async () => {
        const approvers = await passwordChallenge();
        const admin = useAdminStore();
        void approvers.submit('000000');
        fail('bad_code', { attempts_left: '0' });
        await flush();
        expect(admin.session).toBeNull();
        expect(admin.gate).toBe('locked');
        expect(admin.info).toBe('code_locked');
        expect(approvers.challenge).toBeNull();
    });

    it('an expired code stays on screen with its error; a resend respects the server wait', async () => {
        const approvers = await passwordChallenge();
        void approvers.submit('000000');
        fail('code_expired');
        await flush();
        expect(approvers.challenge?.error?.code).toBe('code_expired');

        void approvers.resend();
        fail('rate_limited', { retry_after: '7' });
        await flush();
        expect(approvers.challenge!.resendAt - Date.now()).toBe(7_000);
    });

    it('a dropped session ends the flow', async () => {
        const approvers = await passwordChallenge();
        void approvers.submit('000000');
        fail('bad_session');
        await flush();
        expect(useAdminStore().gate).toBe('locked');
        expect(approvers.challenge).toBeNull();
        expect(approvers.approvers).toBeNull();
    });
});
