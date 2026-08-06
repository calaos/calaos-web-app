import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import AudioCoverArt from './AudioCoverArt.vue';
import en from '../../i18n/en.json';
import * as coverService from '../../services/audio-cover';
import { decodeServerMessage } from '../../protocol/messages';
import { useAudioStore } from '../../stores/audio';
import type { AudioPlayerItem } from '../../protocol/types';
import type { VueWrapper } from '@vue/test-utils';

const PLAYER: AudioPlayerItem = {
    id: 'audio_1',
    name: 'Salon',
    type: 'slim',
    canPlaylist: true,
    canDatabase: true,
    avr: '',
};

const URL_A = 'http://lms.local:9000/music/17/cover.jpg';
const DATA_URL = 'data:image/jpeg;base64,QUJD';

let fetchCover: ReturnType<typeof vi.spyOn>;

function mountArt(variant: 'tile' | 'hero' = 'tile'): VueWrapper {
    return mount(AudioCoverArt, {
        props: { player: PLAYER, variant },
        global: {
            plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })],
        },
    });
}

/** Puts a resolved cover answer into the store, the way the service would. */
function resolveCover(url: string): void {
    const audio = useAudioStore();
    audio.attachTransport(() => true);
    const state = decodeServerMessage({
        msg: 'get_state',
        data: { audio_1: { status: 'playing', current_track: { title: 'Sunrise' } } },
    });
    if (state.kind !== 'get_state') throw new Error('expected get_state');
    audio.applyGetState(state);

    const reply = decodeServerMessage({ msg: 'audio', msg_id: 'cover-1', data: { cover: url } });
    if (reply.kind !== 'audio_query') throw new Error('expected audio_query');
    audio.applyAudioQuery(reply);
}

beforeEach(() => {
    setActivePinia(createPinia());
    fetchCover = vi.spyOn(coverService, 'fetchCoverDataUrl').mockResolvedValue(DATA_URL);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('AudioCoverArt', () => {
    it('shows the placeholder glyph while nothing has been answered yet', () => {
        const wrapper = mountArt();
        expect(wrapper.find('.cover__art').exists()).toBe(false);
        expect(wrapper.find('.cover__placeholder').exists()).toBe(true);
    });

    it('renders the media server URL once it lands', async () => {
        resolveCover(URL_A);
        const wrapper = mountArt();
        await flushPromises();

        expect(wrapper.get('.cover__art').attributes('src')).toBe(URL_A);
    });

    it('falls back to the base64 path when the media URL will not load', async () => {
        resolveCover(URL_A);
        const wrapper = mountArt();
        await flushPromises();

        await wrapper.get('.cover__art').trigger('error');
        await flushPromises();

        expect(wrapper.get('.cover__art').attributes('src')).toBe(DATA_URL);
        expect(fetchCover).toHaveBeenCalled();
    });

    it('ends at the placeholder when no source has a picture', async () => {
        fetchCover.mockResolvedValue('');
        resolveCover('');
        const wrapper = mountArt();
        await flushPromises();

        expect(wrapper.find('.cover__art').exists()).toBe(false);
        expect(wrapper.find('.cover__placeholder').exists()).toBe(true);
    });

    it('asks for a small thumbnail on a tile and a large one on the player screen', async () => {
        resolveCover('');
        mountArt('tile');
        await flushPromises();
        expect(fetchCover).toHaveBeenLastCalledWith('audio_1', expect.anything(), { width: 160 });

        mountArt('hero');
        await flushPromises();
        expect(fetchCover).toHaveBeenLastCalledWith('audio_1', expect.anything(), { width: 640 });
    });
});

describe('AudioCoverArt — the bleed', () => {
    // The signature of the player screen: the artwork lights the panel around
    // it. It is the only colour the app ever shows at that size.
    it('lights the panel behind the artwork on the player screen', async () => {
        resolveCover(URL_A);
        const wrapper = mountArt('hero');
        await flushPromises();

        const bleed = wrapper.get('.cover__bleed');
        expect(bleed.attributes('src')).toBe(URL_A);
        // Scenery, not content: it must not be announced twice.
        expect(bleed.attributes('aria-hidden')).toBe('true');
        expect(bleed.attributes('alt')).toBe('');
    });

    it('does not light anything on a tile', async () => {
        resolveCover(URL_A);
        const wrapper = mountArt('tile');
        await flushPromises();
        expect(wrapper.find('.cover__bleed').exists()).toBe(false);
    });

    // No artwork, no glow: the screen stays dark rather than inventing a mood
    // the player is not in.
    it('does not light anything when there is no artwork', async () => {
        fetchCover.mockResolvedValue('');
        resolveCover('');
        const wrapper = mountArt('hero');
        await flushPromises();
        expect(wrapper.find('.cover__bleed').exists()).toBe(false);
    });
});

describe('AudioCoverArt — accessible naming', () => {
    // On the player screen the artwork IS the subject.
    it('describes the artwork on the player screen', async () => {
        resolveCover(URL_A);
        const wrapper = mountArt('hero');
        await flushPromises();
        expect(wrapper.get('.cover__art').attributes('alt')).toBe(
            en.audio.cover.replace('{name}', 'Salon'),
        );
    });

    // On a tile it sits beside the player's name and the track's title;
    // describing it again would only lengthen the link's accessible name.
    it('leaves the artwork decorative on a tile', async () => {
        resolveCover(URL_A);
        const wrapper = mountArt('tile');
        await flushPromises();
        expect(wrapper.get('.cover__art').attributes('alt')).toBe('');
    });

    it('names the placeholder on the player screen and hides it on a tile', async () => {
        fetchCover.mockResolvedValue('');
        resolveCover('');

        const hero = mountArt('hero');
        await flushPromises();
        expect(hero.get('.cover__placeholder').attributes('aria-label')).toBe(en.audio.noCover);

        const tile = mountArt('tile');
        await flushPromises();
        expect(tile.get('.cover__placeholder').attributes('aria-hidden')).toBe('true');
    });
});
