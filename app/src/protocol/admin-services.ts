// `services_list` / `services_restart` (calaos_base docs/08_http_api.md,
// "Services"). NO Vue imports. The client names an `id` of the daemon's
// closed list, never a systemd unit.

import { isRecord, toWireString } from './guards';
import { toBool } from './admin';

/** The daemon's table, in its order; the last four are status only. */
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
    'calaos-ddns',
    'calaos-container',
    'haproxy',
    'networkd',
    'ssh',
] as const;

export type ServiceId = (typeof SERVICE_IDS)[number];

/** What calaos_server accepts as `unit` before calling the daemon. */
export const SERVICE_ID_PATTERN = /^[a-z0-9-]{1,32}$/;

/** Restarting this one drops the client's own connection within seconds. */
export const SELF_SERVICE_ID = 'calaos-server';

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
    /** `oneshot` is "run now" (`systemctl start`), not a restart. */
    kind: 'service' | 'oneshot';
    restartable: boolean;
    activeState: ServiceActiveState;
    subState: string;
    /** systemd's UnitFileState (`enabled`, `disabled`, `static`…), '' when none. */
    enabled: string;
    /** RFC 3339 of the last entry into `active`; '' when it never was. */
    since: string;
}

export function toServices(raw: unknown): ServiceState[] {
    const list = isRecord(raw) && Array.isArray(raw.services) ? raw.services : [];
    return list.filter(isRecord).map((r) => {
        const state = toWireString(r.active_state);
        return {
            id: toWireString(r.id),
            unit: toWireString(r.unit),
            kind: r.kind === 'oneshot' ? 'oneshot' : 'service',
            restartable: toBool(r.restartable),
            activeState: ACTIVE_STATES.includes(state) ? (state as ServiceActiveState) : 'unknown',
            subState: toWireString(r.sub_state),
            enabled: toWireString(r.enabled),
            since: toWireString(r.since),
        };
    });
}

/** `services_restart` only says the restart was scheduled; the outcome is read by polling. */
export function toServiceRestart(raw: unknown): { id: string; state: string } | null {
    if (!isRecord(raw)) return null;
    const id = toWireString(raw.id);
    return id === '' ? null : { id, state: toWireString(raw.state) };
}

export function servicesRestartParams(id: string): { unit: string } {
    return { unit: id };
}
