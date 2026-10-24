// Approver phones and the push codes they receive (calaos_base
// docs/08_http_api.md, "Approbateurs et codes push").
//
// Every flow ends in one code entry: the code goes to a phone, the user
// types it here. A second enrolment takes two codes (one from the phone
// already enrolled, then one to the new phone), so the flow keeps its own
// context and the challenge only says which code is awaited.

import { ref, watch } from 'vue';
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
export type ChallengeStep = 'approve_enroll' | 'confirm_enroll' | 'remove' | 'password';

export interface Challenge {
    step: ChallengeStep;
    codeId: string;
    /** The phone the code went to; '' when the list does not name it. */
    phone: string;
    /** ms epoch. */
    expiresAt: number;
    /** No new code before this (the daemon's 10 s between two codes). */
    resendAt: number;
    /** Known after a first wrong code. */
    attemptsLeft: number | null;
    error: AdminError | null;
}

export type ApproverWork = 'sending' | 'checking' | null;
export type ApproverDone = 'enrolled' | 'removed' | 'password' | null;

interface FlowContext {
    candidate?: ApproverCandidate;
    approver?: Approver;
    newPassword?: string;
    /** The first phone needs no approval: its own code is resent directly. */
    firstEnrolment: boolean;
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

    // A password change swaps the session for a new one: that is not the end
    // of the admin visit, and it ends the change flow itself.
    watch(
        () => admin.session,
        (session) => {
            if (session === null && admin.busy !== 'set' && admin.busy !== 'unlock') reset();
        },
    );

    function nameOf(approverId: string): string {
        return approvers.value?.find((a) => a.id === approverId)?.deviceName ?? '';
    }

    function openChallenge(step: ChallengeStep, ticket: CodeTicket, phone: string): void {
        const now = Date.now();
        challenge.value = {
            step,
            codeId: ticket.codeId,
            phone,
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
    ): Promise<Record<string, unknown> | null> {
        working.value = work;
        const outcome = await admin.relay(action, params, true);
        working.value = null;
        if (!outcome.ok) {
            report(outcome.error);
            return null;
        }
        return outcome.data;
    }

    // -------------------------------------------------------------- reads ---

    async function load(): Promise<void> {
        const outcome = await admin.relay('approver_list', undefined, false);
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
    ): Promise<void> {
        const data = await call('code_request', { code_action: codeAction, code_params: codeParams }, 'sending');
        const ticket = data === null ? null : toCodeTicket(data.result);
        if (ticket !== null) openChallenge(step, ticket, nameOf(ticket.approverId));
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
        const data = await call('approver_enroll', params, proof === undefined ? 'sending' : 'checking');
        const ticket = data === null ? null : toCodeTicket(data.result);
        if (ticket !== null) {
            // A fresh code to a fresh phone: the attempts count is the session's, kept.
            openChallenge('confirm_enroll', ticket, candidate.deviceName);
        }
    }

    async function startEnrolment(candidate: ApproverCandidate): Promise<void> {
        const first = (approvers.value?.length ?? 0) === 0;
        begin({ candidate, firstEnrolment: first });
        if (first) await sendEnrolment(undefined);
        else await requestCode('approver_enroll', {}, 'approve_enroll');
    }

    async function startRemoval(approver: Approver): Promise<void> {
        begin({ approver, firstEnrolment: false });
        await requestCode('approver_remove', { approver_id: approver.id }, 'remove');
    }

    async function startPasswordChange(newPassword: string): Promise<void> {
        begin({ newPassword, firstEnrolment: false });
        await requestCode('admin_password', { password: newPassword }, 'password');
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
            case 'confirm_enroll': {
                const data = await call('approver_confirm', { code_id: proof.codeId, code }, 'checking');
                if (data === null) return;
                useAdminAlertsStore().expectOwn('approver_set', context.candidate?.deviceName ?? '');
                finish('enrolled');
                void load();
                return;
            }
            case 'remove': {
                const approver = context.approver;
                if (approver === undefined) return;
                const data = await call(
                    'approver_remove',
                    { approver_id: approver.id, code_id: proof.codeId, code },
                    'checking',
                );
                if (data === null) return;
                useAdminAlertsStore().expectOwn('approver_removed', approver.deviceName);
                finish('removed');
                void load();
                return;
            }
            case 'password': {
                const newPassword = context.newPassword;
                if (newPassword === undefined) return;
                working.value = 'checking';
                const error = await admin.changePassword(newPassword, proof);
                working.value = null;
                if (error === null) finish('password');
                else report(error);
                return;
            }
        }
    }

    /** A new code for the step on screen; the typed attempts so far still count. */
    async function resend(): Promise<void> {
        const current = challenge.value;
        if (current === null || working.value !== null) return;
        challenge.value = { ...current, error: null };
        switch (current.step) {
            case 'approve_enroll':
                await requestCode('approver_enroll', {}, 'approve_enroll');
                return;
            case 'confirm_enroll':
                // A second phone's enrolment code is only sent against an
                // approval: a new one means asking the first phone again.
                if (context.firstEnrolment) await sendEnrolment(undefined);
                else await requestCode('approver_enroll', {}, 'approve_enroll');
                return;
            case 'remove':
                if (context.approver !== undefined) {
                    await requestCode('approver_remove', { approver_id: context.approver.id }, 'remove');
                }
                return;
            case 'password':
                if (context.newPassword !== undefined) {
                    await requestCode('admin_password', { password: context.newPassword }, 'password');
                }
                return;
        }
    }

    function finish(what: ApproverDone): void {
        context = { firstEnrolment: false };
        challenge.value = null;
        flowError.value = null;
        done.value = what;
    }

    function cancel(): void {
        context = { firstEnrolment: false };
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
        load,
        loadCandidates,
        startEnrolment,
        startRemoval,
        startPasswordChange,
        submit,
        resend,
        cancel,
        dismissDone,
        handleEvent,
        reset,
    };
});
