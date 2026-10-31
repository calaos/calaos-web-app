<script setup lang="ts">
// The Admin tab. One screen at a time, chosen by the store's gate: a notice
// to wait on, a password to type, or — unlocked — the hub: updates, the ways
// to the box's own pages, the approver phones, the box's actions and MCP
// access. The gate
// screens borrow the login panel so that "enter the admin password" reads as
// the same gesture as signing in.

import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { ADMIN_PASSWORD_MIN_LENGTH } from '../protocol/admin';
import { useAdminStore } from '../stores/admin';
import { useAuthStore } from '../stores/auth';
import { useAdminText } from '../composables/useAdminText';
import AdminActions from '../components/admin/AdminActions.vue';
import AdminButton from '../components/admin/AdminButton.vue';
import AdminNotice from '../components/admin/AdminNotice.vue';
import AdminPages from '../components/admin/AdminPages.vue';
import AdminPasswordForm from '../components/admin/AdminPasswordForm.vue';
import ApproversPanel from '../components/admin/ApproversPanel.vue';
import HouseholdPasswordForm from '../components/admin/HouseholdPasswordForm.vue';
import McpCard from '../components/admin/McpCard.vue';
import UpdatesPanel from '../components/admin/UpdatesPanel.vue';

const { t } = useI18n();
const admin = useAdminStore();
const auth = useAuthStore();
const { errorText } = useAdminText();

onMounted(() => admin.activate());
onUnmounted(() => admin.deactivate());

const actions = ref<InstanceType<typeof AdminActions> | null>(null);
const phones = ref<InstanceType<typeof ApproversPanel> | null>(null);
const route = useRoute();
const router = useRouter();

// The console sends here to enrol a first phone (`?add=phone`), possibly
// through the unlock screen first.
watch(
    phones,
    (panel) => {
        if (panel === null || route.query.add !== 'phone') return;
        void router.replace({ name: 'admin' });
        panel.openAdd();
    },
    { flush: 'post' },
);

const formError = computed(() =>
    admin.notice !== null && admin.noticeSource === 'gate' ? errorText(admin.notice) : '',
);
const refused = computed(() => admin.notice?.code === 'bad_password');
const minLength = computed(() => admin.notice?.minLength ?? ADMIN_PASSWORD_MIN_LENGTH);

/** The same page over https, on the host's default port (haproxy). */
const httpsUrl = computed(
    () => `https://${window.location.hostname}${window.location.pathname}#/admin`,
);

const infoText = computed(() => (admin.info === null ? '' : t(`admin.info.${admin.info}`)));

function unlock(password: string): void {
    void admin.unlock(password);
}

function bootstrap(password: string): void {
    void admin.setPassword(password);
}

function changeHousehold(user: string, password: string): void {
    void admin.changeHouseholdPassword(user, password);
}
</script>

<template>
    <div class="admin" :class="{ 'admin--gate': admin.gate !== 'unlocked' }">
        <h1 class="visually-hidden">{{ t('admin.title') }}</h1>

        <!-- ---- unlocked ------------------------------------------------ -->
        <div v-if="admin.gate === 'unlocked'" class="admin__page fade-in">
            <p v-if="infoText !== ''" class="admin__info fade-in" role="status">
                <span>{{ infoText }}</span>
                <button type="button" class="admin__dismiss" @click="admin.dismissInfo()">
                    {{ t('admin.dismiss') }}
                </button>
            </p>
            <UpdatesPanel @reboot="actions?.askReboot()" />

            <AdminPages />

            <ApproversPanel ref="phones" />

            <AdminActions ref="actions" @add-phone="phones?.openAdd()" />

            <McpCard />
        </div>

        <!-- ---- the gate ----------------------------------------------- -->
        <div v-else class="admin__panel">
            <AdminNotice
                v-if="admin.gate === 'idle' || admin.gate === 'probing'"
                tone="working"
                :title="t('admin.probing')"
                hint=""
            />

            <template v-else-if="admin.gate === 'locked'">
                <header class="admin__intro fade-in-down">
                    <p class="admin__eyebrow">{{ t('admin.title') }}</p>
                    <h2 class="admin__heading">{{ t('admin.unlock.title') }}</h2>
                    <p class="admin__hint">{{ t('admin.unlock.hint') }}</p>
                </header>
                <p v-if="infoText !== ''" class="admin__info admin__info--gate fade-in" role="status">
                    {{ infoText }}
                </p>
                <AdminPasswordForm
                    class="fade-in-up"
                    mode="unlock"
                    :busy="admin.busy === 'unlock'"
                    :error="formError"
                    :refused="refused"
                    @submit="unlock"
                />
            </template>

            <template v-else-if="admin.gate === 'bootstrap'">
                <header class="admin__intro fade-in-down">
                    <p class="admin__eyebrow">{{ t('admin.title') }}</p>
                    <h2 class="admin__heading">{{ t('admin.bootstrap.title') }}</h2>
                    <p class="admin__hint">{{ t('admin.bootstrap.hint', { min: minLength }) }}</p>
                </header>
                <p class="admin__hosts fade-in">
                    <span class="admin__hosts-label">{{ t('admin.bootstrap.allowedHosts') }}</span>
                    <span v-if="admin.apiAllowedHosts !== ''">
                        {{ t('admin.bootstrap.allowedHostsHint', { hosts: admin.apiAllowedHosts }) }}
                    </span>
                    <span v-else>{{ t('admin.bootstrap.allowedHostsNone') }}</span>
                </p>
                <AdminPasswordForm
                    class="fade-in-up"
                    mode="bootstrap"
                    :busy="admin.busy === 'set' || admin.busy === 'unlock'"
                    :error="formError"
                    :min-length="minLength"
                    @submit="bootstrap"
                />
            </template>

            <template v-else-if="admin.gate === 'household'">
                <header class="admin__intro fade-in-down">
                    <p class="admin__eyebrow">{{ t('admin.title') }}</p>
                    <h2 class="admin__heading">{{ t('admin.household.title') }}</h2>
                    <p class="admin__hint">{{ t('admin.household.hint') }}</p>
                </header>
                <HouseholdPasswordForm
                    class="fade-in-up"
                    :user="auth.user"
                    :busy="admin.busy === 'change_cred'"
                    :error="formError"
                    @submit="changeHousehold"
                />
            </template>

            <AdminNotice
                v-else-if="admin.gate === 'unavailable'"
                tone="warn"
                :title="t('admin.notice.unavailable')"
                :hint="t('admin.notice.unavailableHint')"
            />

            <AdminNotice
                v-else-if="admin.gate === 'activating' && !admin.rebootHint"
                tone="working"
                :title="t('admin.notice.activating')"
                :hint="t('admin.notice.activatingHint')"
            />

            <AdminNotice
                v-else-if="admin.gate === 'activating'"
                tone="warn"
                :title="t('admin.notice.rebootBox')"
                :hint="t('admin.notice.rebootBoxHint')"
            />

            <AdminNotice
                v-else-if="admin.gate === 'unreachable'"
                tone="warn"
                :title="t('admin.notice.unreachable')"
                :hint="t('admin.notice.unreachableHint')"
            />

            <AdminNotice
                v-else-if="admin.gate === 'old_server'"
                tone="danger"
                :title="t('admin.notice.oldServer')"
                :hint="t('admin.notice.oldServerHint')"
            />

            <AdminNotice
                v-else-if="admin.gate === 'https_required'"
                tone="secure"
                :title="t('admin.notice.https')"
                :hint="t('admin.notice.httpsHint')"
            >
                <AdminButton class="admin__https" variant="primary" :href="httpsUrl">
                    {{ t('admin.notice.httpsOpen') }}
                </AdminButton>
            </AdminNotice>
        </div>
    </div>
</template>

<style scoped>
.admin {
    display: flex;
    flex-direction: column;
    min-block-size: 100%;
    padding: var(--space-4);
}

@media (min-width: 480px) {
    .admin {
        padding: var(--space-6);
    }
}

/* ---- unlocked ------------------------------------------------------- */

.admin__page {
    display: grid;
    gap: var(--space-6);
    inline-size: 100%;
    max-inline-size: 40rem;
    margin-inline: auto;
}

.admin__info {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid rgba(76, 175, 125, 0.35);
    border-radius: var(--radius-md);
    background-color: rgba(76, 175, 125, 0.1);
    color: var(--c-success);
    font-size: 0.9375rem;
    line-height: 1.4;
}

.admin__info--gate {
    margin-block-end: var(--space-4);
}

.admin__dismiss {
    flex: none;
    padding: var(--space-1) var(--space-3);
    border: 1px solid currentColor;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
}

/* ---- the gate: LoginView's panel ------------------------------------ */

.admin--gate {
    display: flex;
}

.admin__panel {
    margin: auto;
    inline-size: min(22rem, 100%);
    position: relative;
    isolation: isolate;
}

.admin__panel::before {
    content: '';
    position: absolute;
    inset: -20% -25%;
    background-image: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.78), rgba(0, 0, 0, 0) 70%);
    z-index: -1;
    pointer-events: none;
}

.admin__intro {
    margin-block-end: var(--space-6);
}

.admin__eyebrow {
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-muted);
}

.admin__heading {
    margin-block-start: var(--space-2);
    font-size: clamp(1.5rem, 6vw, 1.875rem);
    font-weight: 400;
    letter-spacing: var(--tracking-tight);
    line-height: 1.15;
}

.admin__hint {
    margin-block-start: var(--space-3);
    color: var(--c-text-muted);
    font-size: 0.9375rem;
    line-height: 1.45;
}

.admin__hosts {
    display: grid;
    gap: var(--space-1);
    margin-block-end: var(--space-6);
    padding: var(--space-3) var(--space-4);
    border: 1px solid rgba(224, 163, 86, 0.35);
    border-radius: var(--radius-md);
    background-color: rgba(52, 38, 20, 0.6);
    font-size: 0.875rem;
    line-height: 1.4;
    color: var(--c-text-muted);
    overflow-wrap: anywhere;
}

.admin__hosts-label {
    color: var(--c-warn);
    font-weight: 500;
}
</style>
