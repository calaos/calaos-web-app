// Whether the box runs on a rescue snapshot (calaos_base docs/08_http_api.md,
// `rescue_status`). A household read behind the login: it needs no admin
// session, so every page can show the rescue banner.

import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { toRescueStatus } from '../protocol/admin-snapshots';
import type { RescueStatus } from '../protocol/admin-snapshots';
import { useAdminStore } from './admin';
import { useAuthStore } from './auth';
import { useConnectionStore } from './connection';

/** A failed read is retried this often for the first RETRY_FAST_WINDOW_MS, then slowly. */
export const RETRY_FAST_MS = 5_000;
export const RETRY_FAST_WINDOW_MS = 120_000;
export const RETRY_SLOW_MS = 60_000;

/** Only these may clear up by themselves; anything else (too old, not allowed...) will not. */
const TRANSIENT_CODES: readonly string[] = ['admin_unavailable', 'daemon_unreachable', 'rescue_unavailable', 'timeout'];

export const useRescueStore = defineStore('rescue', () => {
    const admin = useAdminStore();
    const auth = useAuthStore();
    const connection = useConnectionStore();

    /** null until a read succeeded. */
    const status = ref<RescueStatus | null>(null);
    /** Set while the last read failed. */
    const failed = ref(false);

    /** The information dialog: opened once per snapshot by itself, again by the banner's link. */
    const infoOpen = ref(false);

    let seq = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failingSince = 0;

    /** Reads before the household re-login would reach a server that does not know us yet. */
    const online = computed(() => connection.isOpen && auth.isAuthed);
    const active = computed(() => status.value?.rescue === true);
    const snapshot = computed(() => status.value?.snapshot ?? null);

    function stopRetry(): void {
        if (timer !== null) clearTimeout(timer);
        timer = null;
    }

    function scheduleRetry(): void {
        stopRetry();
        const now = Date.now();
        if (failingSince === 0) failingSince = now;
        const delay = now - failingSince < RETRY_FAST_WINDOW_MS ? RETRY_FAST_MS : RETRY_SLOW_MS;
        timer = setTimeout(() => {
            timer = null;
            void load();
        }, delay);
    }

    async function load(): Promise<void> {
        stopRetry();
        if (!online.value) return;
        seq += 1;
        const mine = seq;
        const outcome = await admin.relayHousehold('rescue_status');
        if (mine !== seq) return;
        if (outcome.ok) {
            status.value = toRescueStatus(outcome.data.result);
            failed.value = false;
            failingSince = 0;
            return;
        }
        // A drop is followed by the reconnection's own read.
        if (outcome.error.code === 'disconnected') return;
        failed.value = true;
        if (TRANSIENT_CODES.includes(outcome.error.code)) scheduleRetry();
    }

    function reset(): void {
        seq += 1;
        stopRetry();
        status.value = null;
        failed.value = false;
        failingSince = 0;
        infoOpen.value = false;
    }

    watch(
        online,
        (now) => {
            if (now) {
                failingSince = 0;
                void load();
            } else {
                // The answer to a request sent before the drop is lost with the socket.
                seq += 1;
                stopRetry();
                if (!auth.isAuthed) reset();
            }
        },
        { immediate: true },
    );

    return { status, failed, active, snapshot, infoOpen, load, reset };
});
