<script setup lang="ts">
// The way to the network page from the Admin tab. It also reads the box's
// state: someone back after a reload, or at the box's new address, lands
// here first and must see that a change is waiting to be kept.

import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAdminStore } from '../../stores/admin';
import { useAdminNetworkStore } from '../../stores/adminNetwork';
import { useNetworkCountdown } from '../../composables/useNetworkCountdown';
import AdminButton from './AdminButton.vue';

const { t } = useI18n();
const router = useRouter();
const admin = useAdminStore();
const network = useAdminNetworkStore();

const countdown = useNetworkCountdown(() => network.pending?.deadline ?? null);
const waiting = computed(() => network.pending !== null && (countdown.seconds.value ?? 0) > 0);

onMounted(() => {
    if (admin.isUnlocked) void network.load();
});

function open(): void {
    void router.push({ name: 'adminNetwork' });
}
</script>

<template>
    <section class="net-entry" :aria-label="t('admin.network.entry.name')">
        <div class="net-entry__row">
            <div class="net-entry__text">
                <span class="net-entry__name">{{ t('admin.network.entry.name') }}</span>
                <span v-if="waiting" class="net-entry__pending">
                    {{ t('admin.network.entry.pending', { intf: network.pending?.intf ?? '', time: countdown.clock.value }) }}
                </span>
                <span v-else class="net-entry__hint">{{ t('admin.network.entry.hint') }}</span>
            </div>
            <AdminButton :variant="waiting ? 'primary' : 'quiet'" @click="open">
                {{ waiting ? t('admin.network.entry.review') : t('admin.network.entry.open') }}
            </AdminButton>
        </div>
    </section>
</template>

<style scoped>
.net-entry__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-2);
    border-block: 1px solid var(--c-border);
}

.net-entry__text {
    display: grid;
    gap: var(--space-1);
    min-inline-size: 0;
}

.net-entry__name {
    font-size: 1rem;
}

.net-entry__hint {
    color: var(--c-text-muted);
    font-size: 0.875rem;
    line-height: 1.4;
}

.net-entry__pending {
    color: var(--c-warn);
    font-size: 0.875rem;
    line-height: 1.4;
    font-variant-numeric: tabular-nums;
}

@media (max-width: 479px) {
    .net-entry__row {
        flex-direction: column;
        align-items: stretch;
    }
}
</style>
