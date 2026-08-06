<script setup lang="ts">
// `light_dimmer` — a light with a level, not just a state.
//
// The glyph and the two boundary verbs are `LightIo`'s, unchanged: a dimmer
// at 1% is still visibly "on" (see StateIcon), and `true`/`false` still mean
// "go to full" / "go dark" — exactly what the old `LightDimmerCtrl`'s top two
// buttons sent. What is new is the third control: a slider whose only wire
// action is a single `set N`, sent once, on release (see BaseSlider.vue) —
// not the old template's mouse-only `ng-mouseup`, and not a message per pixel
// dragged.
//
// `parseLightDimmer` is the read side: it turns whatever the server last
// reported — a bare number, a `'set N'` echo, or the boundary states
// `true`/`false` — into the percent this row shows. That percent is always
// the SERVER's, never the value the user is mid-drag on (see LightIo.vue for
// why nothing here is optimistic) — the slider's own thumb is the only place
// a live drag is visible before the server confirms it.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import IconFlash from '~icons/mdi/flash';
import IconFlashOff from '~icons/mdi/flash-off';
import IconLightbulbOn from '~icons/mdi/lightbulb-on';
import IconLightbulbOutline from '~icons/mdi/lightbulb-outline';
import IoRowFrame from './IoRowFrame.vue';
import BaseSlider from '../ui/BaseSlider.vue';
import IconButton from '../ui/IconButton.vue';
import StateIcon from '../ui/StateIcon.vue';
import { useIo } from '../../composables/useIo';
import {
    ACTION_FALSE,
    ACTION_TRUE,
    parseLightDimmer,
    setPercent,
} from '../../protocol/io-states';
import type { IoItem } from '../../protocol/types';

const props = defineProps<{ io: IoItem }>();

const { t } = useI18n();
const { isPending, set } = useIo(() => props.io.id);

const dimmer = computed(() => parseLightDimmer(props.io.state));

function commitPercent(percent: number) {
    set(setPercent(percent));
}
</script>

<template>
    <IoRowFrame :name="io.name" :pending="isPending">
        <template #icon>
            <StateIcon
                :on="dimmer.on"
                :icon-off="IconLightbulbOutline"
                :icon-on="IconLightbulbOn"
                :label="t(dimmer.on ? 'io.on' : 'io.off')"
            />
        </template>
        <template #value>
            <span class="light-dimmer-io__reading">{{ dimmer.percent }}%</span>
        </template>

        <template v-if="io.rw" #actions>
            <IconButton :label="t('io.turnOn', { name: io.name })" @click="set(ACTION_TRUE)">
                <IconFlash />
            </IconButton>
            <IconButton :label="t('io.turnOff', { name: io.name })" @click="set(ACTION_FALSE)">
                <IconFlashOff />
            </IconButton>
            <BaseSlider
                class="light-dimmer-io__slider"
                :model-value="dimmer.percent"
                :label="t('io.brightness', { name: io.name })"
                @commit="commitPercent"
            />
        </template>
    </IoRowFrame>
</template>

<style scoped>
.light-dimmer-io__reading {
    color: var(--c-text);
}

.light-dimmer-io__slider {
    /* Compact: it shares the actions slot with two 40px buttons, and the
       row's name column is what should give way on a narrow screen, not
       this. */
    inline-size: 6rem;
}
</style>
