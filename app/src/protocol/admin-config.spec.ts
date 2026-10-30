import { describe, expect, it } from 'vitest';
import {
    MAX_WEBSOCKET_MESSAGE_BYTES,
    configBackupBody,
    configRestoreParams,
    configSetParams,
    isBackupDownload,
    restoreFitsOneMessage,
    toConfigBackup,
    toConfigOptions,
    toConfigRestoreResult,
    toConfigSetResult,
} from './admin-config';

describe('config codec', () => {
    it('reads options, a secret never carrying a value', () => {
        const [level, secret] = toConfigOptions({
            options: [
                { key: 'debug_level', group: 'Logging', type: 'int', description: 'd', value: '3', default: '3', secret: false, set: true, restart: true },
                { key: 'smtp_password', group: 'Notifications', type: 'string', description: 'p', value: 'leaked', default: '', secret: true, set: true, restart: false },
            ],
        });
        expect(level).toEqual({
            key: 'debug_level',
            group: 'Logging',
            type: 'int',
            description: 'd',
            value: '3',
            default: '3',
            secret: false,
            set: true,
            restart: true,
            choices: null,
        });
        expect(secret).toMatchObject({ secret: true, set: true, value: null });
        expect(toConfigOptions({ options: [{ key: 'lang', choices: ['en', 'fr'] }] })[0].choices).toEqual(['en', 'fr']);
    });

    it('reads config_set answers for plain keys and secrets', () => {
        expect(toConfigSetResult({ key: 'debug_level', value: '4', restart_required: true })).toEqual({
            key: 'debug_level',
            value: '4',
            set: true,
            restartRequired: true,
        });
        expect(toConfigSetResult({ key: 'smtp_password', set: true, restart_required: false })).toEqual({
            key: 'smtp_password',
            value: null,
            set: true,
            restartRequired: false,
        });
        expect(toConfigSetResult(null)).toBeNull();
        expect(configSetParams('lang', '')).toEqual({ key: 'lang', value: '' });
    });

    it('reads a backup document only in its format', () => {
        const doc = { format: 'calaos-config-backup/1', created_at: 'c', server_version: 'v', hostname: 'h', files: { 'io.xml': '<x/>', bad: 3 } };
        expect(toConfigBackup(doc)).toEqual({ format: 'calaos-config-backup/1', createdAt: 'c', serverVersion: 'v', hostname: 'h', ioFormat: 0, files: { 'io.xml': '<x/>' } });
        expect(toConfigBackup({ ...doc, format: 'calaos-config-backup/2', io_format: 2 })?.ioFormat).toBe(2);
        expect(toConfigBackup({ ...doc, format: 'other' })).toBeNull();
    });

    it('puts the session in the body of the HTTP backup, never the URL', () => {
        expect(JSON.parse(configBackupBody('u', 'p', 'abc'))).toEqual({ action: 'config_backup', cn_user: 'u', cn_pass: 'p', admin_session: 'abc' });
    });

    it('tells a download from an error answer by its attachment header', () => {
        expect(isBackupDownload('attachment; filename="x.json"')).toBe(true);
        expect(isBackupDownload('  ATTACHMENT')).toBe(true);
        expect(isBackupDownload(null)).toBe(false);
        expect(isBackupDownload('inline')).toBe(false);
    });

    it('reads a restore answer, a dry run having no previous folder', () => {
        const raw = {
            dry_run: true,
            files: ['io.xml', 'rules.xml', 3],
            backup: { rooms: 4, ios: 21, devices: 3, rules: 12 },
            box: { rooms: 5, ios: '24' },
            io_format: 2,
            kept: ['listen_address'],
            warnings: ['devices_removed'],
        };
        expect(toConfigRestoreResult(raw)).toEqual({
            dryRun: true,
            files: ['io.xml', 'rules.xml'],
            backup: { rooms: 4, ios: 21, devices: 3, rules: 12 },
            box: { rooms: 5, ios: 0, devices: 0, rules: 0 },
            ioFormat: 2,
            kept: ['listen_address'],
            warnings: ['devices_removed'],
            previous: null,
            restarting: false,
        });
        expect(toConfigRestoreResult({ ...raw, dry_run: false, previous: '2026/x', restarting: true })).toMatchObject({
            dryRun: false,
            previous: '2026/x',
            restarting: true,
        });
        expect(toConfigRestoreResult({ previous: '' })?.previous).toBeNull();
        expect(toConfigRestoreResult(null)).toBeNull();
    });

    it('sends the files with the dry run flag', () => {
        expect(configRestoreParams({ 'io.xml': 'a' }, true)).toEqual({ files: { 'io.xml': 'a' }, dry_run: true });
    });

    it('measures the frame, whose JSON escapes grow the XML', () => {
        const session = 'b'.repeat(64);
        const room = MAX_WEBSOCKET_MESSAGE_BYTES - 300;
        expect(restoreFitsOneMessage({ 'io.xml': 'x'.repeat(room) }, session)).toBe(true);
        expect(restoreFitsOneMessage({ 'io.xml': '"'.repeat(room / 2 + 300) }, session)).toBe(false);
        expect(restoreFitsOneMessage({ 'io.xml': 'é'.repeat(room / 2 + 300) }, session)).toBe(false);
    });
});
