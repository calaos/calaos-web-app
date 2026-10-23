import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { decodeServerMessage } from '../protocol/messages';
import type { AdminEventMessage, AdminReplyMessage } from '../protocol/types';
import { useAdminStore } from './admin';

const SESSION = 'a'.repeat(64);

/** Frames the store sent, parsed, newest last. */
let sent: { msg: string; msg_id: string; data: Record<string, unknown> }[];
let online: boolean;

function store(): ReturnType<typeof useAdminStore> {
    const admin = useAdminStore();
    admin.attachTransport((frame) => {
        if (!online) return false;
        sent.push(JSON.parse(frame));
        return true;
    });
    admin.attachHousehold({
        credentials: () => ({ user: 'demo', pass: 'demo' }),
        rotate: () => true,
    });
    return admin;
}

function last(): { msg: string; msg_id: string; data: Record<string, unknown> } {
    const frame = sent[sent.length - 1];
    if (frame === undefined) throw new Error('nothing was sent');
    return frame;
}

/** Answers the LAST frame sent, the way the server would. */
function answer(admin: ReturnType<typeof useAdminStore>, data: Record<string, unknown>): void {
    const frame = last();
    admin.handleReply(
        decodeServerMessage({ msg: frame.msg, msg_id: frame.msg_id, data }) as AdminReplyMessage,
    );
}

function fail(admin: ReturnType<typeof useAdminStore>, error: string, extra: Record<string, string> = {}): void {
    answer(admin, { success: 'false', error, msg: error, ...extra });
}

function statusOk(
    admin: ReturnType<typeof useAdminStore>,
    progress: Record<string, unknown> = { status: 'idle', total_percent: 0 },
    job: Record<string, unknown> | null = null,
): void {
    answer(admin, { success: 'true', result: { progress, job } });
}

function event(admin: ReturnType<typeof useAdminStore>, type: string, data?: unknown): void {
    admin.handleEvent(decodeServerMessage({ msg: 'admin_event', data: { type, ts: 't', data } }) as AdminEventMessage);
}

const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    sent = [];
    online = true;
});

afterEach(() => {
    vi.useRealTimers();
});

describe('probe', () => {
    it('sends update_status without a session when the tab opens', () => {
        const admin = store();
        admin.activate();
        expect(admin.gate).toBe('probing');
        expect(last()).toEqual({ msg: 'admin', msg_id: 'admin-1', data: { action: 'update_status' } });
    });

    it('lands on locked (no session) with the upgrade state applied', async () => {
        const admin = store();
        admin.activate();
        statusOk(admin, { status: 'done', total_percent: 100 }, { id: '1', status: 'done', reboot_required: true });
        await flush();
        expect(admin.gate).toBe('locked');
        expect(admin.progress?.status).toBe('done');
        expect(admin.job?.rebootRequired).toBe(true);
    });

    it('goes to bootstrap on admin_not_set, keeping api_allowed_hosts', async () => {
        const admin = store();
        admin.activate();
        fail(admin, 'admin_not_set', { api_allowed_hosts: 'home.example.org' });
        await flush();
        expect(admin.gate).toBe('bootstrap');
        expect(admin.apiAllowedHosts).toBe('home.example.org');
    });

    it('asks for the household password first when it is still user/pass', async () => {
        const admin = store();
        admin.attachHousehold({ credentials: () => ({ user: 'user', pass: 'pass' }), rotate: () => true });
        admin.activate();
        fail(admin, 'admin_not_set', { api_allowed_hosts: '' });
        await flush();
        expect(admin.gate).toBe('household');
    });

    it('declares the server too old after 5 s of silence', async () => {
        const admin = store();
        admin.activate();
        vi.advanceTimersByTime(4_999);
        await flush();
        expect(admin.gate).toBe('probing');
        vi.advanceTimersByTime(1);
        await flush();
        expect(admin.gate).toBe('old_server');
    });

    it('does not call a dropped socket an old server', async () => {
        const admin = store();
        admin.activate();
        admin.handleTransportLost();
        await flush();
        expect(admin.gate).toBe('idle');
        vi.advanceTimersByTime(10_000);
        await flush();
        expect(admin.gate).toBe('idle');
        // The reconnect's login is what probes again.
        admin.handleLoggedIn();
        expect(sent).toHaveLength(2);
    });

    it('shows https_required as its own screen', async () => {
        const admin = store();
        admin.activate();
        fail(admin, 'https_required');
        await flush();
        expect(admin.gate).toBe('https_required');
    });
});

describe('admin_unavailable retry', () => {
    it('retries every 5 s for two minutes, then every 60 s', async () => {
        const admin = store();
        admin.activate();
        fail(admin, 'admin_unavailable');
        await flush();
        expect(admin.gate).toBe('unavailable');
        expect(sent).toHaveLength(1);

        vi.advanceTimersByTime(5_000);
        expect(sent).toHaveLength(2);
        fail(admin, 'admin_unavailable');
        await flush();

        // 23 more fast retries fill the two-minute window.
        for (let i = 0; i < 23; i++) {
            vi.advanceTimersByTime(5_000);
            fail(admin, 'admin_unavailable');
            await flush();
        }
        const beforeSlow = sent.length;
        vi.advanceTimersByTime(5_000);
        expect(sent).toHaveLength(beforeSlow);
        vi.advanceTimersByTime(55_000);
        expect(sent).toHaveLength(beforeSlow + 1);
    });

    it('stops retrying once the tab is left, and resumes on return', async () => {
        const admin = store();
        admin.activate();
        fail(admin, 'admin_unavailable');
        await flush();
        admin.deactivate();
        vi.advanceTimersByTime(60_000);
        expect(sent).toHaveLength(1);
        admin.activate();
        expect(sent).toHaveLength(2);
    });

    it('unblocks as soon as a probe answers', async () => {
        const admin = store();
        admin.activate();
        fail(admin, 'admin_unavailable');
        await flush();
        vi.advanceTimersByTime(5_000);
        statusOk(admin);
        await flush();
        expect(admin.gate).toBe('locked');
    });
});

describe('daemon_too_old', () => {
    it('shows activation, then the reboot hint after two minutes', async () => {
        const admin = store();
        admin.activate();
        fail(admin, 'daemon_too_old');
        await flush();
        expect(admin.gate).toBe('activating');
        expect(admin.rebootHint).toBe(false);

        // Retries with a growing delay: 5 s, 7.5 s, …
        vi.advanceTimersByTime(5_000);
        expect(sent).toHaveLength(2);
        fail(admin, 'daemon_too_old');
        await flush();
        vi.advanceTimersByTime(5_000);
        expect(sent).toHaveLength(2);
        vi.advanceTimersByTime(2_500);
        expect(sent).toHaveLength(3);

        vi.advanceTimersByTime(120_000);
        expect(admin.rebootHint).toBe(true);
        expect(admin.gate).toBe('activating');
    });
});

describe('unlock', () => {
    it('stores the session and refreshes the status', async () => {
        const admin = store();
        admin.activate();
        statusOk(admin);
        await flush();

        const done = admin.unlock('correct horse battery');
        expect(last()).toEqual({
            msg: 'admin_unlock',
            msg_id: 'admin-2',
            data: { admin_pass: 'correct horse battery' },
        });
        answer(admin, { success: 'true', admin_session: SESSION, expires_in: '900' });
        expect(await done).toBe(true);
        expect(admin.gate).toBe('unlocked');
        expect(admin.session).toBe(SESSION);
        // The follow-up: update_status, now with the session (full view).
        expect(last().data).toEqual({ action: 'update_status', admin_session: SESSION });
    });

    it('locks itself again when the session lifetime is over', async () => {
        const admin = store();
        admin.activate();
        statusOk(admin);
        await flush();
        void admin.unlock('x');
        answer(admin, { success: 'true', admin_session: SESSION, expires_in: '900' });
        await flush();
        vi.advanceTimersByTime(900_000);
        expect(admin.gate).toBe('locked');
        expect(admin.session).toBeNull();
        expect(admin.notice).toBeNull();
    });

    it('reports a wrong password inline and a limiter with its delay', async () => {
        const admin = store();
        admin.activate();
        statusOk(admin);
        await flush();

        void admin.unlock('nope');
        fail(admin, 'bad_password');
        await flush();
        expect(admin.gate).toBe('locked');
        expect(admin.notice?.code).toBe('bad_password');

        void admin.unlock('nope');
        fail(admin, 'rate_limited', { retry_after: '37' });
        await flush();
        expect(admin.notice).toMatchObject({ code: 'rate_limited', retryAfter: 37 });
    });

    it('calls the server too old when admin_unlock gets no answer in 5 s and nothing admin ever answered', async () => {
        const admin = store();
        // No probe answer at all (the tab was opened while reconnecting, say):
        // the unlock is the first admin message the server could answer.
        admin.gate = 'locked';
        void admin.unlock('x');
        vi.advanceTimersByTime(5_000);
        await flush();
        expect(admin.gate).toBe('old_server');
    });
});

describe('bad_session', () => {
    async function unlocked(): Promise<ReturnType<typeof useAdminStore>> {
        const admin = store();
        admin.activate();
        statusOk(admin);
        await flush();
        void admin.unlock('x');
        answer(admin, { success: 'true', admin_session: SESSION, expires_in: '900' });
        await flush();
        statusOk(admin);
        await flush();
        return admin;
    }

    it('asks for the password again with no error, and replays the action', async () => {
        const admin = await unlocked();
        void admin.checkUpdates();
        expect(last().data).toEqual({ action: 'update_check', admin_session: SESSION });
        fail(admin, 'bad_session');
        await flush();
        expect(admin.gate).toBe('locked');
        expect(admin.session).toBeNull();
        expect(admin.notice).toBeNull();

        void admin.unlock('x');
        answer(admin, { success: 'true', admin_session: 'b'.repeat(64), expires_in: '900' });
        await flush();
        expect(last().data).toEqual({ action: 'update_check', admin_session: 'b'.repeat(64) });
        // And its answer lands where a check's does.
        answer(admin, { success: 'true', result: { p: { name: 'p', version: '2', current_version: '1' } } });
        await flush();
        expect(admin.updates).toEqual([{ name: 'p', version: '2', currentVersion: '1' }]);
    });

    it('does not replay an upgrade: it rereads the status instead', async () => {
        const admin = await unlocked();
        void admin.upgradeAll();
        fail(admin, 'bad_session');
        await flush();
        void admin.unlock('x');
        answer(admin, { success: 'true', admin_session: 'b'.repeat(64), expires_in: '900' });
        await flush();
        expect(last().data).toEqual({ action: 'update_status', admin_session: 'b'.repeat(64) });
    });

    it('forgets the session on an admin_set event from elsewhere', async () => {
        const admin = await unlocked();
        event(admin, 'admin_set');
        expect(admin.gate).toBe('locked');
        expect(admin.session).toBeNull();
        expect(admin.info).toBe('session_invalidated');
    });
});

describe('update_status and the session', () => {
    async function unlocked(): Promise<ReturnType<typeof useAdminStore>> {
        const admin = store();
        admin.activate();
        statusOk(admin);
        await flush();
        void admin.unlock('x');
        answer(admin, { success: 'true', admin_session: SESSION, expires_in: '900' });
        await flush();
        statusOk(admin);
        await flush();
        return admin;
    }

    it('probes without a session while locked and keeps the household view as is', async () => {
        const admin = store();
        admin.activate();
        expect(last().data).toEqual({ action: 'update_status' });
        statusOk(
            admin,
            { status: 'upgrading', total_percent: 30, pkg_index: 1, pkg_count: 2, packages: [{ state: 'installing', percent: 30 }] },
            { id: '3f9c', kind: 'upgrade_all', status: 'running' },
        );
        await flush();
        expect(admin.gate).toBe('locked');
        expect(admin.progress).toMatchObject({ currentPkg: '', message: '', pkgIndex: 1, pkgCount: 2 });
        expect(admin.job?.package).toBe('');
        // The poll of a running job stays sessionless too.
        vi.advanceTimersByTime(5_000);
        expect(last().data).toEqual({ action: 'update_status' });
    });

    it('sends the session on every probe and poll once unlocked, and gets the names', async () => {
        const admin = await unlocked();
        void admin.upgradeAll();
        answer(admin, { success: 'true', result: { id: '3f9c', kind: 'upgrade_all', status: 'running' } });
        await flush();

        vi.advanceTimersByTime(5_000);
        expect(last().data).toEqual({ action: 'update_status', admin_session: SESSION });
        statusOk(
            admin,
            { status: 'upgrading', total_percent: 40, current_pkg: 'calaos-server', pkg_index: 1, pkg_count: 2 },
            { id: '3f9c', kind: 'upgrade_all', status: 'running' },
        );
        await flush();
        expect(admin.progress?.currentPkg).toBe('calaos-server');

        // A reconnect's probe carries it as well.
        admin.handleTransportLost();
        admin.handleLoggedIn();
        expect(last().data).toEqual({ action: 'update_status', admin_session: SESSION });
    });

    /** Unlocked, with a run started and its first full read answered. */
    async function running(): Promise<ReturnType<typeof useAdminStore>> {
        const admin = await unlocked();
        void admin.upgradeAll();
        answer(admin, { success: 'true', result: { id: '3f9c', kind: 'upgrade_all', status: 'running' } });
        await flush();
        vi.advanceTimersByTime(5_000);
        statusOk(
            admin,
            {
                status: 'upgrading',
                total_percent: 10,
                current_pkg: 'calaos-server',
                pkg_index: 1,
                pkg_count: 2,
                packages: [
                    { name: 'calaos-server', state: 'download', percent: 10 },
                    { name: 'calaos-container', state: 'pending', percent: 0 },
                ],
            },
            { id: '3f9c', kind: 'upgrade_all', status: 'running' },
        );
        await flush();
        return admin;
    }

    it('names household events from the package list of the last full read, with no extra read', async () => {
        const admin = await running();
        const before = sent.length;
        // pkg_index moves back and forth between the packages of one run.
        for (const [percent, index] of [[20, 2], [30, 1], [40, 2]] as const) {
            event(admin, 'upgrade_progress', { status: 'upgrading', total_percent: percent, pkg_index: index, pkg_count: 2 });
            expect(admin.progress?.currentPkg).toBe(index === 1 ? 'calaos-server' : 'calaos-container');
        }
        expect(sent).toHaveLength(before);
    });

    it('reads once for an index past the known list, and not again for the same one', async () => {
        const admin = await running();
        const before = sent.length;
        event(admin, 'upgrade_progress', { status: 'upgrading', total_percent: 50, pkg_index: 3, pkg_count: 3 });
        expect(admin.progress?.currentPkg).toBe('');
        expect(sent).toHaveLength(before + 1);
        expect(last().data).toEqual({ action: 'update_status', admin_session: SESSION });
        // One read at a time.
        event(admin, 'upgrade_progress', { status: 'upgrading', total_percent: 55, pkg_index: 4, pkg_count: 4 });
        expect(sent).toHaveLength(before + 1);
        fail(admin, 'internal');
        await flush();
        event(admin, 'upgrade_progress', { status: 'upgrading', total_percent: 60, pkg_index: 4, pkg_count: 4 });
        expect(sent).toHaveLength(before + 2);
        event(admin, 'upgrade_progress', { status: 'upgrading', total_percent: 65, pkg_index: 4, pkg_count: 4 });
        expect(sent).toHaveLength(before + 2);
    });

    it('never lets a read sent before an event move the bar back', async () => {
        const admin = await running();
        vi.advanceTimersByTime(5_000);
        expect(last().data).toEqual({ action: 'update_status', admin_session: SESSION });
        event(admin, 'upgrade_progress', { status: 'upgrading', total_percent: 60, pkg_index: 2, pkg_count: 2 });
        // The poll's reply was computed before that event.
        statusOk(
            admin,
            {
                status: 'upgrading',
                total_percent: 30,
                current_pkg: 'calaos-server',
                pkg_index: 1,
                pkg_count: 2,
                packages: [
                    { name: 'calaos-server', state: 'install', percent: 60 },
                    { name: 'calaos-container', state: 'pending', percent: 0 },
                ],
            },
            { id: '3f9c', kind: 'upgrade_all', status: 'running' },
        );
        await flush();
        expect(admin.progress).toMatchObject({ totalPercent: 60, pkgIndex: 2, currentPkg: 'calaos-container' });
        expect(admin.isUpgrading).toBe(true);
    });

    it('reads the job again when the run ends while a read is out', async () => {
        const admin = await running();
        vi.advanceTimersByTime(5_000);
        const before = sent.length;
        event(admin, 'upgrade_progress', { status: 'done', total_percent: 100, pkg_index: 2, pkg_count: 2 });
        expect(sent).toHaveLength(before);
        statusOk(admin, { status: 'upgrading', total_percent: 90 }, { id: '3f9c', status: 'running' });
        await flush();
        expect(sent).toHaveLength(before + 1);
        expect(admin.progress?.status).toBe('done');
        statusOk(admin, { status: 'idle' }, { id: '3f9c', status: 'done', reboot_required: true });
        await flush();
        expect(admin.isUpgrading).toBe(false);
        expect(admin.job?.rebootRequired).toBe(true);
    });

    it('asks for the password again, silently, when the poll gets bad_session, and keeps following the run', async () => {
        const admin = await running();
        vi.advanceTimersByTime(5_000);
        expect(last().data).toEqual({ action: 'update_status', admin_session: SESSION });
        fail(admin, 'bad_session');
        await flush();
        expect(admin.gate).toBe('locked');
        expect(admin.session).toBeNull();
        expect(admin.notice).toBeNull();
        expect(admin.info).toBeNull();

        // Straight away, the household view, and the poll goes on from there.
        expect(last().data).toEqual({ action: 'update_status' });
        statusOk(
            admin,
            { status: 'upgrading', total_percent: 50, pkg_index: 2, pkg_count: 2, packages: [{}, {}] },
            { id: '3f9c', kind: 'upgrade_all', status: 'running' },
        );
        await flush();
        expect(admin.progress?.totalPercent).toBe(50);
        expect(admin.gate).toBe('locked');
        vi.advanceTimersByTime(5_000);
        expect(last().data).toEqual({ action: 'update_status' });
        statusOk(admin, { status: 'idle' }, { id: '3f9c', status: 'done' });
        await flush();
        expect(admin.isUpgrading).toBe(false);

        void admin.unlock('x');
        answer(admin, { success: 'true', admin_session: SESSION, expires_in: '900' });
        await flush();
        const actions = sent.filter((f) => f.msg === 'admin').map((f) => f.data.action);
        expect(actions.filter((a) => a === 'update_upgrade_all')).toHaveLength(1);
        expect(last().data).toEqual({ action: 'update_status', admin_session: SESSION });
    });

    it('treats bad_session on a reconnect probe the same way', async () => {
        const admin = await running();
        admin.handleTransportLost();
        admin.handleLoggedIn();
        expect(last().data).toEqual({ action: 'update_status', admin_session: SESSION });
        fail(admin, 'bad_session');
        await flush();
        expect(admin.gate).toBe('locked');
        expect(admin.session).toBeNull();
        expect(admin.notice).toBeNull();
        expect(last().data).toEqual({ action: 'update_status' });
        statusOk(admin, { status: 'upgrading', total_percent: 70 }, { id: '3f9c', status: 'running' });
        await flush();
        vi.advanceTimersByTime(5_000);
        expect(last().data).toEqual({ action: 'update_status' });
    });
});

describe('set password', () => {
    it('bootstraps, then unlocks with the same password', async () => {
        const admin = store();
        admin.activate();
        fail(admin, 'admin_not_set', { api_allowed_hosts: '' });
        await flush();

        const done = admin.setPassword('a long admin password');
        expect(last()).toEqual({
            msg: 'admin_set',
            msg_id: 'admin-2',
            data: { new_pass: 'a long admin password' },
        });
        answer(admin, { success: 'true', mode: 'bootstrap' });
        await flush();
        expect(last()).toMatchObject({ msg: 'admin_unlock', data: { admin_pass: 'a long admin password' } });
        answer(admin, { success: 'true', admin_session: SESSION, expires_in: '900' });
        expect(await done).toBe(true);
        expect(admin.gate).toBe('unlocked');
        expect(admin.info).toBe('password_set');
    });

    it('routes household_password_required to the household screen', async () => {
        const admin = store();
        admin.activate();
        fail(admin, 'admin_not_set', { api_allowed_hosts: '' });
        await flush();
        void admin.setPassword('a long admin password');
        fail(admin, 'household_password_required');
        await flush();
        expect(admin.gate).toBe('household');
    });

    it('shows password_too_short with the server minimum', async () => {
        const admin = store();
        admin.activate();
        fail(admin, 'admin_not_set', { api_allowed_hosts: '' });
        await flush();
        void admin.setPassword('short');
        fail(admin, 'password_too_short', { min_length: '12' });
        await flush();
        expect(admin.gate).toBe('bootstrap');
        expect(admin.notice).toMatchObject({ code: 'password_too_short', minLength: 12 });
    });

    it('changes the household password, then returns to bootstrap once re-logged in', async () => {
        const rotate = vi.fn(() => true);
        const admin = store();
        admin.attachHousehold({ credentials: () => ({ user: 'user', pass: 'pass' }), rotate });
        admin.activate();
        fail(admin, 'admin_not_set', { api_allowed_hosts: '' });
        await flush();
        expect(admin.gate).toBe('household');

        void admin.changeHouseholdPassword('raoul', 's3cret');
        expect(last()).toEqual({
            msg: 'settings',
            msg_id: undefined,
            data: { action: 'change_cred', old_user: 'user', old_pw: 'pass', new_user: 'raoul', new_pw: 's3cret' },
        });
        admin.handleChangeCredResult({ kind: 'change_cred', success: true });
        await flush();
        expect(rotate).toHaveBeenCalledWith('raoul', 's3cret');
        expect(admin.busy).toBe('change_cred');
        admin.handleLoggedIn();
        expect(admin.gate).toBe('bootstrap');
        expect(admin.busy).toBeNull();
    });
});

describe('updates', () => {
    async function unlocked(): Promise<ReturnType<typeof useAdminStore>> {
        const admin = store();
        admin.activate();
        statusOk(admin);
        await flush();
        void admin.unlock('x');
        answer(admin, { success: 'true', admin_session: SESSION, expires_in: '900' });
        await flush();
        statusOk(admin);
        await flush();
        return admin;
    }

    it('gives update_check 125 s before giving up', async () => {
        const admin = await unlocked();
        void admin.checkUpdates();
        vi.advanceTimersByTime(124_999);
        await flush();
        expect(admin.busy).toBe('update_check');
        answer(admin, {
            success: 'true',
            result: { 'calaos-server': { name: 'calaos-server', version: '4.6.0', current_version: '4.5.0' } },
        });
        await flush();
        expect(admin.updates).toEqual([{ name: 'calaos-server', version: '4.6.0', currentVersion: '4.5.0' }]);
    });

    it('follows an upgrade through events and rereads the job at the end', async () => {
        const admin = await unlocked();
        void admin.upgradeAll();
        answer(admin, { success: 'true', result: { id: '3f9c', kind: 'upgrade_all', status: 'running' } });
        await flush();
        expect(admin.isUpgrading).toBe(true);

        event(admin, 'upgrade_progress', { status: 'upgrading', total_percent: 42, current_pkg: 'calaos-server' });
        expect(admin.progress).toMatchObject({ totalPercent: 42, currentPkg: 'calaos-server' });

        const before = sent.length;
        event(admin, 'upgrade_progress', { status: 'done', total_percent: 100 });
        expect(sent).toHaveLength(before + 1);
        expect(last().data).toEqual({ action: 'update_status', admin_session: SESSION });
        statusOk(admin, { status: 'done', total_percent: 100 }, { id: '3f9c', status: 'done', reboot_required: true });
        await flush();
        expect(admin.isUpgrading).toBe(false);
        expect(admin.job?.rebootRequired).toBe(true);
    });

    it('keeps the last percentage through done then idle, and reads the end at once', async () => {
        const admin = await unlocked();
        void admin.upgradeAll();
        answer(admin, { success: 'true', result: { id: '3f9c', kind: 'upgrade_all', status: 'running' } });
        await flush();
        event(admin, 'upgrade_progress', { status: 'upgrading', total_percent: 90, current_pkg: 'calaos-server' });

        // The daemon publishes done while the job still runs (snapshot, version refresh).
        event(admin, 'upgrade_progress', { status: 'done', total_percent: 100 });
        expect(admin.progress?.totalPercent).toBe(100);
        statusOk(admin, { status: 'done', total_percent: 100 }, { id: '3f9c', status: 'running' });
        await flush();
        expect(admin.isUpgrading).toBe(true);

        const before = sent.length;
        event(admin, 'upgrade_progress', { status: 'idle', total_percent: 0 });
        expect(admin.isUpgrading).toBe(true);
        expect(admin.progress?.totalPercent).toBe(100);
        expect(sent).toHaveLength(before + 1);
        expect(last().data).toEqual({ action: 'update_status', admin_session: SESSION });

        statusOk(admin, { status: 'idle', total_percent: 0 }, { id: '3f9c', status: 'done', reboot_required: true });
        await flush();
        expect(admin.isUpgrading).toBe(false);
        expect(admin.recentJob).toMatchObject({ id: '3f9c', status: 'done', rebootRequired: true });
        // The terminal state came from that read, not from the 5 s poll.
        vi.advanceTimersByTime(5_000);
        expect(sent).toHaveLength(before + 1);
    });

    it('rereads at once when idle lands while the read sent on done is out', async () => {
        const admin = await unlocked();
        void admin.upgradeAll();
        answer(admin, { success: 'true', result: { id: '3f9c', kind: 'upgrade_all', status: 'running' } });
        await flush();
        event(admin, 'upgrade_progress', { status: 'upgrading', total_percent: 60 });
        // A frame from earlier in the run must not rewind the bar either.
        event(admin, 'upgrade_progress', { status: 'upgrading', total_percent: 50 });
        expect(admin.progress?.totalPercent).toBe(60);

        const before = sent.length;
        event(admin, 'upgrade_progress', { status: 'done', total_percent: 100 });
        event(admin, 'upgrade_progress', { status: 'idle', total_percent: 0 });
        expect(sent).toHaveLength(before + 1);
        expect(admin.progress?.totalPercent).toBe(100);

        // The read sent on done predates the end of the job.
        statusOk(admin, { status: 'idle', total_percent: 0 }, { id: '3f9c', status: 'running' });
        await flush();
        expect(admin.isUpgrading).toBe(true);
        expect(admin.progress?.totalPercent).toBe(100);
        expect(sent).toHaveLength(before + 2);

        statusOk(admin, { status: 'idle', total_percent: 0 }, { id: '3f9c', status: 'done' });
        await flush();
        expect(admin.isUpgrading).toBe(false);
        expect(admin.job?.status).toBe('done');
    });

    it('polls update_status while a job runs, and across a reconnect', async () => {
        const admin = await unlocked();
        void admin.upgradeAll();
        answer(admin, { success: 'true', result: { id: '3f9c', status: 'running' } });
        await flush();

        const before = sent.length;
        vi.advanceTimersByTime(5_000);
        expect(sent).toHaveLength(before + 1);
        expect(last().data).toEqual({ action: 'update_status', admin_session: SESSION });

        // calaos-server restarts: the socket dies, the poll stops…
        admin.handleTransportLost();
        vi.advanceTimersByTime(30_000);
        expect(sent).toHaveLength(before + 1);
        // …and the re-login resumes it, session kept.
        admin.handleLoggedIn();
        expect(last().data).toEqual({ action: 'update_status', admin_session: SESSION });
        expect(admin.session).toBe(SESSION);
        statusOk(admin, { status: 'upgrading', total_percent: 70 }, { id: '3f9c', status: 'running' });
        await flush();
        expect(admin.gate).toBe('unlocked');
        expect(admin.progress?.totalPercent).toBe(70);
        vi.advanceTimersByTime(5_000);
        expect(last().data).toEqual({ action: 'update_status', admin_session: SESSION });
    });

    it('surfaces upgrade_in_progress and internal inline', async () => {
        const admin = await unlocked();
        void admin.upgradeAll();
        fail(admin, 'upgrade_in_progress', { job_id: 'ab' });
        await flush();
        expect(admin.notice).toMatchObject({ code: 'upgrade_in_progress', jobId: 'ab' });
        expect(admin.gate).toBe('unlocked');

        void admin.reboot();
        fail(admin, 'internal');
        await flush();
        expect(admin.notice?.code).toBe('internal');
    });

    it('reports reboot and mcp_regenerate as info', async () => {
        const admin = await unlocked();
        void admin.reboot();
        answer(admin, { success: 'true', result: null });
        await flush();
        expect(admin.info).toBe('reboot_sent');
        void admin.regenerateMcp();
        answer(admin, { success: 'true', result: {} });
        await flush();
        expect(admin.info).toBe('mcp_regenerated');
    });
});

describe('reset', () => {
    it('drops the session, the state and the timers on sign-out', async () => {
        const admin = store();
        admin.activate();
        fail(admin, 'admin_unavailable');
        await flush();
        admin.reset();
        vi.advanceTimersByTime(60_000);
        expect(sent).toHaveLength(1);
        expect(admin.gate).toBe('idle');
        expect(admin.session).toBeNull();
    });
});

describe('review fixes', () => {
    async function unlocked(): Promise<ReturnType<typeof useAdminStore>> {
        const admin = store();
        admin.activate();
        statusOk(admin);
        await flush();
        void admin.unlock('x');
        answer(admin, { success: 'true', admin_session: SESSION, expires_in: '900' });
        await flush();
        statusOk(admin);
        await flush();
        return admin;
    }

    it('never logs a password when no transport is attached', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const admin = useAdminStore();
        void admin.unlock('hunter2-secret');
        void admin.setPassword('hunter2-secret');
        await flush();
        expect(warn).toHaveBeenCalled();
        for (const call of warn.mock.calls) {
            expect(JSON.stringify(call)).not.toContain('hunter2-secret');
        }
        warn.mockRestore();
    });

    it('treats a timeout as a stall, not an old server, once the server has spoken admin', async () => {
        const admin = await unlocked();
        void admin.upgradeAll();
        answer(admin, { success: 'true', result: { id: '3f9c', status: 'running' } });
        await flush();

        // The poll goes out and nobody answers.
        vi.advanceTimersByTime(5_000);
        expect(last().data).toEqual({ action: 'update_status', admin_session: SESSION });
        vi.advanceTimersByTime(5_000);
        await flush();
        expect(admin.gate).toBe('unlocked');
        expect(admin.isUpgrading).toBe(true);
        // …and the poll is rescheduled.
        const before = sent.length;
        vi.advanceTimersByTime(5_000);
        expect(sent).toHaveLength(before + 1);
    });

    it('treats a timeout while locked as unreachable, with a retry', async () => {
        const admin = store();
        admin.activate();
        statusOk(admin);
        await flush();
        void admin.unlock('x');
        vi.advanceTimersByTime(5_000);
        await flush();
        expect(admin.gate).toBe('unreachable');
        vi.advanceTimersByTime(5_000);
        expect(last().data).toEqual({ action: 'update_status' });
    });

    it('retries a probe that fails with a non-gate code instead of spinning', async () => {
        const admin = store();
        admin.activate();
        fail(admin, 'internal');
        await flush();
        expect(admin.gate).toBe('unreachable');
        vi.advanceTimersByTime(5_000);
        expect(sent).toHaveLength(2);
        statusOk(admin);
        await flush();
        expect(admin.gate).toBe('locked');
    });

    it('re-probes when the tab is reopened while still probing', async () => {
        const admin = store();
        admin.activate();
        admin.deactivate();
        admin.activate();
        expect(sent).toHaveLength(2);
    });

    it('never replays a reboot or an MCP regeneration after bad_session', async () => {
        const admin = await unlocked();
        void admin.reboot();
        fail(admin, 'bad_session');
        await flush();
        expect(admin.gate).toBe('locked');

        void admin.unlock('x');
        answer(admin, { success: 'true', admin_session: 'b'.repeat(64), expires_in: '900' });
        await flush();
        expect(last().data).toEqual({ action: 'update_status', admin_session: 'b'.repeat(64) });
        expect(sent.some((f) => f.data.action === 'system_reboot' && f.data.admin_session === 'b'.repeat(64))).toBe(false);
    });

    it('forgets a replay when the tab is left, or when the unlock comes late', async () => {
        const admin = await unlocked();
        void admin.checkUpdates();
        fail(admin, 'bad_session');
        await flush();
        admin.deactivate();
        admin.activate();
        statusOk(admin);
        await flush();
        void admin.unlock('x');
        answer(admin, { success: 'true', admin_session: 'b'.repeat(64), expires_in: '900' });
        await flush();
        expect(last().data).toEqual({ action: 'update_status', admin_session: 'b'.repeat(64) });

        void admin.checkUpdates();
        fail(admin, 'bad_session');
        await flush();
        vi.advanceTimersByTime(121_000);
        void admin.unlock('x');
        answer(admin, { success: 'true', admin_session: 'c'.repeat(64), expires_in: '900' });
        await flush();
        expect(last().data).toEqual({ action: 'update_status', admin_session: 'c'.repeat(64) });
    });

    it('reports a refused change_cred as household_refused', async () => {
        const admin = store();
        admin.attachHousehold({ credentials: () => ({ user: 'user', pass: 'pass' }), rotate: () => true });
        admin.activate();
        fail(admin, 'admin_not_set', { api_allowed_hosts: '' });
        await flush();
        void admin.changeHouseholdPassword('raoul', 's3cret');
        admin.handleChangeCredResult({ kind: 'change_cred', success: false });
        await flush();
        expect(admin.gate).toBe('household');
        expect(admin.notice?.code).toBe('household_refused');
        expect(admin.busy).toBeNull();
    });

    it('ignores its own admin_set event even when it lands after the auto-unlock', async () => {
        const admin = store();
        admin.activate();
        fail(admin, 'admin_not_set', { api_allowed_hosts: '' });
        await flush();
        void admin.setPassword('a long admin password');
        answer(admin, { success: 'true', mode: 'bootstrap' });
        await flush();
        answer(admin, { success: 'true', admin_session: SESSION, expires_in: '900' });
        await flush();
        expect(admin.gate).toBe('unlocked');

        event(admin, 'admin_set');
        expect(admin.gate).toBe('unlocked');
        expect(admin.session).toBe(SESSION);
        // A second one is somebody else's.
        event(admin, 'admin_set');
        expect(admin.gate).toBe('locked');
    });

    it('keeps polling through a transient error while a job runs', async () => {
        const admin = await unlocked();
        void admin.upgradeAll();
        answer(admin, { success: 'true', result: { id: '3f9c', status: 'running' } });
        await flush();
        vi.advanceTimersByTime(5_000);
        fail(admin, 'internal');
        await flush();
        const before = sent.length;
        vi.advanceTimersByTime(5_000);
        expect(sent).toHaveLength(before + 1);
    });

    it('drops a stale update list when a job it did not start shows up', async () => {
        const admin = await unlocked();
        void admin.checkUpdates();
        answer(admin, { success: 'true', result: { p: { name: 'p', version: '2', current_version: '1' } } });
        await flush();
        expect(admin.updates).toHaveLength(1);
        void admin.probe();
        statusOk(admin, { status: 'upgrading', total_percent: 10 }, { id: 'kiosk', status: 'running' });
        await flush();
        expect(admin.updates).toBeNull();
        expect(admin.ownJobId).toBeNull();
    });

    it('follows a run started elsewhere on upgrade_in_progress', async () => {
        const admin = await unlocked();
        void admin.upgradeAll();
        fail(admin, 'upgrade_in_progress', { job_id: 'kiosk' });
        await flush();
        expect(last().data).toEqual({ action: 'update_status', admin_session: SESSION });
    });

    it('shows an old finished job as history, a fresh one as news', async () => {
        const admin = await unlocked();
        void admin.probe();
        statusOk(admin, { status: 'idle' }, { id: 'old', status: 'done', finished_at: '2020-01-01T00:00:00Z' });
        await flush();
        expect(admin.recentJob).toBeNull();
        void admin.probe();
        statusOk(admin, { status: 'idle' }, { id: 'new', status: 'done', finished_at: new Date().toISOString() });
        await flush();
        expect(admin.recentJob?.id).toBe('new');
    });

    it('does not call the server too old when the first probe after a mid-upgrade reconnect stalls', async () => {
        const admin = await unlocked();
        void admin.upgradeAll();
        answer(admin, { success: 'true', result: { id: '3f9c', status: 'running' } });
        await flush();

        // calaos-server restarts: the socket dies, the re-login probes, and
        // the daemon (busy with dpkg) lets that probe run past 5 s.
        admin.handleTransportLost();
        admin.handleLoggedIn();
        expect(last().data).toEqual({ action: 'update_status', admin_session: SESSION });
        vi.advanceTimersByTime(5_000);
        await flush();
        expect(admin.gate).toBe('unlocked');
        expect(admin.isUpgrading).toBe(true);
        // The job is still followed.
        const before = sent.length;
        vi.advanceTimersByTime(5_000);
        expect(sent).toHaveLength(before + 1);
        expect(last().data).toEqual({ action: 'update_status', admin_session: SESSION });
    });

    it('adopts the run seen right after a lost update_upgrade_all reply as its own', async () => {
        const admin = await unlocked();
        void admin.upgradeAll();
        admin.handleTransportLost();
        await flush();
        expect(admin.ownJobId).toBeNull();
        admin.handleLoggedIn();
        statusOk(admin, { status: 'upgrading', total_percent: 10 }, { id: 'mine', status: 'running' });
        await flush();
        expect(admin.ownJobId).toBe('mine');
    });

    it('goes back to idle on an admin_reset received while the tab is closed', async () => {
        const admin = await unlocked();
        admin.deactivate();
        event(admin, 'admin_reset');
        expect(admin.gate).toBe('idle');
        expect(admin.session).toBeNull();
        admin.activate();
        expect(last().data).toEqual({ action: 'update_status' });
    });
});
