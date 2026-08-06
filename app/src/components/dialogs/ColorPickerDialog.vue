<script setup lang="ts">
// Pick a colour for an RGB light.
//
// The contract is one line wide on purpose (docs/ARCHITECTURE.md): this
// component takes a `#rrggbb` in and emits a `#rrggbb` out, and NOTHING about
// the picker library leaks through it. The old app wrapped Farbtastic behind
// an `ng-farbtastic` directive and it still leaked — ColorPickerCtrl read
// `$scope.color` straight off the widget's model. Here the wrapper owns a
// plain hex string, normalises it on the way out, and swapping @ckpack for
// something else is a change to this file only.
//
// `Chrome` with alpha and the numeric fields turned off is the picker: a large
// saturation field over a hue bar, which is the only picker shape that works
// under a thumb. Alpha is meaningless for a lamp — the wire format is six hex
// digits — and the r/g/b/h/s/l input boxes are a desktop affordance nobody
// uses on a wall panel. The library's white card is restyled away entirely;
// its own colour chip is hidden because this dialog has a better preview.
//
// Design: the preview is not a paint chip. The thing being set is a LIGHT, so
// the swatch is a bar that BLOOMS in the chosen colour — the app's glow
// vocabulary (the lit bulb, the filament) turned up to say "this is what the
// room will look like". It is the one loud element; the picker under it is
// dark, flat and quiet.

import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Chrome } from '@ckpack/vue-color';
import BaseDialog from '../ui/BaseDialog.vue';

const props = withDefaults(
    defineProps<{
        open: boolean;
        /** Current colour, any hex spelling. Re-read every time it opens. */
        color: string;
        /** The IO's name, shown as the panel's eyebrow. Server data. */
        name?: string;
    }>(),
    { name: '' },
);

const emit = defineEmits<{
    /** Always exactly `#rrggbb`, lowercase. */
    confirm: [hex: string];
    cancel: [];
}>();

const { t } = useI18n();

/**
 * `#rrggbb`, lowercase, or `#000000` for anything unreadable.
 *
 * Both ends need this. Going in, `parseLightRgb` hands us the raw state, which
 * is `#000` for an off lamp and can be any string the server chose. Coming
 * out, @ckpack reports hex in UPPERCASE, and the wire format the old app sent
 * was whatever the widget produced — lowercase here, so `set #ff8800` is one
 * string and not two.
 */
function normalizeHex(value: string): string {
    const raw = value.trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{3}$/.test(raw)) {
        return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
    }
    if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`;
    return '#000000';
}

/** What the picker currently shows. Never written back to the IO by itself. */
const draft = ref(normalizeHex(props.color));

/**
 * What the widget STARTS from, which is deliberately not `draft`.
 *
 * Binding the live draft back into the picker looks tidier and is a trap: the
 * widget works in HSV, hex is a lossy round trip, and a colour with no
 * saturation has no hue to recover. Feeding our hex back on every drag would
 * reset the hue to red the moment the colour passed through grey or black —
 * and an off lamp opens this dialog at #000000 every time. So the widget owns
 * its own HSV for the length of a session and we only listen. It is remounted
 * on every open (BaseDialog renders its body only while open), which is what
 * makes seeding once enough.
 */
const seed = ref(draft.value);

const bloom = computed(() => `0 0 2.5rem ${draft.value}, 0 0 0.75rem ${draft.value}`);

// Re-seeded on open, not on every `color` change: the state can arrive from
// the server while the dialog is up (another client, a scenario), and having
// the field jump out from under a thumb mid-drag is worse than being stale.
watch(
    () => props.open,
    (open) => {
        if (!open) return;
        draft.value = normalizeHex(props.color);
        seed.value = draft.value;
    },
);

function onPick(payload: { hex: string }): void {
    draft.value = normalizeHex(payload.hex);
}

const picker = ref<HTMLElement | null>(null);

/**
 * Names the widget's hue bar.
 *
 * @ckpack renders it as a `<div role="slider">` with value attributes and no
 * accessible name, which is an ARIA input field with nothing to announce —
 * the one a11y defect the library brings in. It cannot be labelled from the
 * template because it is the library's own markup, so it is labelled here,
 * once, when the widget mounts. Nothing else about the picker is touched.
 */
function nameSliders(): void {
    picker.value?.querySelectorAll('[role="slider"]').forEach((node) => {
        node.setAttribute('aria-label', t('dialog.color.hue'));
    });
}
</script>

<template>
    <BaseDialog
        :open="open"
        :eyebrow="name"
        :title="t('dialog.color.title')"
        :confirm-label="t('dialog.color.confirm')"
        :cancel-label="t('dialog.cancel')"
        @confirm="emit('confirm', draft)"
        @cancel="emit('cancel')"
    >
        <div class="color-dialog__preview">
            <span
                class="color-dialog__lamp"
                :style="{ backgroundColor: draft, boxShadow: bloom }"
                aria-hidden="true"
            />
            <!-- The readout says exactly what will be sent, so it is the
                 accessible half of the pair and the bar above is decoration. -->
            <span class="color-dialog__hex">{{ draft }}</span>
        </div>

        <div ref="picker" class="color-dialog__picker">
            <Chrome
                :model-value="seed"
                :disable-alpha="true"
                :disable-fields="true"
                @vue:mounted="nameSliders"
                @update:model-value="onPick"
            />
        </div>
    </BaseDialog>
</template>

<style scoped>
.color-dialog__preview {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-block-end: var(--space-6);
}

.color-dialog__lamp {
    flex: 1;
    block-size: 2.25rem;
    border-radius: var(--radius-md);
    /* A hairline so a black lamp is still an object on a black panel. */
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
}

.color-dialog__hex {
    flex: none;
    font-size: 0.8125rem;
    letter-spacing: var(--tracking-wide);
    font-variant-numeric: tabular-nums;
    color: var(--c-text-muted);
}

/* ---- the library, undressed --------------------------------------------
   @ckpack ships its styles globally (a white 225px card with a Menlo stack
   and two drop shadows). Everything below is scoped-and-deep, so it can only
   ever reach the picker inside THIS dialog. */

.color-dialog__picker :deep(.vc-chrome) {
    inline-size: 100%;
    background: none;
    background-color: transparent;
    box-shadow: none;
    border-radius: 0;
    font-family: inherit;
}

.color-dialog__picker :deep(.vc-chrome-saturation-wrap) {
    /* Squarer than the library's 55%: the field is the control you actually
       aim at, and a thumb needs the height. */
    padding-block-end: 70%;
    border-radius: var(--radius-md);
}

.color-dialog__picker :deep(.vc-chrome-body) {
    padding: var(--space-4) 0 0;
    background-color: transparent;
}

/* The library's own colour chip. The bloom above says the same thing better. */
.color-dialog__picker :deep(.vc-chrome-color-wrap) {
    display: none;
}

.color-dialog__picker :deep(.vc-chrome-hue-wrap) {
    /* 10px is a mouse target; this is a wall panel. */
    block-size: 1.25rem;
    margin-block-end: 0;
}

.color-dialog__picker :deep(.vc-chrome-hue-wrap .vc-hue) {
    border-radius: var(--radius-sm);
}

.color-dialog__picker :deep(.vc-chrome-hue-wrap .vc-hue-picker) {
    inline-size: 1.25rem;
    block-size: 1.25rem;
    border-radius: 50%;
    transform: translate(-0.625rem, 0);
    margin-block-start: 0;
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);
}
</style>
