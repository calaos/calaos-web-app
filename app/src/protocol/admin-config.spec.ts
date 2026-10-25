import { describe, expect, it } from 'vitest';
import { backupFilename, configBackupBody, configSetParams, toConfigBackup, toConfigOptions, toConfigSetResult } from './admin-config';

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
        expect(toConfigBackup(doc)).toEqual({ format: 'calaos-config-backup/1', createdAt: 'c', serverVersion: 'v', hostname: 'h', files: { 'io.xml': '<x/>' } });
        expect(toConfigBackup({ ...doc, format: 'other' })).toBeNull();
    });

    it('puts the session in the body of the HTTP backup, never the URL', () => {
        expect(JSON.parse(configBackupBody('u', 'p', 'abc'))).toEqual({ action: 'config_backup', cn_user: 'u', cn_pass: 'p', admin_session: 'abc' });
    });

    it('takes the file name of an attachment only in the server pattern', () => {
        expect(backupFilename('attachment; filename="calaos-backup-calaos-20261025-0912.json"')).toBe('calaos-backup-calaos-20261025-0912.json');
        expect(backupFilename(null)).toBe('');
        expect(backupFilename('inline')).toBe('');
        const now = Date.parse('2026-10-25T09:12:59Z');
        expect(backupFilename('attachment; filename="../../.bashrc"', 'my box!', now)).toBe('calaos-backup-mybox-20261025-0912.json');
        expect(backupFilename('attachment', '', now)).toBe('calaos-backup-box-20261025-0912.json');
    });
});
