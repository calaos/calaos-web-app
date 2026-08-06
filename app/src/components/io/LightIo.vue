<script setup lang="ts">
// `light` — on, off, and the half-second it takes to believe it.
//
// The state is the crossfading bulb, which is the old app's sprite trick with
// the bitmaps and the disabled checkbox taken out (see StateIcon.vue). The
// old row also showed both buttons unconditionally: `light.html` never looked
// at `rw`, though `var_bool.html` right next to it did. Gating is uniform here
// (docs/ARCHITECTURE.md) — a read-only light shows its state and offers
// nothing to press.
//
// Nothing is optimistic: the bulb only changes when the server says so, and
// the dot on the glyph covers the wait. That is the store's decision
// (`sendSetState` records pending rather than writing the state), because a
// light that lights up on tap and goes dark a second later is worse than one
// that takes a second.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
// The buttons are a bolt and a struck bolt, not MDI's `power`/`power-off`:
// that pair's "off" is a bare ring, which at 20px says nothing and is the
// same shape as a var_bool's resting glyph. Two silhouettes that differ by a
// slash read as one set, and a circuit being energised is this house's own
// vocabulary.
import IconFlash from '~icons/mdi/flash';
import IconFlashOff from '~icons/mdi/flash-off';
import IconLightbulbOn from '~icons/mdi/lightbulb-on';
import IconLightbulbOutline from '~icons/mdi/lightbulb-outline';
import IoRowFrame from './IoRowFrame.vue';
import IconButton from '../ui/IconButton.vue';
import StateIcon from '../ui/StateIcon.vue';
import { useIo } from '../../composables/useIo';
import { ACTION_FALSE, ACTION_TRUE, parseLight } from '../../protocol/io-states';
import type { IoItem } from '../../protocol/types';

const props = defineProps<{ io: IoItem }>();

const { t } = useI18n();
// A getter, not the raw string: the row is re-used across route changes and
// the id it watches must follow the prop.
const { isPending, set } = useIo(() => props.io.id);

const on = computed(() => parseLight(props.io.state).on);
</script>

<template>
    <IoRowFrame :name="io.name" :pending="isPending">
        <template #icon>
            <StateIcon
                :on="on"
                :icon-off="IconLightbulbOutline"
                :icon-on="IconLightbulbOn"
                :label="t(on ? 'io.on' : 'io.off')"
            />
        </template>

        <template v-if="io.rw" #actions>
            <IconButton :label="t('io.turnOn', { name: io.name })" @click="set(ACTION_TRUE)">
                <IconFlash />
            </IconButton>
            <IconButton :label="t('io.turnOff', { name: io.name })" @click="set(ACTION_FALSE)">
                <IconFlashOff />
            </IconButton>
        </template>
    </IoRowFrame>
</template>
