import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import AnalogInIo from './AnalogInIo.vue';
import { ANALOG_STYLE_ICONS, resolveAnalogIcon } from './calaos-icons';
import { toIoItem } from '../../protocol/guards';
import type { WireIo } from '../../protocol/types';
import en from '../../i18n/en.json';

// The row frame carries a translated sensor badge, so every row needs the
// catalogue even when the row itself shows no text of its own.
const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });

function mountAnalog(wire: WireIo) {
    const io = toIoItem({
        id: 'input_2',
        gui_type: 'analog_in',
        visible: 'true',
        ...wire,
    });
    return mount(AnalogInIo, { props: { io }, global: { plugins: [i18n] } });
}

/**
 * The artwork the row drew. These are Calaos's own picture files now, not MDI
 * paths, so the `src` is what identifies one from another.
 */
function glyphPath(wrapper: ReturnType<typeof mountAnalog>): string {
    return wrapper.get('.io-row__lead img').attributes('src') ?? '';
}

describe('AnalogInIo', () => {
    it('shows the value with its unit, and without one when there is none', () => {
        expect(mountAnalog({ state: '412', unit: 'lux' }).get('.io-row__value').text()).toBe(
            '412 lux',
        );
        expect(mountAnalog({ state: '412' }).get('.io-row__value').text()).toBe('412');
    });

    it('draws the glyph the server asked for', () => {
        const humidity = mountAnalog({ state: '54', unit: '%', gui_style: 'humidity' });
        const temp = mountAnalog({ state: '21', unit: '°C', gui_style: 'temp' });

        expect(glyphPath(humidity)).not.toBe(glyphPath(temp));
        expect(glyphPath(humidity)).toBe(glyphPath(mountAnalog({ gui_style: 'humidity' })));
    });

    it('falls back to the default glyph for a missing or unknown gui_style', () => {
        // The old app built `images/icon_<gui_style>.png` and rendered a broken
        // image for anything it had no file for — including no style at all.
        const fallback = glyphPath(mountAnalog({ state: '1' }));

        expect(glyphPath(mountAnalog({ state: '1', gui_style: '' }))).toBe(fallback);
        expect(glyphPath(mountAnalog({ state: '1', gui_style: 'no_such_style' }))).toBe(fallback);
        expect(glyphPath(mountAnalog({ state: '1', gui_style: 'default' }))).toBe(fallback);
    });

    it('offers nothing to press: an input has no verb', () => {
        expect(mountAnalog({ state: '412', unit: 'lux' }).findAll('button')).toHaveLength(0);
    });
});

describe('io_style icons', () => {
    it('covers every style the old app shipped an icon file for', () => {
        // src/images/icon_*.png, the only record of which styles the AngularJS
        // app could draw.
        for (const style of ['default', 'analog', 'temp', 'humidity', 'int', 'text']) {
            expect(ANALOG_STYLE_ICONS[style], style).toBeDefined();
        }
    });

    it('covers the styles calaos_mobile draws that the old web app could not', () => {
        // IOAnalogStyled.qml builds `icon_<io_style>` at runtime, so its set is
        // the set of files that ship in calaos_mobile's img/.
        for (const style of ['luminosity', 'pressure', 'voltage', 'current', 'watt', 'speed']) {
            expect(ANALOG_STYLE_ICONS[style], style).toBeDefined();
        }
    });

    it('special-cases `temperature` onto the thermometer, as calaos_mobile does', () => {
        expect(resolveAnalogIcon('temperature')).toBe(resolveAnalogIcon('temp'));
    });

    it('is total — anything unmapped resolves to the default dial', () => {
        expect(resolveAnalogIcon('')).toBe(ANALOG_STYLE_ICONS.default);
        expect(resolveAnalogIcon('nonsense')).toBe(ANALOG_STYLE_ICONS.default);
    });
});
