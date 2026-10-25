// The box's network configuration (calaos_base docs/08_http_api.md,
// "Réseau"). A change needs a push code, applies as a trial and reverts
// by itself unless confirmed within 120 s. The time left comes from the box
// (`network_state` after a reload or at the new address), and runs down on
// the browser's monotonic clock, whatever its wall clock says.

import { ref, watch } from 'vue';
import { defineStore } from 'pinia';
import {
    NETWORK_CONFIRM_WINDOW_S,
    appliedSecondsLeft,
    eventSecondsLeft,
    monotonicNow,
    networkApplyParams,
    networkChangeParams,
    pendingSecondsLeft,
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
    /** When the daemon reverts, on `monotonicNow()`'s clock. */
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
    /**
     * Applied, but the reply was lost: the box may have moved. Kept for the
     * new-address hint until `network_state` is read again.
     */
    const lostApply = ref<NetworkChange | null>(null);
    /** With `lostApply`: the latest the box can revert, counted from the send. */
    const lostDeadline = ref<number | null>(null);

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

    function deadlineIn(seconds: number): number {
        return monotonicNow() + seconds * 1000;
    }

    /**
     * The reply and the event of one apply race each other; each reading is
     * a little late, so the earlier deadline is the closer one.
     */
    function track(changeId: string, intf: string, appliedAt: string, seconds: number, change: NetworkChange | null): void {
        const current = pending.value;
        const deadline = deadlineIn(seconds);
        if (current !== null && current.changeId === changeId) {
            pending.value = { ...current, deadline: Math.min(current.deadline, deadline), change: current.change ?? change };
            return;
        }
        pending.value = { changeId, intf, appliedAt, deadline, change };
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
        const lost = lostApply.value;
        lostApply.value = null;
        lostDeadline.value = null;
        pending.value =
            p === null
                ? null
                : {
                      changeId: p.changeId,
                      intf: p.intf,
                      appliedAt: p.appliedAt,
                      deadline: deadlineIn(pendingSecondsLeft(p)),
                      change: keepChange(p.changeId) ?? lost,
                  };
    }

    /**
     * Called by services/calaos.ts after every login: a lost apply is
     * resolved here, and a pending change re-read (it may have ended while
     * the socket was down, and its events are not replayed).
     */
    function handleLoggedIn(): void {
        if ((lostApply.value !== null || pending.value !== null) && admin.session !== null) void load();
    }

    /** Asks for the `network_config` code; the code entry then calls `apply`. */
    async function startApply(change: NetworkChange): Promise<void> {
        draft = change;
        finished.value = null;
        rolledBack.value = '';
        await approvers.startNetworkChange(networkChangeParams(change), apply);
    }

    /**
     * Spends the code. The box may switch address before the answer arrives:
     * a lost reply is then kept as `lostApply`, not reported, and
     * `network_state` (here after a reconnect, or at the new address) tells
     * the rest.
     */
    async function apply(proof: CodeProof): Promise<AdminError | null> {
        const change = draft;
        if (change === null) return null;
        const sentAt = monotonicNow();
        const outcome = await admin.relay('network_apply', networkApplyParams(change, proof.codeId, proof.code), false);
        if (!outcome.ok && (outcome.error.code === 'disconnected' || outcome.error.code === 'timeout')) {
            draft = null;
            lostApply.value = change;
            lostDeadline.value = sentAt + NETWORK_CONFIRM_WINDOW_S * 1000;
            return null;
        }
        if (!outcome.ok) {
            if (outcome.error.code === 'network_pending') void load();
            return outcome.error;
        }
        draft = null;
        const applied = toNetworkApplied(outcome.data.result);
        if (applied !== null) {
            track(applied.changeId, applied.intf, applied.appliedAt, appliedSecondsLeft(applied), change);
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
        const ev = toNetworkEvent(msg.type, msg.data, msg.ts);
        if (ev === null) return;
        switch (ev.type) {
            case 'network_pending':
                if (ev.changeId === '') return;
                track(ev.changeId, ev.intf, ev.appliedAt, eventSecondsLeft(ev.appliedAt, ev.ts, ev.confirmWithin), null);
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

    function dismissFinished(): void {
        finished.value = null;
    }

    function reset(): void {
        interfaces.value = null;
        pending.value = null;
        error.value = null;
        finished.value = null;
        rolledBack.value = '';
        lostApply.value = null;
        lostDeadline.value = null;
        draft = null;
    }

    return {
        interfaces,
        pending,
        error,
        rolledBack,
        finished,
        lostApply,
        lostDeadline,
        load,
        handleLoggedIn,
        startApply,
        apply,
        confirm,
        revert,
        handleEvent,
        dismissRolledBack,
        dismissFinished,
        reset,
    };
});
