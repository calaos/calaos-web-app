<script setup lang="ts">
// The box's updates on their own page; the hub's tile says where they stand.

import { useI18n } from 'vue-i18n';
import { useAdminSubPage } from '../composables/useAdminSubPage';
import AdminInfoBanner from '../components/admin/AdminInfoBanner.vue';
import AdminPageHeader from '../components/admin/AdminPageHeader.vue';
import UpdatesPanel from '../components/admin/UpdatesPanel.vue';

const { t } = useI18n();
const { shown } = useAdminSubPage();
</script>

<template>
    <div class="sub-page">
        <div class="sub-page__body">
            <AdminPageHeader :title="t('admin.updates.title')" :hint="t('admin.updates.entryHint')" />
            <AdminInfoBanner />
            <UpdatesPanel v-if="shown" class="fade-in" />
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
