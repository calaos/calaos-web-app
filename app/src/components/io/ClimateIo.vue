<script setup lang="ts">
// `climate` — one widget for the whole device family, drawn only from the
// `device` object: which controls exist is `capabilities`, what they show is
// `state`. Nothing here knows about proxies or thermostats.
//
// The row only reads: a mini dial, the name, the setpoint, the room's
// temperature and a status. Tapping it opens the settings — a side panel on
// a wide screen, a centred dialog below 1024 px — and the mode and the
// secondary settings open in dialogs of their own on top. The commands and
// the "not optimistic" rules live in useClimate.

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import IconThermostat from '~icons/mdi/thermostat';
import IconChevronRight from '~icons/mdi/chevron-right';
import IconClose from '~icons/mdi/close';
import ClimateDetail from './ClimateDetail.vue';
import ClimateDial from './ClimateDial.vue';
import ClimateModeDialog from './ClimateModeDialog.vue';
import ClimateMoreDialog from './ClimateMoreDialog.vue';
import { PAINT } from './climate-dial';
import IoRowFrame from './IoRowFrame.vue';
import BaseDialog from '../ui/BaseDialog.vue';
import IconButton from '../ui/IconButton.vue';
import { useClimate } from '../../composables/useClimate';
import { useClimateText } from '../../composables/useClimateText';
import { closeClimate, openClimate, openClimateId } from '../../composables/useClimatePanel';
import { useMediaQuery } from '../../composables/useMediaQuery';
import { dialPaint } from '../../protocol/climate';
import { useHomeStore } from '../../stores/home';
import type { IoItem } from '../../protocol/types';

const props = defineProps<{ io: IoItem }>();

const { t, te } = useI18n();
const home = useHomeStore();
const ctl = useClimate(() => props.io);
const text = useClimateText(ctl);

const device = ctl.device;
const status = ctl.status;
const paint = computed(() => (status.value ? dialPaint(status.value, ctl.mode.value) : undefined));
const statusColor = computed(() => (status.value ? PAINT[status.value.tone] : undefined));

// The side panel needs 460 px next to a row list that is at least 532 px wide.
const wide = useMediaQuery('(min-width: 64rem)');

const isOpen = computed(() => openClimateId.value === props.io.id);
const roomName = computed(() => home.rooms.find((room) => room.ioIds.includes(props.io.id))?.name ?? '');

const hasMore = computed(
    () =>
        (ctl.caps.value?.fanModes?.length ?? 0) > 0 ||
        (ctl.caps.value?.swingModes?.length ?? 0) > 0 ||
        ctl.state.value?.humidity !== undefined,
);

// ------------------------------------------------------- open and close ---

const modeOpen = ref(false);
const moreOpen = ref(false);
const panel = ref<HTMLElement | null>(null);
let opener: HTMLElement | null = null;

function open() {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openClimate(props.io.id);
}

function close() {
    modeOpen.value = false;
    moreOpen.value = false;
    closeClimate(props.io.id);
}

// The dialog restores focus itself; the panel is not modal and does it here.
watch(isOpen, async (now, was) => {
    if (now && wide.value) {
        await nextTick();
        panel.value?.focus();
    } else if (was && !now) {
        modeOpen.value = false;
        moreOpen.value = false;
        if (wide.value) opener?.focus();
        opener = null;
    }
});

// The room can go away under an open panel (navigation, the device vanishing).
onBeforeUnmount(() => closeClimate(props.io.id));
watch(device, (d) => {
    if (d === undefined) close();
});

function onPanelKeydown(event: KeyboardEvent) {
    // A dialog on top owns Escape; it stops the event before it reaches here.
    if (event.key === 'Escape') close();
}

function choose(mode: string) {
    ctl.selectMode(mode);
    modeOpen.value = false;
}

const modeChoices = computed(() => ctl.modes.value.map((value) => ({ value, label: text.modeLabel(value) })));

/** The server's own value stays on screen when this client has no word for it. */
const fanChoices = computed(() => withCurrent(ctl.caps.value?.fanModes, ctl.fan.value).map((v) => ({ value: v, label: optionLabel(v) })));
const swingChoices = computed(() => withCurrent(ctl.caps.value?.swingModes, ctl.swing.value).map((v) => ({ value: v, label: swingLabel(v) })));

function withCurrent(list: string[] | undefined, current: string): string[] {
    const base = list ?? [];
    return current !== '' && !base.includes(current) ? [...base, current] : base;
}

const optionLabel = (value: string) => (te(`climate.option.${value}`) ? t(`climate.option.${value}`) : value);
const swingLabel = (value: string) => (te(`climate.swingOption.${value}`) ? t(`climate.swingOption.${value}`) : optionLabel(value));
</script>

<template>
    <IoRowFrame
        class="climate-io"
        :name="io.name"
        :status="io.status"
        :pending="ctl.isPending.value"
        :opens="device !== undefined"
        :expanded="isOpen"
        @open="open"
    >
        <template #icon>
            <ClimateDial
                v-if="device && paint"
                mini
                :size="28"
                :stroke="3"
                :knob="3"
                :bounds="ctl.bounds.value"
                :setpoint="ctl.gating.value?.setpoint ?? 'none'"
                :target="ctl.single.value"
                :low="ctl.low.value"
                :high="ctl.high.value"
                :current="ctl.state.value?.currentTemp"
                :paint="paint"
            />
            <IconThermostat v-else class="climate-io__icon" aria-hidden="true" />
        </template>

        <template #value>
            <template v-if="device">
                <span v-if="text.setpoint.value !== ''" class="climate-io__set">{{ text.setpoint.value }}</span>
                <template v-if="text.room.value !== ''">
                    <span v-if="text.setpoint.value !== ''" class="climate-io__dot" aria-hidden="true">·</span>
                    <span>{{ text.room.value }}</span>
                </template>
            </template>
            <span v-else>{{ io.state }}</span>
        </template>

        <template v-if="device" #actions>
            <span class="climate-io__status" :style="{ color: statusColor }">{{ text.statusShort.value }}</span>
            <IconChevronRight class="climate-io__chevron" aria-hidden="true" />
        </template>
    </IoRowFrame>

    <Teleport v-if="device && isOpen && wide" to="body">
        <section
            ref="panel"
            class="climate-panel fade-in"
            tabindex="-1"
            :aria-label="t('climate.settings', { name: io.name })"
            @keydown="onPanelKeydown"
        >
            <header class="climate-panel__head">
                <div class="climate-panel__titles">
                    <p v-if="roomName !== ''" class="climate-panel__eyebrow">{{ roomName }}</p>
                    <h2 class="climate-panel__name">{{ io.name }}</h2>
                </div>
                <IconButton :label="t('climate.close')" @click="close">
                    <IconClose />
                </IconButton>
            </header>
            <ClimateDetail :io="io" :ctl="ctl" :has-more="hasMore" @mode="modeOpen = true" @more="moreOpen = true" />
        </section>
    </Teleport>

    <BaseDialog
        v-if="device"
        :open="isOpen && !wide"
        wide
        :eyebrow="roomName"
        :title="io.name"
        @cancel="close"
    >
        <IconButton class="climate-dialog__close" data-autofocus :label="t('climate.close')" @click="close">
            <IconClose />
        </IconButton>
        <ClimateDetail compact :io="io" :ctl="ctl" :has-more="hasMore" @mode="modeOpen = true" @more="moreOpen = true" />
    </BaseDialog>

    <ClimateModeDialog
        v-if="device"
        :open="modeOpen"
        :eyebrow="io.name"
        :modes="modeChoices"
        :current="ctl.mode.value"
        @choose="choose"
        @close="modeOpen = false"
    />

    <ClimateMoreDialog
        v-if="device"
        :open="moreOpen"
        :eyebrow="io.name"
        :fan-modes="ctl.caps.value?.fanModes ? fanChoices : undefined"
        :fan="ctl.fan.value"
        :swing-modes="ctl.caps.value?.swingModes ? swingChoices : undefined"
        :swing="ctl.swing.value"
        :humidity="ctl.state.value?.humidity"
        @fan="ctl.setOption('fan_mode', $event)"
        @swing="ctl.setOption('swing_mode', $event)"
        @close="moreOpen = false"
    />
</template>

<style scoped>
.climate-io__icon {
    color: var(--c-text-muted);
}

/* The row's own value slot caps at 45%: a setpoint range and the room's
   temperature are the point of this row. */
.climate-io :deep(.io-row__value) {
    max-inline-size: none;
}

.climate-io__set {
    font-size: 1.0625rem;
    color: var(--c-heat);
}

.climate-io__dot {
    margin-inline: 0.375rem;
}

.climate-io__status {
    min-inline-size: 4.5rem;
    font-size: 0.8125rem;
    text-align: end;
    white-space: nowrap;
}

.climate-io__chevron {
    margin-inline-start: var(--space-1);
    font-size: 1.125rem;
    color: var(--c-text-muted);
    transition: color 160ms ease;
}

.climate-io:hover .climate-io__chevron,
.climate-io[aria-expanded='true'] .climate-io__chevron {
    color: var(--c-text);
}

/* Between the bars, beside the room: the room view makes the space
   (RoomView `room--panel`). */
.climate-panel {
    position: fixed;
    z-index: 50;
    inset-block: calc(var(--h-navbar) + var(--space-4)) calc(var(--h-footer) + var(--space-4));
    inset-inline-end: var(--space-4);
    inline-size: 28.75rem;
    display: flex;
    flex-direction: column;
    padding: 1.25rem var(--space-6);
    overflow-y: auto;
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
}

.climate-panel:focus-visible {
    outline: none;
}

.climate-panel :deep(.climate-detail) {
    flex: 1;
}

.climate-panel__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-block-end: var(--space-2);
}

.climate-panel__eyebrow {
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-muted);
}

.climate-panel__name {
    margin-block-start: 0.125rem;
    font-size: 1.375rem;
    font-weight: 400;
    line-height: 1.2;
}

.climate-dialog__close {
    position: absolute;
    inset-block-start: var(--space-4);
    inset-inline-end: var(--space-4);
}
</style>
