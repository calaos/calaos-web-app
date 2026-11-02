// Capture tokens for camera snapshot URLs, as calaos_server hands them out
// (calaos_base docs/08_http_api.md, "jeton de capture"): asked for on a
// logged-in WebSocket, valid for camera/get_picture only, reusable until they
// expire, revoked with their session and by any change_cred.

import { randomBytes } from 'node:crypto';

export const DEFAULT_TTL_S = 120;
/** A fifth token for one session evicts its oldest. */
export const PER_SESSION_MAX = 4;

export function createCameraTokens() {
    /** token → { owner, expiresAt } */
    const tokens = new Map();
    let ttlS = DEFAULT_TTL_S;
    let issued = 0;

    return {
        get ttlS() {
            return ttlS;
        },
        set ttlS(seconds) {
            ttlS = seconds;
        },
        get issued() {
            return issued;
        },

        issue(owner) {
            const own = [...tokens].filter(([, entry]) => entry.owner === owner);
            if (own.length >= PER_SESSION_MAX) tokens.delete(own[0][0]);
            const token = randomBytes(32).toString('hex');
            tokens.set(token, { owner, expiresAt: Date.now() + ttlS * 1000 });
            issued += 1;
            return { token, expiresIn: ttlS };
        },

        valid(token) {
            const entry = tokens.get(token);
            if (entry === undefined) return false;
            if (Date.now() < entry.expiresAt) return true;
            tokens.delete(token);
            return false;
        },

        revokeSession(owner) {
            for (const [token, entry] of tokens) if (entry.owner === owner) tokens.delete(token);
        },

        revokeAll() {
            tokens.clear();
        },

        reset() {
            tokens.clear();
            ttlS = DEFAULT_TTL_S;
            issued = 0;
        },
    };
}
