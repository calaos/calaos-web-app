// `time_get` / `time_zones` / `time_set` of the fake daemon (calaos-container
// docs/API.md "Box time"). The box clock is the mock's clock plus an
// offset; `failStep` makes one step fail, the earlier ones staying applied.
// `unknownOutcome` answers `time_set` as calaos_server does when it stops
// waiting (`"outcome": "unknown"`), the change made (true) or not ('unapplied').

const TIMEZONE = /^[A-Za-z0-9_+\-/]{1,64}$/;
const RFC3339 = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/;

const ZONES = [
    'Africa/Abidjan', 'Africa/Casablanca', 'America/Montreal', 'America/New_York', 'America/Sao_Paulo',
    'Asia/Tokyo', 'Atlantic/Reunion', 'Australia/Sydney', 'Europe/Berlin', 'Europe/Brussels',
    'Europe/Lisbon', 'Europe/London', 'Europe/Luxembourg', 'Europe/Madrid', 'Europe/Paris',
    'Europe/Rome', 'Europe/Zurich', 'Indian/Mauritius', 'Pacific/Noumea', 'Pacific/Tahiti', 'UTC',
];

function iso(ms) {
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function createTime({ failure }) {
    let state;

    function reset() {
        state = {
            offsetMs: 0,
            timezone: 'Europe/Paris',
            ntp: true,
            synchronized: true,
            rtc: true,
            /** 'timezone' | 'ntp' | 'time' | null */
            failStep: null,
            /** false | true | 'unapplied' */
            unknownOutcome: false,
            sets: [],
        };
    }
    reset();

    function boxTime() {
        const now = Date.now() + state.offsetMs;
        return {
            now: iso(now),
            timezone: state.timezone,
            ntp: state.ntp,
            synchronized: state.synchronized,
            rtc: state.rtc ? iso(now) : null,
        };
    }

    function set(params) {
        const has = (key) => params[key] !== undefined;
        if (!has('timezone') && !has('ntp') && !has('time')) return failure('invalid_request', 'no field to set');
        if (has('timezone') && (typeof params.timezone !== 'string' || !TIMEZONE.test(params.timezone))) {
            return failure('invalid_request', 'invalid timezone');
        }
        if (has('ntp') && typeof params.ntp !== 'boolean') return failure('invalid_request', 'ntp must be a boolean');
        let target = null;
        if (has('time')) {
            target = typeof params.time === 'string' && RFC3339.test(params.time) ? Date.parse(params.time) : NaN;
            const year = new Date(target).getUTCFullYear();
            if (!Number.isFinite(target) || year < 2020 || year > 2100) return failure('invalid_request', 'invalid time');
        }
        if (has('timezone') && !ZONES.includes(params.timezone)) return failure('invalid_request', 'unknown timezone');

        const applied = [];
        const stepFailed = (step) =>
            failure('internal', 'time step failed', {
                applied: applied.join(','),
                failed: step,
                restart_required: applied.includes('timezone') ? 'true' : 'false',
            });
        let restartRequired = false;
        if (has('timezone')) {
            if (state.failStep === 'timezone') return stepFailed('timezone');
            restartRequired = params.timezone !== state.timezone;
            state.timezone = params.timezone;
            applied.push('timezone');
        }
        if (has('ntp')) {
            if (state.failStep === 'ntp') return stepFailed('ntp');
            state.ntp = params.ntp;
            if (state.ntp) {
                state.offsetMs = 0;
                state.synchronized = true;
            } else {
                state.synchronized = false;
            }
            applied.push('ntp');
        }
        if (target !== null) {
            if (state.ntp) return failure('invalid_request', 'ntp is active');
            if (state.failStep === 'time') return stepFailed('time');
            state.offsetMs = target - Date.now();
            applied.push('time');
        }
        state.sets.push(params);
        return { success: 'true', result: { ...boxTime(), restart_required: restartRequired } };
    }

    function unknown() {
        return failure('daemon_unreachable', 'no answer from the daemon in time', { outcome: 'unknown' });
    }

    function handle(action, session, params) {
        switch (action) {
            case 'time_get':
                return { success: 'true', result: boxTime() };
            case 'time_zones':
                return { success: 'true', result: { timezones: [...ZONES] } };
            case 'time_set': {
                if (state.unknownOutcome === 'unapplied') {
                    state.sets.push(params);
                    return unknown();
                }
                const reply = set(params);
                return state.unknownOutcome && reply.success === 'true' ? unknown() : reply;
            }
            default:
                return undefined;
        }
    }

    /** `/control {op:'admin', time:{offsetMs, timezone, ntp, synchronized, rtc, failStep, unknownOutcome}}`. */
    function configure(patch) {
        if (patch.offsetMs !== undefined) state.offsetMs = Number(patch.offsetMs);
        if (typeof patch.timezone === 'string') state.timezone = patch.timezone;
        if (patch.ntp !== undefined) state.ntp = Boolean(patch.ntp);
        if (patch.synchronized !== undefined) state.synchronized = Boolean(patch.synchronized);
        if (patch.rtc !== undefined) state.rtc = Boolean(patch.rtc);
        if (patch.failStep !== undefined) state.failStep = patch.failStep;
        if (patch.unknownOutcome !== undefined) {
            state.unknownOutcome = patch.unknownOutcome === 'unapplied' ? 'unapplied' : Boolean(patch.unknownOutcome);
        }
        return null;
    }

    function status() {
        return { ...boxTime(), offsetMs: state.offsetMs, sets: state.sets };
    }

    return { reset, handle, configure, status };
}
