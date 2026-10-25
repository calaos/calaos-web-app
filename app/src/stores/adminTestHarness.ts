// The harness shared by the admin feature store specs: an unlocked admin
// store on a fake transport, and helpers to answer the last frame sent.

import { vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { decodeServerMessage } from '../protocol/messages';
import type { AdminReplyMessage } from '../protocol/types';
import { useAdminStore } from './admin';

export const SESSION = 'b'.repeat(64);

export type Frame = { msg: string; msg_id: string; data: Record<string, unknown> };

export const harness = { sent: [] as Frame[] };

export function last(): Frame {
    const frame = harness.sent[harness.sent.length - 1];
    if (frame === undefined) throw new Error('nothing was sent');
    return frame;
}

function answer(data: Record<string, unknown>): void {
    const frame = last();
    useAdminStore().handleReply(decodeServerMessage({ msg: frame.msg, msg_id: frame.msg_id, data }) as AdminReplyMessage);
}

export const ok = (result: unknown): void => answer({ success: 'true', result });
export const fail = (error: string, extra: Record<string, string> = {}): void =>
    answer({ success: 'false', error, msg: error, ...extra });

export const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

/** Fake timers, a fresh pinia, nothing sent yet. */
export function setUp(): void {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    harness.sent = [];
}

export async function unlocked(): Promise<void> {
    const admin = useAdminStore();
    admin.attachTransport((frame) => {
        harness.sent.push(JSON.parse(frame));
        return true;
    });
    void admin.unlock('correct horse battery');
    answer({ success: 'true', admin_session: SESSION, expires_in: '900' });
    await flush();
    ok({ progress: { status: 'idle' }, job: null });
    await flush();
    harness.sent = [];
}
