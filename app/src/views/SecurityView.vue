<script setup lang="ts">
// The approver phones and the admin password. The password's line sits under
// the phones because its hint points at them.
// A new password swaps the session: the page holds on through that swap, the
// dialog it runs in closes on its own.

import { onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useAdminStore } from '../stores/admin';
import { useApproversStore } from '../stores/approvers';
import { useAdminSubPage } from '../composables/useAdminSubPage';
import AdminInfoBanner from '../components/admin/AdminInfoBanner.vue';
import AdminPageHeader from '../components/admin/AdminPageHeader.vue';
import AdminPasswordChange from '../components/admin/AdminPasswordChange.vue';
import ApproversPanel from '../components/admin/ApproversPanel.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const admin = useAdminStore();
const approvers = useApproversStore();
const { shown } = useAdminSubPage(() => admin.busy === 'set' || admin.busy === 'unlock');

// The console and the network page ask for a first phone (`?add=phone`).
onMounted(() => {
    if (route.query.add !== 'phone' || !shown.value) return;
    void router.replace({ name: 'adminSecurity' });
    approvers.requestAdd();
});
</script>

<template>
    <div class="sub-page">
        <div class="sub-page__body">
            <AdminPageHeader :title="t('admin.security.title')" :hint="t('admin.security.hint')" />
            <AdminInfoBanner />
            <template v-if="shown">
                <ApproversPanel class="fade-in" />
                <AdminPasswordChange class="fade-in" />
            </template>
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
