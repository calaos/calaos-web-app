import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminStore } from './admin';
import { useAdminMcpStore } from './adminMcp';
import { SESSION, setUp, unlocked } from './adminTestHarness';

beforeEach(setUp);

afterEach(() => {
    vi.useRealTimers();
});

const answer = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));

const INFO = { url_path: '/mcp', token: 'f'.repeat(64), hint: 'Use token as Bearer' };

describe('mcp store', () => {
    it('reads the token over HTTP with the session in the body', async () => {
        await unlocked();
        const mcp = useAdminMcpStore();
        const fetchImpl = answer(INFO);
        await mcp.load(false, fetchImpl as unknown as typeof fetch);
        expect(mcp.info).toEqual({ urlPath: '/mcp', token: INFO.token, hint: INFO.hint });
        expect(mcp.renewed).toBe(0);
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('/api');
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body))).toMatchObject({ action: 'get_mcp_info', admin_session: SESSION });
    });

    it('marks a read that follows a regeneration', async () => {
        await unlocked();
        const mcp = useAdminMcpStore();
        await mcp.load(true, answer(INFO) as unknown as typeof fetch);
        expect(mcp.renewed).toBe(1);
    });

    it('never leaves the old token on screen when the read after a regeneration fails', async () => {
        await unlocked();
        const mcp = useAdminMcpStore();
        await mcp.load(false, answer(INFO) as unknown as typeof fetch);
        await mcp.load(true, answer({ success: 'false', error: 'daemon_unreachable', msg: 'x' }) as unknown as typeof fetch);
        expect(mcp.info).toBeNull();
        expect(mcp.error?.code).toBe('daemon_unreachable');
    });

    it('a refused session asks for the password again and forgets the token', async () => {
        await unlocked();
        const admin = useAdminStore();
        const mcp = useAdminMcpStore();
        await mcp.load(false, answer(INFO) as unknown as typeof fetch);
        await mcp.load(false, answer({ success: 'false', error: 'bad_session', msg: 'x' }) as unknown as typeof fetch);
        expect(admin.session).toBeNull();
        expect(admin.isUnlocked).toBe(false);
        expect(mcp.info).toBeNull();
    });

    it('tells a refused household sign-in and a broken server apart', async () => {
        await unlocked();
        const mcp = useAdminMcpStore();
        await mcp.load(false, answer('Bad Request', 400) as unknown as typeof fetch);
        expect(mcp.error?.code).toBe('household_refused');
        await mcp.load(false, answer('x', 500) as unknown as typeof fetch);
        expect(mcp.error?.code).toBe('internal');
        await mcp.load(false, (async () => {
            throw new TypeError('offline');
        }) as unknown as typeof fetch);
        expect(mcp.error?.code).toBe('disconnected');
    });

    it('forgets the token with the admin session', async () => {
        await unlocked();
        const admin = useAdminStore();
        const mcp = useAdminMcpStore();
        await mcp.load(false, answer(INFO) as unknown as typeof fetch);
        admin.dropSession(null);
        await Promise.resolve();
        expect(mcp.info).toBeNull();
    });
});
