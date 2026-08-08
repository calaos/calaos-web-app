<script setup lang="ts">
// `analog_in` — a measured value the server also chooses the glyph for.
//
// `parseAnalogIn` returns the display string (`state` + `unit`, joined only
// when there is a unit) and the resolved `gui_style` key, `'default'` when the
// server sent none. `resolveAnalogIcon` turns that key into Calaos's own
// artwork for that quantity, and is
// total, so an unrecognised style draws the default dial instead of the old
// app's broken-image icon (see calaos-icons.ts).

import { computed } from 'vue';
import IoRowFrame from './IoRowFrame.vue';
import { resolveAnalogIcon } from './calaos-icons';
import ImageIcon from '../ui/ImageIcon.vue';
import { parseAnalogIn } from '../../protocol/io-states';
import type { IoItem } from '../../protocol/types';

const props = defineProps<{ io: IoItem }>();

const reading = computed(() => parseAnalogIn(props.io.state, props.io.unit, props.io.ioStyle));
const icon = computed(() => resolveAnalogIcon(reading.value.icon));
</script>

<template>
    <IoRowFrame :name="io.name" :status="io.status">
        <template #icon>
            <ImageIcon class="analog-in-io__icon" :src="icon" />
        </template>
        <template #value>
            <span class="analog-in-io__reading">{{ reading.display }}</span>
        </template>
    </IoRowFrame>
</template>

<style scoped>
.analog-in-io__icon {
    color: var(--c-text-muted);
}

.analog-in-io__reading {
    color: var(--c-text);
}
</style>
