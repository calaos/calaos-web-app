<script setup lang="ts">
// `var_string` and `string_out` — a line of text the house keeps, and that
// this screen can rewrite.
//
// One component, two gui_types: the old app pointed both at VarStringCtrl and
// the two templates differed by nothing that mattered. The dispatch table
// keeps two keys so the protocol layer stays honest about there being two
// wire types, and the parser call below follows the discriminant rather than
// quietly picking one — `parseStringOut` delegates to `parseVarString` today,
// and if the server ever makes them differ this row already asks the right
// question.
//
// The empty-state rule is `StringInIo`'s, for the same reason: the parser
// falls back to the IO's NAME when the state is empty (old VarStringCtrl),
// which the old markup could print because its row had no name column. This
// row has one, so an empty IO shows its name ONCE, in the name column, and
// omits the value entirely.
//
// The edit button is a keyboard rather than a pencil because a keyboard is
// what happens: on the wall panel this is written for, pressing it puts the
// on-screen keyboard on the glass. (The old template gated the IMAGE inside
// the anchor rather than the anchor, leaving a live, empty tap target on a
// read-only row; the gate is on the button here.)
//
// `rw` gates it for `var_string` ONLY. A `string_out` is an output — there is
// no edit-mode flag to set on it and the server never sends one, so gating it
// on `rw` made every display in the house unwritable. calaos_mobile spells the
// same rule out in one line (IOVarString.qml): the keyboard button is
// `visible: (modelData.rw || modelData.ioType === Common.StringOut) &&
// modelData.ioType !== Common.StringIn`. `string_in` never reaches this
// component — it has StringInIo, which offers no action at all.

import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ActionButton from './ActionButton.vue';
import { BUTTONS, STATE_ICONS } from './calaos-icons';
import IoRowFrame from './IoRowFrame.vue';
import TextInputDialog from '../dialogs/TextInputDialog.vue';
import ImageIcon from '../ui/ImageIcon.vue';
import { useIo } from '../../composables/useIo';
import { parseStringOut, parseVarString, setText } from '../../protocol/io-states';
import type { IoItem } from '../../protocol/types';

const props = defineProps<{ io: IoItem }>();

const { t } = useI18n();
const { isPending, set } = useIo(() => props.io.id);

const display = computed(() =>
    props.io.guiType === 'string_out'
        ? parseStringOut(props.io.state, props.io.name).display
        : parseVarString(props.io.state, props.io.name).display,
);

/** False exactly when the parser fell back to the name, i.e. empty state. */
const hasValue = computed(() => props.io.state !== '');

/** A `string_out` is always writable; a `var_string` only in edit mode. */
const canEdit = computed(() => props.io.rw || props.io.guiType === 'string_out');

const dialogOpen = ref(false);

function confirmText(text: string): void {
    dialogOpen.value = false;
    // RAW, no prefix — the one IO type whose action value is not a verb.
    set(setText(text));
}
</script>

<template>
    <IoRowFrame :name="io.name" :status="io.status" :pending="isPending">
        <template #icon>
            <ImageIcon class="var-string-io__icon" :src="STATE_ICONS.text" />
        </template>

        <template v-if="hasValue" #value>
            <span class="var-string-io__text">{{ display }}</span>
        </template>

        <template v-if="canEdit" #actions>
            <ActionButton
                :label="t('io.setText', { name: io.name })"
                :face="BUTTONS.keyboard"
                @click="dialogOpen = true"
            />
        </template>
    </IoRowFrame>

    <!-- Seeded from the raw state, not from `display`: the name shown by an
         empty row is a placeholder, and pre-filling the field with it would
         make "confirm" write the label into the value. -->
    <TextInputDialog
        :open="dialogOpen"
        :text="io.state"
        :name="io.name"
        @confirm="confirmText"
        @cancel="dialogOpen = false"
    />
</template>

<style scoped>
.var-string-io__icon {
    color: var(--c-text-muted);
}

.var-string-io__text {
    /* The value IS the row here, so it gets the brighter reading colour. */
    color: var(--c-text);
}
</style>
