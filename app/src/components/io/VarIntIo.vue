<script setup lang="ts">
// `var_int` — a number the server keeps, nudged up or down.
//
// The old template hardcoded `icon_int.png` — no `gui_style` lookup, unlike
// `analog_out` right beside it — and `docs/ARCHITECTURE.md`'s parser table
// agrees: `parseVarInt` returns only the display string, no icon field. So
// the glyph here is static: the same counter mark `gui-style-icons.ts` draws
// for `gui_style: 'int'`, not one derived from this IO's own (absent) style.
//
// The two verbs are `analog_out`'s: `ACTION_INC` / `ACTION_DEC`, gated by
// `rw` like every other row's actions.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import IconCounter from '~icons/mdi/counter';
import IconMinus from '~icons/mdi/minus';
import IconPlus from '~icons/mdi/plus';
import IoRowFrame from './IoRowFrame.vue';
import IconButton from '../ui/IconButton.vue';
import { useIo } from '../../composables/useIo';
import { ACTION_DEC, ACTION_INC, parseVarInt } from '../../protocol/io-states';
import type { IoItem } from '../../protocol/types';

const props = defineProps<{ io: IoItem }>();

const { t } = useI18n();
const { isPending, set } = useIo(() => props.io.id);

const display = computed(() => parseVarInt(props.io.state, props.io.unit).display);
</script>

<template>
    <IoRowFrame :name="io.name" :pending="isPending">
        <template #icon>
            <IconCounter class="var-int-io__icon" aria-hidden="true" />
        </template>
        <template #value>
            <span class="var-int-io__reading">{{ display }}</span>
        </template>

        <template v-if="io.rw" #actions>
            <IconButton :label="t('io.increase', { name: io.name })" @click="set(ACTION_INC)">
                <IconPlus />
            </IconButton>
            <IconButton :label="t('io.decrease', { name: io.name })" @click="set(ACTION_DEC)">
                <IconMinus />
            </IconButton>
        </template>
    </IoRowFrame>
</template>

<style scoped>
.var-int-io__icon {
    color: var(--c-text-muted);
}

.var-int-io__reading {
    color: var(--c-text);
}
</style>
