// For a device name inside a plain string (a dialog title): first-strong
// isolate marks keep its direction to itself, and a cap keeps it short.

const MAX_CODE_POINTS = 32;

export function isolateName(name: string): string {
    const points = [...name];
    const short = points.length > MAX_CODE_POINTS ? `${points.slice(0, MAX_CODE_POINTS - 1).join('')}…` : name;
    return `⁨${short}⁩`;
}
