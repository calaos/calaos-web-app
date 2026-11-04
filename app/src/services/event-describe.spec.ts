import { describe, expect, it } from 'vitest';
import { describeEvent } from './event-describe';
import type { EventLogEvent } from '../protocol/eventlog';

function event(patch: Partial<EventLogEvent>): EventLogEvent {
    return { id: 'e', eventType: '3', ioId: 'io_1', ioState: 'true', picUid: '', at: 0, raw: {}, ...patch };
}

const LIGHT = { name: 'Lamp', guiType: 'light', room: 'Kitchen' };

describe('describeEvent', () => {
    it('names the IO and its room, with On/Off for a light', () => {
        expect(describeEvent(event({}), LIGHT)).toMatchObject({
            kind: 'io',
            ioName: 'Lamp',
            room: 'Kitchen',
            actionKey: 'events.action.on',
        });
        expect(describeEvent(event({ ioState: 'false' }), LIGHT).actionKey).toBe('events.action.off');
    });

    it('reads a dimmer by its level', () => {
        const dimmer = { ...LIGHT, guiType: 'light_dimmer' };
        expect(describeEvent(event({ ioState: '40' }), dimmer).actionKey).toBe('events.action.on');
        expect(describeEvent(event({ ioState: '0' }), dimmer).actionKey).toBe('events.action.off');
    });

    it('opened/closed for a shutter, started for a scenario, nothing for the rest', () => {
        const shutter = { ...LIGHT, guiType: 'shutter' };
        expect(describeEvent(event({}), shutter).actionKey).toBe('events.action.opened');
        expect(describeEvent(event({ ioState: 'false' }), shutter).actionKey).toBe('events.action.closed');
        expect(describeEvent(event({}), { ...LIGHT, guiType: 'scenario' }).actionKey).toBe('events.action.started');
        expect(describeEvent(event({}), { ...LIGHT, guiType: 'var_int' }).actionKey).toBe('');
    });

    it('computes the action and icon for any event type once the IO resolves (mobile parity)', () => {
        const push = describeEvent(event({ eventType: '22', ioState: 'true', raw: { message: 'x' } }), LIGHT);
        expect(push).toMatchObject({ kind: 'push', ioName: 'Lamp', actionKey: 'events.action.on', icon: 'lightOn' });
        const unknown = describeEvent(event({ eventType: '99', ioState: 'false' }), LIGHT);
        expect(unknown).toMatchObject({ kind: 'unknown', actionKey: 'events.action.off', icon: 'lightOff' });
    });

    it('keeps the bell for a push whose IO does not resolve', () => {
        expect(describeEvent(event({ eventType: '22' }), null).icon).toBe('push');
    });

    it('treats a binary light as on only for "true", a dimmable one above 0', () => {
        expect(describeEvent(event({ ioState: '40' }), LIGHT).actionKey).toBe('events.action.off');
    });

    it('picks the icon by IO type and carries the light style', () => {
        expect(describeEvent(event({}), { ...LIGHT, guiType: 'temp' })).toMatchObject({ icon: 'temp', actionKey: 'events.action.tempChanged' });
        expect(describeEvent(event({}), { ...LIGHT, guiType: 'shutter_smart' }).icon).toBe('shutterOn');
        expect(describeEvent(event({ ioState: 'false' }), { ...LIGHT, guiType: 'shutter' }).icon).toBe('shutterOff');
        expect(describeEvent(event({}), { ...LIGHT, guiType: 'scenario' }).icon).toBe('scenario');
        expect(describeEvent(event({}), { ...LIGHT, ioStyle: 'outlet' }).ioStyle).toBe('outlet');
    });

    it('falls back to the generic title when the IO is unknown', () => {
        expect(describeEvent(event({}), null)).toMatchObject({ titleKey: 'events.type.io', ioName: '', actionKey: '' });
    });

    it('reads the push text from event_raw', () => {
        const summary = describeEvent(event({ eventType: '22', raw: { message: 'Door' } }), null);
        expect(summary).toMatchObject({ kind: 'push', titleKey: 'events.type.push', message: 'Door' });
        expect(describeEvent(event({ eventType: '22', raw: { message: 7 } }), null).message).toBe('');
    });

    it('calls any other type unknown', () => {
        expect(describeEvent(event({ eventType: '99' }), null)).toMatchObject({
            kind: 'unknown',
            titleKey: 'events.type.unknown',
        });
    });
});
