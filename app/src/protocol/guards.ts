// Defensive runtime guards: wire → typed conversion. Hand-written, no zod.
//
// Contract: NEVER throw on malformed input. Every function accepts `unknown`
// and returns a fully-populated typed value, falling back to neutral defaults
// ('' / false / 0 / []) with a console.warn when a frame is structurally
// wrong. NO Vue imports in this directory.

import { GUI_TYPES } from './types';
import type {
    AudioPlayerItem,
    CameraItem,
    GuiType,
    HomeData,
    IoItem,
    IoStatusInfo,
    Room,
} from './types';

export function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Wire values are strings; numbers/booleans are coerced defensively (the old
// app's loose == comparisons would mostly have coped), everything else → fallback.
export function toWireString(v: unknown, fallback = ''): string {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return fallback;
}

// visible/rw wire strings → booleans, once at ingest (deliberate fix — the
// old templates re-compared `item.visible == 'true'` / `item.rw == "true"`
// everywhere, and inconsistently). Only the string 'true' was truthy in the
// old app; a real JSON boolean true is also accepted defensively.
export function wireBool(v: unknown): boolean {
    return v === 'true' || v === true;
}

// `rw` is NOT a general read-only flag, and almost nothing may gate on it —
// see docs/ARCHITECTURE.md "The `rw` flag". calaos_server only ever sends the
// key for var_bool / var_int / var_string, so reading it as false for a light
// is normal and means nothing about whether that light can be switched.

function toFiniteNumber(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

/**
 * A number the wire may simply not have sent. Distinct from `toFiniteNumber`:
 * a missing battery level must stay missing (no badge) rather than become 0
 * (a flat battery, blinking red at the user).
 */
function toOptionalNumber(v: unknown): number | null {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * `status_info` → typed telemetry, or `null` when the IO has none.
 *
 * Field names and their meanings are calaos_mobile's
 * (`IOBase::ioStatusChanged`): each key is present only when the device
 * actually reports it, and `connected` arrives as the string `'true'`.
 * An EMPTY object still counts as "has status": that is what the reference
 * client does (it sets `hasStatusInfo` on any `status_info` at all), and it is
 * how an IO says "I am a device" without reporting a level yet.
 */
export function toIoStatusInfo(raw: unknown): IoStatusInfo | null {
    if (!isRecord(raw)) return null;
    return {
        batteryLevel: toOptionalNumber(raw.battery_level),
        wirelessSignal: toOptionalNumber(raw.wireless_signal),
        connected: raw.connected === undefined ? null : wireBool(raw.connected),
        uptime: toOptionalNumber(raw.uptime),
        ipAddress: toWireString(raw.ip_address),
        wifiSsid: toWireString(raw.wifi_ssid),
    };
}

function isGuiType(v: string): v is GuiType {
    return (GUI_TYPES as readonly string[]).includes(v);
}

export function toIoItem(raw: unknown): IoItem {
    if (!isRecord(raw)) {
        console.warn('calaos protocol: malformed IO item, using fallback:', raw);
    }
    const obj = isRecord(raw) ? raw : {};
    const base = {
        id: toWireString(obj.id),
        name: toWireString(obj.name),
        state: toWireString(obj.state),
        // Both missing → false, exactly as calaos_mobile's RoomModel reads
        // them. `rw` being false for a light is normal and means nothing: only
        // the three types in `rwGatesControls` ever consult it.
        visible: wireBool(obj.visible),
        rw: wireBool(obj.rw),
        unit: toWireString(obj.unit),
        // `io_style` is the real wire key — it is in calaos_server's parameter
        // whitelist (`JsonApi::buildJsonIO`) and `gui_style` is NOT, so the
        // server never sends the latter and every styled IO was silently
        // falling back to the default glyph. calaos_mobile reads `io_style`
        // too (`RoomModel.cpp`: `update_ioStyle(ioData["io_style"]…)`).
        // `gui_style` stays as a fallback: it is what the old AngularJS
        // templates read, and a fixture or proxy may still speak it.
        ioStyle: toWireString(obj.io_style, toWireString(obj.gui_style)),
        status: toIoStatusInfo(obj.status_info),
    };
    const guiType = toWireString(obj.gui_type);
    if (isGuiType(guiType)) {
        return { ...base, guiType };
    }
    return { ...base, guiType: 'unknown', rawGuiType: guiType };
}

export function toRoom(raw: unknown): Room {
    if (!isRecord(raw)) {
        console.warn('calaos protocol: malformed room, using fallback:', raw);
    }
    const obj = isRecord(raw) ? raw : {};
    return {
        name: toWireString(obj.name),
        type: toWireString(obj.type),
        // Wire sends hits as a string; the old sort relied on implicit numeric
        // coercion ('3' - '1'). NaN → 0 so a bad value cannot poison the sort.
        hits: toFiniteNumber(obj.hits),
        items: Array.isArray(obj.items) ? obj.items.map(toIoItem) : [],
    };
}

export function toCameraItem(raw: unknown): CameraItem {
    const obj = isRecord(raw) ? raw : {};
    return {
        id: toWireString(obj.id),
        name: toWireString(obj.name),
    };
}

// get_home's audio entry. `playlist`/`database` are capability flags in the
// same 'true'/'false' wire spelling as visible/rw, so they convert once here;
// `avr` is absent for every player without a linked receiver, hence ''.
export function toAudioPlayerItem(raw: unknown): AudioPlayerItem {
    const obj = isRecord(raw) ? raw : {};
    return {
        id: toWireString(obj.id),
        name: toWireString(obj.name),
        type: toWireString(obj.type),
        canPlaylist: wireBool(obj.playlist),
        canDatabase: wireBool(obj.database),
        avr: toWireString(obj.avr),
    };
}

// get_home payload. Rooms keep wire order here — sorting desc by hits (and
// roomId assignment) is the home store's job.
export function toHomeData(raw: unknown): HomeData {
    if (!isRecord(raw)) {
        console.warn('calaos protocol: malformed get_home data, using fallback:', raw);
    }
    const obj = isRecord(raw) ? raw : {};
    return {
        rooms: Array.isArray(obj.home) ? obj.home.map(toRoom) : [],
        cameras: Array.isArray(obj.cameras) ? obj.cameras.map(toCameraItem) : [],
        audio: Array.isArray(obj.audio) ? obj.audio.map(toAudioPlayerItem) : [],
    };
}
