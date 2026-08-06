import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory } from 'vue-router';
import AudioListView from './AudioListView.vue';
import en from '../i18n/en.json';
import { createAppRouter } from '../router';
import { toHomeData } from '../protocol/guards';
import { decodeServerMessage } from '../protocol/messages';
import * as coverService from '../services/audio-cover';
import { useAudioStore } from '../stores/audio';
import { useHomeStore } from '../stores/home';
import type { Router } from 'vue-router';
import type { VueWrapper } from '@vue/test-utils';

/** mock-server/fixtures/home.json, in wire order — players are never sorted. */
const PLAYERS = [
    { id: 'audio_1', name: 'Salon', type: 'slim', playlist: 'true', database: 'true' },
    { id: 'audio_2', name: 'Cuisine', type: 'Roon', playlist: 'true', database: 'false' },
];

let router: Router;

function loadHouse(audio: unknown[] = PLAYERS): void {
    useHomeStore().setHome(toHomeData({ home: [], cameras: [], audio }));
}

/** Feeds a get_state answer through the same path the service uses. */
function loadDetail(players: Record<string, unknown>): void {
    const audio = useAudioStore();
    audio.attachTransport(() => true);
    const msg = decodeServerMessage({ msg: 'get_state', data: players });
    if (msg.kind !== 'get_state') throw new Error('expected get_state');
    audio.applyGetState(msg);
}

async function mountList(): Promise<VueWrapper> {
    await router.push('/audio');
    await router.isReady();

    return mount(AudioListView, {
        global: {
            plugins: [router, createI18n({ legacy: false, locale: 'en', messages: { en } })],
        },
    });
}

const texts = (wrapper: VueWrapper, selector: string): string[] =>
    wrapper.findAll(selector).map((node) => node.text());

beforeEach(() => {
    setActivePinia(createPinia());
    router = createAppRouter(createMemoryHistory());
    // The chain's last step is out of scope here (components/audio/
    // AudioCoverArt.spec.ts covers it); this keeps the tiles from reaching
    // for a network that does not exist under jsdom.
    vi.spyOn(coverService, 'fetchCoverDataUrl').mockResolvedValue('');
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('AudioListView', () => {
    it('renders one tile per player, in the order the server sent them', async () => {
        loadHouse();
        const wrapper = await mountList();

        expect(wrapper.findAll('.player-tile')).toHaveLength(2);
        expect(texts(wrapper, '.player-tile__name')).toEqual(['Salon', 'Cuisine']);
    });

    // By protocol id, not by list position: the list is unsorted and a house
    // can gain a player, either of which would repoint a bookmarked index.
    it('links each tile to its player by id', async () => {
        loadHouse();
        const wrapper = await mountList();

        expect(
            wrapper.findAll('.player-tile').map((tile) => tile.attributes('href')),
        ).toEqual(['/audio/audio_1', '/audio/audio_2']);
    });

    it('gives every tile press feedback, like every other tile in the app', async () => {
        loadHouse();
        const wrapper = await mountList();

        for (const tile of wrapper.findAll('.player-tile')) {
            expect(tile.classes()).toContain('pressable');
        }
    });
});

describe('AudioListView — what is playing', () => {
    // The whole point of the screen, and the thing the old one could never
    // show: get_home carries no track, so this comes from get_state.
    it('shows the current track beside the player name', async () => {
        loadHouse();
        loadDetail({
            audio_1: {
                status: 'playing',
                current_track: { title: 'Sunrise Over Wago', artist: 'Calaos Orchestra' },
            },
        });

        const wrapper = await mountList();
        const tile = wrapper.findAll('.player-tile')[0];
        expect(tile.get('.player-tile__title').text()).toBe('Sunrise Over Wago');
        expect(tile.get('.player-tile__artist').text()).toBe('Calaos Orchestra');
    });

    it('shows the status as a word, and marks a playing one with a live dot', async () => {
        loadHouse();
        loadDetail({
            audio_1: { status: 'playing', current_track: { title: 'Sunrise' } },
            audio_2: { status: 'stop' },
        });

        const wrapper = await mountList();
        const tiles = wrapper.findAll('.player-tile');
        expect(tiles[0].get('.player-tile__status').text()).toBe(en.audio.status.playing);
        expect(tiles[0].find('.player-tile__dot').exists()).toBe(true);
        expect(tiles[1].get('.player-tile__status').text()).toBe(en.audio.status.stop);
        expect(tiles[1].find('.player-tile__dot').exists()).toBe(false);
    });

    // Between get_home and the get_state answer there is nothing to say, and
    // claiming "Stopped" would be a lie the tile has no basis for.
    it('says nothing about a player that has not answered yet', async () => {
        loadHouse();
        const wrapper = await mountList();

        const tile = wrapper.findAll('.player-tile')[0];
        expect(tile.get('.player-tile__status').text()).toBe('');
        expect(tile.find('.player-tile__title').exists()).toBe(false);
    });

    it('says a player answered but has nothing loaded, once it has answered', async () => {
        loadHouse();
        loadDetail({ audio_1: { status: 'stop' } });

        const wrapper = await mountList();
        const tile = wrapper.findAll('.player-tile')[0];
        expect(tile.find('.player-tile__title').exists()).toBe(false);
        expect(tile.text()).toContain(en.audio.nothingPlaying);
    });

    // A radio stream reports no artist; a partial track renders partially
    // rather than leaving an empty label behind.
    it('hides the metadata lines the backend did not send', async () => {
        loadHouse();
        loadDetail({ audio_2: { status: 'playing', current_track: { title: 'FIP' } } });

        const wrapper = await mountList();
        const tile = wrapper.findAll('.player-tile')[1];
        expect(tile.get('.player-tile__title').text()).toBe('FIP');
        expect(tile.find('.player-tile__artist').exists()).toBe(false);
    });

    it('follows a live event without a reload', async () => {
        loadHouse();
        loadDetail({ audio_1: { status: 'stop' } });
        const wrapper = await mountList();
        expect(wrapper.findAll('.player-tile')[0].find('.player-tile__dot').exists()).toBe(false);

        useAudioStore().handleAudioEvent('audio_status_changed', {
            player_id: 'audio_1',
            state: 'play',
        });
        await flushPromises();

        const tile = wrapper.findAll('.player-tile')[0];
        expect(tile.get('.player-tile__status').text()).toBe(en.audio.status.playing);
        expect(tile.find('.player-tile__dot').exists()).toBe(true);
    });
});

describe('AudioListView — no players', () => {
    it('says so instead of rendering an empty page', async () => {
        // A house with no audio player at all is the common case: the guard
        // only requires a session, and the Audio tab is always in the footer.
        const wrapper = await mountList();

        expect(wrapper.find('.players__grid').exists()).toBe(false);
        expect(wrapper.get('.players__empty').text()).toContain(en.audio.empty);
        expect(wrapper.get('.players__empty').text()).toContain(en.audio.emptyHint);
    });

    it('drops the message as soon as a house with players lands', async () => {
        const wrapper = await mountList();
        loadHouse();
        await flushPromises();

        expect(wrapper.find('.players__empty').exists()).toBe(false);
        expect(wrapper.findAll('.player-tile')).toHaveLength(2);
    });
});
