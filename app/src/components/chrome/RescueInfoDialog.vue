<script setup lang="ts">
// What rescue mode is and how to leave it, for whoever signs in while the box
// runs on a snapshot. It opens by itself once per snapshot and per browser
// session; the banner's link opens it again. Without an admin session
// "Open Snapshots" lands on the admin password gate, which returns here.

import { watch } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '../../stores/auth';
import { useRescueStore } from '../../stores/rescue';
import BaseDialog from '../ui/BaseDialog.vue';

const SEEN_KEY = 'rescue-info-seen';

const { t } = useI18n();
const router = useRouter();
const auth = useAuthStore();
const rescue = useRescueStore();

function seen(id: string): boolean {
    try {
        return sessionStorage.getItem(SEEN_KEY) === id;
    } catch {
        return false;
    }
}

function remember(id: string): void {
    try {
        sessionStorage.setItem(SEEN_KEY, id);
    } catch {
        // Private mode: the dialog may come back after a reload, which is harmless.
    }
}

watch(
    () => [auth.isAuthed, rescue.active, rescue.snapshot] as const,
    ([authed, active, snapshot]) => {
        if (!authed || !active) return;
        const id = String(snapshot ?? 'unknown');
        if (seen(id)) return;
        remember(id);
        rescue.infoOpen = true;
    },
    { immediate: true },
);

function open(): void {
    rescue.infoOpen = false;
    void router.push({ name: 'adminSnapshots' });
}
</script>

<template>
    <BaseDialog
        :open="auth.isAuthed && rescue.active && rescue.infoOpen"
        :title="t('rescue.info.title')"
        :confirm-label="t('rescue.info.open')"
        :cancel-label="t('rescue.info.close')"
        @confirm="open"
        @cancel="rescue.infoOpen = false"
    >
        <p class="rescue-info">{{ t('rescue.info.body') }}</p>
    </BaseDialog>
</template>

<style scoped>
.rescue-info {
    color: var(--c-text-muted);
    font-size: 0.9375rem;
    line-height: 1.45;
}
</style>
