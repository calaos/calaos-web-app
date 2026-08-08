import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import AnalogInIo from './AnalogInIo.vue';
import { IO_STYLE_ICONS, resolveIoStyleIcon } from './io-style-icons';
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

/** The `d` of the rendered glyph — how one MDI icon is told from another. */
function glyphPath(wrapper: ReturnType<typeof mountAnalog>): string {
    return wrapper.get('.io-row__lead path').attributes('d') ?? '';
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

describe('io-style icons', () => {
    it('covers every style the old app shipped an icon file for', () => {
        // src/images/icon_*.png, which is the only record of which styles a
        // calaos_server actually sends.
        for (const style of ['default', 'analog', 'temp', 'humidity', 'int', 'text']) {
            expect(IO_STYLE_ICONS[style]).toBeDefined();
        }
    });

    it('gives analog and default the same glyph, as the old icon files did', () => {
        // icon_analog.png and icon_default.png were byte-identical.
        expect(resolveIoStyleIcon('analog')).toBe(resolveIoStyleIcon('default'));
    });

    it('is total — anything unmapped resolves to the default glyph', () => {
        expect(resolveIoStyleIcon('')).toBe(IO_STYLE_ICONS.default);
        expect(resolveIoStyleIcon('nonsense')).toBe(IO_STYLE_ICONS.default);
    });
});
