<script setup lang="ts">
// calaos_server's settings and the configuration backup, on their own page.
// Without an admin session there is nothing to show: back to the hub, which
// asks for the password.

import { onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAdminStore } from '../stores/admin';
import AdminPageHeader from '../components/admin/AdminPageHeader.vue';
import ConfigPanel from '../components/admin/ConfigPanel.vue';

const { t } = useI18n();
const router = useRouter();
const admin = useAdminStore();

watch(
    () => admin.isUnlocked,
    (unlocked) => {
        if (!unlocked) void router.replace({ name: 'admin' });
    },
);

onMounted(() => {
    if (!admin.isUnlocked) void router.replace({ name: 'admin' });
});
</script>

<template>
    <div class="sub-page">
        <div class="sub-page__body">
            <AdminPageHeader :title="t('admin.config.title')" :hint="t('admin.config.hint')" />
            <ConfigPanel v-if="admin.isUnlocked" class="fade-in" />
        </div>
    </div>
</template>

<style scoped>
.sub-page {
    padding: var(--space-4);
}

@media (min-width: 480px) {
    .sub-page {
        padding: var(--space-6);
    }
}

.sub-page__body {
    display: grid;
    gap: var(--space-6);
    inline-size: 100%;
    max-inline-size: 40rem;
    margin-inline: auto;
}
</style>
