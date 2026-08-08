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
import ActionButton from './ActionButton.vue';
import { BUTTONS, STATE_ICONS } from './calaos-icons';
import IoRowFrame from './IoRowFrame.vue';
import ImageIcon from '../ui/ImageIcon.vue';
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
    <IoRowFrame :name="io.name" :status="io.status" :pending="isPending">
        <template #icon>
            <StateIcon
                :on="open"
                :label="t(open ? 'io.open' : 'io.closed')"
            >
                <template #off><ImageIcon :src="STATE_ICONS.shutterOff" /></template>
                <template #on><ImageIcon :src="STATE_ICONS.shutterOn" /></template>
            </StateIcon>
        </template>

        <template #actions>
            <ActionButton
                :label="t('io.raise', { name: io.name })"
                :face="BUTTONS.up"
                @click="set(ACTION_UP)"
            />
            <ActionButton
                :label="t('io.stop', { name: io.name })"
                :face="BUTTONS.stop"
                @click="set(ACTION_STOP)"
            />
            <ActionButton
                :label="t('io.lower', { name: io.name })"
                :face="BUTTONS.down"
                @click="set(ACTION_DOWN)"
            />
        </template>
    </IoRowFrame>
</template>
