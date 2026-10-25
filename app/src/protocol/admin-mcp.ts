// `get_mcp_info` (calaos_base docs/08_http_api.md): HTTP only. Once an admin
// is set it needs the admin session, which rides in the JSON body: haproxy
// logs URLs.

export interface McpInfo {
    /** Path of the MCP endpoint on the box, appended to its HTTPS base URL. */
    urlPath: string;
    token: string;
    hint: string;
}

export function mcpInfoBody(user: string, pass: string, session: string): string {
    return JSON.stringify({ action: 'get_mcp_info', cn_user: user, cn_pass: pass, admin_session: session });
}

/** null unless the answer carries a token: anything else is a refusal or garbage. */
export function toMcpInfo(raw: unknown): McpInfo | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const record = raw as Record<string, unknown>;
    if (typeof record.token !== 'string' || record.token === '') return null;
    const path = typeof record.url_path === 'string' && record.url_path.startsWith('/') ? record.url_path : '/mcp';
    return {
        urlPath: path,
        token: record.token,
        hint: typeof record.hint === 'string' ? record.hint : '',
    };
}

/** The address an assistant is given: this page's own origin, which is the box behind haproxy. */
export function mcpUrl(origin: string, urlPath: string): string {
    return `${origin.replace(/\/+$/, '')}${urlPath}`;
}
