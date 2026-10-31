import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminStore } from './admin';
import { useAdminMcpStore } from './adminMcp';
import { SESSION, flush, setUp, unlocked } from './adminTestHarness';

beforeEach(setUp);

afterEach(() => {
    vi.useRealTimers();
});

const answer = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));

const INFO = { url_path: '/mcp', token: 'f'.repeat(64), hint: 'Use token as Bearer' };
const NEW_INFO = { ...INFO, token: 'e'.repeat(64) };

/** A read held open until the test answers it. */
function held() {
    let release!: (response: Response) => void;
    const reply = new Promise<Response>((resolve) => {
        release = resolve;
    });
    return {
        fetchImpl: vi.fn(() => reply) as unknown as typeof fetch,
        answer: async (body: unknown) => {
            release(new Response(JSON.stringify(body)));
            await flush();
        },
    };
}

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
        await mcp.load(false, answer(INFO) as unknown as typeof fetch);
        await mcp.load(true, answer(NEW_INFO) as unknown as typeof fetch);
        expect(mcp.renewed).toBe(1);
        expect(mcp.info?.token).toBe(NEW_INFO.token);
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

describe('mcp store, a new token', () => {
    it('shows the new token once the box has made it', async () => {
        await unlocked();
        const admin = useAdminStore();
        const mcp = useAdminMcpStore();
        await mcp.load(false, answer(INFO) as unknown as typeof fetch);
        const regenerateMcp = vi.spyOn(admin, 'regenerateMcp').mockResolvedValue(true);
        await mcp.regenerate(answer(NEW_INFO) as unknown as typeof fetch);
        expect(regenerateMcp).toHaveBeenCalledOnce();
        expect(mcp.info?.token).toBe(NEW_INFO.token);
        expect(mcp.renewed).toBe(1);
    });

    it('reads nothing when the box refused', async () => {
        await unlocked();
        const admin = useAdminStore();
        const mcp = useAdminMcpStore();
        await mcp.load(false, answer(INFO) as unknown as typeof fetch);
        vi.spyOn(admin, 'regenerateMcp').mockResolvedValue(false);
        const fetchImpl = answer(NEW_INFO);
        await mcp.regenerate(fetchImpl as unknown as typeof fetch);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(mcp.info?.token).toBe(INFO.token);
        expect(mcp.renewed).toBe(0);
    });
});

describe('mcp store, a read that lands late', () => {
    it.each([
        ['the card went', (): void => useAdminMcpStore().reset()],
        ['the session ended', (): void => useAdminStore().dropSession(null)],
    ])('writes nothing once %s', async (_name, leave) => {
        await unlocked();
        const mcp = useAdminMcpStore();
        const read = held();
        const pending = mcp.load(false, read.fetchImpl);
        leave();
        await read.answer(INFO);
        await pending;
        expect(mcp.info).toBeNull();
        expect(mcp.error).toBeNull();
        expect(mcp.loading).toBe(false);
    });

    it('does not count as a regeneration once the card went', async () => {
        await unlocked();
        const mcp = useAdminMcpStore();
        await mcp.load(false, answer(INFO) as unknown as typeof fetch);
        const read = held();
        const pending = mcp.load(true, read.fetchImpl);
        mcp.reset();
        await read.answer(NEW_INFO);
        await pending;
        expect(mcp.info).toBeNull();
        expect(mcp.renewed).toBe(0);
    });

    it('a regeneration that ends after the card went reads nothing', async () => {
        await unlocked();
        const mcp = useAdminMcpStore();
        await mcp.load(false, answer(INFO) as unknown as typeof fetch);
        mcp.reset();
        const fetchImpl = answer(NEW_INFO);
        await mcp.load(true, fetchImpl as unknown as typeof fetch);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(mcp.info).toBeNull();
        expect(mcp.renewed).toBe(0);
    });

    it('a regeneration that ends after the session reads nothing', async () => {
        await unlocked();
        const admin = useAdminStore();
        const mcp = useAdminMcpStore();
        await mcp.load(false, answer(INFO) as unknown as typeof fetch);
        admin.dropSession(null);
        await flush();
        const fetchImpl = answer(NEW_INFO);
        await mcp.load(true, fetchImpl as unknown as typeof fetch);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(mcp.info).toBeNull();
        expect(mcp.error).toBeNull();
    });

    it('keeps the newest of two overlapping reads, whichever lands last', async () => {
        await unlocked();
        const mcp = useAdminMcpStore();
        const older = held();
        const first = mcp.load(false, older.fetchImpl);
        const newer = held();
        const second = mcp.load(true, newer.fetchImpl);
        await newer.answer(NEW_INFO);
        await second;
        expect(mcp.loading).toBe(false);
        await older.answer(INFO);
        await first;
        expect(mcp.info?.token).toBe(NEW_INFO.token);
        expect(mcp.renewed).toBe(1);
    });

    it('stops loading and writes nothing when the session was replaced under the read', async () => {
        await unlocked();
        const admin = useAdminStore();
        const mcp = useAdminMcpStore();
        const read = held();
        const pending = mcp.load(false, read.fetchImpl);
        admin.session = 'c'.repeat(64);
        await read.answer(INFO);
        await pending;
        expect(mcp.info).toBeNull();
        expect(mcp.loading).toBe(false);
    });

    it('a late bad_session leaves the session that replaced the refused one', async () => {
        await unlocked();
        const admin = useAdminStore();
        const mcp = useAdminMcpStore();
        const read = held();
        const pending = mcp.load(false, read.fetchImpl);
        const replacement = 'c'.repeat(64);
        admin.session = replacement;
        await read.answer({ success: 'false', error: 'bad_session', msg: 'x' });
        await pending;
        expect(admin.session).toBe(replacement);
        expect(mcp.error).toBeNull();
    });
});
