import { describe, expect, it } from 'vitest';
import {
    encodeAdminAction,
    encodeAdminSet,
    encodeAdminUnlock,
    encodeChangeCredentials,
    isAdminFailure,
    toAdminError,
    toUpdateList,
    toUpgradeJob,
    toUpgradeStatus,
} from './admin';
import { decodeServerMessage } from './messages';

describe('admin encoders', () => {
    it('encodes admin_unlock with its msg_id', () => {
        expect(encodeAdminUnlock('correct horse battery', '2')).toBe(
            '{"msg":"admin_unlock","msg_id":"2","data":{"admin_pass":"correct horse battery"}}',
        );
    });

    it('omits admin_session entirely for a bootstrap admin_set', () => {
        // An empty `admin_session` key counts as PRESENT (→ bad_session), so
        // the bootstrap frame must not carry the key at all.
        expect(encodeAdminSet('a long admin password', null, '3')).toBe(
            '{"msg":"admin_set","msg_id":"3","data":{"new_pass":"a long admin password"}}',
        );
        expect(encodeAdminSet('another long password', '9b1f', '3')).toBe(
            '{"msg":"admin_set","msg_id":"3","data":{"new_pass":"another long password","admin_session":"9b1f"}}',
        );
    });

    it('encodes admin actions with and without session and params', () => {
        expect(encodeAdminAction('update_status', null, '4')).toBe(
            '{"msg":"admin","msg_id":"4","data":{"action":"update_status"}}',
        );
        expect(encodeAdminAction('update_upgrade', 'abc', '5', { package: 'calaos-server' })).toBe(
            '{"msg":"admin","msg_id":"5","data":{"action":"update_upgrade","admin_session":"abc","params":{"package":"calaos-server"}}}',
        );
    });

    it('encodes the household change_cred frame', () => {
        expect(encodeChangeCredentials('user', 'pass', 'raoul', 's3cret')).toBe(
            '{"msg":"settings","data":{"action":"change_cred","old_user":"user","old_pw":"pass","new_user":"raoul","new_pw":"s3cret"}}',
        );
    });
});

describe('admin error payload', () => {
    it('reads the code and its optional string fields', () => {
        const error = toAdminError({
            success: 'false',
            error: 'rate_limited',
            msg: 'Too many attempts',
            retry_after: '42',
        });
        expect(error).toMatchObject({ code: 'rate_limited', msg: 'Too many attempts', retryAfter: 42 });

        expect(toAdminError({ error: 'password_too_short', min_length: '10' }).minLength).toBe(10);
        expect(toAdminError({ error: 'upgrade_in_progress', job_id: 'ab' }).jobId).toBe('ab');
        expect(toAdminError({ error: 'admin_not_set', api_allowed_hosts: 'h' }).apiAllowedHosts).toBe('h');
    });

    it('keeps package_held as its own code', () => {
        expect(toAdminError({ error: 'package_held', msg: 'calaos-server is held' }).code).toBe('package_held');
    });

    it('maps an unlisted code to unknown and keeps the msg', () => {
        expect(toAdminError({ error: 'brand_new', msg: 'x' })).toMatchObject({ code: 'unknown', msg: 'x' });
        expect(toAdminError('garbage').code).toBe('unknown');
    });

    it('tells a success from a failure on the STRING success', () => {
        expect(isAdminFailure({ success: 'true', mode: 'bootstrap' })).toBe(false);
        expect(isAdminFailure({ success: 'false', error: 'bad_password' })).toBe(true);
        expect(isAdminFailure({ success: true })).toBe(true);
        expect(isAdminFailure(undefined)).toBe(false);
    });
});

describe('daemon result shapes', () => {
    it('reads <Status> with native numbers, clamped', () => {
        expect(
            toUpgradeStatus({ status: 'upgrading', total_percent: 142, current_pkg: 'calaos-server', pkg_index: 1, pkg_count: 2 }),
        ).toMatchObject({ status: 'upgrading', totalPercent: 100, currentPkg: 'calaos-server', pkgIndex: 1, pkgCount: 2 });
        expect(toUpgradeStatus({ status: 'weird' }).status).toBe('unknown');
        expect(toUpgradeStatus(null)).toMatchObject({ status: 'unknown', totalPercent: 0 });
    });

    it('reads the package names of the full view, none from the household one', () => {
        expect(
            toUpgradeStatus({
                packages: [{ name: 'calaos-server', state: 'done', percent: 100 }, { state: 'pending' }, 'junk'],
            }).packageNames,
        ).toEqual(['calaos-server', '', '']);
        expect(toUpgradeStatus({ packages: [{ state: 'pending', percent: 0 }] }).packageNames).toEqual(['']);
        expect(toUpgradeStatus({}).packageNames).toEqual([]);
    });

    it('reads <Job> and null', () => {
        expect(toUpgradeJob(null)).toBeNull();
        expect(
            toUpgradeJob({ id: '3f9c', kind: 'upgrade_all', status: 'done', reboot_required: true, daemon_restart: false }),
        ).toMatchObject({ id: '3f9c', status: 'done', rebootRequired: true, daemonRestart: false, error: '' });
    });

    it('turns the package map into a sorted list', () => {
        expect(
            toUpdateList({
                'calaos-server': { name: 'calaos-server', version: '4.6.0', current_version: '4.5.0' },
                'calaos-container': { version: '1.4.0', current_version: '1.3.2' },
            }),
        ).toEqual([
            { name: 'calaos-container', version: '1.4.0', currentVersion: '1.3.2' },
            { name: 'calaos-server', version: '4.6.0', currentVersion: '4.5.0' },
        ]);
        expect(toUpdateList(undefined)).toEqual([]);
    });
});

describe('decodeServerMessage: admin frames', () => {
    it('hands admin replies over raw, keyed by msg and msg_id', () => {
        expect(
            decodeServerMessage('{"msg":"admin_unlock","msg_id":"4","data":{"success":"false","error":"bad_password","msg":"Wrong"}}'),
        ).toEqual({
            kind: 'admin_reply',
            msg: 'admin_unlock',
            msgId: '4',
            data: { success: 'false', error: 'bad_password', msg: 'Wrong' },
        });
        expect(decodeServerMessage({ msg: 'admin', data: { success: 'true', result: null } })).toMatchObject({
            kind: 'admin_reply',
            msg: 'admin',
            msgId: '',
        });
    });

    it('decodes admin_event with its native data', () => {
        expect(
            decodeServerMessage({
                msg: 'admin_event',
                data: { type: 'upgrade_progress', ts: '2026-10-22T09:12:05Z', data: { status: 'upgrading', total_percent: 42 } },
            }),
        ).toEqual({
            kind: 'admin_event',
            type: 'upgrade_progress',
            ts: '2026-10-22T09:12:05Z',
            data: { status: 'upgrading', total_percent: 42 },
        });
        expect(decodeServerMessage({ msg: 'admin_event', data: { type: 'admin_set', ts: 't' } })).toMatchObject({
            kind: 'admin_event',
            type: 'admin_set',
            data: undefined,
        });
    });

    it('decodes the change_cred answer and nothing else under settings', () => {
        expect(decodeServerMessage({ msg: 'settings', data: { action: 'change_cred', success: 'true' } })).toEqual({
            kind: 'change_cred',
            success: true,
        });
        expect(decodeServerMessage({ msg: 'settings', data: { action: 'other' } }).kind).toBe('unknown');
    });
});
