// Defensive runtime guards: wire → typed conversion. Hand-written, no zod.
//
// Contract: NEVER throw on malformed input. Every function accepts `unknown`
// and returns a fully-populated typed value, falling back to neutral defaults
// ('' / false / 0 / []) with a console.warn when a frame is structurally
// wrong. NO Vue imports in this directory.

import { GUI_TYPES } from './types';
import type { AudioPlayerItem, CameraItem, GuiType, HomeData, IoItem, Room } from './types';

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

function toFiniteNumber(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
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
        // Missing visible/rw → false, matching the old templates where only
        // the exact string 'true' enabled rendering/controls.
        visible: wireBool(obj.visible),
        rw: wireBool(obj.rw),
        unit: toWireString(obj.unit),
        guiStyle: toWireString(obj.gui_style),
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
