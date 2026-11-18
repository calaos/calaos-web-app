// `rescue_status`, `snapshots_list`, `snapshot_boot` and `snapshot_rollback`
// (calaos_base docs/08_http_api.md; the daemon's fields in calaos-container
// docs/API.md, "Snapshots and rescue"). NO Vue imports.

import { isRecord, toWireString } from './guards';
import { toBool } from './admin';

export const SNAPSHOT_TYPES = ['single', 'pre', 'post'] as const;

export type SnapshotType = (typeof SNAPSHOT_TYPES)[number];

/** The relay refuses any other `id` with `invalid_request` before asking the daemon. */
export const SNAPSHOT_ID_MAX = 2_147_483_647;

export interface Snapshot {
    id: number;
    /** RFC 3339 in the box's time zone; '' when snapper's date could not be read. */
    date: string;
    /** '' for a type outside the contract. */
    type: SnapshotType | '';
    /** The "pre" snapshot a "post" one pairs with; 0 when none. */
    preId: number;
    description: string;
    /** snapper's cleanup algorithm ("number", "timeline", ""). */
    cleanup: string;
    current: boolean;
    default: boolean;
    bootable: boolean;
}

export interface SnapshotList {
    /** The snapshot the system runs from, or null. */
    booted: number | null;
    /** In the daemon's order, newest first. */
    snapshots: Snapshot[];
    aptSnapshots: boolean;
}

export interface RescueStatus {
    rescue: boolean;
    overlay: boolean;
    /** The snapshot of `rootflags=`, null when the box did not boot one. */
    snapshot: number | null;
}

export function isSnapshotId(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= SNAPSHOT_ID_MAX;
}

function toSnapshotType(value: unknown): SnapshotType | '' {
    return (SNAPSHOT_TYPES as readonly unknown[]).includes(value) ? (value as SnapshotType) : '';
}

function toSnapshot(raw: unknown): Snapshot | null {
    if (!isRecord(raw) || !isSnapshotId(raw.id)) return null;
    return {
        id: raw.id,
        date: toWireString(raw.date),
        type: toSnapshotType(raw.type),
        preId: isSnapshotId(raw.pre_id) ? raw.pre_id : 0,
        description: toWireString(raw.description),
        cleanup: toWireString(raw.cleanup),
        current: toBool(raw.current),
        default: toBool(raw.default),
        bootable: toBool(raw.bootable),
    };
}

/** A row without a usable id is dropped: no action could name it. */
export function toSnapshotList(raw: unknown): SnapshotList {
    if (!isRecord(raw)) return { booted: null, snapshots: [], aptSnapshots: false };
    const snapshots = Array.isArray(raw.snapshots)
        ? raw.snapshots.map(toSnapshot).filter((entry): entry is Snapshot => entry !== null)
        : [];
    const booted = isRecord(raw.booted) && isSnapshotId(raw.booted.id) ? raw.booted.id : null;
    return { booted, snapshots, aptSnapshots: toBool(raw.apt_snapshots) };
}

export function toRescueStatus(raw: unknown): RescueStatus {
    if (!isRecord(raw)) return { rescue: false, overlay: false, snapshot: null };
    return {
        rescue: raw.rescue === true,
        overlay: raw.overlay === true,
        snapshot: isSnapshotId(raw.snapshot) ? raw.snapshot : null,
    };
}

/** A JSON integer: the relay answers `invalid_request` to a string or a float. */
export function snapshotBootParams(id: number): { id: number } {
    return { id };
}
