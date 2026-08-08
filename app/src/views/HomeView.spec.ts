import { beforeEach, describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory } from 'vue-router';
import HomeView from './HomeView.vue';
import en from '../i18n/en.json';
import { createAppRouter } from '../router';
import { toHomeData } from '../protocol/guards';
import { useAuthStore } from '../stores/auth';
import { useHomeStore } from '../stores/home';
import type { WireRoom } from '../protocol/types';
import type { Router } from 'vue-router';
import type { VueWrapper } from '@vue/test-utils';

let router: Router;

/**
 * Four rooms in deliberately WRONG order: the store sorts by `hits` desc at
 * ingest and this view renders that order verbatim, so the render order is
 * the assertion that the sort survived.
 *
 * `Atelier` has a type the map has never heard of, and `Cave`'s temperature
 * is marked invisible.
 */
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
                id: 'light_salon',
                name: 'Plafonnier',
                gui_type: 'light',
                state: 'false',
                visible: 'true',
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
    {
        name: 'Atelier',
        type: 'atelier',
        hits: '30',
        items: [
            {
                id: 'temp_atelier',
                name: 'Sonde',
                gui_type: 'temp',
                state: '18',
                unit: '°F',
                visible: 'true',
            },
        ],
    },
    {
        name: 'Cave',
        type: 'cellar',
        hits: '5',
        items: [
            {
                id: 'temp_cave',
                name: 'Sonde cave',
                gui_type: 'temp',
                state: '11.0',
                visible: 'false',
            },
        ],
    },
];

function loadHouse(rooms: WireRoom[] = HOUSE): void {
    useHomeStore().setHome(toHomeData({ home: rooms, cameras: [], audio: [] }));
}

async function mountHome(): Promise<VueWrapper> {
    await router.push('/home');
    await router.isReady();

    return mount(HomeView, {
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

describe('HomeView — the grid', () => {
    it('renders one tile per room, most used first', async () => {
        loadHouse();

        const wrapper = await mountHome();

        // hits: Cuisine 47, Atelier 30, Salon 12, Cave 5 — nothing like the
        // order they arrived in.
        expect(texts(wrapper, '.room-tile__name')).toEqual([
            'Cuisine',
            'Atelier',
            'Salon',
            'Cave',
        ]);
    });

    it('links every tile to its room by index', async () => {
        loadHouse();

        const wrapper = await mountHome();

        expect(wrapper.findAll('.room-tile').map((tile) => tile.attributes('href'))).toEqual([
            '/home/0',
            '/home/1',
            '/home/2',
            '/home/3',
        ]);
    });

    it('shows each room as a picture, and does not write its type out', async () => {
        loadHouse();

        const wrapper = await mountHome();

        // Every tile has its artwork...
        expect(wrapper.findAll('.room-tile__icon')).toHaveLength(4);
        // ...including the unknown type, which gets the generic room rather
        // than the previous tile's picture (the old map's `else` branch never
        // assigned, so an unknown type inherited whatever came before it).
        const sources = wrapper.findAll('.room-tile__icon').map((i) => i.attributes('src'));
        expect(new Set(sources).size).toBe(4);

        // The TYPE is not printed on the tile: the picture already says
        // "kitchen", and two labels do not fit on one tile.
        expect(wrapper.find('.room-tile__type').exists()).toBe(false);
        expect(wrapper.text()).not.toContain(en.roomType.kitchen);
    });

    it('gives every tile press feedback', async () => {
        loadHouse();

        const wrapper = await mountHome();

        for (const tile of wrapper.findAll('.room-tile')) {
            expect(tile.classes()).toContain('pressable');
        }
    });
});

describe('HomeView — temperature badge', () => {
    it('shows a temperature only for the rooms that measure one', async () => {
        loadHouse();

        const wrapper = await mountHome();

        const tiles = wrapper.findAll('.room-tile');
        // Cuisine has no temp IO; Cave's is marked invisible — the old app
        // showed that one anyway, because `hasTemp` ignored `visible`.
        expect(tiles[0].find('.room-tile__temp').exists()).toBe(false);
        expect(tiles[3].find('.room-tile__temp').exists()).toBe(false);
        expect(texts(wrapper, '.room-tile__temp')).toEqual(['18 °F', '21.5 °C']);
    });

    it('labels the badge, since a bare number in a tile says nothing', async () => {
        loadHouse();

        const wrapper = await mountHome();

        expect(wrapper.get('.room-tile__temp-icon').attributes('aria-label')).toBe(
            en.home.temperature,
        );
    });

    it('follows the IO as the server pushes new readings', async () => {
        loadHouse();
        const wrapper = await mountHome();
        const home = useHomeStore();

        home.handleEvent({ kind: 'io_changed', id: 'temp_salon', state: '22.4' });
        await flushPromises();

        expect(texts(wrapper, '.room-tile__temp')).toEqual(['18 °F', '22.4 °C']);
    });
});

describe('HomeView — no rooms', () => {
    it('says so instead of rendering an empty page', async () => {
        // Reachable when the account has no rooms at all: the guard only
        // requires a session, not a house.
        const wrapper = await mountHome();

        expect(wrapper.find('.home__grid').exists()).toBe(false);
        expect(wrapper.get('.home__empty').text()).toContain(en.home.empty);
        expect(wrapper.get('.home__empty').text()).toContain(en.home.emptyHint);
    });

    it('drops the message as soon as a house lands', async () => {
        const wrapper = await mountHome();

        loadHouse();
        await flushPromises();

        expect(wrapper.find('.home__empty').exists()).toBe(false);
        expect(wrapper.findAll('.room-tile')).toHaveLength(4);
    });
});
