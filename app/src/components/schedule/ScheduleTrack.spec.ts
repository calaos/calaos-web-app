import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { describe, expect, it } from 'vitest';
import en from '../../i18n/en.json';
import ScheduleTrack from './ScheduleTrack.vue';
import { programFromWire } from '../../protocol/schedule';
import { wireRange } from '../../stores/scheduleTestHarness';

describe('ScheduleTrack', () => {
    it('names a period by its hours and setpoint on hover, and leaves the gaps without a tip', () => {
        const program = programFromWire('heat', [{ n: 1, ranges: [wireRange(1, 8, 0, 10, 30)], setpoint: 22.5 }]);
        const w = mount(ScheduleTrack, {
            props: { program, day: 1, label: 'Monday' },
            global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] },
        });
        expect(w.findAll('.track__seg').map((s) => s.attributes('title'))).toEqual(['08:00 – 10:30, 22.5°']);
        expect(w.findAll('.track__gap').every((g) => g.attributes('title') === undefined)).toBe(true);
    });
});
