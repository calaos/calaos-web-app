<script setup lang="ts">
// The settings of one climate device: the dial with the room's temperature
// and the status inside it, the setpoint between − and +, the mode pill, and
// a way to the secondary settings. Shown in a side panel, or in a dialog on a
// narrow screen; this is the body of both.
//
// One way to set the target: the buttons. The dial is not draggable.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ActionButton from './ActionButton.vue';
import { BUTTONS } from './calaos-icons';
import ClimateDial from './ClimateDial.vue';
import { PAINT } from './climate-dial';
import IconChevronDown from '~icons/mdi/chevron-down';
import IconChevronRight from '~icons/mdi/chevron-right';
import { useClimateText } from '../../composables/useClimateText';
import { useMediaQuery } from '../../composables/useMediaQuery';
import type { UseClimate } from '../../composables/useClimate';
import { canAdjust, dialPaint } from '../../protocol/climate';
import { MODE_ICONS } from './climate-icons';
import type { IoItem } from '../../protocol/types';

const props = defineProps<{
    io: IoItem;
    ctl: UseClimate;
    /** Whether a second level of settings exists for this device. */
    hasMore: boolean;
    /** In a dialog that is as tall as its content: the link to more settings does not stick to the bottom. */
    compact?: boolean;
}>();

defineEmits<{ mode: []; more: [] }>();

const { t } = useI18n();
const text = useClimateText(props.ctl);

// A phone narrower than the dial would clip it.
const narrow = useMediaQuery('(max-width: 22.5rem)');

const status = computed(() => props.ctl.status.value);
const gating = computed(() => props.ctl.gating.value);
const bounds = computed(() => props.ctl.bounds.value);
const adjustable = computed(() => status.value !== undefined && canAdjust(status.value));
const offline = computed(() => status.value?.id === 'offline');
const paint = computed(() => (status.value ? dialPaint(status.value, props.ctl.mode.value) : undefined));
const wordColor = computed(() => (status.value ? PAINT[status.value.tone] : undefined));
const locked = computed(() => status.value?.id === 'lockout');
const modeIcon = computed(() => MODE_ICONS[props.ctl.mode.value] ?? MODE_ICONS['']);

const single = computed(() => gating.value?.setpoint === 'single');
const range = computed(() => gating.value?.setpoint === 'range');
// A half-known range cannot be edited: the server refuses a partial pair.
const rangeKnown = computed(() => props.ctl.low.value !== undefined && props.ctl.high.value !== undefined);

const atMin = computed(() => bounds.value !== undefined && props.ctl.single.value !== undefined && props.ctl.single.value <= bounds.value.min);
const atMax = computed(() => bounds.value !== undefined && props.ctl.single.value !== undefined && props.ctl.single.value >= bounds.value.max);
const lowAtMin = computed(() => bounds.value !== undefined && props.ctl.low.value !== undefined && props.ctl.low.value <= bounds.value.min);
const highAtMax = computed(() => bounds.value !== undefined && props.ctl.high.value !== undefined && props.ctl.high.value >= bounds.value.max);

const name = computed(() => props.io.name);
</script>

<template>
    <div class="climate-detail" :class="{ 'climate-detail--compact': compact }">
        <ClimateDial
            v-if="paint"
            :size="narrow ? 232 : 280"
            :stroke="8"
            :knob="12"
            :bounds="bounds"
            :setpoint="gating?.setpoint ?? 'none'"
            :target="ctl.single.value"
            :low="ctl.low.value"
            :high="ctl.high.value"
            :current="ctl.state.value?.currentTemp"
            :paint="paint"
        >
            <div v-if="text.room.value !== ''" class="climate-detail__room">{{ text.room.value }}</div>
            <div class="climate-detail__word" :style="{ color: wordColor }">{{ text.status.value }}</div>
            <div v-if="locked" class="climate-detail__gauge" aria-hidden="true">
                <i :style="{ inlineSize: `${Math.round(ctl.lockoutElapsed.value * 100)}%` }" />
            </div>
        </ClimateDial>

        <div v-if="bounds && single" class="climate-detail__line">
            <ActionButton
                :label="t('climate.lower', { name })"
                :face="BUTTONS.minus"
                :disabled="!adjustable || atMin"
                @click="ctl.nudge(-1)"
            />
            <output class="climate-detail__num" :class="{ 'climate-detail__num--dim': offline }">{{ text.setpoint.value }}</output>
            <ActionButton
                :label="t('climate.raise', { name })"
                :face="BUTTONS.plus"
                :disabled="!adjustable || atMax"
                @click="ctl.nudge(1)"
            />
        </div>

        <template v-else-if="bounds && range">
            <div class="climate-detail__line climate-detail__line--range">
                <div class="climate-detail__group">
                    <ActionButton
                        :label="t('climate.lowerLow', { name })"
                        :face="BUTTONS.minus"
                        :disabled="!adjustable || !rangeKnown || lowAtMin"
                        @click="ctl.nudgeRange('low', -1)"
                    />
                    <output class="climate-detail__num climate-detail__num--heat">{{ text.degrees(ctl.low.value) }}</output>
                    <ActionButton
                        :label="t('climate.raiseLow', { name })"
                        :face="BUTTONS.plus"
                        :disabled="!adjustable || !rangeKnown || ctl.rangeStop.value"
                        @click="ctl.nudgeRange('low', 1)"
                    />
                </div>
                <div class="climate-detail__group">
                    <ActionButton
                        :label="t('climate.lowerHigh', { name })"
                        :face="BUTTONS.minus"
                        :disabled="!adjustable || !rangeKnown || ctl.rangeStop.value"
                        @click="ctl.nudgeRange('high', -1)"
                    />
                    <output class="climate-detail__num climate-detail__num--cool">{{ text.degrees(ctl.high.value) }}</output>
                    <ActionButton
                        :label="t('climate.raiseHigh', { name })"
                        :face="BUTTONS.plus"
                        :disabled="!adjustable || !rangeKnown || highAtMax"
                        @click="ctl.nudgeRange('high', 1)"
                    />
                </div>
            </div>
            <p v-if="ctl.rangeStop.value" class="climate-detail__stop">
                {{ t('climate.rangeStop', { gap: text.degrees(bounds.minRange) }) }}
            </p>
        </template>

        <button
            type="button"
            class="climate-detail__pill"
            :disabled="offline"
            aria-haspopup="dialog"
            @click="$emit('mode')"
        >
            <component :is="modeIcon" class="climate-detail__pill-icon" aria-hidden="true" />
            <span>{{ text.modeLabel(ctl.mode.value) }}</span>
            <IconChevronDown class="climate-detail__pill-chevron" aria-hidden="true" />
        </button>

        <button v-if="hasMore" type="button" class="climate-detail__more" aria-haspopup="dialog" @click="$emit('more')">
            <span>{{ t('climate.more') }}</span>
            <IconChevronRight aria-hidden="true" />
        </button>
    </div>
</template>

<style scoped>
.climate-detail {
    display: flex;
    flex-direction: column;
    align-items: center;
}

.climate-detail__room {
    font-size: 1.375rem;
    font-weight: 300;
    white-space: nowrap;
}

.climate-detail__word {
    margin-block-start: 0.375rem;
    font-size: 1rem;
    font-weight: 500;
    white-space: nowrap;
}

.climate-detail__gauge {
    position: relative;
    inline-size: 8.75rem;
    block-size: 3px;
    margin: var(--space-2) auto 0;
    overflow: hidden;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.12);
}

.climate-detail__gauge i {
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    background: var(--c-warn);
}

.climate-detail__line {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    margin-block-start: var(--space-1);
}

.climate-detail__line--range {
    flex-wrap: wrap;
    gap: var(--space-2) 0.875rem;
}

.climate-detail__group {
    display: flex;
    align-items: center;
    gap: var(--space-1);
}

.climate-detail__num {
    min-inline-size: 9.375rem;
    font-size: 3.5rem;
    font-weight: 300;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    text-align: center;
    white-space: nowrap;
}

.climate-detail__line--range .climate-detail__num {
    min-inline-size: 5.5rem;
    font-size: 2.25rem;
}

.climate-detail__num--dim {
    color: var(--c-text-muted);
}

.climate-detail__num--heat {
    color: var(--c-heat);
}

.climate-detail__num--cool {
    color: var(--c-accent);
}

.climate-detail__stop {
    margin-block-start: var(--space-2);
    font-size: 0.8125rem;
    color: var(--c-text-muted);
    text-align: center;
}

.climate-detail__pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    block-size: 2.5rem;
    margin-block-start: var(--space-6);
    padding: 0 0.875rem 0 0.75rem;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--c-text);
    background: none;
    border: 1px solid var(--c-border-strong);
    border-radius: 999px;
    cursor: pointer;
    white-space: nowrap;
}

.climate-detail__pill:disabled {
    opacity: 0.45;
    cursor: default;
}

.climate-detail__pill-icon {
    font-size: 1.125rem;
}

.climate-detail__pill-chevron {
    font-size: 1.125rem;
    color: var(--c-text-muted);
}

.climate-detail__more {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    margin-block-start: auto;
    min-block-size: 2.75rem;
    padding: var(--space-4) var(--space-2) 0;
    font-size: 0.875rem;
    color: var(--c-text-muted);
    background: none;
    border: 0;
    cursor: pointer;
}

.climate-detail--compact .climate-detail__more {
    margin-block-start: 1.25rem;
    padding-block-start: 0;
}

.climate-detail__more:hover {
    color: var(--c-text);
}
</style>
