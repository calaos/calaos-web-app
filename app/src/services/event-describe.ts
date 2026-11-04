// What the Events page says about one event, with the same rules as the
// mobile app's EventLogModel: type "3" is an IO change, "22" a push
// notification, anything else is unknown. Pure: the view translates the keys.

import type { EventLogEvent } from '../protocol/eventlog';

export interface EventIoInfo {
    name: string;
    guiType: string;
    /** Style of a binary light (outlet, pump, heater…); picks its icon. */
    ioStyle?: string;
    room: string;
}

export type EventIcon =
    | 'lightOn'
    | 'lightOff'
    | 'temp'
    | 'shutterOn'
    | 'shutterOff'
    | 'scenario'
    | 'push'
    | '';

export type EventKind = 'io' | 'push' | 'unknown';

export interface EventSummary {
    kind: EventKind;
    /** i18n key of the generic title; replaced by `ioName` when the IO resolves. */
    titleKey: string;
    ioName: string;
    room: string;
    /** i18n key of the action line ('' for none). */
    actionKey: string;
    /** Leading icon: the IO's state for a resolved IO, the bell for a push. */
    icon: EventIcon;
    ioStyle: string;
    /** Push text, plain text only. */
    message: string;
}

const DIMMABLE = new Set(['light_dimmer', 'light_rgb']);

/** Mirrors EventLogItem::load: a binary light is on only for "true", a dimmable one above 0. */
function isOn(guiType: string, state: string): boolean {
    return DIMMABLE.has(guiType) ? Number(state) > 0 : state === 'true';
}

function actionFor(guiType: string, state: string): { actionKey: string; icon: EventIcon } {
    if (guiType === 'light' || DIMMABLE.has(guiType)) {
        return isOn(guiType, state)
            ? { actionKey: 'events.action.on', icon: 'lightOn' }
            : { actionKey: 'events.action.off', icon: 'lightOff' };
    }
    if (guiType === 'temp') return { actionKey: 'events.action.tempChanged', icon: 'temp' };
    if (guiType === 'shutter' || guiType === 'shutter_smart') {
        return state === 'true'
            ? { actionKey: 'events.action.opened', icon: 'shutterOn' }
            : { actionKey: 'events.action.closed', icon: 'shutterOff' };
    }
    if (guiType === 'scenario') return { actionKey: 'events.action.started', icon: 'scenario' };
    return { actionKey: '', icon: '' };
}

export function describeEvent(event: EventLogEvent, io: EventIoInfo | null): EventSummary {
    const summary: EventSummary = {
        kind: 'unknown',
        titleKey: 'events.type.unknown',
        ioName: '',
        room: '',
        actionKey: '',
        icon: '',
        ioStyle: '',
        message: '',
    };
    if (event.eventType === '3') {
        summary.kind = 'io';
        summary.titleKey = 'events.type.io';
    } else if (event.eventType === '22') {
        summary.kind = 'push';
        summary.titleKey = 'events.type.push';
        summary.icon = 'push';
        const message = event.raw.message;
        summary.message = typeof message === 'string' ? message : '';
    }
    // Mobile resolves the IO whatever the type: a title with the IO's name.
    if (io) {
        summary.ioName = io.name;
        summary.room = io.room;
        const { actionKey, icon } = actionFor(io.guiType, event.ioState);
        summary.actionKey = actionKey;
        if (icon) summary.icon = icon;
        summary.ioStyle = io.ioStyle ?? '';
    }
    return summary;
}
