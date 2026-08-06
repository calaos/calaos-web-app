import { beforeEach, describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory } from 'vue-router';
import RoomView from './RoomView.vue';
import en from '../i18n/en.json';
import { createAppRouter } from '../router';
import { toHomeData } from '../protocol/guards';
import { useAuthStore } from '../stores/auth';
import { useHomeStore } from '../stores/home';
import type { WireRoom } from '../protocol/types';
import type { Router } from 'vue-router';
import type { VueWrapper } from '@vue/test-utils';

let router: Router;

/** roomId after the store's hits-desc sort: 0 Cuisine, 1 Salon, 2 Atelier. */
const HOUSE: WireRoom[] = [
    {
        name: 'Salon',
        type: 'lounge',
        hits: '12',
        items: [
            {
                id: 'temp_salon',
                name: 'Température',
                gui_type: 'temp',
                state: '21.5',
                visible: 'true',
            },
            {
                id: 'secret_salon',
                name: 'Relais chaudière',
                gui_type: 'light',
                state: 'true',
                visible: 'false',
            },
            {
                id: 'light_salon',
                name: 'Plafonnier',
                gui_type: 'light',
                state: 'false',
                visible: 'true',
                // The only IO here the user can act on. `rw` defaults to
                // false at ingest, which is why the others carry no controls.
                rw: 'true',
            },
        ],
    },
    {
        name: 'Cuisine',
        type: 'kitchen',
        hits: '47',
        items: [
            {
                id: 'light_cuisine',
                name: 'Spots',
                gui_type: 'light',
                state: 'true',
                visible: 'true',
            },
        ],
    },
    { name: 'Atelier', type: 'atelier', hits: '1', items: [] },
];

function loadHouse(rooms: WireRoom[] = HOUSE): void {
    useHomeStore().setHome(toHomeData({ home: rooms, cameras: [], audio: [] }));
}

async function mountRoom(path: string): Promise<VueWrapper> {
    await router.push(path);
    await router.isReady();

    return mount(RoomView, {
        global: {
            plugins: [router, createI18n({ legacy: false, locale: 'en', messages: { en } })],
        },
    });
}

const texts = (wrapper: VueWrapper, selector: string): string[] =>
    wrapper.findAll(selector).map((node) => node.text());

beforeEach(() => {
    setActivePinia(createPinia());
    useAuthStore().state = 'authed';
    router = createAppRouter(createMemoryHistory());
});

describe('RoomView — the room says who it is', () => {
    it('shows the name, the type and the glyph of the room in the URL', async () => {
        loadHouse();

        const wrapper = await mountRoom('/home/1');

        expect(wrapper.get('.room__name').text()).toBe('Salon');
        expect(wrapper.get('.room__type').text()).toBe(en.roomType.lounge);
        expect(wrapper.find('.room__icon').exists()).toBe(true);
    });

    it('names an unrecognized room type instead of leaving a blank', async () => {
        loadHouse();

        const wrapper = await mountRoom('/home/2');

        expect(wrapper.get('.room__name').text()).toBe('Atelier');
        expect(wrapper.get('.room__type').text()).toBe(en.roomType.unknown);
    });

    it('follows the route to another room', async () => {
        loadHouse();
        const wrapper = await mountRoom('/home/1');

        await router.push('/home/0');
        await flushPromises();

        expect(wrapper.get('.room__name').text()).toBe('Cuisine');
        expect(texts(wrapper, '.io-row__name')).toEqual(['Spots']);
    });

    it('renders nothing when the house is gone from under it', async () => {
        // Signing out clears the store before the navigation to /login has
        // completed, so this view renders one frame with no room.
        loadHouse();
        const wrapper = await mountRoom('/home/1');

        useHomeStore().clear();
        await flushPromises();

        expect(wrapper.find('.room').exists()).toBe(false);
    });
});

describe('RoomView — the IO list', () => {
    it('lists the room IOs in the order the server sent them', async () => {
        loadHouse();

        const wrapper = await mountRoom('/home/1');

        expect(texts(wrapper, '.io-row__name')).toEqual(['Température', 'Plafonnier']);
    });

    it('gives every IO the row its own type asks for', async () => {
        loadHouse();

        const wrapper = await mountRoom('/home/1');

        // The temperature reads; the light is a control. Which component draws
        // which is IoRow's business (IoRow.spec.ts) — what matters here is
        // that the list hands each IO over and gets a real row back.
        expect(wrapper.get('.temp-io__reading').text()).toBe('21.5 °C');
        expect(wrapper.findAll('.io-row')).toHaveLength(2);
        expect(wrapper.findAll('button')).toHaveLength(2);
    });

    it('never renders an IO the server marked invisible', async () => {
        loadHouse();

        const wrapper = await mountRoom('/home/1');

        expect(wrapper.text()).not.toContain('Relais chaudière');
    });

    it('follows io_changed events', async () => {
        loadHouse();
        const wrapper = await mountRoom('/home/1');
        expect(wrapper.get('.state-icon').classes()).not.toContain('state-icon--on');

        useHomeStore().handleEvent({ kind: 'io_changed', id: 'light_salon', state: 'true' });
        await flushPromises();

        // The event patches one IO in the store's Map and the row re-renders:
        // no re-fetch of the house, and no copy of the IO held by the list.
        expect(wrapper.get('.state-icon').classes()).toContain('state-icon--on');
    });

    it('says a room is empty rather than showing a bare header', async () => {
        loadHouse();

        const wrapper = await mountRoom('/home/2');

        expect(wrapper.find('.room__ios').exists()).toBe(false);
        expect(wrapper.get('.room__empty').text()).toBe(en.room.empty);
    });
});
