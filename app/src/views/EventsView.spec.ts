import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import EventsView from './EventsView.vue';
import en from '../i18n/en.json';
import type { EventLogEvent } from '../protocol/eventlog';
import { useEventsStore } from '../stores/events';

function event(patch: Partial<EventLogEvent>): EventLogEvent {
    return { id: 'e', eventType: '3', ioId: '', ioState: '', picUid: '', at: 0, raw: {}, ...patch };
}

async function mountView() {
    const events = useEventsStore();
    // The store's own wiring is covered elsewhere; the view only reads its state.
    vi.spyOn(events, 'refresh').mockResolvedValue(undefined);
    const wrapper = mount(EventsView, {
        global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] },
    });
    await flushPromises();
    return { events, wrapper };
}

beforeEach(() => {
    setActivePinia(createPinia());
});

describe('EventsView', () => {
    it('lists the events with a generic title and an icon for an unknown one', async () => {
        const { events, wrapper } = await mountView();
        events.events = [event({ id: 'a', eventType: '99' }), event({ id: 'b', eventType: '22', raw: { message: 'Hi' } })];
        await flushPromises();

        const rows = wrapper.findAll('[data-testid="event-item"]');
        expect(rows).toHaveLength(2);
        expect(rows[0].text()).toContain('Unknown event');
        expect(rows[0].find('[data-testid="event-icon-unknown"]').exists()).toBe(true);
        expect(rows[1].text()).toContain('Hi');
        expect(rows[1].find('[data-testid="event-icon-push"]').exists()).toBe(true);
    });

    it('says so when the log is empty', async () => {
        const { wrapper } = await mountView();
        expect(wrapper.find('[data-testid="event-empty"]').text()).toBe('No events yet.');
    });

    it('shows a fixed offline message, never the server text', async () => {
        const { events, wrapper } = await mountView();
        events.error = 'not connected';
        await flushPromises();
        expect(wrapper.find('[role="alert"]').text()).toBe(en.events.error.offline);
        events.error = 'SQL exploded at db.cpp:12';
        await flushPromises();
        expect(wrapper.find('[role="alert"]').text()).toBe(en.events.error.generic);
    });

    it('shows the detail with the missing-picture placeholder, and hides the list', async () => {
        const { events, wrapper } = await mountView();
        events.events = [event({ id: 'a', eventType: '22', picUid: 'p', raw: { message: 'Doorbell' } })];
        events.detail = events.events[0];
        events.pictureStatus = 'missing';
        await flushPromises();

        expect(wrapper.find('[data-testid="event-detail"]').text()).toContain('Doorbell');
        expect(wrapper.find('[data-testid="event-picture-missing"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="event-picture"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="event-list"]').attributes('style')).toContain('display: none');
    });
});
