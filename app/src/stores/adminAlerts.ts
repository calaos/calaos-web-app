// The approver alerts shown in a banner at sign-in: a phone that started (or
// stopped) receiving admin codes is something every member of the household
// should see, since whoever holds the admin password could have enrolled it.
//
// Read from the event log after each login and after each live alert; which
// ones were dismissed is remembered per browser.

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { alertDeviceName, encodeEventLog, toEventLogPage } from '../protocol/alerts';
import type { AdminAlert, AdminAlertKind } from '../protocol/alerts';
import type { EventLogMessage } from '../protocol/types';
import type { FrameSender } from './admin';

const SEEN_KEY = 'calaos.adminAlerts.seen';
const SEEN_MAX = 64;
/** Older alerts are history; a first visit from a new browser must not dig them up. */
const ALERT_WINDOW_MS = 30 * 24 * 3_600_000;
/**
 * The log also holds every logged IO change, and has no type filter: the
 * reader walks back until the window is covered, within a bounded budget.
 */
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const MSG_ID_PREFIX = 'admin_alerts:';
/** How long a change of ours waits for its alert. */
const OWN_WINDOW_MS = 120_000;

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

interface OwnChange {
    kind: AdminAlertKind;
    /** As the box will write it. */
    name: string;
    /** Alerts read before the change: ours is none of them. */
    known: Set<string>;
    until: number;
}

export const useAdminAlertsStore = defineStore('adminAlerts', () => {
    const recent = ref<AdminAlert[]>([]);
    const seen = ref<string[]>(readSeen());

    let send: FrameSender = () => false;
    let generation = 0;
    /** The pages of the walk in progress. */
    let gathered: AdminAlert[] = [];
    let own: OwnChange[] = [];

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

    function requestPage(page: number): void {
        send(encodeEventLog(`${MSG_ID_PREFIX}${generation}:${page}`, page, PAGE_SIZE));
    }

    /** A new walk; the answers of an older one are dropped. */
    function refresh(): void {
        generation += 1;
        gathered = [];
        requestPage(0);
    }

    /**
     * Our own change is not news to us. The box rewrites the name, so it is
     * compared as the box writes it; among the alerts that were not there
     * before the change, the oldest match is ours.
     */
    function claimOwn(found: AdminAlert[]): void {
        const now = Date.now();
        own = own.filter((entry) => entry.until > now);
        const mine: string[] = [];
        own = own.filter((entry) => {
            const match = [...found]
                .reverse()
                .find(
                    (alert) =>
                        alert.kind === entry.kind &&
                        alert.deviceName === entry.name &&
                        !entry.known.has(alert.id) &&
                        !seen.value.includes(alert.id) &&
                        !mine.includes(alert.id),
                );
            if (match === undefined) return true;
            mine.push(match.id);
            return false;
        });
        if (mine.length > 0) markSeen(mine);
    }

    /** True when the answer was ours (the event log has other readers). */
    function handleEventLog(msg: EventLogMessage): boolean {
        if (!msg.msgId.startsWith(MSG_ID_PREFIX)) return false;
        const [gen, page] = msg.msgId.slice(MSG_ID_PREFIX.length).split(':').map(Number);
        if (gen !== generation) return true;
        const read = toEventLogPage(msg.data);
        gathered = [...gathered, ...read.alerts];
        const next = page + 1;
        const older = Number.isFinite(read.oldestAt) && Date.now() - read.oldestAt < ALERT_WINDOW_MS;
        if (older && next < read.totalPages && next < MAX_PAGES) {
            requestPage(next);
            return true;
        }
        claimOwn(gathered);
        recent.value = gathered;
        return true;
    }

    /** Called by the approvers store just before it confirms an enrolment or a removal. */
    function expectOwn(kind: AdminAlertKind, name: string): void {
        own.push({
            kind,
            name: alertDeviceName(name),
            known: new Set(recent.value.map((alert) => alert.id)),
            until: Date.now() + OWN_WINDOW_MS,
        });
    }

    /** The change failed: nothing of ours is coming. */
    function dropOwn(kind: AdminAlertKind, name: string): void {
        const normalized = alertDeviceName(name);
        own = own.filter((entry) => entry.kind !== kind || entry.name !== normalized);
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
        generation += 1;
        gathered = [];
        recent.value = [];
        own = [];
    }

    return { alerts, attachTransport, refresh, handleEventLog, handleEvent, expectOwn, dropOwn, dismiss, reset };
});
