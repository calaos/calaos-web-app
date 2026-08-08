import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import SensorStatusBadge from './SensorStatusBadge.vue';
import batteryEmpty from '../../assets/io/icon_battery_empty.svg';
import battery25 from '../../assets/io/icon_battery_25.svg';
import battery75 from '../../assets/io/icon_battery_75.svg';
import batteryFull from '../../assets/io/icon_battery_full.svg';
import wifi100 from '../../assets/io/icon_wifi_100.svg';
import wifi25 from '../../assets/io/icon_wifi_25.svg';
import wifi50 from '../../assets/io/icon_wifi_50.svg';
import wifi75 from '../../assets/io/icon_wifi_75.svg';
import wifiOff from '../../assets/io/icon_wifi_off.svg';
import en from '../../i18n/en.json';
import { toIoStatusInfo } from '../../protocol/guards';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });

/** Mounts the badge from a raw wire `status_info`, guards included. */
function mountBadge(statusInfo: unknown) {
    return mount(SensorStatusBadge, {
        props: { status: toIoStatusInfo(statusInfo) },
        global: { plugins: [i18n] },
    });
}

/**
 * The artwork the badge chose.
 *
 * Compared against the imported asset itself rather than against a filename:
 * the test runner inlines small SVGs as `data:` URIs, so there is no basename
 * to read, and identity is the stronger assertion anyway.
 */
function artwork(wrapper: ReturnType<typeof mountBadge>): string | undefined {
    return wrapper.get('img').attributes('src');
}

describe('SensorStatusBadge', () => {
    it('renders nothing for an IO with no status at all', () => {
        // Which is nearly every IO in a wired house — a badge on all of them
        // would be noise on every row.
        expect(mountBadge(undefined).find('img').exists()).toBe(false);
    });

    it('renders nothing when the device reports neither battery nor signal', () => {
        // calaos_mobile shows a generic sensor dot here, but only because it
        // is a button opening a details sheet. There is no sheet here.
        expect(mountBadge({}).find('img').exists()).toBe(false);
        expect(mountBadge({ ip_address: '10.0.0.9' }).find('img').exists()).toBe(false);
    });

    // SensorStatusIcon.qml's exact ladder: low at <= 30, then 75 / 50 / 25.
    it.each([
        [100, batteryFull],
        [75, batteryFull],
        [74, battery75],
        [50, battery75],
        [49, battery25],
        [31, battery25],
        [30, batteryEmpty],
        [5, batteryEmpty],
    ])('draws a battery at %i percent with its matching artwork', (level, expected) => {
        expect(artwork(mountBadge({ battery_level: String(level) }))).toBe(expected);
    });

    it.each([
        [100, wifi100],
        [75, wifi100],
        [74, wifi75],
        [50, wifi75],
        [49, wifi50],
        [25, wifi50],
        [24, wifi25],
    ])('draws a signal at %i percent with its matching artwork', (signal, expected) => {
        expect(artwork(mountBadge({ wireless_signal: String(signal) }))).toBe(expected);
    });

    it('prefers the battery over the signal, as the reference client does', () => {
        const wrapper = mountBadge({ battery_level: '90', wireless_signal: '10' });

        expect(artwork(wrapper)).toBe(batteryFull);
    });

    it('lets "disconnected" win over a healthy battery', () => {
        // The battery reading of an unreachable sensor is whatever it last
        // said; showing it would hide the fact that nobody can hear it.
        const wrapper = mountBadge({ connected: 'false', battery_level: '90' });

        expect(artwork(wrapper)).toBe(wifiOff);
        expect(wrapper.get('img').attributes('alt')).toBe(en.io.status.disconnected);
    });

    it('says nothing special about a device that is simply connected', () => {
        expect(artwork(mountBadge({ connected: 'true', battery_level: '90' }))).toBe(batteryFull);
    });

    it('blinks for the two states worth interrupting for, and only those', () => {
        const urgent = ['sensor-status--urgent'];

        expect(mountBadge({ connected: 'false' }).get('img').classes()).toEqual(
            expect.arrayContaining(urgent),
        );
        expect(mountBadge({ battery_level: '10' }).get('img').classes()).toEqual(
            expect.arrayContaining(urgent),
        );
        expect(mountBadge({ battery_level: '90' }).get('img').classes()).not.toContain(
            'sensor-status--urgent',
        );
        expect(mountBadge({ wireless_signal: '20' }).get('img').classes()).not.toContain(
            'sensor-status--urgent',
        );
    });

    it('announces the reading rather than drawing it as text', () => {
        // The row already has a name, a value and its controls; a percentage
        // in that line would compete with the value the user came to read.
        const wrapper = mountBadge({ battery_level: '42' });

        expect(wrapper.text()).toBe('');
        expect(wrapper.get('img').attributes('alt')).toBe('Battery 42%');
    });
});
