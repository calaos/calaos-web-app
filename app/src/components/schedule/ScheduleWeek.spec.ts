import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { describe, expect, it } from 'vitest';
import en from '../../i18n/en.json';
import ScheduleWeek from './ScheduleWeek.vue';
import { programFromWire } from '../../protocol/schedule';

const program = programFromWire(
    'heat',
    Array.from({ length: 6 }, (_, i) => ({ n: i + 1, ranges: [], setpoint: 20 - i })),
);

function mountWeek(paused: boolean) {
    return mount(ScheduleWeek, {
        props: { program, directions: ['heat'], direction: 'heat', today: 1, now: 600, paused, pausedText: 'Stays at 17°', canToggle: true, saving: false },
        global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] },
    });
}

describe('ScheduleWeek program switch', () => {
    it('asks to pause from the active state', async () => {
        const w = mountWeek(false);
        await w.findAll('button').find((b) => b.text() === 'Pause')?.trigger('click');
        expect(w.emitted('toggle')).toHaveLength(1);
    });

    it('asks to resume from the paused state', async () => {
        const w = mountWeek(true);
        await w.findAll('button').find((b) => b.text() === 'Resume')?.trigger('click');
        expect(w.emitted('toggle')).toHaveLength(1);
    });
});
