<script setup lang="ts">
// `scenario` — a script the house runs. One button, no state.
//
// A scenario has no "on": `parseScenario` returns its name and that is the
// whole view model, because the state a scenario reports (`false`, always, in
// practice) says nothing a user could act on. So the row shows what it is and
// how to run it, and the only feedback is the pending dot while the server
// works — which is also the only feedback there IS, since running a scene
// changes other rows, not this one.
//
// The old template showed the play button whether or not `rw` was set; the
// gate is uniform here, like every other type.

import { useI18n } from 'vue-i18n';
import IconPlay from '~icons/mdi/play';
import IconScriptTextOutline from '~icons/mdi/script-text-outline';
import IoRowFrame from './IoRowFrame.vue';
import IconButton from '../ui/IconButton.vue';
import { useIo } from '../../composables/useIo';
import { ACTION_TRUE } from '../../protocol/io-states';
import type { IoItem } from '../../protocol/types';

const props = defineProps<{ io: IoItem }>();

const { t } = useI18n();
const { isPending, set } = useIo(() => props.io.id);
</script>

<template>
    <IoRowFrame :name="io.name" :status="io.status" :pending="isPending">
        <template #icon>
            <IconScriptTextOutline class="scenario-io__icon" aria-hidden="true" />
        </template>

        <template #actions>
            <IconButton :label="t('io.run', { name: io.name })" @click="set(ACTION_TRUE)">
                <IconPlay />
            </IconButton>
        </template>
    </IoRowFrame>
</template>

<style scoped>
.scenario-io__icon {
    color: var(--c-text-muted);
}
</style>
