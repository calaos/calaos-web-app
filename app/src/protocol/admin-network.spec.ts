import { describe, expect, it } from 'vitest';
import {
    appliedSecondsLeft,
    cidrAddress,
    eventSecondsLeft,
    isIpv4,
    isIpv4Cidr,
    isSearchDomain,
    isValidIntf,
    networkApplyParams,
    networkChangeParams,
    networkChangeProblem,
    networkReopenUrl,
    pendingSecondsLeft,
    toNetworkApplied,
    toNetworkEvent,
    toNetworkFinished,
    toNetworkState,
} from './admin-network';

describe('network codec', () => {
    it('reads the state with its pending change', () => {
        const state = toNetworkState({
            interfaces: [
                { name: 'eth0', ipv4: '192.168.1.10/24', gateway: '192.168.1.1', mac: 'm', state: 'routable', dhcp: false, dns_servers: ['192.168.1.1'], search_domains: ['lan'] },
            ],
            pending: { change_id: '5d0c8e1f2a3b4c6d', intf: 'eth0', applied_at: '2026-10-25T09:12:03Z', expires_in: 87 },
        });
        expect(state.interfaces[0]).toEqual({
            name: 'eth0',
            ipv4: '192.168.1.10/24',
            gateway: '192.168.1.1',
            mac: 'm',
            state: 'routable',
            dhcp: false,
            dnsServers: ['192.168.1.1'],
            searchDomains: ['lan'],
        });
        expect(state.pending).toEqual({ changeId: '5d0c8e1f2a3b4c6d', intf: 'eth0', appliedAt: '2026-10-25T09:12:03Z', expiresIn: 87 });
        expect(toNetworkState({ interfaces: [], pending: null }).pending).toBeNull();
        expect(toNetworkState(undefined)).toEqual({ interfaces: [], pending: null });
    });

    it('builds the same typed fields for the code and the apply', () => {
        const change = { intf: 'eth0', dhcp: false, ipv4: '192.168.1.20/24', gateway: '', dnsServers: ['1.1.1.1'], searchDomains: [] };
        expect(networkChangeParams(change)).toEqual({ intf: 'eth0', dhcp: false, ipv4: '192.168.1.20/24', dns_servers: ['1.1.1.1'] });
        expect(networkApplyParams(change, '0123456789abcdef', '482913')).toEqual({
            ...networkChangeParams(change),
            code_id: '0123456789abcdef',
            code: '482913',
        });
        expect(networkChangeParams({ intf: 'eth0', dhcp: true, ipv4: '10.0.0.1/8' })).toEqual({ intf: 'eth0', dhcp: true });
    });

    it('reads apply, confirm and revert answers', () => {
        expect(toNetworkApplied({ change_id: 'c', intf: 'eth0', applied_at: 'a', confirm_within: 120 })).toEqual({
            changeId: 'c',
            intf: 'eth0',
            appliedAt: 'a',
            confirmWithin: 120,
        });
        expect(toNetworkFinished({ change_id: 'c', intf: 'eth0', state: 'reverted' })?.state).toBe('reverted');
        expect(toNetworkFinished({ change_id: 'c', state: 'gone' })).toBeNull();
    });

    it('reads the time left from the box values, never from the browser clock', () => {
        expect(appliedSecondsLeft({ changeId: 'c', intf: 'eth0', appliedAt: '2026-10-25T09:12:03Z', confirmWithin: 120 })).toBe(120);
        expect(pendingSecondsLeft({ changeId: 'c', intf: 'eth0', appliedAt: '2026-10-25T09:12:03Z', expiresIn: 87 })).toBe(87);
        expect(pendingSecondsLeft({ changeId: 'c', intf: 'eth0', appliedAt: '', expiresIn: 900 })).toBe(120);
        // First publish, relayed a second later.
        expect(eventSecondsLeft('2026-10-25T09:12:03Z', '2026-10-25T09:12:04Z', 120)).toBe(119);
        // Published again after a daemon restart: same applied_at, confirm_within = seconds left.
        expect(eventSecondsLeft('2026-10-25T09:12:03Z', '2026-10-25T09:13:33Z', 30)).toBe(30);
        expect(eventSecondsLeft('2026-10-25T09:12:03Z', '2026-10-25T09:15:00Z', 0)).toBe(0);
        expect(eventSecondsLeft('garbage', '', 40)).toBe(40);
    });

    it('points at the new static address, keeping scheme, port and path', () => {
        const page = { protocol: 'https:', port: '', pathname: '/app/index.html' };
        expect(networkReopenUrl({ intf: 'eth0', dhcp: false, ipv4: '192.168.1.20/24' }, page)).toBe(
            'https://192.168.1.20/app/index.html#/admin/network',
        );
        expect(networkReopenUrl({ intf: 'eth0', dhcp: false, ipv4: '10.0.0.2/8' }, { ...page, protocol: 'http:', port: '4173', pathname: '/' })).toBe(
            'http://10.0.0.2:4173/#/admin/network',
        );
        expect(networkReopenUrl({ intf: 'eth0', dhcp: true }, page)).toBe('');
        expect(cidrAddress('192.168.1.20')).toBe('');
    });

    it('reads the network events', () => {
        expect(toNetworkEvent('network_pending', { intf: 'eth0', change_id: 'c', applied_at: 'a', confirm_within: 40 })).toEqual({
            type: 'network_pending',
            changeId: 'c',
            intf: 'eth0',
            appliedAt: 'a',
            confirmWithin: 40,
            ts: '',
        });
        expect(toNetworkEvent('network_rolled_back', { intf: 'eth0' })?.intf).toBe('eth0');
        expect(toNetworkEvent('upgrade_progress', {})).toBeNull();
    });

    it('validates as the box does', () => {
        expect(isValidIntf('eth0')).toBe(true);
        expect(isValidIntf('lo')).toBe(false);
        expect(isValidIntf('apply')).toBe(false);
        expect(isValidIntf('a'.repeat(16))).toBe(false);
        expect(isIpv4('192.168.1.1')).toBe(true);
        expect(isIpv4('192.168.01.1')).toBe(false);
        expect(isIpv4('256.1.1.1')).toBe(false);
        expect(isIpv4Cidr('192.168.1.10/24')).toBe(true);
        expect(isIpv4Cidr('192.168.1.10')).toBe(false);
        expect(isIpv4Cidr('192.168.1.10/33')).toBe(false);
        expect(isSearchDomain('lan')).toBe(true);
        expect(isSearchDomain('home.example.')).toBe(true);
        expect(isSearchDomain('-bad.lan')).toBe(false);
        expect(isSearchDomain('a..b')).toBe(false);
        expect(networkChangeProblem({ intf: 'eth0', dhcp: true })).toBe('');
        expect(networkChangeProblem({ intf: 'eth0', dhcp: false, ipv4: '192.168.1.10' })).toBe('ipv4');
        expect(networkChangeProblem({ intf: 'eth0', dhcp: false, ipv4: '192.168.1.10/24', gateway: 'x' })).toBe('gateway');
        expect(networkChangeProblem({ intf: 'eth0', dhcp: false, ipv4: '192.168.1.10/24', dnsServers: Array(5).fill('1.1.1.1') })).toBe('dns_servers');
        expect(networkChangeProblem({ intf: 'eth0', dhcp: false, ipv4: '192.168.1.10/24', searchDomains: ['ok', '-no'] })).toBe('search_domains');
    });
});
