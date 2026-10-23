// Admin store — the admin session (memory only), the gate the Admin tab is
// behind, the update flow, and the retry policies of the contract
// (calaos_base docs/08_http_api.md, "Administration").
//
// calaos_server keeps no admin state at all: the session is held here and
// resent with every message that needs one, so it survives a server restart.
// `update_status` needs no session and is the probe for everything — it tells
// whether an admin exists, whether the daemon is reachable, and where an
// upgrade stands — which is why a reconnect, a retry and the first visit of
// the tab all go through `probe()`.

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
    ACTIVATION_REBOOT_HINT_MS,
    ADMIN_REPLY_TIMEOUT_MS,
    UNAVAILABLE_FAST_RETRY_MS,
    UNAVAILABLE_FAST_WINDOW_MS,
    UNAVAILABLE_SLOW_RETRY_MS,
    UPDATE_CHECK_TIMEOUT_MS,
    clientAdminError,
    encodeAdminAction,
    encodeAdminSet,
    encodeAdminUnlock,
    encodeChangeCredentials,
    isAdminFailure,
    toAdminError,
    toUpdateList,
    toUpgradeJob,
    toUpgradeStatus,
} from '../protocol/admin';
import type {
    AdminAction,
    AdminError,
    UpdateEntry,
    UpgradeJob,
    UpgradeStatus,
} from '../protocol/admin';
import type { AdminEventMessage, AdminReplyMessage, ChangeCredMessage } from '../protocol/types';

/** See stores/home.ts — same contract, declared locally to avoid a cycle. */
export type FrameSender = (frame: string) => boolean;

/**
 * What this store needs from the auth store, injected by services/calaos.ts
 * rather than imported: auth already imports this store (sign-out resets
 * it), and a store cycle is what the home/audio split exists to avoid.
 */
export interface HouseholdAccess {
    credentials(): { user: string; pass: string };
    /** `auth.rotateCredentials` — re-login with new credentials on the live socket. */
    rotate(user: string, pass: string): boolean;
}

/**
 * What the Admin tab shows. One screen per value; the view never has to
 * combine two of them.
 */
export type AdminGate =
    | 'idle'
    | 'probing'
    | 'household'
    | 'bootstrap'
    | 'locked'
    | 'unlocked'
    | 'unavailable'
    | 'activating'
    | 'unreachable'
    | 'old_server'
    | 'https_required';

/** Something to tell the user that is not an error. */
export type AdminInfo =
    | 'password_set'
    | 'password_changed'
    | 'session_invalidated'
    | 'already_set'
    | 'mcp_regenerated'
    | 'reboot_sent'
    | 'restart_sent';

export type AdminBusy = AdminAction | 'unlock' | 'set' | 'change_cred' | null;

type Outcome = { ok: true; data: Record<string, unknown> } | { ok: false; error: AdminError };

interface PendingReply {
    resolve: (outcome: Outcome) => void;
    timer: ReturnType<typeof setTimeout>;
}

/** Retry cadence while the daemon is unreachable or still the old binary. */
function backoffMs(attempt: number): number {
    return Math.min(5_000 * Math.pow(1.5, attempt), 30_000);
}

/** Only `update_status` may be polled while an upgrade runs. */
const JOB_POLL_MS = 5_000;

export const useAdminStore = defineStore('admin', () => {
    const gate = ref<AdminGate>('idle');
    /** Opaque, from the daemon; memory only. */
    const session = ref<string | null>(null);
    const apiAllowedHosts = ref('');
    /** The error the current screen shows under its form, if any. */
    const notice = ref<AdminError | null>(null);
    const info = ref<AdminInfo | null>(null);
    const busy = ref<AdminBusy>(null);
    const progress = ref<UpgradeStatus | null>(null);
    const job = ref<UpgradeJob | null>(null);
    /** null until a check ran; [] means nothing to update. */
    const updates = ref<UpdateEntry[] | null>(null);
    /** `daemon_too_old` has lasted long enough that only a reboot will do. */
    const rebootHint = ref(false);

    // Not state: transport, timers, correlation.
    let send: FrameSender = (frame) => {
        console.warn('calaos admin: no transport attached, dropping frame:', frame);
        return false;
    };
    let household: HouseholdAccess = {
        credentials: () => ({ user: '', pass: '' }),
        rotate: () => false,
    };
    let nextMsgId = 0;
    const pending = new Map<string, PendingReply>();
    let pendingChangeCred: PendingReply | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let sessionTimer: ReturnType<typeof setTimeout> | null = null;
    let rebootHintTimer: ReturnType<typeof setTimeout> | null = null;
    let unavailableSince: number | null = null;
    let retryAttempt = 0;
    /** The Admin tab is on screen: retries are worth scheduling. */
    let active = false;
    /** An action refused with `bad_session`, replayed after the next unlock. */
    let replay: { action: AdminAction; params?: Record<string, string> } | null = null;
    /** The household credentials being installed by `change_cred`. */
    let credentialDraft: { user: string; pass: string } | null = null;

    const isUnlocked = computed(() => gate.value === 'unlocked' && session.value !== null);
    const isUpgrading = computed(
        () => job.value?.status === 'running' || progress.value?.status === 'upgrading',
    );

    function attachTransport(sender: FrameSender): void {
        send = sender;
    }

    function attachHousehold(access: HouseholdAccess): void {
        household = access;
    }

    // ------------------------------------------------------------ timers ---

    function clearTimer(handle: ReturnType<typeof setTimeout> | null): null {
        if (handle !== null) clearTimeout(handle);
        return null;
    }

    function scheduleRetry(delayMs: number): void {
        retryTimer = clearTimer(retryTimer);
        if (!active) return;
        retryTimer = setTimeout(() => {
            retryTimer = null;
            void probe();
        }, delayMs);
    }

    function schedulePoll(): void {
        pollTimer = clearTimer(pollTimer);
        pollTimer = setTimeout(() => {
            pollTimer = null;
            void refreshStatus();
        }, JOB_POLL_MS);
    }

    function armSession(expiresInSeconds: number): void {
        sessionTimer = clearTimer(sessionTimer);
        if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) return;
        // The daemon's lifetime is absolute; locking a second early is better
        // than a panel whose next tap gets `bad_session`.
        sessionTimer = setTimeout(() => {
            sessionTimer = null;
            forgetSession(null);
        }, expiresInSeconds * 1000);
    }

    // ----------------------------------------------------------- requests ---

    function request(frame: string, timeoutMs: number, msgId: string): Promise<Outcome> {
        return new Promise((resolve) => {
            if (!send(frame)) {
                resolve({ ok: false, error: clientAdminError('disconnected') });
                return;
            }
            const timer = setTimeout(() => {
                pending.delete(msgId);
                resolve({ ok: false, error: clientAdminError('timeout') });
            }, timeoutMs);
            pending.set(msgId, { resolve, timer });
        });
    }

    function newMsgId(): string {
        nextMsgId += 1;
        return `admin-${nextMsgId}`;
    }

    function settle(entry: PendingReply, outcome: Outcome): void {
        clearTimeout(entry.timer);
        entry.resolve(outcome);
    }

    /** Called by services/calaos.ts for every admin reply. */
    function handleReply(msg: AdminReplyMessage): void {
        const entry = pending.get(msg.msgId);
        if (entry === undefined) {
            console.debug('calaos admin: reply with no pending request, ignored:', msg.msgId);
            return;
        }
        pending.delete(msg.msgId);
        const data = typeof msg.data === 'object' && msg.data !== null ? msg.data : {};
        if (isAdminFailure(msg.data)) {
            settle(entry, { ok: false, error: toAdminError(msg.data) });
        } else {
            settle(entry, { ok: true, data: data as Record<string, unknown> });
        }
    }

    /** Called by services/calaos.ts for every `settings` / `change_cred` answer. */
    function handleChangeCredResult(msg: ChangeCredMessage): void {
        const entry = pendingChangeCred;
        if (entry === null) return;
        pendingChangeCred = null;
        settle(
            entry,
            msg.success
                ? { ok: true, data: {} }
                : { ok: false, error: { ...clientAdminError('disconnected'), code: 'bad_password' } },
        );
    }

    /** Called by services/calaos.ts when the socket is no longer open. */
    function handleTransportLost(): void {
        for (const entry of pending.values()) {
            settle(entry, { ok: false, error: clientAdminError('disconnected') });
        }
        pending.clear();
        if (pendingChangeCred !== null) {
            settle(pendingChangeCred, { ok: false, error: clientAdminError('disconnected') });
            pendingChangeCred = null;
        }
        retryTimer = clearTimer(retryTimer);
        pollTimer = clearTimer(pollTimer);
    }

    /**
     * Called by services/calaos.ts after every successful login, reconnects
     * included. The session is kept; `update_status` is what resumes the
     * display of an upgrade that outlived calaos_server.
     */
    function handleLoggedIn(): void {
        if (credentialDraft !== null) {
            // The household password just changed and the new one works:
            // back to choosing the admin password.
            credentialDraft = null;
            gate.value = 'bootstrap';
            busy.value = null;
            return;
        }
        if (!active && !isUpgrading.value) return;
        void probe();
    }

    // -------------------------------------------------------------- errors ---

    function forgetSession(reason: AdminInfo | null): void {
        session.value = null;
        sessionTimer = clearTimer(sessionTimer);
        if (gate.value === 'unlocked' || gate.value === 'bootstrap') gate.value = 'locked';
        notice.value = null;
        if (reason !== null) info.value = reason;
    }

    function enterBlocked(next: 'unavailable' | 'activating' | 'unreachable'): void {
        const now = Date.now();
        if (gate.value !== next) retryAttempt = 0;
        gate.value = next;

        if (next === 'unavailable') {
            unavailableSince ??= now;
            const fast = now - unavailableSince < UNAVAILABLE_FAST_WINDOW_MS;
            scheduleRetry(fast ? UNAVAILABLE_FAST_RETRY_MS : UNAVAILABLE_SLOW_RETRY_MS);
            return;
        }
        unavailableSince = null;
        if (next === 'activating' && rebootHintTimer === null && !rebootHint.value) {
            rebootHintTimer = setTimeout(() => {
                rebootHintTimer = null;
                if (gate.value === 'activating') rebootHint.value = true;
            }, ACTIVATION_REBOOT_HINT_MS);
        }
        scheduleRetry(backoffMs(retryAttempt));
        retryAttempt += 1;
    }

    function leaveBlocked(): void {
        unavailableSince = null;
        retryAttempt = 0;
        rebootHint.value = false;
        rebootHintTimer = clearTimer(rebootHintTimer);
        retryTimer = clearTimer(retryTimer);
    }

    function isDefaultHousehold(): boolean {
        const { user, pass } = household.credentials();
        return user === 'user' && pass === 'pass';
    }

    /**
     * Routes an error to the screen it belongs to. Returns true when the gate
     * changed (the caller's screen is gone); false when the error is for the
     * caller to show inline.
     */
    function applyGateError(error: AdminError): boolean {
        switch (error.code) {
            case 'https_required':
                gate.value = 'https_required';
                return true;
            case 'admin_unavailable':
                enterBlocked('unavailable');
                return true;
            case 'daemon_too_old':
                enterBlocked('activating');
                return true;
            case 'daemon_unreachable':
                enterBlocked('unreachable');
                return true;
            case 'timeout':
                gate.value = 'old_server';
                return true;
            case 'disconnected':
                // The reconnect probes again; nothing to show meanwhile.
                return true;
            case 'admin_not_set':
                leaveBlocked();
                session.value = null;
                sessionTimer = clearTimer(sessionTimer);
                apiAllowedHosts.value = error.apiAllowedHosts;
                gate.value = isDefaultHousehold() ? 'household' : 'bootstrap';
                return true;
            case 'household_password_required':
                gate.value = 'household';
                return true;
            case 'admin_already_set':
                leaveBlocked();
                forgetSession('already_set');
                gate.value = 'locked';
                return true;
            case 'bad_session':
                // Expired or invalidated: ask again, with no error message.
                leaveBlocked();
                forgetSession(null);
                gate.value = 'locked';
                return true;
            default:
                return false;
        }
    }

    // ------------------------------------------------------------- actions ---

    function applyStatus(data: Record<string, unknown>): void {
        const result = typeof data.result === 'object' && data.result !== null ? data.result : {};
        const r = result as Record<string, unknown>;
        progress.value = toUpgradeStatus(r.progress);
        job.value = toUpgradeJob(r.job);
        if (job.value?.status === 'running') schedulePoll();
        else pollTimer = clearTimer(pollTimer);
    }

    /** `update_status` as the probe: fixes the gate and refreshes the upgrade state. */
    async function probe(): Promise<void> {
        retryTimer = clearTimer(retryTimer);
        if (gate.value === 'idle') gate.value = 'probing';
        const outcome = await request(
            encodeAdminAction('update_status', null, newMsgId()),
            ADMIN_REPLY_TIMEOUT_MS,
            `admin-${nextMsgId}`,
        );
        if (!outcome.ok) {
            if (!applyGateError(outcome.error)) notice.value = outcome.error;
            else if (outcome.error.code === 'disconnected' && gate.value === 'probing') {
                gate.value = 'idle';
            }
            return;
        }
        leaveBlocked();
        applyStatus(outcome.data);
        gate.value = session.value !== null ? 'unlocked' : 'locked';
    }

    /** `update_status` without touching the gate — the poll during an upgrade. */
    async function refreshStatus(): Promise<void> {
        const outcome = await request(
            encodeAdminAction('update_status', null, newMsgId()),
            ADMIN_REPLY_TIMEOUT_MS,
            `admin-${nextMsgId}`,
        );
        if (outcome.ok) applyStatus(outcome.data);
        else applyGateError(outcome.error);
    }

    async function unlock(adminPass: string): Promise<boolean> {
        if (busy.value !== null) return false;
        busy.value = 'unlock';
        notice.value = null;
        info.value = null;
        const outcome = await request(
            encodeAdminUnlock(adminPass, newMsgId()),
            ADMIN_REPLY_TIMEOUT_MS,
            `admin-${nextMsgId}`,
        );
        busy.value = null;
        if (!outcome.ok) {
            if (!applyGateError(outcome.error)) notice.value = outcome.error;
            return false;
        }
        const token = outcome.data.admin_session;
        session.value = typeof token === 'string' ? token : null;
        armSession(Number(outcome.data.expires_in));
        leaveBlocked();
        gate.value = 'unlocked';
        // Only `update_status` is safe to replay blindly; the upgrade may have
        // started before the session died, so the status says what to show.
        const toReplay = replay;
        replay = null;
        if (toReplay !== null && !toReplay.action.startsWith('update_upgrade')) {
            void run(toReplay.action, toReplay.params);
        } else {
            void refreshStatus();
        }
        return true;
    }

    /**
     * Bootstrap (no session) or change (session held). Every session is
     * invalidated by the server on success, so the password just chosen is
     * used to unlock straight away: one screen fewer for the user.
     */
    async function setPassword(newPass: string): Promise<boolean> {
        if (busy.value !== null) return false;
        busy.value = 'set';
        notice.value = null;
        info.value = null;
        const wasBootstrap = session.value === null;
        const outcome = await request(
            encodeAdminSet(newPass, session.value, newMsgId()),
            ADMIN_REPLY_TIMEOUT_MS,
            `admin-${nextMsgId}`,
        );
        busy.value = null;
        if (!outcome.ok) {
            if (!applyGateError(outcome.error)) notice.value = outcome.error;
            return false;
        }
        session.value = null;
        sessionTimer = clearTimer(sessionTimer);
        gate.value = 'locked';
        const unlocked = await unlock(newPass);
        info.value = wasBootstrap ? 'password_set' : 'password_changed';
        return unlocked;
    }

    /**
     * Changes the HOUSEHOLD password (the bootstrap refuses `user`/`pass`).
     * The server drops the session on success; `handleLoggedIn` finishes the
     * move once the new credentials have been accepted.
     */
    async function changeHouseholdPassword(newUser: string, newPass: string): Promise<boolean> {
        if (busy.value !== null) return false;
        const current = household.credentials();
        busy.value = 'change_cred';
        notice.value = null;
        const outcome = await new Promise<Outcome>((resolve) => {
            const frame = encodeChangeCredentials(current.user, current.pass, newUser, newPass);
            if (!send(frame)) {
                resolve({ ok: false, error: clientAdminError('disconnected') });
                return;
            }
            const timer = setTimeout(() => {
                pendingChangeCred = null;
                resolve({ ok: false, error: clientAdminError('timeout') });
            }, ADMIN_REPLY_TIMEOUT_MS);
            pendingChangeCred = { resolve, timer };
        });
        if (!outcome.ok) {
            busy.value = null;
            if (!applyGateError(outcome.error)) notice.value = outcome.error;
            return false;
        }
        credentialDraft = { user: newUser, pass: newPass };
        // Stays busy until the re-login answers (handleLoggedIn).
        household.rotate(newUser, newPass);
        return true;
    }

    /** One relayed action with the session; errors land in `notice`. */
    async function run(
        action: AdminAction,
        params?: Record<string, string>,
    ): Promise<Record<string, unknown> | null> {
        if (busy.value !== null) return null;
        busy.value = action;
        notice.value = null;
        info.value = null;
        const timeout = action === 'update_check' ? UPDATE_CHECK_TIMEOUT_MS : ADMIN_REPLY_TIMEOUT_MS;
        const outcome = await request(
            encodeAdminAction(action, session.value, newMsgId(), params),
            timeout,
            `admin-${nextMsgId}`,
        );
        busy.value = null;
        if (!outcome.ok) {
            if (outcome.error.code === 'bad_session') replay = { action, params };
            if (!applyGateError(outcome.error)) notice.value = outcome.error;
            return null;
        }
        return outcome.data;
    }

    async function checkUpdates(): Promise<void> {
        const data = await run('update_check');
        if (data !== null) updates.value = toUpdateList(data.result);
    }

    async function upgradeAll(): Promise<void> {
        const data = await run('update_upgrade_all');
        if (data === null) return;
        job.value = toUpgradeJob(data.result);
        progress.value = {
            status: 'upgrading',
            totalPercent: 0,
            currentPkg: '',
            currentStep: '',
            pkgIndex: 0,
            pkgCount: updates.value?.length ?? 0,
            message: '',
            error: '',
        };
        updates.value = null;
        schedulePoll();
    }

    async function reboot(): Promise<void> {
        const data = await run('system_reboot');
        if (data !== null) info.value = 'reboot_sent';
    }

    async function regenerateMcp(): Promise<void> {
        const data = await run('mcp_regenerate');
        if (data !== null) info.value = 'mcp_regenerated';
    }

    // -------------------------------------------------------------- events ---

    /** Called by services/calaos.ts for every `admin_event`. */
    function handleEvent(msg: AdminEventMessage): void {
        switch (msg.type) {
            case 'upgrade_progress': {
                const next = toUpgradeStatus(msg.data);
                progress.value = next;
                if (next.status === 'done' || next.status === 'error') {
                    // The job's `reboot_required` / `error` only come from
                    // update_status; events never carry the job.
                    pollTimer = clearTimer(pollTimer);
                    void refreshStatus();
                }
                return;
            }
            case 'admin_set':
                // Someone (maybe this client, see setPassword) just changed
                // the password: every session is dead, including this one.
                if (busy.value === 'set' || busy.value === 'unlock') return;
                if (session.value !== null) forgetSession('session_invalidated');
                else if (gate.value === 'bootstrap' || gate.value === 'household') {
                    gate.value = 'locked';
                    info.value = 'already_set';
                }
                return;
            case 'admin_reset':
                session.value = null;
                sessionTimer = clearTimer(sessionTimer);
                if (active) void probe();
                return;
            default:
                return;
        }
    }

    // ----------------------------------------------------------- lifecycle ---

    /** The Admin tab is mounted: probe, and keep retrying while it is shown. */
    function activate(): void {
        active = true;
        if (gate.value === 'idle' || gate.value === 'old_server') {
            gate.value = 'idle';
            void probe();
            return;
        }
        if (gate.value === 'unavailable' || gate.value === 'activating' || gate.value === 'unreachable') {
            void probe();
            return;
        }
        if (gate.value !== 'household') void refreshStatus();
    }

    function deactivate(): void {
        active = false;
        retryTimer = clearTimer(retryTimer);
        notice.value = null;
        info.value = null;
    }

    function dismissInfo(): void {
        info.value = null;
    }

    function dismissNotice(): void {
        notice.value = null;
    }

    /** Sign-out: nothing of the session or the box may outlive the account. */
    function reset(): void {
        handleTransportLost();
        sessionTimer = clearTimer(sessionTimer);
        rebootHintTimer = clearTimer(rebootHintTimer);
        active = false;
        gate.value = 'idle';
        session.value = null;
        apiAllowedHosts.value = '';
        notice.value = null;
        info.value = null;
        busy.value = null;
        progress.value = null;
        job.value = null;
        updates.value = null;
        rebootHint.value = false;
        unavailableSince = null;
        retryAttempt = 0;
        replay = null;
        credentialDraft = null;
    }

    return {
        gate,
        session,
        apiAllowedHosts,
        notice,
        info,
        busy,
        progress,
        job,
        updates,
        rebootHint,
        isUnlocked,
        isUpgrading,
        attachTransport,
        attachHousehold,
        handleReply,
        handleChangeCredResult,
        handleTransportLost,
        handleLoggedIn,
        handleEvent,
        probe,
        unlock,
        setPassword,
        changeHouseholdPassword,
        checkUpdates,
        upgradeAll,
        reboot,
        regenerateMcp,
        activate,
        deactivate,
        dismissInfo,
        dismissNotice,
        reset,
    };
});
