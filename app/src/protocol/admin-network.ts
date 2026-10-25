// `network_state` / `network_apply` / `network_confirm` / `network_revert`
// and the network `admin_event`s (calaos_base docs/08_http_api.md, "Réseau").
// NO Vue imports. A change is a trial the daemon reverts by itself unless a
// client confirms it within 120 s, possibly from the box's new address.

import { isRecord, toWireString } from './guards';
import { toBool, toNumberOrNull } from './admin';

export const NETWORK_CONFIRM_WINDOW_S = 120;
export const NETWORK_LIST_MAX = 4;
const RESERVED_INTF = ['.', '..', 'lo', 'apply', 'confirm', 'revert', 'state', 'list', 'trial'];
const INTF_PATTERN = /^[a-zA-Z0-9_.-]{1,15}$/;
const OCTET = '(?:0|[1-9]\\d{0,2})';
const IPV4 = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);

export interface NetInterface {
    name: string;
    /** CIDR, '' when none. */
    ipv4: string;
    gateway: string;
    mac: string;
    /** networkd's operational state (`routable`, `no-carrier`…). */
    state: string;
    dhcp: boolean;
    dnsServers: string[];
    searchDomains: string[];
}

export interface NetworkPending {
    changeId: string;
    intf: string;
    /** RFC 3339 UTC, the daemon's. */
    appliedAt: string;
    /** Seconds left when read; the countdown runs from `appliedAt`. */
    expiresIn: number;
}

export interface NetworkState {
    interfaces: NetInterface[];
    pending: NetworkPending | null;
}

/** What `network_apply` and the `network_config` code are both built from. */
export interface NetworkChange {
    intf: string;
    dhcp: boolean;
    ipv4?: string;
    gateway?: string;
    dnsServers?: string[];
    searchDomains?: string[];
}

export interface NetworkApplied {
    changeId: string;
    intf: string;
    appliedAt: string;
    confirmWithin: number;
}

export interface NetworkFinished {
    changeId: string;
    intf: string;
    state: 'confirmed' | 'reverted';
}

function toStrings(raw: unknown): string[] {
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

function toPending(raw: unknown): NetworkPending | null {
    if (!isRecord(raw)) return null;
    const changeId = toWireString(raw.change_id);
    if (changeId === '') return null;
    return {
        changeId,
        intf: toWireString(raw.intf),
        appliedAt: toWireString(raw.applied_at),
        expiresIn: toNumberOrNull(raw.expires_in) ?? 0,
    };
}

export function toNetworkState(raw: unknown): NetworkState {
    const r = isRecord(raw) ? raw : {};
    const list = Array.isArray(r.interfaces) ? r.interfaces.filter(isRecord) : [];
    return {
        interfaces: list.map((i) => ({
            name: toWireString(i.name),
            ipv4: toWireString(i.ipv4),
            gateway: toWireString(i.gateway),
            mac: toWireString(i.mac),
            state: toWireString(i.state),
            dhcp: toBool(i.dhcp),
            dnsServers: toStrings(i.dns_servers),
            searchDomains: toStrings(i.search_domains),
        })),
        pending: toPending(r.pending),
    };
}

/**
 * The typed fields, shared by `network_apply` and the `code_params` of its
 * code: the daemon binds the code to these strings verbatim, so both must
 * be built here and nowhere else. A DHCP change carries no address field.
 */
export function networkChangeParams(change: NetworkChange): Record<string, unknown> {
    if (change.dhcp) return { intf: change.intf, dhcp: true };
    const params: Record<string, unknown> = { intf: change.intf, dhcp: false, ipv4: change.ipv4 ?? '' };
    if (change.gateway !== undefined && change.gateway !== '') params.gateway = change.gateway;
    if (change.dnsServers !== undefined && change.dnsServers.length > 0) params.dns_servers = [...change.dnsServers];
    if (change.searchDomains !== undefined && change.searchDomains.length > 0) {
        params.search_domains = [...change.searchDomains];
    }
    return params;
}

export function networkApplyParams(change: NetworkChange, codeId: string, code: string): Record<string, unknown> {
    return { ...networkChangeParams(change), code_id: codeId, code };
}

export function toNetworkApplied(raw: unknown): NetworkApplied | null {
    if (!isRecord(raw)) return null;
    const changeId = toWireString(raw.change_id);
    if (changeId === '') return null;
    return {
        changeId,
        intf: toWireString(raw.intf),
        appliedAt: toWireString(raw.applied_at),
        confirmWithin: toNumberOrNull(raw.confirm_within) ?? NETWORK_CONFIRM_WINDOW_S,
    };
}

export function toNetworkFinished(raw: unknown): NetworkFinished | null {
    if (!isRecord(raw)) return null;
    const changeId = toWireString(raw.change_id);
    const state = raw.state;
    if (changeId === '' || (state !== 'confirmed' && state !== 'reverted')) return null;
    return { changeId, intf: toWireString(raw.intf), state };
}

// The countdown is the daemon's: what is left of `confirm_within`, read from
// the box's own values at the moment they arrive, then run down on the
// browser's monotonic clock. A browser whose wall clock is off by minutes
// still shows the time the box will actually wait.

/** The clock the countdown runs on: monotonic, unmoved by a clock change. */
export function monotonicNow(): number {
    return performance.now();
}

function clampWindow(seconds: number): number {
    return Math.min(NETWORK_CONFIRM_WINDOW_S, Math.max(0, seconds));
}

/** From the `network_apply` reply: the box answers the moment it applies. */
export function appliedSecondsLeft(applied: NetworkApplied): number {
    return clampWindow(applied.confirmWithin);
}

/** From `network_state`: `expires_in` is the box's own reckoning. */
export function pendingSecondsLeft(pending: NetworkPending): number {
    return clampWindow(pending.expiresIn);
}

/**
 * From a `network_pending` event: the window runs from `applied_at`, and `ts`
 * is calaos_server's clock when it relayed the event (the same box). After a
 * daemon restart the event is published again with the original
 * `applied_at`, so `confirm_within` alone would only be right the first time.
 */
export function eventSecondsLeft(appliedAt: string, ts: string, confirmWithin: number): number {
    const applied = Date.parse(appliedAt);
    const relayed = Date.parse(ts);
    if (!Number.isFinite(applied) || !Number.isFinite(relayed)) return clampWindow(confirmWithin);
    return clampWindow(Math.min(confirmWithin, NETWORK_CONFIRM_WINDOW_S - (relayed - applied) / 1000));
}

/** `network_pending`, `network_applied` and `network_rolled_back` (which carries only `intf`). */
export function toNetworkEvent(
    type: string,
    data: unknown,
    ts = '',
): {
    type: 'network_pending' | 'network_applied' | 'network_rolled_back';
    changeId: string;
    intf: string;
    appliedAt: string;
    confirmWithin: number;
    ts: string;
} | null {
    if (type !== 'network_pending' && type !== 'network_applied' && type !== 'network_rolled_back') return null;
    const r = isRecord(data) ? data : {};
    return {
        type,
        changeId: toWireString(r.change_id),
        intf: toWireString(r.intf),
        appliedAt: toWireString(r.applied_at),
        confirmWithin: toNumberOrNull(r.confirm_within) ?? 0,
        ts,
    };
}

/** The bare address of a CIDR, '' for anything else. */
export function cidrAddress(cidr: string): string {
    return isIpv4Cidr(cidr) ? cidr.slice(0, cidr.indexOf('/')) : '';
}

/**
 * The page to open once the box has moved: this same page at the new static
 * address, keeping scheme, port and path (the app lives under `/app/` in
 * production). '' for a DHCP change, whose address nobody knows yet.
 */
export function networkReopenUrl(
    change: NetworkChange,
    page: { protocol: string; port: string; pathname: string },
): string {
    const address = change.dhcp ? '' : cidrAddress(change.ipv4 ?? '');
    if (address === '') return '';
    const port = page.port === '' ? '' : `:${page.port}`;
    return `${page.protocol}//${address}${port}${page.pathname}#/admin/network`;
}

// ---------------------------------------------------------- validation ---
// The checks calaos_server and the daemon make, so a form can say what is
// wrong before a code is spent on it.

export function isValidIntf(name: string): boolean {
    return INTF_PATTERN.test(name) && !RESERVED_INTF.includes(name);
}

export function isIpv4(value: string): boolean {
    return IPV4.test(value) && value.split('.').every((octet) => Number(octet) <= 255);
}

/** An explicit prefix is required: a bare address is refused. */
export function isIpv4Cidr(value: string): boolean {
    const slash = value.indexOf('/');
    if (slash < 0) return false;
    const prefix = value.slice(slash + 1);
    return isIpv4(value.slice(0, slash)) && /^(?:\d|[12]\d|3[0-2])$/.test(prefix);
}

/** The daemon's rule: optionally fully qualified (trailing dot). */
export function isSearchDomain(value: string): boolean {
    if (value === '' || value.length > 253 || !/^[a-zA-Z0-9.-]+$/.test(value)) return false;
    const name = value.endsWith('.') ? value.slice(0, -1) : value;
    if (name === '') return false;
    return name
        .split('.')
        .every((label) => label !== '' && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'));
}

/** The first field the box would refuse, or '' when the change passes. */
export function networkChangeProblem(change: NetworkChange): '' | 'intf' | 'ipv4' | 'gateway' | 'dns_servers' | 'search_domains' {
    if (!isValidIntf(change.intf)) return 'intf';
    if (change.dhcp) return '';
    if (!isIpv4Cidr(change.ipv4 ?? '')) return 'ipv4';
    if (change.gateway !== undefined && change.gateway !== '' && !isIpv4(change.gateway)) return 'gateway';
    const dns = change.dnsServers ?? [];
    if (dns.length > NETWORK_LIST_MAX || !dns.every(isIpv4)) return 'dns_servers';
    const domains = change.searchDomains ?? [];
    if (domains.length > NETWORK_LIST_MAX || !domains.every(isSearchDomain)) return 'search_domains';
    return '';
}
