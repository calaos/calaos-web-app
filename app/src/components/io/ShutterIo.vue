<script setup lang="ts">
// `shutter` — a plain up/stop/down cover with no reported position.
//
// The old `shutter.html` template was shared by both `shutter` and
// `shutter_smart` gui_types behind one `ShutterCtrl`, deciding at runtime
// which of two incompatible parses applied to `item.state`. Splitting the
// controller in two here removes that runtime branch: this component only
// ever sees a plain shutter, whose entire state is the boolean `parseShutter`
// returns (open ⇔ `state === 'true'`, exactly like `light`/`var_bool`).
//
// The three buttons are the old `.action_button` trio — `up`/`stop`/`down` —
// sent verbatim as `set_state` values, gated uniformly by `rw` like every
// other row (docs/ARCHITECTURE.md; the old template showed them regardless
// of `rw`).

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
import { ACTION_DOWN, ACTION_STOP, ACTION_UP, parseShutter } from '../../protocol/io-states';
import type { IoItem } from '../../protocol/types';

const props = defineProps<{ io: IoItem }>();

const { t } = useI18n();
// A getter, not the raw string: the row is re-used across route changes and
// the id it watches must follow the prop.
const { isPending, set } = useIo(() => props.io.id);

const open = computed(() => parseShutter(props.io.state).open);
</script>

<template>
    <IoRowFrame :name="io.name" :pending="isPending">
        <template #icon>
            <StateIcon
                :on="open"
                :icon-off="IconWindowShutter"
                :icon-on="IconWindowShutterOpen"
                :label="t(open ? 'io.open' : 'io.closed')"
            />
        </template>

        <template v-if="io.rw" #actions>
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
