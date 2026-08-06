import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory } from 'vue-router';
import AudioPlayerView from './AudioPlayerView.vue';
import en from '../i18n/en.json';
import { createAppRouter } from '../router';
import { toHomeData } from '../protocol/guards';
import { decodeServerMessage } from '../protocol/messages';
import * as coverService from '../services/audio-cover';
import { useAudioStore } from '../stores/audio';
import { useAuthStore } from '../stores/auth';
import { useHomeStore } from '../stores/home';
import type { Router } from 'vue-router';
import type { DOMWrapper, VueWrapper } from '@vue/test-utils';

const PLAYERS = [
    { id: 'audio_1', name: 'Salon', type: 'slim', playlist: 'true', database: 'true' },
    { id: 'audio_2', name: 'Cuisine', type: 'Roon', playlist: 'true', database: 'false' },
];

const PLAYING = {
    playlist_current_track: '1',
    volume: '35',
    playlist_size: '3',
    time_elapsed: '42.5',
    status: 'playing',
    current_track: {
        title: 'Sunrise Over Wago',
        artist: 'Calaos Orchestra',
        album: 'Home Automation Vol. 1',
        duration: '187.2',
    },
};

let router: Router;
/** Frames the store sent, in order — the assertion target for transport. */
let sent: string[];

function loadHouse(): void {
    useHomeStore().setHome(toHomeData({ home: [], cameras: [], audio: PLAYERS }));
}

function loadDetail(players: Record<string, unknown>): void {
    const audio = useAudioStore();
    const msg = decodeServerMessage({ msg: 'get_state', data: players });
    if (msg.kind !== 'get_state') throw new Error('expected get_state');
    audio.applyGetState(msg);
}

async function mountPlayer(id = 'audio_1'): Promise<VueWrapper> {
    await router.push(`/audio/${id}`);
    await router.isReady();

    const wrapper = mount(AudioPlayerView, {
        global: {
            plugins: [router, createI18n({ legacy: false, locale: 'en', messages: { en } })],
        },
    });
    await flushPromises();
    return wrapper;
}

/** A transport control, found the way a screen reader would find it. */
function control(wrapper: VueWrapper, key: 'play' | 'pause' | 'stop' | 'next' | 'previous') {
    const label = en.audio[key].replace('{name}', 'Salon');
    const found = wrapper
        .findAll('button')
        .find((button) => button.attributes('aria-label') === label);
    if (found === undefined) throw new Error(`no control labelled "${label}"`);
    return found;
}

/** Only the set_state frames, so a re-anchoring get_state never confuses a count. */
const commands = (): string[] => sent.filter((frame) => frame.includes('set_state'));

/** Moves a slider without ending the interaction (a real drag fires only `input`). */
async function dragTo(input: Omit<DOMWrapper<Element>, 'exists'>, value: number): Promise<void> {
    (input.element as HTMLInputElement).value = String(value);
    await input.trigger('input');
}

beforeEach(() => {
    setActivePinia(createPinia());
    // Every audio route is behind the auth guard; without a session the router
    // would answer each push with a redirect to /login.
    const auth = useAuthStore();
    auth.user = 'demo';
    auth.pass = 'demo';
    auth.state = 'authed';
    router = createAppRouter(createMemoryHistory());
    sent = [];
    useAudioStore().attachTransport((frame) => {
        sent.push(frame);
        return true;
    });
    vi.spyOn(coverService, 'fetchCoverDataUrl').mockResolvedValue('');
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('AudioPlayerView — what it shows', () => {
    it('names the player and its status', async () => {
        loadHouse();
        loadDetail({ audio_1: PLAYING });
        const wrapper = await mountPlayer();

        expect(wrapper.get('.player__name').text()).toBe('Salon');
        expect(wrapper.get('.player__eyebrow').text()).toBe(en.audio.status.playing);
        expect(wrapper.find('.player__dot').exists()).toBe(true);
    });

    it('falls back to the section name while the player has said nothing', async () => {
        loadHouse();
        const wrapper = await mountPlayer();

        expect(wrapper.get('.player__eyebrow').text()).toBe(en.audio.label);
        expect(wrapper.find('.player__dot').exists()).toBe(false);
    });

    it('shows the three metadata lines the backend sent', async () => {
        loadHouse();
        loadDetail({ audio_1: PLAYING });
        const wrapper = await mountPlayer();

        expect(wrapper.get('.player__track').text()).toBe('Sunrise Over Wago');
        expect(wrapper.get('.player__artist').text()).toBe('Calaos Orchestra');
        expect(wrapper.get('.player__album').text()).toBe('Home Automation Vol. 1');
    });

    // Which tags a real LMS returns per media type is unverified; a partial
    // track renders partially rather than leaving empty labels behind.
    it('hides the metadata lines the backend did not send', async () => {
        loadHouse();
        loadDetail({ audio_1: { status: 'playing', current_track: { title: 'FIP' } } });
        const wrapper = await mountPlayer();

        expect(wrapper.get('.player__track').text()).toBe('FIP');
        expect(wrapper.find('.player__artist').exists()).toBe(false);
        expect(wrapper.find('.player__album').exists()).toBe(false);
    });

    it('says nothing is playing rather than showing a blank line', async () => {
        loadHouse();
        loadDetail({ audio_1: { status: 'stop' } });
        const wrapper = await mountPlayer();

        expect(wrapper.get('.player__track').text()).toBe(en.audio.nothingPlaying);
        expect(wrapper.find('.player__position').exists()).toBe(false);
    });

    // A stale deep link, or a sign-out that emptied the store before the route
    // change completed.
    it('renders nothing for a player id the house does not have', async () => {
        loadHouse();
        const wrapper = await mountPlayer('audio_nope');
        expect(wrapper.find('.player').exists()).toBe(false);
    });
});

describe('AudioPlayerView — position', () => {
    it('shows the elapsed and total time', async () => {
        loadHouse();
        loadDetail({ audio_1: PLAYING });
        const wrapper = await mountPlayer();

        const clocks = wrapper.findAll('.player__clock').map((node) => node.text());
        expect(clocks).toEqual(['0:42', '3:07']);
    });

    it('advances the clock locally between anchors', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(1_000_000);
            loadHouse();
            loadDetail({ audio_1: { ...PLAYING, time_elapsed: '40' } });
            const wrapper = await mountPlayer();
            expect(wrapper.findAll('.player__clock')[0].text()).toBe('0:40');

            vi.setSystemTime(1_005_000);
            await vi.advanceTimersByTimeAsync(500);
            expect(wrapper.findAll('.player__clock')[0].text()).toBe('0:45');
        } finally {
            vi.useRealTimers();
        }
    });

    // There is no seek command in the protocol, so nothing here may look
    // draggable: the filament is an indicator, and the only <input> on the
    // screen is the volume slider.
    it('draws position as an indicator, never as a control', async () => {
        loadHouse();
        loadDetail({ audio_1: PLAYING });
        const wrapper = await mountPlayer();

        const filament = wrapper.get('.player__filament');
        expect(filament.attributes('role')).toBe('progressbar');
        expect(filament.element.tagName).not.toBe('INPUT');
        expect(wrapper.get('.player__position').findAll('input')).toHaveLength(0);
        expect(wrapper.get('.player__position').findAll('button')).toHaveLength(0);
    });

    it('reports the position to assistive tech in both numbers and words', async () => {
        loadHouse();
        loadDetail({ audio_1: PLAYING });
        const wrapper = await mountPlayer();

        const filament = wrapper.get('.player__filament');
        expect(filament.attributes('aria-valuenow')).toBe('43');
        expect(filament.attributes('aria-valuemax')).toBe('187');
        expect(filament.attributes('aria-valuetext')).toBe('0:42');
        expect(filament.attributes('aria-label')).toBe(
            en.audio.position.replace('{name}', 'Salon'),
        );
    });

    // A radio stream reports duration '0'. A bar that can never fill is worse
    // than no bar — but the elapsed clock still counts, which is what a
    // stream is.
    it('drops the filament and the total for a stream with no end', async () => {
        loadHouse();
        loadDetail({
            audio_1: { status: 'playing', time_elapsed: '12', current_track: { title: 'FIP' } },
        });
        const wrapper = await mountPlayer();

        expect(wrapper.findAll('.player__clock').map((node) => node.text())).toEqual(['0:12']);
        expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
        expect(wrapper.find('.player__filament--open').exists()).toBe(true);
    });
});

describe('AudioPlayerView — transport', () => {
    it('sends the exact play frame when the player is not playing', async () => {
        loadHouse();
        loadDetail({ audio_1: { status: 'stop' } });
        const wrapper = await mountPlayer();

        await control(wrapper, 'play').trigger('click');
        expect(commands()).toEqual(['{"msg":"set_state","data":{"id":"audio_1","value":"play"}}']);
    });

    it('sends the exact pause frame when it is', async () => {
        loadHouse();
        loadDetail({ audio_1: PLAYING });
        const wrapper = await mountPlayer();

        await control(wrapper, 'pause').trigger('click');
        expect(commands()).toEqual(['{"msg":"set_state","data":{"id":"audio_1","value":"pause"}}']);
    });

    it('sends the exact stop frame', async () => {
        loadHouse();
        loadDetail({ audio_1: PLAYING });
        const wrapper = await mountPlayer();

        await control(wrapper, 'stop').trigger('click');
        expect(commands()).toEqual(['{"msg":"set_state","data":{"id":"audio_1","value":"stop"}}']);
    });

    it('sends the exact next frame', async () => {
        loadHouse();
        loadDetail({ audio_1: PLAYING });
        const wrapper = await mountPlayer();

        await control(wrapper, 'next').trigger('click');
        expect(commands()).toEqual(['{"msg":"set_state","data":{"id":"audio_1","value":"next"}}']);
    });

    // The old app's previous button sent 'prev', which set_value swallows.
    it('sends "previous", never "prev"', async () => {
        loadHouse();
        loadDetail({ audio_1: PLAYING });
        const wrapper = await mountPlayer();

        await control(wrapper, 'previous').trigger('click');
        expect(commands()).toEqual([
            '{"msg":"set_state","data":{"id":"audio_1","value":"previous"}}',
        ]);
    });

    it('does not flip the button until the server confirms the change', async () => {
        loadHouse();
        loadDetail({ audio_1: PLAYING });
        const wrapper = await mountPlayer();

        await control(wrapper, 'pause').trigger('click');
        // Still labelled "pause": the state on screen is the server's.
        expect(control(wrapper, 'pause').exists()).toBe(true);

        useAudioStore().handleAudioEvent('audio_status_changed', {
            player_id: 'audio_1',
            state: 'pause',
        });
        await flushPromises();
        expect(control(wrapper, 'play').exists()).toBe(true);
    });
});

describe('AudioPlayerView — volume', () => {
    it('shows the server-reported level', async () => {
        loadHouse();
        loadDetail({ audio_1: PLAYING });
        const wrapper = await mountPlayer();

        expect(wrapper.get('input[type="range"]').element).toHaveProperty('value', '35');
        expect(wrapper.get('.player__volume-value').text()).toBe('35%');
    });

    it('sends nothing while the slider is still being dragged', async () => {
        loadHouse();
        loadDetail({ audio_1: PLAYING });
        const wrapper = await mountPlayer();

        const input = wrapper.get('input[type="range"]');
        await input.trigger('pointerdown', { pointerType: 'mouse' });
        await dragTo(input, 55);
        await dragTo(input, 70);
        expect(commands()).toEqual([]);
    });

    it('commits once, on release, as an absolute volume command', async () => {
        loadHouse();
        loadDetail({ audio_1: PLAYING });
        const wrapper = await mountPlayer();

        const input = wrapper.get('input[type="range"]');
        await input.trigger('pointerdown', { pointerType: 'mouse' });
        await dragTo(input, 55);
        await input.trigger('pointerup', { pointerType: 'mouse' });

        expect(commands()).toEqual([
            '{"msg":"set_state","data":{"id":"audio_1","value":"volume set 55"}}',
        ]);
    });

    it('shows the new level only once the player reports it', async () => {
        loadHouse();
        loadDetail({ audio_1: PLAYING });
        const wrapper = await mountPlayer();

        const input = wrapper.get('input[type="range"]');
        await input.trigger('pointerdown', { pointerType: 'mouse' });
        await dragTo(input, 55);
        await input.trigger('pointerup', { pointerType: 'mouse' });
        expect(wrapper.get('.player__volume-value').text()).toBe('35%');

        useAudioStore().handleAudioEvent('audio_volume_changed', {
            player_id: 'audio_1',
            volume: '55',
        });
        await flushPromises();
        expect(wrapper.get('.player__volume-value').text()).toBe('55%');
    });
});

describe('AudioPlayerView — staying current', () => {
    it('asks for fresh detail on arrival', async () => {
        loadHouse();
        await mountPlayer();
        expect(sent).toContain('{"msg":"get_state","data":{"items":["audio_1"]}}');
    });

    it('follows the route when the same view is reused for another player', async () => {
        loadHouse();
        const wrapper = await mountPlayer();
        loadDetail({ audio_2: { status: 'stop' } });

        await router.push('/audio/audio_2');
        await flushPromises();

        expect(wrapper.get('.player__name').text()).toBe('Cuisine');
        expect(sent).toContain('{"msg":"get_state","data":{"items":["audio_2"]}}');
    });

    // There is no position event: the local clock is arithmetic, and this is
    // what keeps it honest over an hour on a wall panel. Only while playing —
    // a paused player's position is already exact.
    it('re-anchors a playing player periodically, and a paused one never', async () => {
        vi.useFakeTimers();
        try {
            loadHouse();
            loadDetail({ audio_1: PLAYING });
            await mountPlayer();
            sent.length = 0;

            await vi.advanceTimersByTimeAsync(15_000);
            expect(sent).toEqual(['{"msg":"get_state","data":{"items":["audio_1"]}}']);

            useAudioStore().handleAudioEvent('audio_status_changed', {
                player_id: 'audio_1',
                state: 'pause',
            });
            sent.length = 0;
            await vi.advanceTimersByTimeAsync(60_000);
            expect(sent).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('stops both timers when the screen goes away', async () => {
        vi.useFakeTimers();
        try {
            loadHouse();
            loadDetail({ audio_1: PLAYING });
            const wrapper = await mountPlayer();
            wrapper.unmount();
            sent.length = 0;

            await vi.advanceTimersByTimeAsync(120_000);
            expect(sent).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });
});
