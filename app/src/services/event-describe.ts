// What the Events page says about one event, with the same rules as the
// mobile app's EventLogModel: type "3" is an IO change, "22" a push
// notification, anything else is unknown. Pure: the view translates the keys.

import type { EventLogEvent } from '../protocol/eventlog';

export interface EventIoInfo {
    name: string;
    guiType: string;
    room: string;
}

export type EventKind = 'io' | 'push' | 'unknown';

export interface EventSummary {
    kind: EventKind;
    /** i18n key of the generic title; replaced by `ioName` when the IO resolves. */
    titleKey: string;
    ioName: string;
    room: string;
    /** i18n key of the action line ('' for none). */
    actionKey: string;
    /** Push text, plain text only. */
    message: string;
}

const LIGHTS = new Set(['light', 'light_dimmer', 'light_rgb']);

function isOn(state: string): boolean {
    return state === 'true' || Number(state) > 0;
}

function actionFor(guiType: string, state: string): string {
    if (LIGHTS.has(guiType)) return isOn(state) ? 'events.action.on' : 'events.action.off';
    if (guiType === 'temp') return 'events.action.tempChanged';
    if (guiType === 'shutter' || guiType === 'shutter_smart') {
        return state === 'true' ? 'events.action.opened' : 'events.action.closed';
    }
    if (guiType === 'scenario') return 'events.action.started';
    return '';
}

export function describeEvent(event: EventLogEvent, io: EventIoInfo | null): EventSummary {
    const summary: EventSummary = {
        kind: 'unknown',
        titleKey: 'events.type.unknown',
        ioName: '',
        room: '',
        actionKey: '',
        message: '',
    };
    if (event.eventType === '3') {
        summary.kind = 'io';
        summary.titleKey = 'events.type.io';
    } else if (event.eventType === '22') {
        summary.kind = 'push';
        summary.titleKey = 'events.type.push';
        const message = event.raw.message;
        summary.message = typeof message === 'string' ? message : '';
    }
    // Mobile resolves the IO whatever the type: a title with the IO's name.
    if (io) {
        summary.ioName = io.name;
        summary.room = io.room;
        if (summary.kind === 'io') summary.actionKey = actionFor(io.guiType, event.ioState);
    }
    return summary;
}
