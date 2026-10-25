// The box's network configuration (calaos_base docs/08_http_api.md,
// "Réseau"). A change needs a push code, applies as a trial and reverts
// by itself unless confirmed within 120 s. The deadline is computed from the
// daemon's `applied_at`, so a reload or a reconnect at the new address finds
// the same countdown in `network_state`.

import { ref, watch } from 'vue';
import { defineStore } from 'pinia';
import {
    networkApplyParams,
    networkChangeParams,
    networkDeadline,
    toNetworkApplied,
    toNetworkEvent,
    toNetworkFinished,
    toNetworkState,
} from '../protocol/admin-network';
import type { NetInterface, NetworkChange, NetworkFinished } from '../protocol/admin-network';
import type { AdminError, CodeProof } from '../protocol/admin';
import type { AdminEventMessage } from '../protocol/types';
import { useAdminStore } from './admin';
import { useApproversStore } from './approvers';

export interface PendingChange {
    changeId: string;
    intf: string;
    appliedAt: string;
    /** ms epoch at which the daemon reverts. */
    deadline: number;
    /** What this client applied, when it did: the address to reopen the page at. */
    change: NetworkChange | null;
}

export const useAdminNetworkStore = defineStore('adminNetwork', () => {
    const admin = useAdminStore();
    const approvers = useApproversStore();

    /** null until read. */
    const interfaces = ref<NetInterface[] | null>(null);
    const pending = ref<PendingChange | null>(null);
    const error = ref<AdminError | null>(null);
    /** The interface of the last automatic rollback seen live; '' for none. */
    const rolledBack = ref('');
    /** The last change confirmed or reverted by this client. */
    const finished = ref<NetworkFinished | null>(null);

    /** The change on its way through the code entry. */
    let draft: NetworkChange | null = null;

    watch(
        () => admin.session,
        (session) => {
            if (session === null && admin.busy !== 'set' && admin.busy !== 'unlock') reset();
        },
    );

    function keepChange(changeId: string): NetworkChange | null {
        return pending.value?.changeId === changeId ? pending.value.change : null;
    }

    async function load(): Promise<void> {
        const outcome = await admin.relay('network_state', undefined, false);
        if (!outcome.ok) {
            if (admin.gate === 'unlocked') error.value = outcome.error;
            return;
        }
        error.value = null;
        const state = toNetworkState(outcome.data.result);
        interfaces.value = state.interfaces;
        const p = state.pending;
        pending.value =
            p === null
                ? null
                : {
                      changeId: p.changeId,
                      intf: p.intf,
                      appliedAt: p.appliedAt,
                      deadline: networkDeadline(p.appliedAt, p.expiresIn),
                      change: keepChange(p.changeId),
                  };
    }

    /** Asks for the `network_config` code; the code entry then calls `apply`. */
    async function startApply(change: NetworkChange): Promise<void> {
        draft = change;
        finished.value = null;
        await approvers.startNetworkChange(networkChangeParams(change), apply);
    }

    /**
     * Spends the code. The box may switch address before the answer arrives:
     * a dropped connection then is the change working, and `network_state`
     * at the new address tells the rest.
     */
    async function apply(proof: CodeProof): Promise<AdminError | null> {
        const change = draft;
        if (change === null) return null;
        const outcome = await admin.relay('network_apply', networkApplyParams(change, proof.codeId, proof.code), false);
        if (!outcome.ok) {
            if (outcome.error.code === 'network_pending') void load();
            return outcome.error;
        }
        draft = null;
        const applied = toNetworkApplied(outcome.data.result);
        if (applied !== null) {
            pending.value = {
                changeId: applied.changeId,
                intf: applied.intf,
                appliedAt: applied.appliedAt,
                deadline: networkDeadline(applied.appliedAt, applied.confirmWithin),
                change,
            };
        }
        return null;
    }

    async function finish(action: 'network_confirm' | 'network_revert'): Promise<AdminError | null> {
        const current = pending.value;
        if (current === null) return null;
        const outcome = await admin.relay(action, { change_id: current.changeId }, true);
        if (!outcome.ok) {
            // Unknown or finished meanwhile (rolled back, confirmed elsewhere).
            if (outcome.error.code === 'invalid_request') void load();
            return outcome.error;
        }
        finished.value = toNetworkFinished(outcome.data.result);
        pending.value = null;
        void load();
        return null;
    }

    function confirm(): Promise<AdminError | null> {
        return finish('network_confirm');
    }

    function revert(): Promise<AdminError | null> {
        return finish('network_revert');
    }

    /** Called by services/calaos.ts for every `admin_event`. */
    function handleEvent(msg: AdminEventMessage): void {
        const ev = toNetworkEvent(msg.type, msg.data);
        if (ev === null) return;
        switch (ev.type) {
            case 'network_pending':
                if (ev.changeId === '') return;
                pending.value = {
                    changeId: ev.changeId,
                    intf: ev.intf,
                    appliedAt: ev.appliedAt,
                    deadline: networkDeadline(ev.appliedAt, ev.confirmWithin),
                    change: keepChange(ev.changeId),
                };
                return;
            case 'network_applied':
                if (pending.value?.changeId === ev.changeId) pending.value = null;
                if (admin.isUnlocked) void load();
                return;
            case 'network_rolled_back':
                pending.value = null;
                rolledBack.value = ev.intf === '' ? '?' : ev.intf;
                if (admin.isUnlocked) void load();
                return;
        }
    }

    function dismissRolledBack(): void {
        rolledBack.value = '';
    }

    function reset(): void {
        interfaces.value = null;
        pending.value = null;
        error.value = null;
        finished.value = null;
        rolledBack.value = '';
        draft = null;
    }

    return {
        interfaces,
        pending,
        error,
        rolledBack,
        finished,
        load,
        startApply,
        apply,
        confirm,
        revert,
        handleEvent,
        dismissRolledBack,
        reset,
    };
});
