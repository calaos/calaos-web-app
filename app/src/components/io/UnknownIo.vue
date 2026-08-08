<script setup lang="ts">
// The row for anything this app cannot draw properly — in two roles.
//
//  1. `gui_type: 'unknown'`: the server sent a type this version has never
//     heard of. The old app printed "TEMPLATE TO BE DONE : <type>" into the
//     room, in English, to whoever happened to be standing at the wall panel.
//     Here the row behaves like every other one — glyph, name, value — and the
//     type the server used goes in the frame's eyebrow, where it is useful to
//     the installer reading it and inert to everyone else.
//
//  2. The scaffold for gui_types whose real component has not landed yet
//     (T11–T13; see the dispatch table in IoRow.vue). Those ARE known types,
//     so they get no eyebrow: name and raw state, quietly, until their own
//     component replaces this one in the table.
//
// Neither role offers an action. Guessing what verb an unknown IO takes is how
// you switch off a boiler by accident.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import IconHelpCircleOutline from '~icons/mdi/help-circle-outline';
import IconTuneVariant from '~icons/mdi/tune-variant';
import IoRowFrame from './IoRowFrame.vue';
import { resolveAnalogIcon } from './calaos-icons';
import ImageIcon from '../ui/ImageIcon.vue';
import type { IoItem } from '../../protocol/types';

const props = defineProps<{ io: IoItem }>();

const { t } = useI18n();

/** Role 1 (a type we do not know) as opposed to role 2 (one not built yet). */
const isUnknownType = computed(() => props.io.guiType === 'unknown');

// An `io_style` is the server's own hint about what the thing measures, and
// it is worth more than any fallback — so it wins in both roles, and it comes
// from Calaos's own artwork.
const styleIcon = computed(() =>
    props.io.ioStyle !== '' ? resolveAnalogIcon(props.io.ioStyle) : null,
);

// Without one, an unknown type says so, and a not-yet-built one shows a
// neutral control glyph rather than accusing a perfectly valid shutter of
// being a mystery. These two have no Calaos equivalent — they describe THIS
// app's confusion, not a device — so they stay MDI.
const fallbackIcon = computed(() =>
    isUnknownType.value ? IconHelpCircleOutline : IconTuneVariant,
);

/** The server's own word for the type, or ours when it did not send one. */
const note = computed(() => {
    // Narrowed here rather than through `isUnknownType`: `rawGuiType` exists
    // on the unknown member of the union only.
    if (props.io.guiType !== 'unknown') return '';
    return props.io.rawGuiType !== '' ? props.io.rawGuiType : t('io.unknownType');
});
</script>

<template>
    <IoRowFrame :name="io.name" :status="io.status" :note="note">
        <template #icon>
            <ImageIcon v-if="styleIcon !== null" class="unknown-io__icon" :src="styleIcon" />
            <component :is="fallbackIcon" v-else class="unknown-io__icon" aria-hidden="true" />
        </template>
        <template v-if="io.state !== ''" #value>
            <span class="unknown-io__state">{{ io.state }}</span>
        </template>
    </IoRowFrame>
</template>

<style scoped>
.unknown-io__icon {
    color: var(--c-text-muted);
}

.unknown-io__state {
    /* Raw wire text, not a reading: it stays in the muted value colour the
       frame gives it, and is monospaced so `up 100` and `#ff2200` read as the
       machine strings they are. */
    font-family: ui-monospace, 'SFMono-Regular', 'Menlo', monospace;
    font-size: 0.8125rem;
}
</style>
