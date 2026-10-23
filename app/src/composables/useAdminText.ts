// One sentence per admin error code, from the catalogue. The contract says
// the client branches on `error`, never on `msg`; `msg` is only appended to
// the three codes whose text the daemon is allowed to write for the user.

import { useI18n } from 'vue-i18n';
import { ADMIN_PASSWORD_MIN_LENGTH } from '../protocol/admin';
import type { AdminError } from '../protocol/admin';

export function useAdminText(): { errorText: (error: AdminError) => string } {
    const { t } = useI18n();

    function errorText(error: AdminError): string {
        switch (error.code) {
            case 'rate_limited':
                return t('admin.error.rate_limited', { seconds: error.retryAfter ?? 60 });
            case 'password_too_short':
                return t('admin.error.password_too_short', {
                    min: error.minLength ?? ADMIN_PASSWORD_MIN_LENGTH,
                });
            case 'not_allowed':
            case 'invalid_request':
            case 'package_not_found':
            case 'unknown':
                return t(`admin.error.${error.code}`, { msg: error.msg }).trim();
            default:
                return t(`admin.error.${error.code}`);
        }
    }

    return { errorText };
}
