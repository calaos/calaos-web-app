import { describe, expect, it } from 'vitest';
import {
    DEFAULT_LIGHT_STYLE,
    LIGHT_STYLES,
    resolveLightStyle,
} from './light-styles';

/**
 * The mapping calaos_mobile performs in `Common::IOTypeFromString`, style by
 * style. A `light` is only a lamp when the server does not say otherwise.
 */
const STYLES: [string, string][] = [
    ['outlet', 'outlet'],
    ['pump', 'pump'],
    ['heater', 'heater'],
    ['boiler', 'boiler'],
];

describe('resolveLightStyle', () => {
    it.each(STYLES)('maps io_style %s to the %s device', (ioStyle, key) => {
        expect(resolveLightStyle(ioStyle).key).toBe(key);
    });

    it('falls back to the lamp for an absent or unknown style', () => {
        // calaos_mobile's `IOTypeFromString` ends on `if (t == "light") return
        // Light;`, so anything it does not recognise is a plain light.
        expect(resolveLightStyle('')).toBe(DEFAULT_LIGHT_STYLE);
        expect(resolveLightStyle('disco_ball')).toBe(DEFAULT_LIGHT_STYLE);
        expect(DEFAULT_LIGHT_STYLE.key).toBe('light');
    });

    it('ignores case and surrounding space', () => {
        expect(resolveLightStyle(' Pump ').key).toBe('pump');
        expect(resolveLightStyle('OUTLET').key).toBe('outlet');
    });

    it('gives every style two distinct pieces of artwork', () => {
        for (const definition of [...Object.values(LIGHT_STYLES), DEFAULT_LIGHT_STYLE]) {
            expect(definition.imageOn, definition.key).toBeTruthy();
            expect(definition.imageOff, definition.key).toBeTruthy();
            // A device whose lit and resting pictures are the same file cannot
            // show its state at all.
            expect(definition.imageOn).not.toBe(definition.imageOff);
        }
    });

    it('gives the pump a still backdrop, because its lit artwork is only a rotor', () => {
        // IOPump.qml nests the rotor inside an IconItem showing `icon_pump_bg`.
        // Without it the row draws a small blade floating in an empty box.
        const pump = resolveLightStyle('pump');

        expect(pump.imageBackdrop).toBeTruthy();
        expect(pump.imageBackdrop).not.toBe(pump.imageOn);
        // Nothing else needs one: their artwork is the whole device.
        expect(resolveLightStyle('outlet').imageBackdrop).toBeUndefined();
        expect(DEFAULT_LIGHT_STYLE.imageBackdrop).toBeUndefined();
    });

    it('spins exactly the two devices that rotate in calaos_mobile', () => {
        // IOPump.qml and IOOutlet.qml drive a RotationAnimation; the heater
        // and the boiler do not.
        expect(resolveLightStyle('pump').spins).toBe(true);
        expect(resolveLightStyle('outlet').spins).toBe(true);
        expect(resolveLightStyle('heater').spins).toBe(false);
        expect(resolveLightStyle('boiler').spins).toBe(false);
        expect(DEFAULT_LIGHT_STYLE.spins).toBe(false);
    });
});
