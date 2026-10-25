import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminConfigStore } from './adminConfig';
import { SESSION, flush, ok, setUp, unlocked } from './adminTestHarness';

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
            new Response('{"format":"calaos-config-backup/1"}', {
                headers: { 'content-disposition': 'attachment; filename="calaos-backup-box-20261025-0912.json"' },
            }),
        );
        const file = await config.downloadBackup(fetchImpl as unknown as typeof fetch);
        expect(file).toMatchObject({ filename: 'calaos-backup-box-20261025-0912.json' });
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('/api');
        expect(JSON.parse(String(init.body))).toMatchObject({ action: 'config_backup', admin_session: SESSION });
    });

    it('reads a refused backup as an admin error', async () => {
        await unlocked();
        const config = useAdminConfigStore();
        const fetchImpl = async () => new Response('{"success":"false","error":"https_required","msg":"x"}');
        expect(await config.downloadBackup(fetchImpl as typeof fetch)).toMatchObject({ code: 'https_required' });
    });
});
