<script setup lang="ts">
// `shutter_smart` — a cover that also reports its own position.
//
// `parseShutterSmart` reads the `'up|down|stop <pct>'` wire state (the same
// prefix stripping as the old `ShutterCtrl`) and returns a NUMERIC percent
// (NaN → 0) plus `open ⇔ percent < 100`. That numeric compare is a deliberate
// fix over the old code, which parsed the percent with `parseInt` and then
// never used the result — it compared the raw STRING to `100` instead, so an
// unparseable percent (e.g. a bare `'down'` with no trailing number) fell
// through to a lexicographic compare that always read as closed
// (docs/ARCHITECTURE.md).
//
// The percent is shown as a reading (`.io-row__value`, tabular numerals so it
// does not jitter as it changes) alongside the same open/closed glyph pair a
// plain `shutter` uses, so the two types read as one family with an extra
// digit rather than two unrelated rows.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import IconArrowDownBold from '~icons/mdi/arrow-down-bold';
import IconArrowUpBold from '~icons/mdi/arrow-up-bold';
import IconStop from '~icons/mdi/stop';
import IconWindowShutter from '~icons/mdi/window-shutter';
import IconWindowShutterOpen from '~icons/mdi/window-shutter-open';
import IoRowFrame from './IoRowFrame.vue';
import IconButton from '../ui/IconButton.vue';
import StateIcon from '../ui/StateIcon.vue';
import { useIo } from '../../composables/useIo';
import { ACTION_DOWN, ACTION_STOP, ACTION_UP, parseShutterSmart } from '../../protocol/io-states';
import type { IoItem } from '../../protocol/types';

const props = defineProps<{ io: IoItem }>();

const { t } = useI18n();
const { isPending, set } = useIo(() => props.io.id);

const state = computed(() => parseShutterSmart(props.io.state));
</script>

<template>
    <IoRowFrame :name="io.name" :status="io.status" :pending="isPending">
        <template #icon>
            <StateIcon
                :on="state.open"
                :icon-off="IconWindowShutter"
                :icon-on="IconWindowShutterOpen"
                :label="t(state.open ? 'io.open' : 'io.closed')"
            />
        </template>

        <template #value>
            <span class="shutter-smart-io__percent">{{ state.percent }}%</span>
        </template>

        <template #actions>
            <IconButton :label="t('io.raise', { name: io.name })" @click="set(ACTION_UP)">
                <IconArrowUpBold />
            </IconButton>
            <IconButton :label="t('io.stop', { name: io.name })" @click="set(ACTION_STOP)">
                <IconStop />
            </IconButton>
            <IconButton :label="t('io.lower', { name: io.name })" @click="set(ACTION_DOWN)">
                <IconArrowDownBold />
            </IconButton>
        </template>
    </IoRowFrame>
</template>

<style scoped>
.shutter-smart-io__percent {
    color: var(--c-text);
}
</style>
