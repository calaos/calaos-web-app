// For a device name inside a plain string (a dialog title): first-strong
// isolate marks keep its direction to itself, and a cap keeps it short.

const MAX_CODE_POINTS = 32;

/** Bidi embeddings, overrides and isolates: one stray PDI would close ours early. */
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

export function isolateName(name: string): string {
    const clean = name.replace(BIDI_CONTROLS, '');
    const points = [...clean];
    const short = points.length > MAX_CODE_POINTS ? `${points.slice(0, MAX_CODE_POINTS - 1).join('')}…` : clean;
    return `\u2068${short}\u2069`;
}
