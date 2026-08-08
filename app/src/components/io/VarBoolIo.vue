<script setup lang="ts">
// `var_bool` — a flag on the server, shown as a flag.
//
// Same two verbs and the same two buttons as `light`, deliberately: "turn on"
// means one thing in this app and it is spelled one way. What differs is the
// glyph pair. A bulb would claim something is alight; a var_bool is a state
// of affairs ("Mode vacances"), so it gets a ring that fills with a check —
// the same footprint in both layers, which is what makes the crossfade read
// as one object changing rather than two icons swapping.
//
// A checkbox glyph would have been the literal descendant of the old
// `label.boolean` sprite, but a checkbox next to two real buttons invites a
// tap that does nothing. The circle pair states, it does not offer.
//
// The buttons ARE `rw`-gated, unlike a light's: `var_bool` is one of the three
// types the server actually sends `rw` for, and the old `var_bool.html` was
// the one template that checked it (docs/ARCHITECTURE.md "The `rw` flag").

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import IconCheckCircle from '~icons/mdi/check-circle';
import IconCircleOutline from '~icons/mdi/circle-outline';
// The same two action glyphs a light gets, for the same two verbs (see
// LightIo.vue).
import IconFlash from '~icons/mdi/flash';
import IconFlashOff from '~icons/mdi/flash-off';
import IoRowFrame from './IoRowFrame.vue';
import IconButton from '../ui/IconButton.vue';
import StateIcon from '../ui/StateIcon.vue';
import { useIo } from '../../composables/useIo';
import { ACTION_FALSE, ACTION_TRUE, parseVarBool } from '../../protocol/io-states';
import type { IoItem } from '../../protocol/types';

const props = defineProps<{ io: IoItem }>();

const { t } = useI18n();
const { isPending, set } = useIo(() => props.io.id);

const checked = computed(() => parseVarBool(props.io.state).checked);
</script>

<template>
    <IoRowFrame :name="io.name" :status="io.status" :pending="isPending">
        <template #icon>
            <StateIcon
                :on="checked"
                :icon-off="IconCircleOutline"
                :icon-on="IconCheckCircle"
                :label="t(checked ? 'io.on' : 'io.off')"
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
