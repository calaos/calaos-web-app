// The configuration backup as a zip, and everything a restore accepts: this
// zip, a zip of an installer project folder, the server's JSON document, or
// the XML files picked together. NO Vue imports. The zip is what a person
// handles (it opens with a double click, the installer reads the unzipped
// folder); the server only ever sees the three XML files.

import { BACKUP_FILES, toConfigBackup } from './admin-config';
import type { ConfigBackup } from './admin-config';
import { isRecord, toWireString } from './guards';

export const MANIFEST_NAME = 'calaos-backup.json';
export const MANIFEST_FORMAT = 'calaos-backup/2';
export const MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const MAX_ENTRIES = 64;
/** calaos_server refuses a bigger file. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

const README = `Calaos backup: io.xml and rules.xml are your home, local_config.xml the settings of the box.
It contains passwords: the household login, tokens, mail and InfluxDB passwords. local_config.xml
also holds the ddns token, which lets anyone delete your calaos.fr address. Keep this backup private.
To restore it, one of:
1. Web app: Admin, Settings, "Restore a backup...", then pick this zip.
2. Calaos Installer: unzip, "Open project" on the folder, "Send project to Calaos Server"
   (io.xml and rules.xml only).
3. SSH: unzip, systemctl stop calaos-server, scp io.xml rules.xml local_config.xml
   root@<box>:/mnt/calaos/config/, systemctl start calaos-server.

Sauvegarde Calaos : io.xml et rules.xml sont votre maison, local_config.xml les réglages de la box.
Elle contient des mots de passe : foyer, jetons, mail et InfluxDB. local_config.xml contient aussi
le jeton ddns, qui permet à n'importe qui de supprimer votre adresse calaos.fr. Gardez-la privée.
Pour la restaurer : application web (Admin, Réglages, « Restaurer une sauvegarde… »), Calaos
Installer (décompresser, ouvrir le dossier, envoyer le projet) ou SSH (comme ci-dessus).
`;

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const END_OF_DIRECTORY_BYTES = 22;
const MAX_COMMENT_BYTES = 0xffff;
const INFLATE_WRITE_BYTES = 64 * 1024;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const FLAG_ENCRYPTED = 0x0001;

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
    let c = index;
    for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
});

export function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------------ writer ---

interface DosStamp {
    time: number;
    date: number;
}

/** UTC, like the file name. A zip cannot say anything before 1980. */
function dosStamp(createdAt: string): DosStamp {
    const ms = Date.parse(createdAt);
    const when = new Date(Number.isNaN(ms) ? 0 : ms);
    if (when.getUTCFullYear() < 1980) return { time: 0, date: (1 << 5) | 1 };
    return {
        time: (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | (when.getUTCSeconds() >> 1),
        date: ((when.getUTCFullYear() - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate(),
    };
}

/** Stored entries: the files are KiB, and the output stays deterministic. Names are ASCII. */
export function encodeZip(entries: { name: string; data: Uint8Array }[], createdAt: string): Uint8Array<ArrayBuffer> {
    const encoder = new TextEncoder();
    const stamp = dosStamp(createdAt);
    const named = entries.map((entry) => ({ ...entry, nameBytes: encoder.encode(entry.name), crc: crc32(entry.data) }));
    const localSize = named.reduce((sum, e) => sum + LOCAL_HEADER_BYTES + e.nameBytes.length + e.data.length, 0);
    const centralSize = named.reduce((sum, e) => sum + CENTRAL_HEADER_BYTES + e.nameBytes.length, 0);
    const bytes = new Uint8Array(localSize + centralSize + END_OF_DIRECTORY_BYTES);
    const view = new DataView(bytes.buffer);

    // Both headers share these fields from "version needed" to the name length.
    const writeCommon = (at: number, entry: (typeof named)[number]): void => {
        view.setUint16(at, 10, true);
        view.setUint16(at + 2, 0, true);
        view.setUint16(at + 4, METHOD_STORED, true);
        view.setUint16(at + 6, stamp.time, true);
        view.setUint16(at + 8, stamp.date, true);
        view.setUint32(at + 10, entry.crc, true);
        view.setUint32(at + 14, entry.data.length, true);
        view.setUint32(at + 18, entry.data.length, true);
        view.setUint16(at + 22, entry.nameBytes.length, true);
    };

    let offset = 0;
    let central = localSize;
    for (const entry of named) {
        view.setUint32(offset, LOCAL_HEADER, true);
        writeCommon(offset + 4, entry);
        bytes.set(entry.nameBytes, offset + LOCAL_HEADER_BYTES);
        bytes.set(entry.data, offset + LOCAL_HEADER_BYTES + entry.nameBytes.length);

        view.setUint32(central, CENTRAL_HEADER, true);
        view.setUint16(central + 4, 10, true);
        writeCommon(central + 6, entry);
        view.setUint32(central + 42, offset, true);
        bytes.set(entry.nameBytes, central + CENTRAL_HEADER_BYTES);

        offset += LOCAL_HEADER_BYTES + entry.nameBytes.length + entry.data.length;
        central += CENTRAL_HEADER_BYTES + entry.nameBytes.length;
    }

    view.setUint32(central, END_OF_DIRECTORY, true);
    view.setUint16(central + 8, named.length, true);
    view.setUint16(central + 10, named.length, true);
    view.setUint32(central + 12, centralSize, true);
    view.setUint32(central + 16, localSize, true);
    return bytes;
}

export function backupZipEntries(doc: ConfigBackup): { name: string; data: Uint8Array }[] {
    const encoder = new TextEncoder();
    const names = BACKUP_FILES.filter((name) => doc.files[name] !== undefined);
    const manifest = {
        format: MANIFEST_FORMAT,
        created_at: doc.createdAt,
        server_version: doc.serverVersion,
        hostname: doc.hostname,
        io_format: doc.ioFormat,
        files: names,
    };
    return [
        ...names.map((name) => ({ name, data: encoder.encode(doc.files[name]) })),
        { name: MANIFEST_NAME, data: encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`) },
        { name: 'README.txt', data: encoder.encode(README) },
    ];
}

export function buildBackupZip(doc: ConfigBackup): Blob {
    return new Blob([encodeZip(backupZipEntries(doc), doc.createdAt)], { type: 'application/zip' });
}

// ------------------------------------------------------------------ reader ---

export type RestoreReadError =
    | 'too_big'
    | 'too_many_entries'
    | 'encrypted'
    | 'duplicate'
    | 'two_folders'
    | 'compression'
    | 'entry_too_big'
    | 'not_a_zip'
    | 'corrupt'
    | 'missing_files'
    | 'bad_json'
    | 'bad_format'
    | 'mixed'
    | 'not_utf8'
    | 'unsupported'
    | 'no_inflate';

/** What the dialog can say about where a backup came from. */
export interface RestoreManifest {
    hostname: string;
    createdAt: string;
    serverVersion: string;
}

export interface RestoreInput {
    files: Record<string, string>;
    /** null for a bare project: nothing says which box it came from. */
    manifest: RestoreManifest | null;
}

export type RestoreRead = { ok: true; input: RestoreInput } | { ok: false; error: RestoreReadError };

/** Carries a refusal out of the nested reads, up to `readRestoreInput`. */
class Refused extends Error {
    constructor(readonly code: RestoreReadError) {
        super(code);
    }
}

interface ZipEntry {
    name: string;
    method: number;
    flags: number;
    crc: number;
    compressedSize: number;
    size: number;
    localOffset: number;
}

const RESTORE_NAMES: readonly string[] = BACKUP_FILES;

function findEndOfDirectory(view: DataView): number {
    const last = view.byteLength - END_OF_DIRECTORY_BYTES;
    for (let at = last; at >= 0 && at >= last - MAX_COMMENT_BYTES; at -= 1) {
        if (view.getUint32(at, true) === END_OF_DIRECTORY) return at;
    }
    throw new Refused('not_a_zip');
}

/** Sizes come from here: a streaming zipper leaves them at 0 in the local header. */
function readDirectory(bytes: Uint8Array): ZipEntry[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = findEndOfDirectory(view);
    const count = view.getUint16(end + 10, true);
    if (count > MAX_ENTRIES) throw new Refused('too_many_entries');
    const decoder = new TextDecoder();
    const entries: ZipEntry[] = [];
    let at = view.getUint32(end + 16, true);
    for (let index = 0; index < count; index += 1) {
        if (at + CENTRAL_HEADER_BYTES > end || view.getUint32(at, true) !== CENTRAL_HEADER) throw new Refused('corrupt');
        const nameLength = view.getUint16(at + 28, true);
        const next = at + CENTRAL_HEADER_BYTES + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
        if (next > end) throw new Refused('corrupt');
        entries.push({
            name: decoder.decode(bytes.subarray(at + CENTRAL_HEADER_BYTES, at + CENTRAL_HEADER_BYTES + nameLength)),
            flags: view.getUint16(at + 8, true),
            method: view.getUint16(at + 10, true),
            crc: view.getUint32(at + 16, true),
            compressedSize: view.getUint32(at + 20, true),
            size: view.getUint32(at + 24, true),
            localOffset: view.getUint32(at + 42, true),
        });
        at = next;
    }
    return entries;
}

/** Folder ('' at the root) and file name, or null when the path is not one a restore looks at. */
function restorePath(path: string): { folder: string; name: string } | null {
    const parts = path.replaceAll('\\', '/').split('/');
    if (parts.length > 2 || parts[0] === '__MACOSX') return null;
    if (parts.some((part) => part === '' || part.startsWith('.'))) return null;
    const name = parts.pop();
    return name === undefined ? null : { folder: parts[0] ?? '', name };
}

async function inflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
    if (typeof DecompressionStream === 'undefined') throw new Refused('no_inflate');
    const stream = new DecompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    // One big write inflates in full before the first read returns, so the limit
    // below would only fire once the bomb is in memory. Rejects when the reader
    // stops early or the data is broken; the read reports it.
    void (async () => {
        for (let at = 0; at < data.length; at += INFLATE_WRITE_BYTES) {
            await writer.write(data.subarray(at, at + INFLATE_WRITE_BYTES));
        }
        await writer.close();
    })().catch(() => undefined);
    const reader = stream.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > MAX_FILE_BYTES) {
                void reader.cancel().catch(() => undefined);
                throw new Refused('entry_too_big');
            }
            chunks.push(value);
        }
    } catch (error) {
        throw error instanceof Refused ? error : new Refused('corrupt');
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

async function readEntry(bytes: Uint8Array<ArrayBuffer>, entry: ZipEntry): Promise<Uint8Array> {
    if (entry.flags & FLAG_ENCRYPTED) throw new Refused('encrypted');
    if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE) throw new Refused('compression');
    if (entry.size > MAX_FILE_BYTES) throw new Refused('entry_too_big');
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (entry.localOffset + LOCAL_HEADER_BYTES > bytes.length || header.getUint32(entry.localOffset, true) !== LOCAL_HEADER) {
        throw new Refused('corrupt');
    }
    const start =
        entry.localOffset +
        LOCAL_HEADER_BYTES +
        header.getUint16(entry.localOffset + 26, true) +
        header.getUint16(entry.localOffset + 28, true);
    if (start + entry.compressedSize > bytes.length) throw new Refused('corrupt');
    const data = bytes.subarray(start, start + entry.compressedSize);
    const content = entry.method === METHOD_STORED ? data : await inflate(data);
    if (content.length !== entry.size || crc32(content) !== entry.crc) throw new Refused('corrupt');
    return content;
}

function decodeUtf8(bytes: Uint8Array): string {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        throw new Refused('not_utf8');
    }
}

function requireProject(files: Record<string, string>): Record<string, string> {
    if (files['io.xml'] === undefined || files['rules.xml'] === undefined) throw new Refused('missing_files');
    return files;
}

function toManifest(raw: unknown): RestoreManifest | null {
    if (!isRecord(raw) || raw.format !== MANIFEST_FORMAT) return null;
    return {
        hostname: toWireString(raw.hostname),
        createdAt: toWireString(raw.created_at),
        serverVersion: toWireString(raw.server_version),
    };
}

/** The manifest is a nicety: an unreadable one only costs the title of the dialog. */
async function readManifest(bytes: Uint8Array<ArrayBuffer>, entry: ZipEntry): Promise<RestoreManifest | null> {
    try {
        return toManifest(JSON.parse(decodeUtf8(await readEntry(bytes, entry))));
    } catch {
        return null;
    }
}

async function readZip(bytes: Uint8Array<ArrayBuffer>): Promise<RestoreInput> {
    const found = new Map<string, ZipEntry>();
    const folders = new Set<string>();
    for (const entry of readDirectory(bytes)) {
        const path = restorePath(entry.name);
        if (path === null || (path.name !== MANIFEST_NAME && !RESTORE_NAMES.includes(path.name))) continue;
        if (found.has(path.name)) throw new Refused('duplicate');
        found.set(path.name, entry);
        folders.add(path.folder);
    }
    // io.xml of one project with rules.xml of another is no backup of anything.
    if (folders.size > 1) throw new Refused('two_folders');
    const files: Record<string, string> = {};
    for (const name of RESTORE_NAMES) {
        const entry = found.get(name);
        if (entry !== undefined) files[name] = decodeUtf8(await readEntry(bytes, entry));
    }
    const manifest = found.get(MANIFEST_NAME);
    return {
        files: requireProject(files),
        manifest: manifest === undefined ? null : await readManifest(bytes, manifest),
    };
}

function readJson(text: string): RestoreInput {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        throw new Refused('bad_json');
    }
    const doc = toConfigBackup(raw);
    if (doc === null) throw new Refused('bad_format');
    const encoder = new TextEncoder();
    const files: Record<string, string> = {};
    for (const name of RESTORE_NAMES) {
        const content = doc.files[name];
        if (content === undefined) continue;
        if (encoder.encode(content).length > MAX_FILE_BYTES) throw new Refused('entry_too_big');
        files[name] = content;
    }
    return {
        files: requireProject(files),
        manifest: { hostname: doc.hostname, createdAt: doc.createdAt, serverVersion: doc.serverVersion },
    };
}

/** Names decide: a stray file of the same folder is left out, and the dialog lists what stays. */
async function readXmlFiles(selected: File[]): Promise<RestoreInput> {
    const files: Record<string, string> = {};
    for (const file of selected) {
        if (!RESTORE_NAMES.includes(file.name)) continue;
        if (file.size > MAX_FILE_BYTES) throw new Refused('entry_too_big');
        files[file.name] = decodeUtf8(new Uint8Array(await file.arrayBuffer()));
    }
    return { files: requireProject(files), manifest: null };
}

const extension = (file: File): string => file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();

async function readSelection(selected: File[]): Promise<RestoreInput> {
    if (selected.reduce((sum, file) => sum + file.size, 0) > MAX_INPUT_BYTES) throw new Refused('too_big');
    const kinds = new Set(selected.map(extension));
    if (kinds.size === 1 && kinds.has('xml')) return readXmlFiles(selected);
    const [file] = selected;
    if (file === undefined || kinds.size > 1 || selected.length > 1) {
        throw new Refused(selected.length > 1 ? 'mixed' : 'unsupported');
    }
    if (kinds.has('zip')) return readZip(new Uint8Array(await file.arrayBuffer()));
    if (kinds.has('json')) return readJson(decodeUtf8(new Uint8Array(await file.arrayBuffer())));
    throw new Refused('unsupported');
}

export async function readRestoreInput(selected: File[]): Promise<RestoreRead> {
    try {
        return { ok: true, input: await readSelection(selected) };
    } catch (error) {
        // Anything else is the browser failing to read the file, e.g. it changed on disk.
        return { ok: false, error: error instanceof Refused ? error.code : 'corrupt' };
    }
}
