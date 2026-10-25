// `network_state` / `network_apply` / `network_confirm` / `network_revert`
// of the fake daemon (calaos-container docs/API.md "Network configuration").
// A change is pending for `confirmMs` (120 s), then rolls back with the
// `network_rolled_back` alert; `dropOnApply` cuts every socket right after
// the answer, as a box that moved to its new address does, and
// `dropOnApply: 'before'` cuts them before it, the answer never arriving.
// The rollback alert is stored in the event log, as calaos_server does.

import { randomBytes } from 'node:crypto';

const INTF = /^[a-zA-Z0-9_.-]{1,15}$/;
const RESERVED = ['.', '..', 'lo', 'apply', 'confirm', 'revert', 'state', 'list', 'trial'];
const OCTET = '(?:0|[1-9]\\d{0,2})';
const IPV4 = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);
const HEX16 = /^[0-9a-f]{16}$/;
const CONFIRM_WITHIN_S = 120;

function isIpv4(value) {
    return typeof value === 'string' && IPV4.test(value) && value.split('.').every((o) => Number(o) <= 255);
}

function isCidr(value) {
    if (typeof value !== 'string') return false;
    const [addr, prefix, extra] = value.split('/');
    return extra === undefined && prefix !== undefined && isIpv4(addr) && /^(?:\d|[12]\d|3[0-2])$/.test(prefix);
}

function isDomain(value) {
    if (typeof value !== 'string' || value === '' || value.length > 253 || !/^[a-zA-Z0-9.-]+$/.test(value)) return false;
    const name = value.endsWith('.') ? value.slice(0, -1) : value;
    return name !== '' && name.split('.').every((l) => l !== '' && l.length <= 63 && !l.startsWith('-') && !l.endsWith('-'));
}

function iso(ms) {
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * The checks of calaos_server and the daemon, then the six strings the code
 * is bound to (verbatim, `""` when absent). `{error}` or `{bound}`.
 */
export function networkBinding(params, failure, knownIntf) {
    const bad = (msg) => ({ error: failure('invalid_request', msg) });
    const { intf, dhcp } = params;
    if (typeof intf !== 'string' || !INTF.test(intf) || RESERVED.includes(intf)) return bad('invalid intf');
    if (typeof dhcp !== 'boolean') return bad('dhcp must be a boolean');
    for (const key of ['ipv4', 'gateway']) {
        if (params[key] !== undefined && typeof params[key] !== 'string') return bad(`${key} must be a string`);
    }
    for (const key of ['dns_servers', 'search_domains']) {
        if (params[key] !== undefined && (!Array.isArray(params[key]) || !params[key].every((v) => typeof v === 'string'))) {
            return bad(`${key} must be an array of strings`);
        }
    }
    const ipv4 = params.ipv4 ?? '';
    const gateway = params.gateway ?? '';
    const dns = params.dns_servers ?? [];
    const domains = params.search_domains ?? [];
    if (dhcp) {
        if (ipv4 !== '' || gateway !== '' || dns.length > 0 || domains.length > 0) {
            return bad('dhcp: no static field allowed');
        }
    } else {
        if (!isCidr(ipv4)) return bad('ipv4 must be a CIDR with an explicit prefix');
        if (gateway !== '' && !isIpv4(gateway)) return bad('invalid gateway');
        if (dns.length > 4 || !dns.every(isIpv4)) return bad('invalid dns_servers');
        if (domains.length > 4 || !domains.every(isDomain)) return bad('invalid search_domains');
    }
    if (knownIntf !== undefined && !knownIntf(intf)) return bad('unknown interface');
    return {
        bound: {
            intf,
            dhcp: dhcp ? 'true' : 'false',
            ipv4,
            gateway,
            dns_servers: dns.join(','),
            search_domains: domains.join(','),
        },
    };
}

export function createNetwork({ hub, failure, event, running, useCode, proofFormatError, rolledBack }) {
    let state;
    let timer = null;

    function defaultInterfaces() {
        return [
            { name: 'lo', ipv4: '127.0.0.1/8', gateway: '', mac: '00:00:00:00:00:00', state: 'carrier', dhcp: false, dns_servers: [], search_domains: [] },
            { name: 'eth0', ipv4: '192.168.1.10/24', gateway: '192.168.1.1', mac: 'b8:27:eb:12:34:56', state: 'routable', dhcp: false, dns_servers: ['192.168.1.1'], search_domains: ['lan'] },
            { name: 'eth1', ipv4: '', gateway: '', mac: 'b8:27:eb:65:43:21', state: 'no-carrier', dhcp: true, dns_servers: [], search_domains: [] },
        ];
    }

    function reset() {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        state = {
            interfaces: defaultInterfaces(),
            /** {change_id, intf, applied_at, appliedMs, deadline, previous} */
            pending: null,
            confirmMs: CONFIRM_WITHIN_S * 1000,
            dropOnApply: false,
            applies: 0,
            rollbacks: 0,
            history: [],
        };
    }
    reset();

    function intfEntry(name) {
        return state.interfaces.find((entry) => entry.name === name);
    }

    function hex16() {
        return randomBytes(8).toString('hex');
    }

    function pendingView() {
        if (state.pending === null) return null;
        const { change_id, intf, applied_at, deadline } = state.pending;
        return { change_id, intf, applied_at, expires_in: Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) };
    }

    function restore() {
        const p = state.pending;
        const entry = intfEntry(p.intf);
        if (entry !== undefined) Object.assign(entry, p.previous);
        state.pending = null;
        if (timer !== null) clearTimeout(timer);
        timer = null;
    }

    function rollBack() {
        const intf = state.pending.intf;
        restore();
        state.rollbacks += 1;
        state.history.push({ kind: 'rolled_back', intf });
        rolledBack(intf);
    }

    function arm(ms) {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            if (state.pending !== null) rollBack();
        }, Math.max(0, ms));
        // A pending change must not keep a test process alive.
        timer.unref?.();
    }

    function apply(session, params) {
        const checked = networkBinding(params, failure, (name) => intfEntry(name) !== undefined && name !== 'lo');
        if (checked.error !== undefined) return checked.error;
        const formatError = proofFormatError(params, true);
        if (formatError !== null) return formatError;
        if (state.pending !== null) {
            const view = pendingView();
            return failure('network_pending', 'A network change is waiting for confirmation', {
                change_id: view.change_id,
                expires_in: String(view.expires_in),
            });
        }
        if (running()) return failure('upgrade_in_progress', 'upgrade already in progress');
        const codeError = useCode(session, params, 'network_config', checked.bound);
        if (codeError !== null) return codeError;

        const entry = intfEntry(params.intf);
        const now = Date.now();
        const previous = { ipv4: entry.ipv4, gateway: entry.gateway, dhcp: entry.dhcp, dns_servers: [...entry.dns_servers], search_domains: [...entry.search_domains] };
        Object.assign(entry, params.dhcp
            ? { dhcp: true, ipv4: '192.168.1.77/24', gateway: '192.168.1.1', dns_servers: ['192.168.1.1'], search_domains: [] }
            : { dhcp: false, ipv4: params.ipv4, gateway: params.gateway ?? '', dns_servers: [...(params.dns_servers ?? [])], search_domains: [...(params.search_domains ?? [])] });
        state.pending = {
            change_id: hex16(),
            intf: params.intf,
            applied_at: iso(now),
            deadline: now + state.confirmMs,
            previous,
        };
        state.applies += 1;
        state.history.push({ kind: 'applied', intf: params.intf });
        arm(state.confirmMs);
        const result = { change_id: state.pending.change_id, intf: params.intf, applied_at: state.pending.applied_at, confirm_within: CONFIRM_WITHIN_S };
        event('network_pending', { ...result });
        if (state.dropOnApply === 'before') {
            hub.dropClients();
            return null;
        }
        if (state.dropOnApply) setTimeout(() => hub.dropClients(), 100);
        return { success: 'true', result };
    }

    function finish(params, kind) {
        if (!HEX16.test(String(params.change_id))) return failure('invalid_request', 'invalid change_id');
        if (state.pending === null || state.pending.change_id !== params.change_id) {
            return failure('invalid_request', 'unknown or finished change');
        }
        const { change_id, intf } = state.pending;
        if (kind === 'confirmed') {
            state.pending = null;
            if (timer !== null) clearTimeout(timer);
            timer = null;
            event('network_applied', { intf, change_id });
        } else {
            restore();
        }
        state.history.push({ kind, intf });
        return { success: 'true', result: { change_id, intf, state: kind } };
    }

    function handle(action, session, params) {
        switch (action) {
            case 'network_state':
                return { success: 'true', result: { interfaces: structuredClone(state.interfaces), pending: pendingView() } };
            case 'network_apply':
                return apply(session, params);
            case 'network_confirm':
                return finish(params, 'confirmed');
            case 'network_revert':
                return finish(params, 'reverted');
            default:
                return undefined;
        }
    }

    /**
     * `/control {op:'admin', network:{confirmMs, dropOnApply (true | 'before'), expire, pending}}`.
     * `expire` rolls the pending change back now; `pending` seeds one
     * (`{intf, ageMs}`), as a reload at the new address finds it.
     */
    function configure(patch) {
        if (patch.confirmMs !== undefined) state.confirmMs = Number(patch.confirmMs);
        if (patch.dropOnApply !== undefined) state.dropOnApply = patch.dropOnApply === 'before' ? 'before' : Boolean(patch.dropOnApply);
        if (patch.expire && state.pending !== null) rollBack();
        if (typeof patch.pending === 'object' && patch.pending !== null) {
            const entry = intfEntry(patch.pending.intf ?? 'eth0');
            if (entry === undefined) return `unknown interface '${patch.pending.intf}'`;
            const appliedMs = Date.now() - Number(patch.pending.ageMs ?? 0);
            state.pending = {
                change_id: hex16(),
                intf: entry.name,
                applied_at: iso(appliedMs),
                deadline: appliedMs + state.confirmMs,
                previous: { ipv4: entry.ipv4, gateway: entry.gateway, dhcp: entry.dhcp, dns_servers: [...entry.dns_servers], search_domains: [...entry.search_domains] },
            };
            arm(state.pending.deadline - Date.now());
        }
        return null;
    }

    function status() {
        return { pending: pendingView(), applies: state.applies, rollbacks: state.rollbacks, history: [...state.history] };
    }

    return { reset, handle, configure, status };
}
