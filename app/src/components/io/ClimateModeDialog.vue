<script setup lang="ts">
// The mode, as a list. Choosing one applies it and closes the list.

import { useI18n } from 'vue-i18n';
import ClimateChoice from './ClimateChoice.vue';
import { MODE_ICONS } from './climate-icons';
import BaseDialog from '../ui/BaseDialog.vue';

defineProps<{
    open: boolean;
    /** The device's name. */
    eyebrow: string;
    modes: { value: string; label: string }[];
    current: string;
}>();

const emit = defineEmits<{
    /** The mode the user picked. */
    choose: [mode: string];
    close: [];
}>();

const { t } = useI18n();
</script>

<template>
    <BaseDialog :open="open" :eyebrow="eyebrow" :title="t('climate.modeTitle')" :cancel-label="t('climate.close')" @cancel="emit('close')">
        <div class="climate-mode-dialog" role="radiogroup" :aria-label="t('climate.modeTitle')">
            <ClimateChoice
                v-for="m in modes"
                :key="m.value"
                :label="m.label"
                :selected="m.value === current"
                @choose="emit('choose', m.value)"
            >
                <template #icon><component :is="MODE_ICONS[m.value] ?? MODE_ICONS['']" /></template>
            </ClimateChoice>
        </div>
    </BaseDialog>
</template>
