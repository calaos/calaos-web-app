<script setup lang="ts">
// Fan, swing and humidity: the settings that only some devices have. Each
// section exists only when the device announces it. Choices apply on tap and
// the list stays open, so both can be set in one visit.

import { useI18n } from 'vue-i18n';
import ClimateChoice from './ClimateChoice.vue';
import BaseDialog from '../ui/BaseDialog.vue';

defineProps<{
    open: boolean;
    /** The device's name. */
    eyebrow: string;
    fanModes?: { value: string; label: string }[];
    fan: string;
    swingModes?: { value: string; label: string }[];
    swing: string;
    humidity?: number;
}>();

const emit = defineEmits<{
    fan: [value: string];
    swing: [value: string];
    close: [];
}>();

const { t } = useI18n();
</script>

<template>
    <BaseDialog :open="open" :eyebrow="eyebrow" :title="t('climate.more')" :cancel-label="t('climate.close')" @cancel="emit('close')">
        <section v-if="fanModes?.length" class="climate-more__section">
            <h3 class="climate-more__title">{{ t('climate.fan') }}</h3>
            <div role="radiogroup" :aria-label="t('climate.fan')">
                <ClimateChoice v-for="m in fanModes" :key="m.value" :label="m.label" :selected="m.value === fan" @choose="emit('fan', m.value)" />
            </div>
        </section>
        <section v-if="swingModes?.length" class="climate-more__section">
            <h3 class="climate-more__title">{{ t('climate.swing') }}</h3>
            <div role="radiogroup" :aria-label="t('climate.swing')">
                <ClimateChoice v-for="m in swingModes" :key="m.value" :label="m.label" :selected="m.value === swing" @choose="emit('swing', m.value)" />
            </div>
        </section>
        <p v-if="humidity !== undefined" class="climate-more__humidity">{{ t('climate.humidity', { value: humidity }) }}</p>
    </BaseDialog>
</template>

<style scoped>
/* Fan, swing and humidity have to fit a 768px-high screen together. */
.climate-more__section :deep(.climate-choice) {
    block-size: 2.5rem;
}

.climate-more__section + .climate-more__section {
    margin-block-start: 0.875rem;
}

/* The app's eyebrow: a label that names a group. */
.climate-more__title {
    margin-block-end: var(--space-1);
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-muted);
}

.climate-more__humidity {
    margin: 0.875rem 0.625rem 0;
    font-size: 0.875rem;
    color: var(--c-text-muted);
}
</style>
