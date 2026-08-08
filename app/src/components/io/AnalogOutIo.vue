<script setup lang="ts">
// `analog_out` — a measured value the server also picks the glyph for,
// nudged up or down.
//
// The reading is `analog_in`'s: `parseAnalogOut` returns the same shape
// (display string + resolved `gui_style` glyph, `'default'` when the server
// sent none — see calaos-icons.ts). What this type adds is two verbs,
// `ACTION_INC` / `ACTION_DEC`: no target value, just "more" and "less" (the
// old template's +/- buttons, src/views/io/analog_out.html). That template
// never looked at `rw` — the one type the old app got the gate wrong for in
// this direction (docs/ARCHITECTURE.md) — so the buttons here are gated like
// every other row's actions instead.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ActionButton from './ActionButton.vue';
import { BUTTONS, resolveAnalogIcon } from './calaos-icons';
import IoRowFrame from './IoRowFrame.vue';
import ImageIcon from '../ui/ImageIcon.vue';
import { useIo } from '../../composables/useIo';
import { ACTION_DEC, ACTION_INC, parseAnalogOut } from '../../protocol/io-states';
import type { IoItem } from '../../protocol/types';

const props = defineProps<{ io: IoItem }>();

const { t } = useI18n();
const { isPending, set } = useIo(() => props.io.id);

const reading = computed(() => parseAnalogOut(props.io.state, props.io.unit, props.io.ioStyle));
const icon = computed(() => resolveAnalogIcon(reading.value.icon));
</script>

<template>
    <IoRowFrame :name="io.name" :status="io.status" :pending="isPending">
        <template #icon>
            <ImageIcon class="analog-out-io__icon" :src="icon" />
        </template>
        <template #value>
            <span class="analog-out-io__reading">{{ reading.display }}</span>
        </template>

        <template #actions>
            <ActionButton
                :label="t('io.increase', { name: io.name })"
                :face="BUTTONS.plus"
                @click="set(ACTION_INC)"
            />
            <ActionButton
                :label="t('io.decrease', { name: io.name })"
                :face="BUTTONS.minus"
                @click="set(ACTION_DEC)"
            />
        </template>
    </IoRowFrame>
</template>

<style scoped>
.analog-out-io__icon {
    color: var(--c-text-muted);
}

.analog-out-io__reading {
    color: var(--c-text);
}
</style>
