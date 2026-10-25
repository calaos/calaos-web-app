// The MCP endpoint and its token, read over HTTP (`get_mcp_info`). The token
// is a credential: memory only, dropped with the admin session or when the
// card goes, and never logged.

import { ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { bareAdminError, isAdminFailure, toAdminError } from '../protocol/admin';
import type { AdminError } from '../protocol/admin';
import { mcpInfoBody, toMcpInfo } from '../protocol/admin-mcp';
import type { McpInfo } from '../protocol/admin-mcp';
import { useAdminStore } from './admin';

export const useAdminMcpStore = defineStore('adminMcp', () => {
    const admin = useAdminStore();

    const info = ref<McpInfo | null>(null);
    const error = ref<AdminError | null>(null);
    const loading = ref(false);
    /** Bumped when a read follows a regeneration, so the card can mark the new token. */
    const renewed = ref(0);

    watch(
        () => admin.session,
        (session) => {
            if (session === null) reset();
        },
    );

    async function read(fetchImpl: typeof fetch): Promise<McpInfo | AdminError> {
        const session = admin.session;
        if (session === null) return bareAdminError('bad_session');
        const { user, pass } = admin.householdCredentials();
        let response: Response;
        try {
            response = await fetchImpl('/api', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: mcpInfoBody(user, pass, session),
                cache: 'no-store',
            });
        } catch {
            return bareAdminError('disconnected');
        }
        // A refused household sign-in is HTTP 400 with an HTML page.
        if (response.status === 400) return bareAdminError('household_refused');
        if (!response.ok) return bareAdminError('internal');
        let payload: unknown;
        try {
            payload = await response.json();
        } catch {
            return bareAdminError('unknown');
        }
        const parsed = toMcpInfo(payload);
        if (parsed !== null) return parsed;
        const failure = isAdminFailure(payload) ? toAdminError(payload) : bareAdminError('unknown');
        if (failure.code === 'bad_session') admin.dropSession(null);
        return failure;
    }

    async function load(afterRegenerate = false, fetchImpl: typeof fetch = fetch): Promise<void> {
        loading.value = true;
        const outcome = await read(fetchImpl);
        loading.value = false;
        if ('token' in outcome) {
            info.value = outcome;
            error.value = null;
            if (afterRegenerate) renewed.value += 1;
        } else {
            // The old token no longer works after a regeneration: never leave it on screen.
            if (afterRegenerate) info.value = null;
            error.value = outcome;
        }
    }

    function reset(): void {
        info.value = null;
        error.value = null;
        loading.value = false;
    }

    return { info, error, loading, renewed, load, reset };
});
