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
    cidrAddress,
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
import { isPanelError } from '../protocol/admin';
import type { AdminError, CodeProof } from '../protocol/admin';
import type { AdminEventMessage } from '../protocol/types';
import { useAdminStore } from './admin';
import { useApproversStore } from './approvers';

/** How this client's last change ended; `not_applied` is an apply with no answer that did not take. */
export interface NetworkOutcome {
    changeId: string;
    intf: string;
    state: NetworkFinished['state'] | 'not_applied';
}

/** The action may have happened: the box went quiet, or calaos_server gave up on it. */
function isUnanswered(error: AdminError): boolean {
    return error.code === 'timeout' || error.code === 'disconnected' || error.outcomeUnknown;
}
/** The box rounds its seconds up and they are read on arrival: keep one in hand. */
const SAFETY_S = 1;

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
    const finished = ref<NetworkOutcome | null>(null);
    /**
     * Applied, but the reply was lost: the box may have moved. Kept for the
     * new-address hint until `network_state` is read again.
     */
    const lostApply = ref<NetworkChange | null>(null);
    /** With `lostApply`: the latest the box can revert, counted from the send. */
    const lostDeadline = ref<number | null>(null);
    /**
     * The address (no prefix) the changed interface had when this client
     * applied: if it is the page's own host, the page is about to lose the box.
     */
    const appliedFrom = ref('');
    /** A keep or a go back got no answer: the box may be at its new address. */
    const unanswered = ref(false);

    /** The change on its way through the code entry. */
    let draft: NetworkChange | null = null;
    /** The change this client is keeping or reverting: its own event needs no second read. */
    let finishing = '';
    /**
     * The lost apply came back as an unknown outcome, read at once: nothing
     * waiting then means it never took, not that it was rolled back unseen.
     */
    let lostAnswered = false;
    /** A `network_applied` for `finishing` that arrived before its reply. */
    let keptMeanwhile = '';

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
        return monotonicNow() + Math.max(0, seconds - SAFETY_S) * 1000;
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
        const outcome = await admin.relay('network_state', undefined, false, isPanelError);
        if (!outcome.ok) {
            if (admin.gate === 'unlocked') error.value = outcome.error;
            return;
        }
        error.value = null;
        unanswered.value = false;
        const state = toNetworkState(outcome.data.result);
        interfaces.value = state.interfaces;
        const p = state.pending;
        const lost = lostApply.value;
        lostApply.value = null;
        lostDeadline.value = null;
        if (lost !== null && lostAnswered && p === null) {
            finished.value = { changeId: '', intf: lost.intf, state: 'not_applied' };
        }
        lostAnswered = false;
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
        unanswered.value = false;
        const before = interfaces.value?.find((intf) => intf.name === change.intf)?.ipv4 ?? '';
        appliedFrom.value = cidrAddress(before);
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
        const outcome = await admin.relay(
            'network_apply',
            networkApplyParams(change, proof.codeId, proof.code),
            false,
            isPanelError,
        );
        if (!outcome.ok && isUnanswered(outcome.error)) {
            draft = null;
            lostApply.value = change;
            lostDeadline.value = sentAt + NETWORK_CONFIRM_WINDOW_S * 1000;
            // calaos_server answered: the box is still reachable here.
            lostAnswered = outcome.error.outcomeUnknown;
            if (lostAnswered) void load();
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
        finishing = current.changeId;
        keptMeanwhile = '';
        const outcome = await admin.relay(action, { change_id: current.changeId }, true, isPanelError);
        finishing = '';
        const kept = keptMeanwhile === current.changeId;
        keptMeanwhile = '';
        // The box already said it was kept: the lost reply changes nothing.
        if (!outcome.ok && kept && isUnanswered(outcome.error)) {
            if (pending.value?.changeId === current.changeId) pending.value = null;
            finished.value = { changeId: current.changeId, intf: current.intf, state: 'confirmed' };
            return null;
        }
        if (!outcome.ok && outcome.error.outcomeUnknown) {
            await load();
            // Still on trial: nothing happened, the buttons are back. Gone and
            // not rolled back: the daemon did what was asked.
            if (pending.value === null && rolledBack.value === '') {
                finished.value = {
                    changeId: current.changeId,
                    intf: current.intf,
                    state: action === 'network_confirm' ? 'confirmed' : 'reverted',
                };
            }
            return null;
        }
        if (!outcome.ok) {
            if (isUnanswered(outcome.error)) unanswered.value = true;
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
                track(ev.changeId, ev.intf, ev.appliedAt, eventSecondsLeft(ev.confirmWithin), null);
                return;
            case 'network_applied':
                // Our own keep reads the state once its reply is in.
                if (ev.changeId !== '' && ev.changeId === finishing) {
                    keptMeanwhile = ev.changeId;
                    return;
                }
                if (ev.changeId !== '' && ev.changeId === finished.value?.changeId) return;
                if (pending.value !== null && pending.value.changeId === ev.changeId) {
                    finished.value = { changeId: ev.changeId, intf: ev.intf, state: 'confirmed' };
                    pending.value = null;
                }
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
        appliedFrom.value = '';
        unanswered.value = false;
        draft = null;
        finishing = '';
        keptMeanwhile = '';
        lostAnswered = false;
    }

    return {
        interfaces,
        pending,
        error,
        rolledBack,
        finished,
        lostApply,
        lostDeadline,
        appliedFrom,
        unanswered,
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
