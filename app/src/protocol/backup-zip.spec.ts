import { afterEach, describe, expect, it, vi } from 'vitest';
import { backupZipName, toConfigBackup } from './admin-config';
import type { ConfigBackup } from './admin-config';
import {
    MANIFEST_FORMAT,
    MANIFEST_NAME,
    MAX_ENTRIES,
    MAX_FILE_BYTES,
    MAX_INPUT_BYTES,
    backupZipEntries,
    buildBackupZip,
    crc32,
    encodeZip,
    readRestoreInput,
} from './backup-zip';

// Real archives of synthetic files, made by Info-ZIP: `zip -9` (deflate), `zip -fd`
// (data descriptor, sizes only in the central directory), and an arborescence as
// the macOS Finder leaves it (`Maison/`, `.DS_Store`, `__MACOSX/Maison/._io.xml`).
const INFOZIP =
    'UEsDBBQAAgAIAGtqXl2YWK5zXAAAAKYAAAANAAAATWFpc29uL2lvLnhtbLOxr8jNUShLLSrOzM+zVTLUM1Cyt+OySU7MScwvtsrM' +
    'T87PS8tMVwAqyiu2gojaKmWUlBRY6euXl5frQYT00oqUFNLyi3ITS2yVjJQQBmTk56bqk8rVR7PdjgsAUEsDBBQAAgAIAGtqXl1q' +
    'GrlXSgAAAIYAAAAQAAAATWFpc29uL3J1bGVzLnhtbLOxr8jNUShLLSrOzM+zVTLUM1Cyt+OySU7MScwvtioqzUktVgCqyCu2ggjZ' +
    'KmWUlBRY6euXl5frQYT00oqUULXoE+TqI1tgxwUAUEsDBBQAAgAIAGtqXl0e7zMuQwAAAEsAAAAXAAAATWFpc29uL2xvY2FsX2Nv' +
    'bmZpZy54bWyzsa/IzVEoSy0qzszPs1Uy1DNQsrfjsklOzEnML7ZKzs9Ly0xXACrJA3LAYrZKGSUlBVb6+uXl5XoQIb20IiV9Oy4A' +
    'UEsBAh4DFAACAAgAa2peXZhYrnNcAAAApgAAAA0AAAAAAAAAAQAAAKSBAAAAAE1haXNvbi9pby54bWxQSwECHgMUAAIACABral5d' +
    'ahq5V0oAAACGAAAAEAAAAAAAAAABAAAApIGHAAAATWFpc29uL3J1bGVzLnhtbFBLAQIeAxQAAgAIAGtqXl0e7zMuQwAAAEsAAAAX' +
    'AAAAAAAAAAEAAACkgf8AAABNYWlzb24vbG9jYWxfY29uZmlnLnhtbFBLBQYAAAAAAwADAL4AAAB3AQAAAAA=';
const INFOZIP_DESCRIPTOR =
    'UEsDBBQACAAIAGtqXl0AAAAAAAAAAKYAAAANAAAATWFpc29uL2lvLnhtbLOxr8jNUShLLSrOzM+zVTLUM1Cyt+OySU7MScwvtsrM' +
    'T87PS8tMVwAqyiu2gojaKmWUlBRY6euXl5frQYT00oqUFNLyi3ITS2yVjJQQBmTk56bqk8rVR7PdjgsAUEsHCJhYrnNcAAAApgAA' +
    'AFBLAwQUAAgACABral5dAAAAAAAAAACGAAAAEAAAAE1haXNvbi9ydWxlcy54bWyzsa/IzVEoSy0qzszPs1Uy1DNQsrfjsklOzEnM' +
    'L7YqKs1JLVYAqsgrtoII2SpllJQUWOnrl5eX60GE9NKKlFC16BPk6iNbYMcFAFBLBwhqGrlXSgAAAIYAAABQSwMEFAAIAAgAa2pe' +
    'XQAAAAAAAAAASwAAABcAAABNYWlzb24vbG9jYWxfY29uZmlnLnhtbLOxr8jNUShLLSrOzM+zVTLUM1Cyt+OySU7MScwvtkrOz0vL' +
    'TFcAKskDcsBitkoZJSUFVvr65eXlehAhvbQiJX07LgBQSwcIHu8zLkMAAABLAAAAUEsBAh4DFAAIAAgAa2peXZhYrnNcAAAApgAA' +
    'AA0AAAAAAAAAAQAAAKSBAAAAAE1haXNvbi9pby54bWxQSwECHgMUAAgACABral5dahq5V0oAAACGAAAAEAAAAAAAAAABAAAApIGX' +
    'AAAATWFpc29uL3J1bGVzLnhtbFBLAQIeAxQACAAIAGtqXl0e7zMuQwAAAEsAAAAXAAAAAAAAAAEAAACkgR8BAABNYWlzb24vbG9j' +
    'YWxfY29uZmlnLnhtbFBLBQYAAAAAAwADAL4AAACnAQAAAAA=';
const MACOS =
    'UEsDBAoAAAAAAGtqXl0AAAAAAAAAAAAAAAAHAAAATWFpc29uL1BLAwQUAAAACABral5dmFiuc1wAAACmAAAADQAAAE1haXNvbi9p' +
    'by54bWyzsa/IzVEoSy0qzszPs1Uy1DNQsrfjsklOzEnML7bKzE/Oz0vLTFcAKsortoKI2ipllJQUWOnrl5eX60GE9NKKlBTS8oty' +
    'E0tslYyUEAZk5Oem6pPK1Uez3Y4LAFBLAwQUAAAACABral5dahq5V0oAAACGAAAAEAAAAE1haXNvbi9ydWxlcy54bWyzsa/IzVEo' +
    'Sy0qzszPs1Uy1DNQsrfjsklOzEnML7YqKs1JLVYAqsgrtoII2SpllJQUWOnrl5eX60GE9NKKlFC16BPk6iNbYMcFAFBLAwQUAAAA' +
    'CABral5dHu8zLkMAAABLAAAAFwAAAE1haXNvbi9sb2NhbF9jb25maWcueG1ss7GvyM1RKEstKs7Mz7NVMtQzULK347JJTsxJzC+2' +
    'Ss7PS8tMVwAqyQNywGK2ShklJQVW+vrl5eV6ECG9tCIlfTsuAFBLAwQKAAAAAABral5dOZz7BgQAAAAEAAAAEAAAAE1haXNvbi8u' +
    'RFNfU3RvcmVqdW5rUEsDBAoAAAAAAGtqXl0AAAAAAAAAAAAAAAAJAAAAX19NQUNPU1gvUEsDBAoAAAAAAGtqXl0AAAAAAAAAAAAA' +
    'AAAQAAAAX19NQUNPU1gvTWFpc29uL1BLAwQKAAAAAABral5dfY4KdwgAAAAIAAAAGAAAAF9fTUFDT1NYL01haXNvbi8uX2lvLnht' +
    'bAAFFgdqdW5rUEsBAh4DCgAAAAAAa2peXQAAAAAAAAAAAAAAAAcAAAAAAAAAAAAQAO1BAAAAAE1haXNvbi9QSwECHgMUAAAACABr' +
    'al5dmFiuc1wAAACmAAAADQAAAAAAAAABAAAApIElAAAATWFpc29uL2lvLnhtbFBLAQIeAxQAAAAIAGtqXl1qGrlXSgAAAIYAAAAQ' +
    'AAAAAAAAAAEAAACkgawAAABNYWlzb24vcnVsZXMueG1sUEsBAh4DFAAAAAgAa2peXR7vMy5DAAAASwAAABcAAAAAAAAAAQAAAKSB' +
    'JAEAAE1haXNvbi9sb2NhbF9jb25maWcueG1sUEsBAh4DCgAAAAAAa2peXTmc+wYEAAAABAAAABAAAAAAAAAAAQAAAKSBnAEAAE1h' +
    'aXNvbi8uRFNfU3RvcmVQSwECHgMKAAAAAABral5dAAAAAAAAAAAAAAAACQAAAAAAAAAAABAA7UHOAQAAX19NQUNPU1gvUEsBAh4D' +
    'CgAAAAAAa2peXQAAAAAAAAAAAAAAABAAAAAAAAAAAAAQAO1B9QEAAF9fTUFDT1NYL01haXNvbi9QSwECHgMKAAAAAABral5dfY4K' +
    'dwgAAAAIAAAAGAAAAAAAAAAAAAAApIEjAgAAX19NQUNPU1gvTWFpc29uLy5faW8ueG1sUEsFBgAAAAAIAAgA7AEAAGECAAAAAA==';

const IO_XML = '<?xml version="1.0"?>\n<calaos:ioconfig xmlns:calaos="http://www.calaos.fr" format="2">\n';
const encoder = new TextEncoder();

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

function zipFile(bytes: Uint8Array<ArrayBuffer>, name = 'backup.zip'): File {
    return new File([bytes], name);
}

function textFile(name: string, content: string): File {
    return new File([content], name);
}

function entries(files: Record<string, string>): { name: string; data: Uint8Array }[] {
    return Object.entries(files).map(([name, content]) => ({ name, data: encoder.encode(content) }));
}

const PROJECT = { 'io.xml': '<?xml?><io/>', 'rules.xml': '<?xml?><rules/>' };

function zipOf(files: Record<string, string>): File {
    return zipFile(encodeZip(entries(files), '2026-10-25T09:12:58Z'));
}

/** Rewrites a 16-bit field of every central directory record. */
function patchCentral(bytes: Uint8Array<ArrayBuffer>, field: number, value: number): Uint8Array<ArrayBuffer> {
    const view = new DataView(bytes.buffer);
    for (let at = 0; at + 4 <= bytes.length; at += 1) {
        if (view.getUint32(at, true) === 0x02014b50) view.setUint16(at + field, value, true);
    }
    return bytes;
}

/** The last file becomes deflate; its size stays the packed one, so the archive lies about it. */
function markLastDeflated(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
    const view = new DataView(bytes.buffer);
    for (let at = bytes.length - 22; at >= 0; at -= 1) {
        if (view.getUint32(at, true) === 0x02014b50) {
            view.setUint16(at + 10, 8, true);
            return bytes;
        }
    }
    throw new Error('no central directory');
}

function doc(overrides: Partial<ConfigBackup> = {}): ConfigBackup {
    return {
        format: 'calaos-config-backup/2',
        createdAt: '2026-10-25T09:12:58Z',
        serverVersion: '4.6.0',
        hostname: 'maison',
        ioFormat: 2,
        files: { 'io.xml': IO_XML, 'rules.xml': '<?xml version="1.0"?>\n<r/>', 'local_config.xml': '<?xml version="1.0"?>\n<é/>' },
        unrestorable: [],
        ...overrides,
    };
}

describe('zip writer', () => {
    it('computes the standard CRC-32', () => {
        expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926);
        expect(crc32(new Uint8Array())).toBe(0);
    });

    it('writes the three files, the manifest and a README of fifteen lines naming the ddns token', async () => {
        const list = backupZipEntries(doc());
        expect(list.map((entry) => entry.name)).toEqual([
            'io.xml',
            'rules.xml',
            'local_config.xml',
            MANIFEST_NAME,
            'README.txt',
        ]);
        const readme = new TextDecoder().decode(list[4]?.data);
        expect(readme.trimEnd().split('\n')).toHaveLength(15);
        expect(readme).toContain('ddns token');
        expect(readme).toContain('jeton ddns');
        expect(JSON.parse(new TextDecoder().decode(list[3]?.data))).toEqual({
            format: MANIFEST_FORMAT,
            created_at: '2026-10-25T09:12:58Z',
            server_version: '4.6.0',
            hostname: 'maison',
            io_format: 2,
            files: ['io.xml', 'rules.xml', 'local_config.xml'],
        });
    });

    it('stamps the entries with the date of the backup, in UTC', () => {
        const bytes = encodeZip(entries(PROJECT), '2026-10-25T09:12:58Z');
        const view = new DataView(bytes.buffer);
        expect(view.getUint16(10, true)).toBe((9 << 11) | (12 << 5) | 29);
        expect(view.getUint16(12, true)).toBe((46 << 9) | (10 << 5) | 25);
    });

    it('never writes a date a zip cannot hold', () => {
        const bytes = encodeZip(entries(PROJECT), 'not a date');
        expect(new DataView(bytes.buffer).getUint16(12, true)).toBe((1 << 5) | 1);
    });

    it('gives the same bytes for the same document', () => {
        expect(encodeZip(backupZipEntries(doc()), doc().createdAt)).toEqual(encodeZip(backupZipEntries(doc()), doc().createdAt));
    });

    it('reads back what it wrote, accents included', async () => {
        const input = await readRestoreInput([new File([buildBackupZip(doc())], 'backup.zip')]);
        expect(input).toEqual({
            ok: true,
            input: {
                files: doc().files,
                manifest: { hostname: 'maison', createdAt: '2026-10-25T09:12:58Z', serverVersion: '4.6.0' },
            },
        });
    });

    it('names the zip after the box and the date of the backup', () => {
        expect(backupZipName('Maison Box/../x', '2026-10-25T09:12:58Z')).toBe('calaos-backup-MaisonBox..x-20261025-0912.zip');
        expect(backupZipName('', 'garbage', Date.parse('2026-01-02T03:04:05Z'))).toBe('calaos-backup-box-20260102-0304.zip');
    });
});

describe('restore input', () => {
    it.each([
        ['deflate', INFOZIP],
        ['a data descriptor', INFOZIP_DESCRIPTOR],
        ['the leftovers of macOS', MACOS],
    ])('reads an archive with %s, in its folder', async (_, base64) => {
        const read = await readRestoreInput([zipFile(fromBase64(base64))]);
        if (!read.ok) throw new Error(read.error);
        expect(Object.keys(read.input.files).sort()).toEqual(['io.xml', 'local_config.xml', 'rules.xml']);
        expect(read.input.files['io.xml']).toContain('<calaos:ioconfig');
        expect(read.input.files['rules.xml']).toContain('<calaos:rules');
        expect(read.input.manifest).toBeNull();
    });

    it('takes the JSON documents of both formats, and ignores the widgets of the old one', async () => {
        const files = { ...PROJECT, 'widgets.xml': '<w/>' };
        const old = { format: 'calaos-config-backup/1', created_at: 'c', server_version: 'v', hostname: 'h', files };
        const read = await readRestoreInput([textFile('old.json', JSON.stringify(old))]);
        expect(read).toEqual({
            ok: true,
            input: { files: PROJECT, manifest: { hostname: 'h', createdAt: 'c', serverVersion: 'v' } },
        });
        expect(toConfigBackup(old)?.ioFormat).toBe(0);
        const current = { ...old, format: 'calaos-config-backup/2', io_format: 2 };
        expect((await readRestoreInput([textFile('new.json', JSON.stringify(current))])).ok).toBe(true);
    });

    it('takes the XML files picked together, and only those a restore knows', async () => {
        const read = await readRestoreInput([
            textFile('io.xml', PROJECT['io.xml']),
            textFile('rules.xml', PROJECT['rules.xml']),
            textFile('widgets.xml', '<w/>'),
        ]);
        expect(read).toEqual({ ok: true, input: { files: PROJECT, manifest: null } });
    });

    it('survives a damaged manifest: only the title of the dialog is lost', async () => {
        const read = await readRestoreInput([zipOf({ ...PROJECT, [MANIFEST_NAME]: '{' })]);
        expect(read).toEqual({ ok: true, input: { files: PROJECT, manifest: null } });
    });

    it('refuses a selection over the size limit, before reading it', async () => {
        const big = new File([new Uint8Array(MAX_INPUT_BYTES + 1)], 'big.zip');
        expect(await readRestoreInput([big])).toEqual({ ok: false, error: 'too_big' });
    });

    it('takes exactly as many entries as the limit, and refuses one more', async () => {
        const stuffed = (count: number): File =>
            zipOf({ ...PROJECT, ...Object.fromEntries(Array.from({ length: count - 2 }, (_, i) => [`x${i}.txt`, ''])) });
        expect((await readRestoreInput([stuffed(MAX_ENTRIES)])).ok).toBe(true);
        expect(await readRestoreInput([stuffed(MAX_ENTRIES + 1)])).toEqual({ ok: false, error: 'too_many_entries' });
    });

    it('refuses an encrypted zip', async () => {
        const bytes = patchCentral(encodeZip(entries(PROJECT), ''), 8, 1);
        expect(await readRestoreInput([zipFile(bytes)])).toEqual({ ok: false, error: 'encrypted' });
    });

    it('refuses a compression the browser cannot read', async () => {
        const bytes = patchCentral(encodeZip(entries(PROJECT), ''), 10, 12);
        expect(await readRestoreInput([zipFile(bytes)])).toEqual({ ok: false, error: 'compression' });
    });

    it('refuses the same file twice, even in two places', async () => {
        const bytes = encodeZip(entries({ ...PROJECT, 'Maison/io.xml': '<x/>' }), '');
        expect(await readRestoreInput([zipFile(bytes)])).toEqual({ ok: false, error: 'duplicate' });
    });

    it('refuses a file over 2 MiB once unpacked, whatever the archive claims', async () => {
        const honest = zipOf({ ...PROJECT, 'local_config.xml': 'x'.repeat(MAX_FILE_BYTES + 1) });
        expect(await readRestoreInput([honest])).toEqual({ ok: false, error: 'entry_too_big' });
        const bomb = new CompressionStream('deflate-raw');
        const writer = bomb.writable.getWriter();
        void writer.write(new Uint8Array(MAX_FILE_BYTES + 1));
        void writer.close();
        const compressed = new Uint8Array(await new Response(bomb.readable).arrayBuffer());
        const bytes = encodeZip([...entries(PROJECT), { name: 'local_config.xml', data: compressed }], '');
        expect(await readRestoreInput([zipFile(markLastDeflated(bytes))])).toEqual({ ok: false, error: 'entry_too_big' });
    });

    describe('with a deflate bomb', () => {
        afterEach(() => vi.unstubAllGlobals());

        /** 512 MiB of zeros, about 512 KiB once packed: under the limits the archive is checked against. */
        async function bomb(): Promise<Uint8Array<ArrayBuffer>> {
            const stream = new CompressionStream('deflate-raw');
            const writer = stream.writable.getWriter();
            const mib = new Uint8Array(1024 * 1024);
            const written = (async () => {
                for (let count = 0; count < 512; count += 1) await writer.write(mib);
                await writer.close();
            })();
            const packed = new Uint8Array(await new Response(stream.readable).arrayBuffer());
            await written;
            return packed;
        }

        it('stops feeding the inflater at the limit, long before the end of the entry', async () => {
            const packed = await bomb();
            const bytes = encodeZip([...entries(PROJECT), { name: 'local_config.xml', data: packed }], '');
            const writes: number[] = [];
            const Real = DecompressionStream;
            // The output only stays small if the input stops coming, so the input is what is counted.
            class Counting {
                private readonly inner = new Real('deflate-raw');
                readonly readable = this.inner.readable;
                readonly writable = {
                    getWriter: () => {
                        const writer = this.inner.writable.getWriter();
                        return {
                            write: (chunk: Uint8Array<ArrayBuffer>) => {
                                writes.push(chunk.length);
                                return writer.write(chunk);
                            },
                            close: () => writer.close(),
                        };
                    },
                };
            }
            vi.stubGlobal('DecompressionStream', Counting);

            const read = await readRestoreInput([zipFile(markLastDeflated(bytes))]);

            expect(read).toEqual({ ok: false, error: 'entry_too_big' });
            expect(Math.max(...writes)).toBeLessThanOrEqual(64 * 1024);
            expect(writes.reduce((sum, length) => sum + length, 0)).toBeLessThan(packed.length / 2);
        });
    });

    it('refuses two project folders side by side', async () => {
        const bytes = encodeZip(entries({ 'A/io.xml': '<x/>', 'B/rules.xml': '<x/>' }), '');
        expect(await readRestoreInput([zipFile(bytes)])).toEqual({ ok: false, error: 'two_folders' });
    });

    it('refuses a file whose CRC does not match', async () => {
        const bytes = encodeZip(entries(PROJECT), '');
        bytes[40] = 0;
        expect(await readRestoreInput([zipFile(bytes)])).toEqual({ ok: false, error: 'corrupt' });
    });

    it('refuses a broken deflate stream', async () => {
        const bytes = patchCentral(encodeZip(entries(PROJECT), ''), 10, 8);
        expect(await readRestoreInput([zipFile(bytes)])).toEqual({ ok: false, error: 'corrupt' });
    });

    it('says what is missing or wrong', async () => {
        expect(await readRestoreInput([zipOf({ 'io.xml': '<x/>' })])).toEqual({ ok: false, error: 'missing_files' });
        expect(await readRestoreInput([textFile('io.xml', '<x/>')])).toEqual({ ok: false, error: 'missing_files' });
        expect(await readRestoreInput([textFile('a.zip', 'not a zip at all, but long enough to look')])).toEqual({ ok: false, error: 'not_a_zip' });
        expect(await readRestoreInput([textFile('a.json', '{')])).toEqual({ ok: false, error: 'bad_json' });
        expect(await readRestoreInput([textFile('a.json', '{"format":"other"}')])).toEqual({ ok: false, error: 'bad_format' });
        expect(await readRestoreInput([textFile('a.txt', 'x')])).toEqual({ ok: false, error: 'unsupported' });
        expect(await readRestoreInput([textFile('a.zip', 'x'), textFile('io.xml', 'x')])).toEqual({ ok: false, error: 'mixed' });
        expect(await readRestoreInput([zipFile(new Uint8Array([0xff, 0xfe]), 'io.xml'), textFile('rules.xml', 'x')])).toEqual({ ok: false, error: 'not_utf8' });
    });
});
