// `config_list` / `config_set` / `config_backup` / `config_restore` of the mock
// calaos_server (calaos_base docs/08_http_api.md "Configuration"): handled by
// the server itself, the daemon only validating the session. Secrets are
// write-only. The backup is also an HTTP action, answered as a file download.

/**
 * [key, group, type, default, restart, secret, choices?, bounds?] — a subset of
 * ConfigOptions.cpp, with its type ids (`typeId()`) and value lists.
 */
const REGISTRY = [
    ['debug_level', 'Logging', 'int', '4', true, false, ['0', '1', '2', '3', '4', '5'], [0, 5]],
    ['debug_domains', 'Logging', 'csv', '', true, false],
    ['smtp_server', 'Notifications', 'host', '', false, false],
    ['smtp_port', 'Notifications', 'port', '', false, false, null, [1, 65535]],
    ['smtp_auth', 'Notifications', 'bool', 'false', false, false],
    ['smtp_tls', 'Notifications', 'bool', 'false', false, false],
    ['smtp_username', 'Notifications', 'string', '', false, false],
    ['smtp_password', 'Notifications', 'password', '', false, true],
    ['user_emails', 'Notifications', 'email_list', '', false, false],
    ['history_keep_days', 'History', 'int', '30', false, false, null, [1, 3650]],
    ['influxdb_enabled', 'InfluxDB', 'bool', 'false', true, false],
    ['influxdb_version', 'InfluxDB', 'enum', '1', true, false, ['1', '2']],
    ['influxdb_host', 'InfluxDB', 'host', '127.0.0.1', true, false],
    ['influxdb_port', 'InfluxDB', 'port', '8086', true, false, null, [1, 65535]],
    ['influxdb_database', 'InfluxDB', 'string', 'calaos', true, false],
    ['influxdb_org', 'InfluxDB', 'string', 'calaos', true, false],
    ['influxdb_bucket', 'InfluxDB', 'string', 'calaos-data', true, false],
    ['influxdb_token', 'InfluxDB', 'token', '', true, true],
    ['influxdb_log_timeout', 'InfluxDB', 'int', '300', true, false, null, [0, 86400]],
    ['mcp_rate_limit', 'MCP', 'int', '300', true, false, null, [0, 100000]],
    ['mcp_ban_failures', 'MCP', 'int', '20', true, false, null, [0, 10000]],
    ['mcp_ban_seconds', 'MCP', 'int', '120', true, false, null, [0, 86400]],
    ['ota_enabled', 'OTA', 'bool', 'true', true, false, ['true', '1', 'false', '0']],
    ['ota_rescan_interval', 'OTA', 'int', '60', true, false, null, [1, 10080]],
    ['api_allowed_hosts', 'Origin', 'csv', '', false, false],
    ['latitude', 'Location', 'float', '46.422713', false, false, null, [-90, 90]],
    ['longitude', 'Location', 'float', '2.548828', false, false, null, [-180, 180]],
    ['show_cursor', 'Kiosk', 'bool', 'true', false, false],
    ['dpms_enable', 'Kiosk', 'bool', 'false', false, false],
    ['dpms_standby', 'Kiosk', 'int', '', false, false, null, [0, 1440]],
    ['lang', 'Kiosk', 'enum', '', false, false, ['de', 'en', 'es', 'fr', 'hi', 'nb', 'pl', 'ru']],
];

const RESTORE_ROOTS = { 'io.xml': 'calaos:ioconfig', 'rules.xml': 'calaos:rules', 'local_config.xml': 'calaos:config' };
const RESTORE_MAX_BYTES = 2 * 1024 * 1024;
const IO_FORMAT_DEVICES = 2;
/** calaos_server stops about this long after its answer left. */
const RESTORE_RESTART_MS = 500;

function describe(key) {
    return key.replaceAll('_', ' ');
}

/** calaos_server's sanitised file name: `[A-Za-z0-9._-]`, 32 chars, `box` if empty. */
const PREVIOUS_FOLDER = '2026/10/25-10-2026_17-14-15';

export function backupFilename(hostname, createdAtMs) {
    const host = hostname.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 32) || 'box';
    const stamp = new Date(createdAtMs).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
    return `calaos-backup-${host}-${stamp}.json`;
}

/** What calaos_server refuses before any session check, as its message; null when acceptable. */
function restoreRefusal(params) {
    const files = params?.files;
    if (typeof files !== 'object' || files === null) return 'files is required';
    for (const [name, content] of Object.entries(files)) {
        const root = RESTORE_ROOTS[name];
        if (root === undefined) return `Unexpected file: ${name}`;
        if (typeof content !== 'string') return `${name} must be a string`;
        if (Buffer.byteLength(content) > RESTORE_MAX_BYTES) return `${name} is too big`;
        if (!content.startsWith('<?xml')) return `${name} is not an XML file`;
        if (!content.includes(`<${root}`)) return `${name}: unexpected root element`;
    }
    for (const name of ['io.xml', 'rules.xml']) {
        if (files[name] === undefined) return `${name} is missing`;
    }
    if (ioFormatOf(files['io.xml']) > IO_FORMAT_DEVICES) {
        return `io.xml was made by a newer Calaos (format ${ioFormatOf(files['io.xml'])})`;
    }
    if (typeof params.dry_run !== 'boolean') return 'dry_run is required';
    return null;
}

/** 1 when the attribute is absent. */
function ioFormatOf(xml) {
    const format = /<calaos:ioconfig[^>]*\sformat="(\d+)"/.exec(xml);
    return format === null ? 1 : Number(format[1]);
}

function localOption(xml, name) {
    return new RegExp(`name="${name}" value="([^"]*)"`).exec(xml)?.[1];
}

export function createConfig({ failure, hub, running }) {
    let state;
    const timers = new Set();

    function reset() {
        for (const handle of timers) clearTimeout(handle);
        timers.clear();
        state = {
            /** key → stored value; absent means default. */
            values: new Map([
                ['smtp_server', 'smtp.example.org'],
                ['smtp_password', 'mock-smtp-secret'],
                ['latitude', '45.7640'],
                ['longitude', '4.8357'],
            ]),
            hostname: 'calaos-mock',
            /** `unrestorable` of the next backups; null leaves the field out, like a healthy box. */
            unrestorable: null,
            sets: [],
            backups: 0,
            restores: [],
            restore: {
                warnings: [],
                backup: { rooms: 4, ios: 21, devices: 3, rules: 12 },
                box: { rooms: 5, ios: 24, devices: 4, rules: 12 },
                kept: ['listen_address', 'mcp_service_token'],
                fail: '',
                failRestarting: false,
                upgrading: false,
                drop: true,
            },
        };
    }
    reset();

    function entry(key) {
        return REGISTRY.find(([k]) => k === key);
    }

    function option([key, group, type, def, restart, secret, choices]) {
        const stored = state.values.get(key);
        const out = {
            key,
            group,
            type,
            description: describe(key),
            default: def,
            secret,
            set: stored !== undefined && stored !== '',
            restart,
        };
        if (!secret) out.value = stored ?? def;
        if (choices) out.choices = [...choices];
        return out;
    }

    function validate([, , type, , , , choices, bounds], value) {
        if (choices && !choices.includes(value)) return `must be one of ${choices.join(', ')}`;
        if (type === 'bool' && value !== 'true' && value !== 'false') return 'must be true or false';
        if (type === 'int' || type === 'port' || type === 'float') {
            const n = Number(value);
            const integer = type !== 'float';
            if (value.trim() === '' || !Number.isFinite(n) || (integer && !Number.isInteger(n))) {
                return `must be ${integer ? 'an integer' : 'a number'}`;
            }
            if (bounds && (n < bounds[0] || n > bounds[1])) return `must be between ${bounds[0]} and ${bounds[1]}`;
        }
        if (type === 'email_list' && value.split(',').some((mail) => !/^[^@\s]+@[^@\s]+$/.test(mail.trim()))) {
            return 'must be a comma separated list of e-mail addresses';
        }
        return null;
    }

    function set(params) {
        if (typeof params.key !== 'string' || typeof params.value !== 'string') {
            return failure('invalid_request', 'key and value are strings');
        }
        const row = entry(params.key);
        if (row === undefined) return failure('invalid_request', `Unknown or protected key: ${params.key}`);
        const value = params.value;
        if (value !== '') {
            const problem = validate(row, value);
            if (problem !== null) return failure('invalid_request', `${params.key} ${problem}`);
        }
        if (value === '') state.values.delete(params.key);
        else state.values.set(params.key, value);
        state.sets.push(params.key);
        const [key, , , def, restart, secret] = row;
        const result = { key, restart_required: restart };
        if (secret) result.set = value !== '';
        else result.value = value === '' ? def : value;
        return { success: 'true', result };
    }

    /** Warnings the sent files really earn, then those the test asked for. */
    function restoreWarnings(local) {
        if (local === undefined) return ['no_local_config', ...state.restore.warnings];
        const user = localOption(local, 'cn_user');
        const pass = localOption(local, 'cn_pass');
        const changes = (user !== undefined && user !== hub.user) || (pass !== undefined && pass !== hub.pass);
        return [...(changes ? ['household_login_changes'] : []), ...state.restore.warnings];
    }

    function restartOnRestored(local) {
        const handle = setTimeout(() => {
            timers.delete(handle);
            if (local !== undefined) {
                hub.user = localOption(local, 'cn_user') ?? hub.user;
                hub.pass = localOption(local, 'cn_pass') ?? hub.pass;
            }
            if (state.restore.drop) hub.dropClients();
        }, RESTORE_RESTART_MS);
        timers.add(handle);
    }

    function restore(params) {
        if (running() || state.restore.upgrading) return failure('upgrade_in_progress', 'An update is running');
        const dryRun = params.dry_run === true;
        const local = params.files['local_config.xml'];
        const names = Object.keys(params.files);
        state.restores.push({ dry_run: dryRun, files: names });
        const result = {
            dry_run: dryRun,
            files: names,
            backup: state.restore.backup,
            box: state.restore.box,
            io_format: ioFormatOf(params.files['io.xml']),
            kept: state.restore.kept,
            warnings: restoreWarnings(local),
        };
        if (dryRun) return { success: 'true', result };
        if (state.restore.fail !== '') {
            // The extra fields of an error are strings on the wire.
            const restarting = state.restore.failRestarting === true;
            if (restarting) restartOnRestored(local);
            return failure('internal', `${state.restore.fail}; previous files in backups/${PREVIOUS_FOLDER}`, {
                previous: PREVIOUS_FOLDER,
                restarting: String(restarting),
            });
        }
        restartOnRestored(local);
        return { success: 'true', result: { ...result, previous: PREVIOUS_FOLDER, restarting: true } };
    }

    function backup() {
        state.backups += 1;
        const created = Date.now();
        const local = [...state.values].map(([k, v]) => `  <calaos:option name="${k}" value="${v}"/>`).join('\n');
        return {
            createdAtMs: created,
            document: {
                format: 'calaos-config-backup/2',
                created_at: new Date(created).toISOString().replace(/\.\d{3}Z$/, 'Z'),
                server_version: '4.6.0-mock',
                hostname: state.hostname,
                io_format: IO_FORMAT_DEVICES,
                ...(state.unrestorable === null ? {} : { unrestorable: state.unrestorable }),
                files: {
                    'io.xml': '<?xml version="1.0"?>\n<calaos:ioconfig xmlns:calaos="http://www.calaos.fr"/>\n',
                    'rules.xml': '<?xml version="1.0"?>\n<calaos:rules xmlns:calaos="http://www.calaos.fr"/>\n',
                    'local_config.xml': `<?xml version="1.0"?>\n<calaos:config xmlns:calaos="http://www.calaos.fr">\n  <calaos:option name="cn_user" value="${hub.user}"/>\n  <calaos:option name="cn_pass" value="${hub.pass}"/>\n${local}\n</calaos:config>\n`,
                },
            },
        };
    }

    function handle(action, session, params) {
        switch (action) {
            case 'config_list':
                return { success: 'true', result: { options: REGISTRY.map(option) } };
            case 'config_set':
                return set(params);
            case 'config_backup':
                return { success: 'true', result: backup().document };
            case 'config_restore':
                return restore(params);
            default:
                return undefined;
        }
    }

    /** The HTTP action: the document as a download, or the usual error payload without a file. */
    function httpBackup(refusal) {
        if (refusal !== null) {
            return { headers: { 'content-type': 'application/json; charset=utf-8' }, body: refusal };
        }
        const { createdAtMs, document } = backup();
        return {
            headers: {
                'content-type': 'application/json',
                'content-disposition': `attachment; filename="${backupFilename(state.hostname, createdAtMs)}"`,
                'cache-control': 'no-store',
                'x-content-type-options': 'nosniff',
            },
            body: document,
        };
    }

    /** `/control {op:'admin', config:{hostname, values, restore}}`. */
    function configure(patch) {
        if (typeof patch.hostname === 'string') state.hostname = patch.hostname;
        if (Array.isArray(patch.unrestorable) || patch.unrestorable === null) state.unrestorable = patch.unrestorable;
        if (typeof patch.restore === 'object' && patch.restore !== null) Object.assign(state.restore, patch.restore);
        if (typeof patch.values === 'object' && patch.values !== null) {
            for (const [key, value] of Object.entries(patch.values)) {
                if (entry(key) === undefined) return `unknown config key '${key}'`;
                state.values.set(key, String(value));
            }
        }
        return null;
    }

    function status() {
        return {
            values: Object.fromEntries(state.values),
            sets: [...state.sets],
            backups: state.backups,
            restores: [...state.restores],
        };
    }

    return { reset, handle, httpBackup, configure, status, restoreRefusal };
}
