// `services_list` and the five service verbs (calaos_base docs/08_http_api.md,
// "Services"). NO Vue imports. The client names an `id` of the daemon's
// closed list, never a systemd unit.

import { isRecord, toWireString } from './guards';
import { toBool } from './admin';

/** The daemon's table, in its order. */
export const SERVICE_IDS = [
    'calaos-server',
    'calaos-home',
    'mosquitto',
    'zigbee2mqtt',
    'influxdb',
    'grafana',
    'hue2mqtt',
    'envoy',
    'olad',
    'ntp',
    'calaos-container',
    'haproxy',
    'networkd',
    'ssh',
] as const;

export type ServiceId = (typeof SERVICE_IDS)[number];

/** In the order the daemon lists them in `actions`. */
export const SERVICE_VERBS = ['restart', 'start', 'stop', 'enable', 'disable'] as const;

export type ServiceVerb = (typeof SERVICE_VERBS)[number];

/** What calaos_server accepts as `unit` before calling the daemon. */
export const SERVICE_ID_PATTERN = /^[a-z0-9-]{1,32}$/;

/** The server this page talks to: its restart also reloads the house. */
export const SELF_SERVICE_ID = 'calaos-server';

/** Every browser socket goes through these two, so restarting either one drops ours within seconds. */
export const CONNECTION_SERVICE_IDS: readonly string[] = [SELF_SERVICE_ID, 'haproxy'];

/** The daemon behind every admin action: until it is back, the relay answers `daemon_unreachable`. */
export const DAEMON_SERVICE_ID = 'calaos-container';

/** Restarted by `reload-or-restart`, which keeps the process: `since` does not move. */
export const RELOADED_SERVICE_IDS: readonly string[] = ['ssh'];

/** Its on/off lives in the Time card (`time_set`), so it has no switch here. */
export const TIME_SERVICE_ID = 'ntp';

/** systemd's ActiveState, or `not-found` for a unit that is not installed. */
export type ServiceActiveState =
    | 'active'
    | 'inactive'
    | 'failed'
    | 'activating'
    | 'deactivating'
    | 'reloading'
    | 'not-found'
    | 'unknown';

const ACTIVE_STATES: readonly string[] = [
    'active',
    'inactive',
    'failed',
    'activating',
    'deactivating',
    'reloading',
    'not-found',
];

export interface ServiceState {
    id: string;
    unit: string;
    /** The unit `enable` and `disable` act on, and that `startup` describes. */
    bootUnit: string;
    /** The only verbs to offer for this row. */
    actions: ServiceVerb[];
    activeState: ServiceActiveState;
    subState: string;
    /** `enabled`, `disabled`, `masked`, `static`, or '' for a missing unit: what the boot will do. */
    startup: string;
    /** RFC 3339 of the last entry into `active`; '' when it never was. */
    since: string;
}

function toActions(r: Record<string, unknown>): ServiceVerb[] {
    // A daemon older than these verbs only says whether the row restarts.
    if (!Array.isArray(r.actions)) return toBool(r.restartable) ? ['restart'] : [];
    return SERVICE_VERBS.filter((verb) => (r.actions as unknown[]).includes(verb));
}

export function toServices(raw: unknown): ServiceState[] {
    const list = isRecord(raw) && Array.isArray(raw.services) ? raw.services : [];
    return list.filter(isRecord).map((r) => {
        const state = toWireString(r.active_state);
        return {
            id: toWireString(r.id),
            unit: toWireString(r.unit),
            bootUnit: toWireString(r.boot_unit),
            actions: toActions(r),
            activeState: ACTIVE_STATES.includes(state) ? (state as ServiceActiveState) : 'unknown',
            subState: toWireString(r.sub_state),
            startup: toWireString(r.startup),
            since: toWireString(r.since),
        };
    });
}

export function serviceParams(id: string): { unit: string } {
    return { unit: id };
}
