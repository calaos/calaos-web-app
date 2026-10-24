// Approver phones and the push codes they receive (calaos_base
// docs/08_http_api.md, "Approbateurs et codes push").
//
// Every flow ends in one code entry: the code goes to a phone, the user
// types it here. A second enrolment takes two codes (one from the phone
// already enrolled, then one to the new phone), so the flow keeps its own
// context and the challenge only says which code is awaited.

import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import {
    CODE_LIFETIME_S,
    CODE_RESEND_S,
    toApproverCandidates,
    toApprovers,
    toCodeTicket,
} from '../protocol/admin';
import type {
    AdminAction,
    AdminError,
    Approver,
    ApproverCandidate,
    CodeAction,
    CodeProof,
    CodeTicket,
} from '../protocol/admin';
import { useAdminStore } from './admin';
import { useAdminAlertsStore } from './adminAlerts';

/**
 * Which code is awaited. `approve_enroll`: from an enrolled phone, to let a
 * new one in. `confirm_enroll`: sent to the new phone itself.
 */
export type ChallengeStep = 'approve_enroll' | 'confirm_enroll' | 'remove' | 'password' | 'console';

export interface Challenge {
    step: ChallengeStep;
    codeId: string;
    /** The enrolled phone the code went to; '' for the new phone's own code. */
    approverId: string;
    /** The phone the code went to; '' when the list does not name it. */
    phone: string;
    /** A new code for a second phone means asking this one again. */
    restartPhone: string;
    /** ms epoch. */
    expiresAt: number;
    /** No new code before this (the daemon's 10 s between two codes). */
    resendAt: number;
    /** Known after a first wrong code. */
    attemptsLeft: number | null;
    error: AdminError | null;
}

export type ApproverWork = 'sending' | 'checking' | null;
export type ApproverDone = 'enrolled' | 'removed' | 'password' | 'console' | null;

interface FlowContext {
    candidate?: ApproverCandidate;
    approver?: Approver;
    newPassword?: string;
    /** The first phone needs no approval: its own code is resent directly. */
    firstEnrolment: boolean;
}

type CallResult = { data: Record<string, unknown> } | { error: AdminError };

/** No `last_seen`: the token left the box's list and no code reaches it. */
export function isGone(approver: Approver): boolean {
    return !Number.isFinite(Date.parse(approver.lastSeen));
}

export const useApproversStore = defineStore('approvers', () => {
    const admin = useAdminStore();

    /** null until read. */
    const approvers = ref<Approver[] | null>(null);
    const candidates = ref<ApproverCandidate[] | null>(null);
    const listError = ref<AdminError | null>(null);
    /** A refusal before any code was sent (approver_last, approver_limit…). */
    const flowError = ref<AdminError | null>(null);
    const challenge = ref<Challenge | null>(null);
    const working = ref<ApproverWork>(null);
    const done = ref<ApproverDone>(null);

    let context: FlowContext = { firstEnrolment: false };
    /** The verified console code, until the console page takes it. */
    let consoleGrant: string | null = null;
    /** Only the reply to the latest list request is applied. */
    let listSeq = 0;

    // A password change swaps the session for a new one: that is not the end
    // of the admin visit, and it ends the change flow itself.
    watch(
        () => admin.session,
        (session) => {
            if (session === null && admin.busy !== 'set' && admin.busy !== 'unlock') reset();
        },
    );

    /** The other enrolled phone a code can go to instead, if any. */
    const alternative = computed<Approver | null>(() => {
        const current = challenge.value;
        if (current === null || current.approverId === '') return null;
        return approvers.value?.find((a) => a.id !== current.approverId) ?? null;
    });

    function nameOf(approverId: string): string {
        return approvers.value?.find((a) => a.id === approverId)?.deviceName ?? '';
    }

    /**
     * Where a code goes: the phone seen most recently, so a dead token (purged,
     * reinstalled app) does not swallow it. A removal asks the other phone
     * when it is alive, since the one being removed may be the dead one.
     */
    function target(excluding?: string): string | undefined {
        const list = [...(approvers.value ?? [])].sort((a, b) => {
            if (isGone(a) !== isGone(b)) return isGone(a) ? 1 : -1;
            return b.lastSeen.localeCompare(a.lastSeen);
        });
        const preferred = list.find((a) => a.id !== excluding && !isGone(a));
        return (preferred ?? list[0])?.id;
    }

    function openChallenge(step: ChallengeStep, ticket: CodeTicket, approverId: string, phone: string): void {
        const now = Date.now();
        challenge.value = {
            step,
            codeId: ticket.codeId,
            approverId,
            phone,
            restartPhone: step === 'confirm_enroll' && !context.firstEnrolment ? nameOf(target() ?? '') : '',
            expiresAt: now + (ticket.expiresIn > 0 ? ticket.expiresIn : CODE_LIFETIME_S) * 1000,
            resendAt: now + CODE_RESEND_S * 1000,
            attemptsLeft: challenge.value?.attemptsLeft ?? null,
            error: null,
        };
    }

    /** An error before or after a code was sent lands where the user is looking. */
    function report(error: AdminError): void {
        if (admin.gate !== 'unlocked') {
            reset();
            return;
        }
        if (error.code === 'approver_not_found') void load();
        const current = challenge.value;
        if (current === null) {
            flowError.value = error;
            return;
        }
        const next: Challenge = { ...current, error };
        if (error.code === 'rate_limited' && error.retryAfter !== null) {
            next.resendAt = Date.now() + error.retryAfter * 1000;
        }
        if (error.code === 'bad_code') next.attemptsLeft = error.attemptsLeft;
        challenge.value = next;
        // The fifth wrong code killed the session: the next call would be
        // bad_session anyway, so the password is asked for right now.
        if (error.code === 'bad_code' && error.attemptsLeft === 0) {
            admin.dropSession('code_locked');
            reset();
        }
    }

    async function call(
        action: AdminAction,
        params: Record<string, unknown> | undefined,
        work: ApproverWork,
    ): Promise<CallResult | null> {
        working.value = work;
        const outcome = await admin.relay(action, params, true);
        working.value = null;
        if (outcome.ok) return { data: outcome.data };
        // Another request holds the page: nothing was sent, nothing to say.
        if (outcome.error.code === 'busy') return null;
        return { error: outcome.error };
    }

    // -------------------------------------------------------------- reads ---

    async function load(): Promise<void> {
        listSeq += 1;
        const seq = listSeq;
        const outcome = await admin.relay('approver_list', undefined, false);
        if (seq !== listSeq) return;
        if (outcome.ok) {
            approvers.value = toApprovers(outcome.data.result);
            listError.value = null;
        } else if (admin.gate === 'unlocked') {
            listError.value = outcome.error;
        }
    }

    async function loadCandidates(): Promise<void> {
        candidates.value = null;
        const outcome = await admin.relay('approver_candidates', undefined, false);
        if (outcome.ok) candidates.value = toApproverCandidates(outcome.data.result);
        else if (admin.gate === 'unlocked') flowError.value = outcome.error;
    }

    // -------------------------------------------------------------- flows ---

    function begin(next: FlowContext): void {
        context = next;
        challenge.value = null;
        flowError.value = null;
        done.value = null;
    }

    async function requestCode(
        codeAction: CodeAction,
        codeParams: Record<string, string>,
        step: ChallengeStep,
        approverId: string | undefined,
    ): Promise<void> {
        const params: Record<string, unknown> = { code_action: codeAction, code_params: codeParams };
        if (approverId !== undefined) params.approver_id = approverId;
        const result = await call('code_request', params, 'sending');
        if (result === null) return;
        if ('error' in result) {
            report(result.error);
            return;
        }
        const ticket = toCodeTicket(result.data.result);
        if (ticket !== null) openChallenge(step, ticket, ticket.approverId, nameOf(ticket.approverId));
    }

    /**
     * Another client enrolled a phone since this flow started: the new one now
     * needs an approval code, so the flow starts over from there.
     */
    async function restartWithApproval(): Promise<void> {
        context.firstEnrolment = false;
        challenge.value = null;
        await load();
        await requestCode('approver_enroll', {}, 'approve_enroll', target());
    }

    /** `approver_enroll`: the new phone gets its own code to type back. */
    async function sendEnrolment(proof: CodeProof | undefined): Promise<void> {
        const candidate = context.candidate;
        if (candidate === undefined) return;
        const params: Record<string, string> = { token_id: candidate.tokenId };
        if (proof !== undefined) {
            params.code_id = proof.codeId;
            params.code = proof.code;
        }
        const result = await call('approver_enroll', params, proof === undefined ? 'sending' : 'checking');
        if (result === null) return;
        if ('error' in result) {
            if (result.error.code === 'code_required' && proof === undefined) await restartWithApproval();
            else report(result.error);
            return;
        }
        const ticket = toCodeTicket(result.data.result);
        // A fresh code to a fresh phone: the attempts count is the session's, kept.
        if (ticket !== null) openChallenge('confirm_enroll', ticket, '', candidate.deviceName);
    }

    async function startEnrolment(candidate: ApproverCandidate): Promise<void> {
        // A fresh read of the alerts, so the one this enrolment raises is told
        // apart from those already there.
        useAdminAlertsStore().refresh();
        const first = (approvers.value?.length ?? 0) === 0;
        begin({ candidate, firstEnrolment: first });
        if (first) await sendEnrolment(undefined);
        else await requestCode('approver_enroll', {}, 'approve_enroll', target());
    }

    async function startRemoval(approver: Approver): Promise<void> {
        useAdminAlertsStore().refresh();
        begin({ approver, firstEnrolment: false });
        await requestCode('approver_remove', { approver_id: approver.id }, 'remove', target(approver.id));
    }

    async function startPasswordChange(newPassword: string): Promise<void> {
        begin({ newPassword, firstEnrolment: false });
        await requestCode('admin_password', { password: newPassword }, 'password', target());
    }

    async function startConsole(): Promise<void> {
        consoleGrant = null;
        begin({ firstEnrolment: false });
        await requestCode('console_open', {}, 'console', target());
    }

    /** The `code_id` that opens one console within 30 s; handed out once. */
    function takeConsoleGrant(): string | null {
        const grant = consoleGrant;
        consoleGrant = null;
        return grant;
    }

    /** The last phone: refused before a round trip; the server says the same. */
    function refuseLast(): void {
        begin({ firstEnrolment: false });
        flowError.value = {
            code: 'approver_last',
            msg: '',
            retryAfter: null,
            jobId: '',
            minLength: null,
            apiAllowedHosts: '',
            attemptsLeft: null,
            max: null,
        };
    }

    async function confirmEnrolment(proof: CodeProof): Promise<void> {
        const alerts = useAdminAlertsStore();
        const name = context.candidate?.deviceName ?? '';
        alerts.expectOwn('approver_set', name);
        const result = await call('approver_confirm', { code_id: proof.codeId, code: proof.code }, 'checking');
        if (result === null || 'error' in result) {
            alerts.dropOwn('approver_set', name);
            if (result === null) return;
            if (result.error.code === 'code_required') await restartWithApproval();
            else report(result.error);
            return;
        }
        finish('enrolled');
        void load();
    }

    async function confirmRemoval(proof: CodeProof): Promise<void> {
        const approver = context.approver;
        if (approver === undefined) return;
        const alerts = useAdminAlertsStore();
        alerts.expectOwn('approver_removed', approver.deviceName);
        const result = await call(
            'approver_remove',
            { approver_id: approver.id, code_id: proof.codeId, code: proof.code },
            'checking',
        );
        if (result === null || 'error' in result) {
            alerts.dropOwn('approver_removed', approver.deviceName);
            if (result !== null) report(result.error);
            return;
        }
        finish('removed');
        void load();
    }

    async function submit(code: string): Promise<void> {
        const current = challenge.value;
        if (current === null || working.value !== null) return;
        challenge.value = { ...current, error: null };
        const proof: CodeProof = { codeId: current.codeId, code };
        switch (current.step) {
            case 'approve_enroll':
                await sendEnrolment(proof);
                return;
            case 'confirm_enroll':
                await confirmEnrolment(proof);
                return;
            case 'remove':
                await confirmRemoval(proof);
                return;
            case 'console': {
                const result = await call(
                    'console_open',
                    { code_id: proof.codeId, code: proof.code },
                    'checking',
                );
                if (result === null) return;
                if ('error' in result) {
                    report(result.error);
                    return;
                }
                consoleGrant = proof.codeId;
                finish('console');
                return;
            }
            case 'password': {
                const newPassword = context.newPassword;
                if (newPassword === undefined) return;
                working.value = 'checking';
                const error = await admin.changePassword(newPassword, proof);
                working.value = null;
                if (error === null) finish('password');
                else if (error.code !== 'busy') report(error);
                return;
            }
        }
    }

    /** A new code for the step on screen, to `approverId` or the same phone. */
    async function resend(approverId?: string): Promise<void> {
        const current = challenge.value;
        if (current === null || working.value !== null) return;
        challenge.value = { ...current, error: null };
        const to = approverId ?? (current.approverId || target());
        switch (current.step) {
            case 'approve_enroll':
                await requestCode('approver_enroll', {}, 'approve_enroll', to);
                return;
            case 'confirm_enroll':
                // A second phone's enrolment code is only sent against an
                // approval: a new one means asking the first phone again.
                if (context.firstEnrolment) await sendEnrolment(undefined);
                else await requestCode('approver_enroll', {}, 'approve_enroll', target());
                return;
            case 'remove':
                if (context.approver !== undefined) {
                    await requestCode('approver_remove', { approver_id: context.approver.id }, 'remove', to);
                }
                return;
            case 'console':
                await requestCode('console_open', {}, 'console', to);
                return;
            case 'password':
                if (context.newPassword !== undefined) {
                    await requestCode('admin_password', { password: context.newPassword }, 'password', to);
                }
                return;
        }
    }

    /** The code went to a phone that is not at hand: send one to the other. */
    async function sendToOther(): Promise<void> {
        const other = alternative.value;
        if (other !== null) await resend(other.id);
    }

    function finish(what: ApproverDone): void {
        context = { firstEnrolment: false };
        challenge.value = null;
        flowError.value = null;
        done.value = what;
    }

    function cancel(): void {
        context = { firstEnrolment: false };
        consoleGrant = null;
        challenge.value = null;
        flowError.value = null;
        candidates.value = null;
    }

    function dismissDone(): void {
        done.value = null;
    }

    /** Called by services/calaos.ts for `approver_set` / `approver_removed`. */
    function handleEvent(type: string): void {
        if (type !== 'approver_set' && type !== 'approver_removed') return;
        if (admin.isUnlocked) void load();
    }

    function reset(): void {
        cancel();
        listSeq += 1;
        approvers.value = null;
        listError.value = null;
        working.value = null;
        done.value = null;
    }

    return {
        approvers,
        candidates,
        listError,
        flowError,
        challenge,
        working,
        done,
        alternative,
        load,
        loadCandidates,
        startEnrolment,
        startRemoval,
        startPasswordChange,
        startConsole,
        takeConsoleGrant,
        refuseLast,
        submit,
        resend,
        sendToOther,
        cancel,
        dismissDone,
        handleEvent,
        reset,
    };
});
