// Admin store — the admin session (memory only), the gate the Admin tab is
// behind, the update flow, and the retry policies of the contract
// (calaos_base docs/08_http_api.md, "Administration").
//
// calaos_server keeps no admin state at all: the session is held here and
// resent with every message that needs one, so it survives a server restart.
// `update_status` needs no session and is the probe for everything — it tells
// whether an admin exists, whether the daemon is reachable, and where an
// upgrade stands — which is why a reconnect, a retry and the first visit of
// the tab all go through `probe()`. Without a session the server answers a
// household view (no package names, generic error), so the session is sent
// whenever one is held.

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

/** What the Admin tab shows: one screen per value. */
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
    | 'reboot_sent';

export type AdminBusy = AdminAction | 'unlock' | 'set' | 'change_cred' | null;

/** Which section of the unlocked page an inline error belongs to. */
export type AdminNoticeSource = 'updates' | 'box' | 'gate';

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
/** An action refused with `bad_session` is replayed only by a prompt unlock. */
const REPLAY_WINDOW_MS = 120_000;
/** Reads are the only actions safe to replay without asking again. */
const REPLAYABLE: readonly AdminAction[] = ['update_check', 'update_available', 'system_info'];
/** The client's own `admin_set` event may arrive well after the reply. */
const OWN_SET_EVENT_WINDOW_MS = 30_000;
/** A finished job older than this is history, not news. */
const JOB_NEWS_WINDOW_MS = 24 * 3_600_000;
/** A run seen this soon after a lost `update_upgrade_all` reply is our own. */
const LOST_UPGRADE_ADOPT_MS = 10_000;

export const useAdminStore = defineStore('admin', () => {
    const gate = ref<AdminGate>('idle');
    /** Opaque, from the daemon; memory only. */
    const session = ref<string | null>(null);
    const apiAllowedHosts = ref('');
    /** The error the current screen shows under its form, if any. */
    const notice = ref<AdminError | null>(null);
    const noticeSource = ref<AdminNoticeSource>('gate');
    const info = ref<AdminInfo | null>(null);
    const busy = ref<AdminBusy>(null);
    const progress = ref<UpgradeStatus | null>(null);
    const job = ref<UpgradeJob | null>(null);
    /** null until a check ran; [] means nothing to update. */
    const updates = ref<UpdateEntry[] | null>(null);
    /** `daemon_too_old` has lasted long enough that only a reboot will do. */
    const rebootHint = ref(false);
    /** The job this client started; another id is a run started elsewhere. */
    const ownJobId = ref<string | null>(null);

    // Not state: transport, timers, correlation.
    let send: FrameSender = () => {
        console.warn('calaos admin: no transport attached, dropping frame');
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
    let ownSetTimer: ReturnType<typeof setTimeout> | null = null;
    let unavailableSince: number | null = null;
    let retryAttempt = 0;
    /** The Admin tab is on screen: retries are worth scheduling. */
    let active = false;
    /** Any admin reply on this socket: silence afterwards is a stall, not an old server. */
    let adminSpoken = false;
    /** A read refused with `bad_session`, replayed after the next unlock. */
    let replay: { action: AdminAction; at: number } | null = null;
    /** The household credentials being installed by `change_cred`. */
    let credentialDraft: { user: string; pass: string } | null = null;
    /** Our own `admin_set` just succeeded: its event must not kill the new session. */
    let ownSetPending = false;
    /** Jobs this visit saw running — their end is news whatever its date. */
    const seenRunning = new Set<string>();
    /** When the reply to our `update_upgrade_all` was lost to a drop. */
    let lostUpgradeAt: number | null = null;
    /** A poll is out: an event must not send a second one. */
    let statusInFlight = false;

    const isUnlocked = computed(() => gate.value === 'unlocked' && session.value !== null);
    const isUpgrading = computed(
        () => job.value?.status === 'running' || progress.value?.status === 'upgrading',
    );
    /** A finished job worth telling about: ended during this visit, or recently. */
    const recentJob = computed<UpgradeJob | null>(() => {
        const current = job.value;
        if (current === null || current.status === 'running' || current.status === 'unknown') return null;
        if (seenRunning.has(current.id)) return current;
        const finished = Date.parse(current.finishedAt);
        return Number.isFinite(finished) && Date.now() - finished < JOB_NEWS_WINDOW_MS ? current : null;
    });

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
        // The daemon's lifetime is absolute; locking a second early beats a
        // panel whose next tap gets `bad_session`.
        sessionTimer = setTimeout(
            () => {
                sessionTimer = null;
                forgetSession(null);
            },
            Math.max(0, expiresInSeconds - 1) * 1000,
        );
    }

    // ----------------------------------------------------------- requests ---

    /** Sends one frame built around a fresh msg_id and awaits its reply. */
    function request(build: (msgId: string) => string, timeoutMs: number): Promise<Outcome> {
        nextMsgId += 1;
        const msgId = `admin-${nextMsgId}`;
        return new Promise((resolve) => {
            if (!send(build(msgId))) {
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

    function settle(entry: PendingReply, outcome: Outcome): void {
        clearTimeout(entry.timer);
        entry.resolve(outcome);
    }

    /** Called by services/calaos.ts for every admin reply. */
    function handleReply(msg: AdminReplyMessage): void {
        adminSpoken = true;
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
                : { ok: false, error: clientAdminError('household_refused') },
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
        // A re-login in flight when the socket died: handleLoggedIn finishes
        // the move on the next login, but the form must not stay frozen.
        if (busy.value === 'change_cred') busy.value = null;
        adminSpoken = false;
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

    function setNotice(error: AdminError, source: AdminNoticeSource): void {
        notice.value = error;
        noticeSource.value = source;
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
                // Silence from a server that has never spoken admin is an old
                // calaos_server; silence later, or during an upgrade (dpkg
                // keeps the daemon busy right after a reconnect), is a stall.
                if (!adminSpoken && !isUpgrading.value) {
                    gate.value = 'old_server';
                    return true;
                }
                if (gate.value === 'unlocked') {
                    if (isUpgrading.value) schedulePoll();
                    return false;
                }
                enterBlocked('unreachable');
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
        const next = toUpgradeJob(r.job);
        // A run this client did not see start (lost reply, kiosk) makes the
        // last check stale: "Install updates" must not offer a second run.
        if (next !== null && next.id !== job.value?.id) updates.value = null;
        job.value = next;
        if (next?.status === 'running') {
            if (lostUpgradeAt !== null && Date.now() - lostUpgradeAt < LOST_UPGRADE_ADOPT_MS) {
                ownJobId.value = next.id;
            }
            lostUpgradeAt = null;
            seenRunning.add(next.id);
            schedulePoll();
        } else {
            pollTimer = clearTimer(pollTimer);
        }
    }

    /** `update_status` as the probe: fixes the gate and refreshes the upgrade state. */
    async function probe(): Promise<void> {
        retryTimer = clearTimer(retryTimer);
        if (gate.value === 'idle') gate.value = 'probing';
        const outcome = await request(
            (id) => encodeAdminAction('update_status', session.value, id),
            ADMIN_REPLY_TIMEOUT_MS,
        );
        if (!outcome.ok) {
            if (applyGateError(outcome.error)) {
                if (outcome.error.code === 'disconnected' && gate.value === 'probing') gate.value = 'idle';
            } else if (gate.value === 'unlocked') {
                setNotice(outcome.error, 'updates');
            } else {
                // `internal` and friends on the probe: nothing to type, so
                // wait and retry rather than spin on "checking".
                enterBlocked('unreachable');
            }
            if (gate.value !== 'locked') replay = null;
            return;
        }
        leaveBlocked();
        applyStatus(outcome.data);
        gate.value = session.value !== null ? 'unlocked' : 'locked';
        if (gate.value !== 'locked') replay = null;
    }

    /** `update_status` without touching the gate — the poll during an upgrade. */
    async function refreshStatus(): Promise<void> {
        statusInFlight = true;
        const outcome = await request(
            (id) => encodeAdminAction('update_status', session.value, id),
            ADMIN_REPLY_TIMEOUT_MS,
        );
        statusInFlight = false;
        if (outcome.ok) {
            applyStatus(outcome.data);
            return;
        }
        // A transient failure must not end the follow-up of a running job.
        if (!applyGateError(outcome.error) && isUpgrading.value) schedulePoll();
    }

    async function unlock(adminPass: string): Promise<boolean> {
        if (busy.value !== null) return false;
        busy.value = 'unlock';
        notice.value = null;
        info.value = null;
        const outcome = await request(
            (id) => encodeAdminUnlock(adminPass, id),
            ADMIN_REPLY_TIMEOUT_MS,
        );
        busy.value = null;
        if (!outcome.ok) {
            if (!applyGateError(outcome.error)) setNotice(outcome.error, 'gate');
            return false;
        }
        const token = outcome.data.admin_session;
        session.value = typeof token === 'string' ? token : null;
        armSession(Number(outcome.data.expires_in));
        leaveBlocked();
        gate.value = 'unlocked';
        // A read refused a moment ago is finished for the user; anything else
        // (an upgrade, a reboot) is asked for again.
        const toReplay = replay;
        replay = null;
        if (toReplay !== null && Date.now() - toReplay.at < REPLAY_WINDOW_MS) {
            void replayAction(toReplay.action);
        } else {
            void refreshStatus();
        }
        return true;
    }

    /** The replay must land where the original would have (its store field). */
    async function replayAction(action: AdminAction): Promise<void> {
        switch (action) {
            case 'update_check':
                await checkUpdates();
                return;
            case 'update_available':
                await listAvailable();
                return;
            default:
                await run(action);
        }
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
            (id) => encodeAdminSet(newPass, session.value, id),
            ADMIN_REPLY_TIMEOUT_MS,
        );
        busy.value = null;
        if (!outcome.ok) {
            if (!applyGateError(outcome.error)) setNotice(outcome.error, wasBootstrap ? 'gate' : 'box');
            return false;
        }
        // The matching `admin_set` event may land before or after the unlock
        // reply below: either way it is ours, not someone else's.
        ownSetPending = true;
        ownSetTimer = clearTimer(ownSetTimer);
        ownSetTimer = setTimeout(() => {
            ownSetTimer = null;
            ownSetPending = false;
        }, OWN_SET_EVENT_WINDOW_MS);
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
            if (!applyGateError(outcome.error)) setNotice(outcome.error, 'gate');
            return false;
        }
        credentialDraft = { user: newUser, pass: newPass };
        // Stays busy until the re-login answers (handleLoggedIn). If the
        // socket is not open, the reconnect's own login carries the new pair.
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
            (id) => encodeAdminAction(action, session.value, id, params),
            timeout,
        );
        busy.value = null;
        if (!outcome.ok) {
            const { error } = outcome;
            if (error.code === 'disconnected' && action === 'update_upgrade_all') lostUpgradeAt = Date.now();
            if (error.code === 'bad_session' && REPLAYABLE.includes(action)) {
                replay = { action, at: Date.now() };
            }
            if (!applyGateError(error)) {
                setNotice(error, action.startsWith('update_') ? 'updates' : 'box');
                // A run started elsewhere (kiosk, CLI): follow it instead.
                if (error.code === 'upgrade_in_progress') void refreshStatus();
            }
            return null;
        }
        return outcome.data;
    }

    async function checkUpdates(): Promise<void> {
        const data = await run('update_check');
        if (data !== null) updates.value = toUpdateList(data.result);
    }

    /** The pending list without contacting the mirrors. */
    async function listAvailable(): Promise<void> {
        const data = await run('update_available');
        if (data !== null) updates.value = toUpdateList(data.result);
    }

    async function upgradeAll(): Promise<void> {
        const data = await run('update_upgrade_all');
        if (data === null) return;
        const started = toUpgradeJob(data.result);
        ownJobId.value = started?.id ?? null;
        if (started !== null) seenRunning.add(started.id);
        job.value = started;
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
                // Events are always the household view: keep the name the
                // last full read gave for this package, and fetch the next one.
                const next = toUpgradeStatus(msg.data);
                const prev = progress.value;
                if (next.currentPkg === '' && prev !== null && prev.pkgIndex === next.pkgIndex) {
                    next.currentPkg = prev.currentPkg;
                    next.message = prev.message;
                } else if (
                    next.currentPkg === '' &&
                    next.status === 'upgrading' &&
                    session.value !== null &&
                    !statusInFlight
                ) {
                    void refreshStatus();
                }
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
                if (ownSetPending) {
                    ownSetPending = false;
                    ownSetTimer = clearTimer(ownSetTimer);
                    return;
                }
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
                else gate.value = 'idle';
                return;
            default:
                return;
        }
    }

    // ----------------------------------------------------------- lifecycle ---

    /** The Admin tab is mounted: probe, and keep retrying while it is shown. */
    function activate(): void {
        active = true;
        switch (gate.value) {
            case 'idle':
            case 'probing':
            case 'old_server':
                gate.value = 'idle';
                void probe();
                return;
            case 'unavailable':
            case 'activating':
            case 'unreachable':
                void probe();
                return;
            case 'household':
                return;
            default:
                void refreshStatus();
        }
    }

    function deactivate(): void {
        active = false;
        retryTimer = clearTimer(retryTimer);
        unavailableSince = null;
        replay = null;
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
        ownSetTimer = clearTimer(ownSetTimer);
        active = false;
        gate.value = 'idle';
        session.value = null;
        apiAllowedHosts.value = '';
        notice.value = null;
        noticeSource.value = 'gate';
        info.value = null;
        busy.value = null;
        progress.value = null;
        job.value = null;
        updates.value = null;
        rebootHint.value = false;
        ownJobId.value = null;
        unavailableSince = null;
        retryAttempt = 0;
        replay = null;
        credentialDraft = null;
        ownSetPending = false;
        lostUpgradeAt = null;
        statusInFlight = false;
        seenRunning.clear();
    }

    return {
        gate,
        session,
        apiAllowedHosts,
        notice,
        noticeSource,
        info,
        busy,
        progress,
        job,
        updates,
        rebootHint,
        ownJobId,
        isUnlocked,
        isUpgrading,
        recentJob,
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
