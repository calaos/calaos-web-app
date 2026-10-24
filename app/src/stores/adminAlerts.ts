// The approver alerts shown in a banner at sign-in: a phone that started (or
// stopped) receiving admin codes is something every member of the household
// should see, since whoever holds the admin password could have enrolled it.
//
// Read from the event log after each login and after each live alert; which
// ones were dismissed is remembered per browser.

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { encodeEventLog, toAdminAlerts } from '../protocol/alerts';
import type { AdminAlert, AdminAlertKind } from '../protocol/alerts';
import type { EventLogMessage } from '../protocol/types';
import type { FrameSender } from './admin';

const SEEN_KEY = 'calaos.adminAlerts.seen';
const SEEN_MAX = 64;
/** Older alerts are history; a first visit from a new browser must not dig them up. */
const ALERT_WINDOW_MS = 30 * 24 * 3_600_000;
const PAGE_SIZE = 50;
const MSG_ID_PREFIX = 'admin_alerts:';
/** Our own enrolment's alert is not news to us, if it shows up soon enough. */
const OWN_WINDOW_MS = 60_000;

function readSeen(): string[] {
    try {
        const raw: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
        return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
    } catch {
        return [];
    }
}

function writeSeen(ids: string[]): void {
    try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-SEEN_MAX)));
    } catch {
        // Private mode or full storage: the banner just comes back next time.
    }
}

export const useAdminAlertsStore = defineStore('adminAlerts', () => {
    const recent = ref<AdminAlert[]>([]);
    const seen = ref<string[]>(readSeen());

    let send: FrameSender = () => false;
    let nextMsgId = 0;
    let own: { kind: AdminAlertKind; name: string; until: number }[] = [];

    const alerts = computed(() => {
        const now = Date.now();
        return recent.value.filter(
            (alert) => !seen.value.includes(alert.id) && !(now - alert.at > ALERT_WINDOW_MS),
        );
    });

    function attachTransport(sender: FrameSender): void {
        send = sender;
    }

    function markSeen(ids: string[]): void {
        const next = [...seen.value.filter((id) => !ids.includes(id)), ...ids];
        seen.value = next.slice(-SEEN_MAX);
        writeSeen(seen.value);
    }

    function refresh(): void {
        nextMsgId += 1;
        send(encodeEventLog(`${MSG_ID_PREFIX}${nextMsgId}`, PAGE_SIZE));
    }

    /** True when the answer was ours (the event log has other readers). */
    function handleEventLog(msg: EventLogMessage): boolean {
        if (!msg.msgId.startsWith(MSG_ID_PREFIX)) return false;
        const found = toAdminAlerts(msg.data);
        const now = Date.now();
        own = own.filter((entry) => entry.until > now);
        const mine: string[] = [];
        own = own.filter((entry) => {
            const match = found.find(
                (alert) =>
                    alert.kind === entry.kind &&
                    alert.deviceName === entry.name &&
                    !seen.value.includes(alert.id) &&
                    !mine.includes(alert.id),
            );
            if (match === undefined) return true;
            mine.push(match.id);
            return false;
        });
        if (mine.length > 0) markSeen(mine);
        recent.value = found;
        return true;
    }

    /** Called by the approvers store right after its own enrolment or removal. */
    function expectOwn(kind: AdminAlertKind, name: string): void {
        own.push({ kind, name, until: Date.now() + OWN_WINDOW_MS });
    }

    /** Called by services/calaos.ts for `approver_set` / `approver_removed`. */
    function handleEvent(type: string): void {
        if (type === 'approver_set' || type === 'approver_removed') refresh();
    }

    function dismiss(): void {
        markSeen(alerts.value.map((alert) => alert.id));
    }

    /** Sign-out: the dismissals stay (they are the browser's), the list goes. */
    function reset(): void {
        recent.value = [];
        own = [];
    }

    return { alerts, attachTransport, refresh, handleEventLog, handleEvent, expectOwn, dismiss, reset };
});
