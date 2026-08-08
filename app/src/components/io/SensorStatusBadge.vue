<script setup lang="ts">
// Battery, signal, reachability — the little badge on a row whose IO is a
// device rather than a wire.
//
// A port of calaos_mobile's SensorStatusIcon.qml, including its priority
// order, its thresholds and its artwork (app/src/assets/io/, copied from
// calaos/calaos_mobile — both projects are Calaos GPL):
//
//     disconnected            -> wifi_off,        blinking
//     battery <= 30           -> battery_empty,   blinking
//     battery  > 30           -> battery_full/75/25 by 75/50/25
//     wireless signal present -> wifi_100/75/50/25 by 75/50/25
//     otherwise               -> nothing
//
// Two deliberate differences from the reference client:
//
//  1. It renders NOTHING when the IO reports no battery and no signal.
//     calaos_mobile shows a generic `icon_sensor` for that case, but it does so
//     as a tappable button opening a details sheet; with no such sheet here, a
//     grey dot on every zigbee row would be decoration that says nothing.
//  2. The blink is a real `aria-label` too, not just an animation: "battery
//     low" and "disconnected" are the two states worth interrupting for, and a
//     blinking picture is invisible to a screen reader.
//
// The reading is announced rather than drawn as text: a row already carries a
// name, a value and its controls, and a percentage in that line would compete
// with the value the user came to read.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import batteryEmpty from '../../assets/io/icon_battery_empty.svg';
import battery25 from '../../assets/io/icon_battery_25.svg';
import battery75 from '../../assets/io/icon_battery_75.svg';
import batteryFull from '../../assets/io/icon_battery_full.svg';
import wifi100 from '../../assets/io/icon_wifi_100.svg';
import wifi25 from '../../assets/io/icon_wifi_25.svg';
import wifi50 from '../../assets/io/icon_wifi_50.svg';
import wifi75 from '../../assets/io/icon_wifi_75.svg';
import wifiOff from '../../assets/io/icon_wifi_off.svg';
import ImageIcon from '../ui/ImageIcon.vue';
import type { IoStatusInfo } from '../../protocol/types';

const props = defineProps<{ status: IoStatusInfo | null }>();

const { t } = useI18n();

/** calaos_mobile's threshold: at or below this the battery is "low". */
const BATTERY_LOW = 30;

interface Badge {
    image: string;
    label: string;
    /** Low battery and lost connection blink, as in the reference client. */
    urgent: boolean;
}

const badge = computed<Badge | null>(() => {
    const status = props.status;
    if (status === null) return null;

    // Priority order is calaos_mobile's, and it matters: a disconnected sensor
    // still reports whatever battery level it last had, and showing that
    // stale-but-healthy battery would hide the fact that it is unreachable.
    if (status.connected === false) {
        return { image: wifiOff, label: t('io.status.disconnected'), urgent: true };
    }

    const battery = status.batteryLevel;
    if (battery !== null) {
        const label = t('io.status.battery', { percent: battery });
        if (battery <= BATTERY_LOW) return { image: batteryEmpty, label, urgent: true };
        if (battery >= 75) return { image: batteryFull, label, urgent: false };
        if (battery >= 50) return { image: battery75, label, urgent: false };
        return { image: battery25, label, urgent: false };
    }

    const signal = status.wirelessSignal;
    if (signal !== null) {
        const label = t('io.status.signal', { percent: signal });
        if (signal >= 75) return { image: wifi100, label, urgent: false };
        if (signal >= 50) return { image: wifi75, label, urgent: false };
        if (signal >= 25) return { image: wifi50, label, urgent: false };
        return { image: wifi25, label, urgent: false };
    }

    return null;
});
</script>

<template>
    <ImageIcon
        v-if="badge !== null"
        class="sensor-status"
        :class="{ 'sensor-status--urgent': badge.urgent }"
        :src="badge.image"
        :alt="badge.label"
    />
</template>

<style scoped>
.sensor-status {
    flex: none;
    font-size: 1.125rem;
    /* Held back: this is context about the device, not about the room. It is
       the one thing on the row the user is not looking for — until it blinks. */
    opacity: 0.75;
}

.sensor-status--urgent {
    opacity: 1;
    animation: sensor-status-blink 1600ms ease-in-out infinite;
}

/* calaos_mobile blinks 1.0 -> 0.3 -> 1.0 over 800ms each way. */
@keyframes sensor-status-blink {
    0%,
    100% {
        opacity: 1;
    }
    50% {
        opacity: 0.3;
    }
}

@media (prefers-reduced-motion: reduce) {
    .sensor-status--urgent {
        animation: none;
    }
}
</style>
