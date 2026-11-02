// Shared by the camera specs: the live session already holds a capture token,
// as it does once logged in.

import { useCameraTokenStore } from './cameraToken';

export const CAPTURE_TOKEN = 'c'.repeat(64);

export function grantCameraToken(token = CAPTURE_TOKEN, expiresIn = 120): void {
    const tokens = useCameraTokenStore();
    let msgId = '';
    tokens.attachTransport((frame) => {
        msgId = (JSON.parse(frame) as { msg_id: string }).msg_id;
        return true;
    });
    tokens.acquire();
    tokens.handleReply({ kind: 'camera_token', msgId, token, expiresIn, error: '' });
    tokens.release();
}
