// Connection store — the UI-facing mirror of the websocket lifecycle.
//
// Fed exclusively by CalaosSocket 'statuschange' events through
// services/calaos.ts; it holds NO socket reference and never reconnects
// anything itself. Its only real logic is the banner debounce.
//
// Deliberate fix (see docs/ARCHITECTURE.md "WS client"): a lost connection
// drives this store and nothing else. The old app signed the user out and
// navigated to /login on every websocket error.

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { ConnectionStatus, SocketStatusInfo } from '../protocol/socket';

/**
 * The socket must stay non-open for this long, CONTINUOUSLY, before the
 * banner shows. Short blips (a reconnect that succeeds on the first retry —
 * 1000 ms backoff, so this is common) must not flash a banner at the user.
 */
export const BANNER_DELAY_MS = 1000;

export const useConnectionStore = defineStore('connection', () => {
    // Mirrors CalaosSocket's own three-state union; 'connecting' until the
    // first statuschange arrives (the socket starts there too).
    const status = ref<ConnectionStatus>('connecting');
    /** Consecutive failed attempts since the last successful open. */
    const attempt = ref(0);
    /** ms until the next attempt; 0 unless status is 'reconnecting'. */
    const nextRetryMs = ref(0);
    /** Debounced: true only after BANNER_DELAY_MS of continuous non-open. */
    const showBanner = ref(false);

    // Plain closure variable on purpose: a timer handle is not state, and
    // exposing it would make it show up in devtools/$state snapshots.
    let bannerTimer: ReturnType<typeof setTimeout> | null = null;

    const isOpen = computed(() => status.value === 'open');

    function cancelBannerTimer(): void {
        if (bannerTimer !== null) {
            clearTimeout(bannerTimer);
            bannerTimer = null;
        }
    }

    /** Called by services/calaos.ts for every socket 'statuschange'. */
    function applyStatus(info: SocketStatusInfo): void {
        status.value = info.status;
        attempt.value = info.attempt;
        nextRetryMs.value = info.nextRetryMs;

        if (info.status === 'open') {
            cancelBannerTimer();
            showBanner.value = false;
            return;
        }

        // The socket re-emits 'reconnecting' once per retry (with a new
        // attempt/nextRetryMs), so the countdown is armed ONCE on the way out
        // of 'open' and left alone afterwards — restarting it per event would
        // push the banner further away the longer the outage lasts.
        if (bannerTimer === null && !showBanner.value) {
            bannerTimer = setTimeout(() => {
                bannerTimer = null;
                showBanner.value = true;
            }, BANNER_DELAY_MS);
        }
    }

    /** Back to the pristine state (tests, and a future socket teardown). */
    function reset(): void {
        cancelBannerTimer();
        status.value = 'connecting';
        attempt.value = 0;
        nextRetryMs.value = 0;
        showBanner.value = false;
    }

    return { status, attempt, nextRetryMs, showBanner, isOpen, applyStatus, reset };
});
