import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG_RESTORE_TIMEOUT_MS } from '../protocol/admin';
import { useAdminStore } from './admin';
import { useAdminConfigStore } from './adminConfig';
import { SESSION, fail, flush, harness, last, ok, setUp, unlocked } from './adminTestHarness';
import { SELF_RESTART_DEADLINE_MS } from './adminServices';
import { useAuthStore } from './auth';
import { useConnectionStore } from './connection';

beforeEach(setUp);

afterEach(() => {
    vi.useRealTimers();
});

describe('config store', () => {
    it('never keeps a secret value after a save', async () => {
        await unlocked();
        const config = useAdminConfigStore();
        void config.load();
        ok({ options: [{ key: 'smtp_password', secret: true, set: false }] });
        await flush();
        const pending = config.set('smtp_password', 'x');
        ok({ key: 'smtp_password', set: true, restart_required: false });
        await pending;
        expect(config.options?.[0]).toMatchObject({ value: null, set: true });
    });

    it('downloads the backup over HTTP with the session in the body', async () => {
        await unlocked();
        const config = useAdminConfigStore();
        const fetchImpl = vi.fn(async () =>
            new Response(
                JSON.stringify({
                    format: 'calaos-config-backup/2',
                    created_at: '2026-10-25T09:12:58Z',
                    server_version: '4.6.0',
                    hostname: 'box',
                    io_format: 2,
                    files: { 'io.xml': '<x/>', 'rules.xml': '<y/>' },
                }),
                { headers: { 'content-disposition': 'attachment; filename="calaos-backup-box-20261025-0912.json"' } },
            ),
        );
        const file = await config.downloadBackup(fetchImpl as unknown as typeof fetch);
        expect(file).toMatchObject({ filename: 'calaos-backup-box-20261025-0912.zip' });
        expect((file as { blob: Blob }).blob.type).toBe('application/zip');
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('/api');
        expect(JSON.parse(String(init.body))).toMatchObject({ action: 'config_backup', admin_session: SESSION });
    });

    it('reports a download it cannot read, rather than saving it', async () => {
        await unlocked();
        const config = useAdminConfigStore();
        const answer = (body: string) => async () =>
            new Response(body, { headers: { 'content-disposition': 'attachment' } });
        expect(await config.downloadBackup(answer('not json') as typeof fetch)).toMatchObject({ code: 'internal' });
        expect(await config.downloadBackup(answer('{"format":"other"}') as typeof fetch)).toMatchObject({ code: 'internal' });
    });

    it('reads a refused backup as an admin error', async () => {
        await unlocked();
        const config = useAdminConfigStore();
        const fetchImpl = async () => new Response('{"success":"false","error":"https_required","msg":"x"}');
        expect(await config.downloadBackup(fetchImpl as typeof fetch)).toMatchObject({ code: 'https_required' });
    });

    it('tells a refused household sign-in apart from a box failure', async () => {
        await unlocked();
        const config = useAdminConfigStore();
        const refused = async () => new Response('Bad Request', { status: 400 });
        expect(await config.downloadBackup(refused as typeof fetch)).toMatchObject({ code: 'household_refused' });
        const broken = async () => new Response('x', { status: 500 });
        expect(await config.downloadBackup(broken as typeof fetch)).toMatchObject({ code: 'internal' });
    });

    it('an older daemon stays in the panel: the Admin page stays unlocked', async () => {
        await unlocked();
        const config = useAdminConfigStore();
        void config.load();
        fail('daemon_too_old');
        await flush();
        expect(useAdminStore().gate).toBe('unlocked');
        expect(config.error?.code).toBe('daemon_too_old');
        const saved = config.set('smtp_host', 'mail');
        fail('daemon_too_old');
        expect((await saved).error?.code).toBe('daemon_too_old');
        expect(useAdminStore().gate).toBe('unlocked');
    });
});

describe('config restore', () => {
    const FILES = { 'io.xml': '<?xml?>', 'rules.xml': '<?xml?>' };
    const ANSWER = {
        dry_run: false,
        files: ['io.xml', 'rules.xml'],
        backup: { rooms: 1, ios: 2, devices: 3, rules: 4 },
        box: { rooms: 1, ios: 2, devices: 3, rules: 4 },
        io_format: 2,
        kept: [],
        warnings: [],
        previous: '2026/10/25-10-2026_17-14-15',
        restarting: true,
    };

    function goOnline(): void {
        useAuthStore().state = 'authed';
        useConnectionStore().applyStatus({ status: 'open', attempt: 0, nextRetryMs: 0 });
    }

    function dropConnection(): void {
        useConnectionStore().applyStatus({ status: 'reconnecting', attempt: 1, nextRetryMs: 1000 });
        useAuthStore().state = 'idle';
    }

    it('asks for a dry run, which follows no restart', async () => {
        await unlocked();
        const config = useAdminConfigStore();
        const pending = config.previewRestore(FILES);
        expect(last().data).toMatchObject({ action: 'config_restore', params: { files: FILES, dry_run: true } });
        ok({ ...ANSWER, dry_run: true, previous: undefined, restarting: false });
        expect((await pending).result).toMatchObject({ dryRun: true, previous: null });
        expect(config.restoreFollowUp).toBeNull();
    });

    it('hands a refused preview back, session kept', async () => {
        await unlocked();
        const pending = useAdminConfigStore().previewRestore(FILES);
        fail('invalid_request');
        expect((await pending).error).toMatchObject({ code: 'invalid_request' });
        expect(useAdminStore().session).toBe(SESSION);
    });

    it('only says restored once the connection dropped and the household signed back in', async () => {
        await unlocked();
        goOnline();
        const config = useAdminConfigStore();
        const pending = config.restore(FILES, true);
        expect(last().data).toMatchObject({ action: 'config_restore', params: { dry_run: false } });
        ok(ANSWER);
        expect(await pending).toBeNull();
        expect(config.restoreFollowUp).toEqual({ phase: 'restarting', previous: ANSWER.previous, partial: false });
        expect(config.householdChanged).toBe(true);

        dropConnection();
        await flush();
        useConnectionStore().applyStatus({ status: 'open', attempt: 0, nextRetryMs: 0 });
        await flush();
        expect(config.restoreFollowUp?.phase).toBe('restarting');

        harness.sent = [];
        useAuthStore().state = 'authed';
        await flush();
        expect(config.restoreFollowUp?.phase).toBe('done');
        expect(config.householdChanged).toBe(false);
        expect(last().data).toMatchObject({ action: 'config_list' });
    });

    it('stays on the wait when the connection never dropped', async () => {
        await unlocked();
        goOnline();
        const config = useAdminConfigStore();
        const pending = config.restore(FILES, false);
        ok(ANSWER);
        await pending;
        useAuthStore().state = 'idle';
        await flush();
        expect(config.restoreFollowUp?.phase).toBe('restarting');
    });

    it('says the box is slow past the deadline, and still takes its return', async () => {
        await unlocked();
        goOnline();
        const config = useAdminConfigStore();
        const pending = config.restore(FILES, false);
        ok(ANSWER);
        await pending;
        dropConnection();
        await vi.advanceTimersByTimeAsync(SELF_RESTART_DEADLINE_MS);
        expect(config.restoreFollowUp?.phase).toBe('slow');
        goOnline();
        await flush();
        expect(config.restoreFollowUp?.phase).toBe('done');
    });

    it('follows a lost answer without claiming the folder', async () => {
        await unlocked();
        goOnline();
        const config = useAdminConfigStore();
        const pending = config.restore(FILES, true);
        await vi.advanceTimersByTimeAsync(CONFIG_RESTORE_TIMEOUT_MS);
        expect(await pending).toBeNull();
        expect(config.restoreFollowUp).toMatchObject({ phase: 'restarting', previous: null });
        expect(config.householdChanged).toBe(true);
    });

    it('hands a refusal back and follows nothing', async () => {
        await unlocked();
        goOnline();
        const config = useAdminConfigStore();
        const pending = config.restore(FILES, true);
        fail('upgrade_in_progress');
        expect(await pending).toMatchObject({ code: 'upgrade_in_progress' });
        expect(config.restoreFollowUp).toBeNull();
        expect(config.householdChanged).toBe(false);
    });

    it('follows the restart of a write that failed half way, with its folder', async () => {
        await unlocked();
        goOnline();
        const config = useAdminConfigStore();
        const pending = config.restore(FILES, false);
        fail('internal', { msg: 'disk full; previous files in backups/2026/x', previous: '2026/x', restarting: 'true' });
        expect(await pending).toMatchObject({ code: 'internal', previous: '2026/x', restarting: true });
        expect(config.restoreFollowUp).toEqual({ phase: 'restarting', previous: '2026/x', partial: true });
    });

    it('follows nothing when a failed write leaves the server running', async () => {
        await unlocked();
        goOnline();
        const config = useAdminConfigStore();
        const pending = config.restore(FILES, false);
        fail('internal', { msg: 'disk full', previous: '2026/x', restarting: 'false' });
        expect(await pending).toMatchObject({ restarting: false });
        expect(config.restoreFollowUp).toBeNull();
    });

    it('reloads the options when the box returns after a dismissed slow banner', async () => {
        await unlocked();
        goOnline();
        const config = useAdminConfigStore();
        config.options = [];
        const pending = config.restore(FILES, false);
        ok(ANSWER);
        await pending;
        dropConnection();
        await vi.advanceTimersByTimeAsync(SELF_RESTART_DEADLINE_MS);
        config.dismissRestore();
        goOnline();
        await flush();
        expect(last().data).toMatchObject({ action: 'config_list' });
    });

    it('forgets the follow-up on dismiss', async () => {
        await unlocked();
        goOnline();
        const config = useAdminConfigStore();
        const pending = config.restore(FILES, false);
        ok(ANSWER);
        await pending;
        config.dismissRestore();
        expect(config.restoreFollowUp).toBeNull();
    });

    it('keeps the household hint past a dismissed slow banner, until the sign-in succeeds', async () => {
        await unlocked();
        goOnline();
        const config = useAdminConfigStore();
        const pending = config.restore(FILES, true);
        ok(ANSWER);
        await pending;
        dropConnection();
        await vi.advanceTimersByTimeAsync(SELF_RESTART_DEADLINE_MS);
        expect(config.restoreFollowUp?.phase).toBe('slow');

        config.dismissRestore();
        expect(config.restoreFollowUp).toBeNull();
        expect(config.householdChanged).toBe(true);

        // The box is back, the old login is refused: still no household session.
        useConnectionStore().applyStatus({ status: 'open', attempt: 0, nextRetryMs: 0 });
        await flush();
        expect(config.householdChanged).toBe(true);

        useAuthStore().state = 'authed';
        await flush();
        expect(config.householdChanged).toBe(false);
        expect(config.restoreFollowUp).toBeNull();
    });

    it('a later restore without a login change drops an earlier hint', async () => {
        await unlocked();
        goOnline();
        const config = useAdminConfigStore();
        const first = config.restore(FILES, true);
        ok(ANSWER);
        await first;
        config.dismissRestore();
        const second = config.restore(FILES, false);
        ok(ANSWER);
        await second;
        expect(config.householdChanged).toBe(false);
    });
});
