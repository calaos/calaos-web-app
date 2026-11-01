// The Admin sub-pages that took over the hub's actions (update, restart, new
// password, new token). Those actions cut the socket or change the session, so
// the store keeps watching the box here as it does on the hub. Without an
// admin session there is nothing to show: back to the hub, which asks for the
// password.

import { computed, onMounted, onUnmounted, watch } from 'vue';
import type { ComputedRef } from 'vue';
import { useRouter } from 'vue-router';
import { useAdminStore } from '../stores/admin';

/** `holding`: the page outlives a session swap it started itself. */
export function useAdminSubPage(holding: () => boolean = () => false): {
    shown: ComputedRef<boolean>;
} {
    const admin = useAdminStore();
    const router = useRouter();

    const shown = computed(() => admin.isUnlocked || holding());

    watch(shown, (visible) => {
        if (!visible) void router.replace({ name: 'admin' });
    });

    onMounted(() => {
        if (shown.value) admin.activate();
        else void router.replace({ name: 'admin' });
    });

    onUnmounted(() => {
        admin.suspend();
        // A refusal belongs to the page that showed it; the gate's own stays
        // for the password form this page may be handing over to.
        if (admin.noticeSource !== 'gate') admin.dismissNotice();
    });

    return { shown };
}
