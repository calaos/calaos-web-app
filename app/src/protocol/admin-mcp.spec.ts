import { describe, expect, it } from 'vitest';
import { mcpInfoBody, mcpUrl, toMcpInfo } from './admin-mcp';

describe('mcp codec', () => {
    it('puts the session in the body', () => {
        expect(JSON.parse(mcpInfoBody('u', 'p', 'abc'))).toEqual({
            action: 'get_mcp_info',
            cn_user: 'u',
            cn_pass: 'p',
            admin_session: 'abc',
        });
    });

    it('reads the answer of 08', () => {
        expect(toMcpInfo({ url_path: '/mcp', token: 'tok', hint: 'Use token as Bearer' })).toEqual({
            urlPath: '/mcp',
            token: 'tok',
            hint: 'Use token as Bearer',
        });
    });

    it('rejects a refusal or an answer without a token', () => {
        expect(toMcpInfo({ success: 'false', error: 'bad_session', msg: 'x' })).toBeNull();
        expect(toMcpInfo({ url_path: '/mcp', token: '' })).toBeNull();
        expect(toMcpInfo('nope')).toBeNull();
        expect(toMcpInfo(null)).toBeNull();
    });

    it('falls back to /mcp for a missing or relative path', () => {
        expect(toMcpInfo({ token: 't' })?.urlPath).toBe('/mcp');
        expect(toMcpInfo({ token: 't', url_path: 'evil.example' })?.urlPath).toBe('/mcp');
    });

    it('builds the address from the page origin', () => {
        expect(mcpUrl('https://calaos.local', '/mcp')).toBe('https://calaos.local/mcp');
        expect(mcpUrl('https://calaos.local/', '/mcp')).toBe('https://calaos.local/mcp');
    });
});
