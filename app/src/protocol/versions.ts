// The `versions` admin action (household session, no admin password): the
// server's version and, when calaos-container answers, the box's. Framework-free.

import { isRecord, toWireString } from './guards';

export interface PackageVersion {
    name: string;
    version: string;
}

export interface SystemVersions {
    calaosOs: string;
    debian: string;
    kernel: string;
    container: string;
    packages: PackageVersion[];
}

export interface Versions {
    server: string;
    /** null: calaos-container did not answer. */
    system: SystemVersions | null;
    /** The server's short reason when `system` is null. */
    error: string;
}

function toSystem(raw: unknown): SystemVersions | null {
    if (!isRecord(raw)) return null;
    const packages = Array.isArray(raw.packages)
        ? raw.packages
              .filter(isRecord)
              .map((entry) => ({ name: toWireString(entry.name), version: toWireString(entry.version) }))
              .filter((entry) => entry.name !== '')
        : [];
    return {
        calaosOs: toWireString(raw.calaos_os),
        debian: toWireString(raw.debian),
        kernel: toWireString(raw.kernel),
        container: toWireString(raw.container),
        packages,
    };
}

export function toVersions(raw: unknown): Versions {
    const result = isRecord(raw) ? raw : {};
    return {
        server: toWireString(result.server),
        system: toSystem(result.system),
        error: toWireString(result.error),
    };
}

export interface ClientVersion {
    name: string;
    version: string;
}

/**
 * The plain text the Copy button puts on the clipboard, for a bug report.
 * Calaos components come from the package list only; the client and server
 * lines are a fallback for when that list is missing.
 */
export function formatVersionsText(client: ClientVersion, versions: Versions | null, now: Date): string {
    const lines = [`Calaos versions (${now.toISOString().slice(0, 10)})`];
    const system = versions?.system ?? null;
    if (versions === null || system === null || system.packages.length === 0) {
        lines.push(`client: ${client.name} ${client.version}`);
        lines.push(versions === null || versions.server === '' ? 'calaos-server unavailable' : `calaos-server ${versions.server}`);
    }
    if (versions !== null && system === null) {
        lines.push(versions.error === '' ? 'calaos-container unreachable' : `calaos-container unreachable (${versions.error})`);
        return lines.join('\n');
    }
    if (system === null) return lines.join('\n');
    const os = [
        system.calaosOs !== '' ? `calaos-os ${system.calaosOs}` : '',
        system.debian !== '' ? `debian ${system.debian}` : '',
        system.kernel !== '' ? `kernel ${system.kernel}` : '',
    ].filter((part) => part !== '');
    if (os.length > 0) lines.push(os.join(' · '));
    for (const pkg of system.packages) lines.push(`${pkg.name} ${pkg.version}`.trimEnd());
    return lines.join('\n');
}
