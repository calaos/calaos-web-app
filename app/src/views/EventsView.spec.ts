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

    it('labels the photo indicator with the translated text, not a raw key', async () => {
        const { events, wrapper } = await mountView();
        events.events = [event({ id: 'a', picUid: 'p1' })];
        await flushPromises();

        const label = wrapper.find('[data-testid="event-has-picture"]').attributes('aria-label');
        expect(label).toBe(en.events.hasPicture);
        expect(label).toBe('A picture is attached');
    });

    it('folds identical consecutive events into one row with a count, keeping the newest id', async () => {
        const { events, wrapper } = await mountView();
        const at = new Date(2024, 4, 6, 12, 0, 0).getTime();
        const push = { eventType: '22', raw: { message: 'Hi' } };
        events.events = [
            event({ id: 'n1', at, ...push }),
            event({ id: 'n2', at: at - 1000, ...push }),
            event({ id: 'n3', at: at - 2000, ...push }),
            event({ id: 'other', at: at - 3000, eventType: '22', raw: { message: 'Bye' } }),
            // Same text as the first group but not adjacent to it, and one with a picture.
            event({ id: 'again', at: at - 4000, ...push }),
            event({ id: 'pic1', at: at - 5000, picUid: 'p', ...push }),
            event({ id: 'pic2', at: at - 6000, picUid: 'p', ...push }),
            // Same text on another day.
            event({ id: 'old', at: at - 5 * 86400000, ...push }),
        ];
        await flushPromises();

        const rows = wrapper.findAll('[data-testid="event-item"]');
        expect(rows).toHaveLength(6);
        expect(rows[0].find('[data-testid="event-count"]').text()).toBe('3x');
        expect(rows[0].find('[data-testid="event-count"]').attributes('aria-label')).toBe('3 times');
        expect(wrapper.findAll('[data-testid="event-count"]')).toHaveLength(1);

        const openDetail = vi.spyOn(events, 'openDetail').mockReturnValue();
        await rows[0].trigger('click');
        expect(openDetail).toHaveBeenCalledWith('n1');
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
