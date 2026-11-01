import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { messages } from '../../i18n/messages';
import { useAdminTimeStore } from '../../stores/adminTime';
import TimePanel from './TimePanel.vue';

enableAutoUnmount(beforeEach);

// The daemon lists ~600 zones; the mock only 21.
const ZONES = Array.from({ length: 600 }, (_, i) => `Area${String(i % 12)}/City_${String(i)}`).concat('Europe/Paris', 'America/New_York');

function mountPanel() {
    setActivePinia(createPinia());
    const time = useAdminTimeStore();
    vi.spyOn(time, 'load').mockResolvedValue(true);
    vi.spyOn(time, 'loadZones').mockResolvedValue(undefined as never);
    time.time = { now: '2026-07-01T10:00:00Z', timezone: 'Europe/Paris', ntp: true, synchronized: true, rtc: '' };
    time.readAt = Date.now();
    time.zones = ZONES;
    return mount(TimePanel, {
        global: {
            plugins: [createI18n({ legacy: false, locale: 'en', messages })],
            stubs: { Teleport: true, RouterLink: { template: '<a><slot /></a>' } },
        },
    });
}

describe('the time zone list at the size the daemon sends', () => {
    it('renders every zone, then narrows on the filter and keeps the chosen one', async () => {
        const wrapper = mountPanel();
        await flushPromises();
        const options = () => wrapper.findAll('#time-zone option').map((o) => o.text());
        expect(options()).toHaveLength(ZONES.length);
        await wrapper.find('input[type="search"]').setValue('new york');
        expect(options()).toEqual(['Europe/Paris', 'America/New_York']);
        expect((wrapper.find('#time-zone').element as HTMLSelectElement).value).toBe('Europe/Paris');
        expect(wrapper.find('.time__none').exists()).toBe(false);
    });

    it('says so when nothing matches, in a live region, and keeps the chosen zone', async () => {
        const wrapper = mountPanel();
        await flushPromises();
        await wrapper.find('input[type="search"]').setValue('zzz');
        expect(wrapper.findAll('#time-zone option').map((o) => o.text())).toEqual(['Europe/Paris']);
        const none = wrapper.find('.time__none');
        expect(none.text()).toBe(messages.en.admin.time.zoneNone);
        expect(none.attributes('aria-live')).toBe('polite');
    });
});
