<script setup lang="ts">
// `string_in` — a line of text the server writes and nobody here edits.
//
// `parseStringIn` falls back to the IO's NAME when the state is empty, which
// is exactly what the old `VarStringCtrl` did — and the old template
// (src/views/io/string_input.html) could get away with it because it printed
// `display_text` and nothing else: the row had no name column to collide
// with. This row does. So the parser's fallback is honoured by showing the
// name ONCE, in the name column, and leaving the value column out entirely.
// An empty `string_in` therefore reads as a labelled row with nothing to say,
// rather than as its own name twice.

import { computed } from 'vue';
import IconFormatText from '~icons/mdi/format-text';
import IoRowFrame from './IoRowFrame.vue';
import { parseStringIn } from '../../protocol/io-states';
import type { IoItem } from '../../protocol/types';

const props = defineProps<{ io: IoItem }>();

const display = computed(() => parseStringIn(props.io.state, props.io.name).display);

/** False exactly when the parser fell back to the name, i.e. empty state. */
const hasValue = computed(() => display.value !== props.io.name);
</script>

<template>
    <IoRowFrame :name="io.name">
        <template #icon>
            <IconFormatText class="string-in-io__icon" aria-hidden="true" />
        </template>
        <template v-if="hasValue" #value>
            <span class="string-in-io__text">{{ display }}</span>
        </template>
    </IoRowFrame>
</template>

<style scoped>
.string-in-io__icon {
    color: var(--c-text-muted);
}

.string-in-io__text {
    /* The value IS the row here, so it gets the brighter reading colour. Its
       width and its ellipsis are the frame's business, not this file's. */
    color: var(--c-text);
}
</style>
