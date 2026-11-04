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
