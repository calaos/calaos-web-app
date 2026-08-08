<script setup lang="ts">
// `temp` — a temperature, and nothing you can do about it.
//
// The old template (src/views/io/temp.html) printed `{{item.state}} °C` with
// the unit hardcoded, so a server reporting °F reported it as °C. `parseTemp`
// uses the server's unit and only falls back to °C — the documented fix in
// docs/ARCHITECTURE.md, and the same call HomeView's tiles make.
//
// The glyph stays muted: colour in this app means "live" or "yours to change",
// and a reading is neither.

import { computed } from 'vue';
import IconThermometer from '~icons/mdi/thermometer';
import IoRowFrame from './IoRowFrame.vue';
import { parseTemp } from '../../protocol/io-states';
import type { IoItem } from '../../protocol/types';

// Every row component takes the whole `IoItem`: the dispatch table in
// IoRow.vue decides which one gets which type, and a row only ever reads the
// fields common to all of them (plus its own parser's output).
const props = defineProps<{ io: IoItem }>();

const display = computed(() => parseTemp(props.io.state, props.io.unit).display);
</script>

<template>
    <IoRowFrame :name="io.name" :status="io.status">
        <template #icon>
            <IconThermometer class="temp-io__icon" aria-hidden="true" />
        </template>
        <template #value>
            <span class="temp-io__reading">{{ display }}</span>
        </template>
    </IoRowFrame>
</template>

<style scoped>
.temp-io__icon {
    color: var(--c-text-muted);
}

.temp-io__reading {
    /* Brighter than the frame's default value colour: on a row with no
       controls, the number IS the row. */
    color: var(--c-text);
}
</style>
