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
import ActionButton from './ActionButton.vue';
import { BUTTONS, STATE_ICONS } from './calaos-icons';
import IoRowFrame from './IoRowFrame.vue';
import BaseSlider from '../ui/BaseSlider.vue';
import ImageIcon from '../ui/ImageIcon.vue';
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
    <IoRowFrame :name="io.name" :status="io.status" :pending="isPending">
        <template #icon>
            <StateIcon
                :on="dimmer.on"
                :label="t(dimmer.on ? 'io.on' : 'io.off')"
            >
                <template #off><ImageIcon :src="STATE_ICONS.lightOff" /></template>
                <template #on><ImageIcon :src="STATE_ICONS.lightOn" /></template>
            </StateIcon>
        </template>
        <template #value>
            <span class="light-dimmer-io__reading">{{ dimmer.percent }}%</span>
        </template>

        <template #actions>
            <ActionButton
                :label="t('io.turnOn', { name: io.name })"
                :face="BUTTONS.lightOn"
                @click="set(ACTION_TRUE)"
            />
            <ActionButton
                :label="t('io.turnOff', { name: io.name })"
                :face="BUTTONS.lightOff"
                @click="set(ACTION_FALSE)"
            />
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
    /* Wide enough that 1% and 99% are different places to put a thumb. It
       shares the actions slot with two 44px buttons, and on a phone the three
       of them drop to a line of their own rather than shrinking (IoRowFrame):
       a 96px dimmer with 100 stops on it was a control in name only. */
    inline-size: 8rem;
}
</style>
