// `logs_sources` / `logs_query` of the fake daemon (calaos-container
// docs/API.md "Logs"): a synthetic journal of 20 000 entries over 7 days,
// already redacted the way the daemon masks, paged by cursor both ways.
// "Live" lines (1 to 3 a second) are generated when a query arrives, from
// the time elapsed since the previous one: no timer keeps the mock busy.

const SOURCES = [
    ['calaos-server', 'Calaos server'],
    ['calaos-home', 'Calaos Home (kiosk)'],
    ['haproxy', 'haproxy'],
    ['mosquitto', 'Mosquitto'],
    ['zigbee2mqtt', 'Zigbee2MQTT'],
    ['influxdb', 'InfluxDB'],
    ['grafana', 'Grafana'],
    ['hue2mqtt', 'hue2mqtt'],
    ['envoy', 'Envoy'],
    ['calaos-container', 'calaos-container'],
    ['olad', 'OLA (olad)'],
    ['ntp', 'Time sync (NTP)'],
    ['calaos-ddns', 'Calaos DDNS'],
    ['networkd', 'Network (networkd)'],
    ['ssh', 'SSH'],
    ['kernel', 'Kernel'],
    ['system', 'Whole system'],
];
const SOURCE_IDS = SOURCES.map(([id]) => id);
const UNITS = {
    ntp: 'chrony.service',
    networkd: 'systemd-networkd.service',
    kernel: 'kernel',
};
const PRIORITIES = ['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug'];

const RING_SIZE = 20_000;
const RING_MAX = 25_000;
const SPAN_MS = 7 * 86_400_000;
const SCAN_MAX = 5000;
const MESSAGE_MAX = 2048;
const RATE_PER_SECOND = 2;
const LIVE_CATCH_UP_MAX = 600;

/**
 * What the daemon's redaction leaves in a message: each sample is a line a
 * real driver prints, after masking.
 */
const TEMPLATES = {
    'calaos-server': [
        [6, 'WagoOutput(light_{n}): write coil {n} on 192.168.1.50 ok'],
        [6, 'JsonApiHandlerWS: login from 192.168.1.{n}'],
        [4, 'HttpClient: GET /api.php?cn_user=***&cn_pass=*** answered 200'],
        [6, 'Calaos admin code ******: open the web console. Valid 60 s, never share it.'],
        [3, 'MqttBrokersList: connection to mqtt://***@127.0.0.1:1883 refused, retrying in 5 s'],
        [7, 'Rule "Night {n}": condition evaluated to false'],
    ],
    'calaos-home': [
        [6, 'ApplicationMain: page Home shown'],
        [4, 'CalaosConnection: websocket closed, reconnecting'],
    ],
    haproxy: [
        [6, 'Proxy calaos started.'],
        [5, 'Server calaos/local is UP, reason: Layer4 check passed'],
    ],
    mosquitto: [
        [6, 'New client connected from 172.17.0.{n} as zigbee2mqtt (p2, c1, k60, u***).'],
        [6, 'Client calaos-{n} disconnected.'],
    ],
    zigbee2mqtt: [
        [6, "MQTT publish: topic 'zigbee2mqtt/0x00158d000{n}', payload '{\"temperature\":21.{n},\"battery\":97}'"],
        [4, 'Device 0x00158d000{n} did not respond to a ping'],
        [6, 'Loaded config {"mqtt":{"server":"mqtt://localhost","password": "***"}}'],
    ],
    influxdb: [[6, 'Write to bucket calaos: {n} points']],
    grafana: [[6, 'HTTP Server Listen address=[::]:3000 protocol=http']],
    envoy: [[5, 'Envoy: production {n} W']],
    'calaos-container': [
        [6, 'GET /api/v2/update/status 200'],
        [4, 'authorization: bearer *** refused (stale token)'],
        [6, 'apt: 0 upgraded, 0 newly installed'],
    ],
    ntp: [[6, 'Selected source 162.159.200.{n} (2.debian.pool.ntp.org)']],
    'calaos-ddns': [[6, 'Updated calaos-{n}.calaos.fr to 82.65.12.{n}']],
    networkd: [
        [6, 'eth0: Gained carrier'],
        [5, 'eth0: DHCPv4 address 192.168.1.{n}/24, gateway 192.168.1.1'],
    ],
    ssh: [
        [6, 'Accepted publickey for root from 192.168.1.{n} port 5{n}22 ssh2'],
        [5, 'Connection closed by authenticating user root 10.0.0.{n} port 4{n}12 [preauth]'],
    ],
    kernel: [
        [6, 'eth0: Link is Up - 1Gbps/Full - flow control rx/tx'],
        [4, 'usb 1-1.{n}: device descriptor read/64, error -71'],
        [2, 'EXT4-fs warning (device mmcblk0p3): ext4_end_bio:{n}: I/O error 10 writing to inode {n}'],
    ],
};
/** Weighted: the busy services write most of the journal. */
const WEIGHTS = [
    ['calaos-server', 30],
    ['zigbee2mqtt', 18],
    ['mosquitto', 10],
    ['calaos-container', 8],
    ['haproxy', 6],
    ['networkd', 4],
    ['kernel', 6],
    ['ntp', 3],
    ['ssh', 4],
    ['calaos-home', 4],
    ['influxdb', 3],
    ['grafana', 2],
    ['envoy', 1],
    ['calaos-ddns', 1],
];
const WEIGHT_TOTAL = WEIGHTS.reduce((sum, [, w]) => sum + w, 0);

/** mulberry32: the same journal on every reset. */
function prng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function cursorOf(seq) {
    return `s=6d6f636b6a6f75726e616c;i=${seq.toString(16)};b=mock`;
}

function seqOf(cursor) {
    const match = /;i=([0-9a-f]+);/.exec(cursor);
    return match === null ? null : parseInt(match[1], 16);
}

function isoMs(ms) {
    return new Date(ms).toISOString();
}

const RFC3339 = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/;

export function createLogs({ failure }) {
    let state;

    function reset() {
        state = {
            /** Generated on first use. */
            entries: null,
            firstSeq: 0,
            nextSeq: 0,
            lastLiveAt: 0,
            live: true,
            random: prng(0x5eed),
            /** session → recent query times (ms). */
            calls: new Map(),
            rateLimitNext: 0,
            failNext: false,
            truncateNext: false,
            queries: [],
        };
    }
    reset();

    function pickSource() {
        let roll = state.random() * WEIGHT_TOTAL;
        for (const [id, w] of WEIGHTS) {
            roll -= w;
            if (roll < 0) return id;
        }
        return WEIGHTS[0][0];
    }

    function makeEntry(ts) {
        const source = pickSource();
        const templates = TEMPLATES[source];
        const [priority, template] = templates[Math.floor(state.random() * templates.length)];
        const n = String(Math.floor(state.random() * 90) + 10);
        let message = template.replaceAll('{n}', n);
        let cut = false;
        // One in a thousand is a stack dump past the daemon's cut.
        if (state.random() < 0.001) {
            message = `${message} ${'trace '.repeat(400)}`.slice(0, MESSAGE_MAX);
            cut = true;
        }
        const seq = state.nextSeq;
        state.nextSeq += 1;
        const entry = {
            cursor: cursorOf(seq),
            ts: isoMs(ts),
            source,
            unit: UNITS[source] ?? `${source}.service`,
            priority,
            message,
        };
        if (source !== 'kernel') entry.pid = 400 + (seq % 1500);
        if (cut) entry.cut = true;
        return entry;
    }

    function ensure() {
        if (state.entries !== null) return;
        const now = Date.now();
        state.entries = [];
        const step = SPAN_MS / RING_SIZE;
        for (let i = 0; i < RING_SIZE; i += 1) {
            const ts = now - SPAN_MS + Math.floor(i * step + state.random() * step * 0.9);
            state.entries.push(makeEntry(ts));
        }
        state.lastLiveAt = now;
    }

    /** 1 to 3 lines for every second since the last query. */
    function catchUp() {
        const now = Date.now();
        if (!state.live) {
            state.lastLiveAt = now;
            return;
        }
        const seconds = Math.floor((now - state.lastLiveAt) / 1000);
        if (seconds <= 0) return;
        let count = 0;
        for (let s = 0; s < seconds && count < LIVE_CATCH_UP_MAX; s += 1) {
            const lines = 1 + Math.floor(state.random() * 3);
            for (let l = 0; l < lines; l += 1) {
                const ts = state.lastLiveAt + s * 1000 + Math.floor(((l + 1) * 1000) / (lines + 1));
                state.entries.push(makeEntry(Math.min(ts, now)));
                count += 1;
            }
        }
        state.lastLiveAt += seconds * 1000;
        if (state.entries.length > RING_MAX) {
            const drop = state.entries.length - RING_MAX;
            state.entries.splice(0, drop);
            state.firstSeq += drop;
        }
    }

    /** calaos_server's checks; the parsed query, or an error payload. */
    function parse(params) {
        const bad = (msg) => ({ error: failure('invalid_request', msg) });
        const q = { sources: ['system'], priority: 7, since: null, until: null, text: '', lines: 200, cursor: null, direction: 'backward' };
        if (params.sources !== undefined) {
            if (!Array.isArray(params.sources) || params.sources.length < 1 || params.sources.length > 8) return bad('sources: 1 to 8 ids');
            if (!params.sources.every((id) => SOURCE_IDS.includes(id))) return bad('unknown source');
            q.sources = params.sources;
        }
        if (params.priority !== undefined) {
            const p = params.priority;
            if (typeof p === 'number' && Number.isInteger(p) && p >= 0 && p <= 7) q.priority = p;
            else if (typeof p === 'string' && PRIORITIES.includes(p)) q.priority = PRIORITIES.indexOf(p);
            else return bad('invalid priority');
        }
        for (const key of ['since', 'until']) {
            if (params[key] === undefined) continue;
            if (typeof params[key] !== 'string' || !RFC3339.test(params[key])) return bad(`invalid ${key}`);
            q[key] = Date.parse(params[key]);
        }
        if (q.since !== null && q.until !== null && q.since >= q.until) return bad('since must be before until');
        if (params.text !== undefined) {
            if (typeof params.text !== 'string' || [...params.text].length > 256) return bad('invalid text');
            q.text = params.text.toLowerCase();
        }
        if (params.lines !== undefined) {
            if (typeof params.lines !== 'number' || !Number.isInteger(params.lines) || params.lines < 1 || params.lines > 1000) {
                return bad('lines: 1 to 1000');
            }
            q.lines = params.lines;
        }
        if (params.cursor !== undefined) {
            if (typeof params.cursor !== 'string' || params.cursor.length > 512 || !/^[\x20-\x7e]+$/.test(params.cursor)) {
                return bad('invalid cursor');
            }
            q.cursor = params.cursor;
        }
        if (params.direction !== undefined) {
            if (params.direction !== 'backward' && params.direction !== 'forward') return bad('invalid direction');
            q.direction = params.direction;
        }
        if (q.direction === 'forward' && q.cursor === null && q.since === null) return bad('forward needs a cursor or since');
        // The daemon's 7-day default for a backward read without `since`.
        if (q.direction === 'backward' && q.since === null) q.since = Date.now() - SPAN_MS;
        return { query: q };
    }

    function matches(q, entry) {
        if (entry.priority > q.priority) return null;
        if (q.text !== '' && !entry.message.toLowerCase().includes(q.text)) return null;
        if (q.sources.includes(entry.source)) return entry.source;
        if (q.sources.includes('system')) return 'system';
        return null;
    }

    function run(q) {
        const list = state.entries;
        const out = [];
        let scanned = 0;
        let last = null;
        let reachedEnd = false;
        const cursorSeq = q.cursor === null ? null : seqOf(q.cursor);
        if (q.direction === 'backward') {
            let i = list.length - 1;
            if (cursorSeq !== null) i = Math.min(list.length - 1, cursorSeq - state.firstSeq - 1);
            for (; ; i -= 1) {
                if (i < 0) {
                    reachedEnd = true;
                    break;
                }
                const entry = list[i];
                const ts = Date.parse(entry.ts);
                if (q.until !== null && ts >= q.until) continue;
                if (ts < q.since) {
                    reachedEnd = true;
                    break;
                }
                if (scanned >= SCAN_MAX || out.length >= q.lines) break;
                scanned += 1;
                last = entry;
                const source = matches(q, entry);
                if (source !== null) out.push({ ...entry, source });
            }
            out.reverse();
        } else {
            let i = 0;
            if (cursorSeq !== null) i = Math.max(0, cursorSeq - state.firstSeq + 1);
            for (; ; i += 1) {
                if (i >= list.length) {
                    reachedEnd = true;
                    break;
                }
                const entry = list[i];
                const ts = Date.parse(entry.ts);
                if (q.since !== null && ts < q.since) continue;
                if (q.until !== null && ts >= q.until) {
                    reachedEnd = true;
                    break;
                }
                if (scanned >= SCAN_MAX || out.length >= q.lines) break;
                scanned += 1;
                last = entry;
                const source = matches(q, entry);
                if (source !== null) out.push({ ...entry, source });
            }
        }
        return {
            entries: out,
            truncated: false,
            complete: out.length >= q.lines || reachedEnd,
            next_cursor: last === null ? null : last.cursor,
        };
    }

    function rateLimited(session) {
        if (state.rateLimitNext > 0) {
            state.rateLimitNext -= 1;
            return true;
        }
        const now = Date.now();
        const recent = (state.calls.get(session) ?? []).filter((at) => now - at < 1000);
        if (recent.length >= RATE_PER_SECOND) {
            state.calls.set(session, recent);
            return true;
        }
        recent.push(now);
        state.calls.set(session, recent);
        return false;
    }

    function handle(action, session, params) {
        if (action === 'logs_sources') {
            return { success: 'true', result: { sources: SOURCES.map(([id, label]) => ({ id, label })) } };
        }
        if (action !== 'logs_query') return undefined;
        const parsed = parse(params);
        if (parsed.error !== undefined) return parsed.error;
        if (rateLimited(session)) return failure('rate_limited', 'Too many log queries', { retry_after: '1' });
        if (state.failNext) {
            state.failNext = false;
            return failure('internal', 'journalctl failed');
        }
        ensure();
        catchUp();
        state.queries.push(params);
        const result = run(parsed.query);
        if (state.truncateNext && result.entries.length > 1) {
            // The 1 MiB budget drops the entries farthest from the start point.
            state.truncateNext = false;
            const keep = Math.ceil(result.entries.length / 2);
            result.entries = parsed.query.direction === 'forward' ? result.entries.slice(0, keep) : result.entries.slice(-keep);
            result.truncated = true;
            result.next_cursor = (parsed.query.direction === 'forward' ? result.entries.at(-1) : result.entries[0]).cursor;
        }
        return { success: 'true', result };
    }

    /** `/control {op:'admin', logs:{live, rateLimitNext, failNext, truncateNext}}`. */
    function configure(patch) {
        if (patch.live !== undefined) state.live = Boolean(patch.live);
        if (Number.isInteger(patch.rateLimitNext)) state.rateLimitNext = patch.rateLimitNext;
        if (patch.failNext !== undefined) state.failNext = Boolean(patch.failNext);
        if (patch.truncateNext !== undefined) state.truncateNext = Boolean(patch.truncateNext);
        return null;
    }

    function status() {
        return { size: state.entries?.length ?? 0, queries: state.queries.length, lastQuery: state.queries.at(-1) ?? null };
    }

    return { reset, handle, configure, status };
}
