// URL of the JPEG attached to an event (`pic_uid` of a push-notification event).
//
// calaos_server runs checkCredentials() on every HTTP request before it looks
// at `action`, so event_picture needs cn_user/cn_pass in the query exactly as
// the camera snapshot does; there is no cookie or header auth. The pair is
// written by the camera-url module, the only one allowed to put credentials in
// a URL.

import { credentialedApiUrl } from './camera-url';
import type { CameraCredentials } from './camera-url';

export function eventPictureUrl(picUid: string, credentials: CameraCredentials): string {
    return `${credentialedApiUrl(credentials)}&action=event_picture&pic_uid=${encodeURIComponent(picUid)}`;
}
