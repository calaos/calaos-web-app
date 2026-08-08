<script setup lang="ts">
// `var_int` — a number the server keeps, nudged up or down.
//
// The old template hardcoded `icon_int.png` — no `gui_style` lookup, unlike
// `analog_out` right beside it — and `docs/ARCHITECTURE.md`'s parser table
// agrees: `parseVarInt` returns only the display string, no icon field. So
// the glyph here is static: the same counter mark `calaos-icons.ts` draws
// for `gui_style: 'int'`, not one derived from this IO's own (absent) style.
//
// The two verbs are `analog_out`'s: `ACTION_INC` / `ACTION_DEC` — but unlike
// `analog_out`, they ARE gated by `rw`. This is one of the only three types
// the server sends `rw` for, and where it genuinely means "the user may edit
// this value" (docs/ARCHITECTURE.md "The `rw` flag").

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ActionButton from './ActionButton.vue';
import { BUTTONS, STATE_ICONS } from './calaos-icons';
import IoRowFrame from './IoRowFrame.vue';
import ImageIcon from '../ui/ImageIcon.vue';
import { useIo } from '../../composables/useIo';
import { ACTION_DEC, ACTION_INC, parseVarInt } from '../../protocol/io-states';
import type { IoItem } from '../../protocol/types';

const props = defineProps<{ io: IoItem }>();

const { t } = useI18n();
const { isPending, set } = useIo(() => props.io.id);

const display = computed(() => parseVarInt(props.io.state, props.io.unit).display);
</script>

<template>
    <IoRowFrame :name="io.name" :status="io.status" :pending="isPending">
        <template #icon>
            <ImageIcon class="var-int-io__icon" :src="STATE_ICONS.int" />
        </template>
        <template #value>
            <span class="var-int-io__reading">{{ display }}</span>
        </template>

        <template v-if="io.rw" #actions>
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
.var-int-io__icon {
    color: var(--c-text-muted);
}

.var-int-io__reading {
    color: var(--c-text);
}
</style>
