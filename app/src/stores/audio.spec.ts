import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { decodeServerMessage } from '../protocol/messages';
import { useAudioStore } from './audio';
import type { AudioQueryMessage, GetStateMessage } from '../protocol/types';

/** Frames the store handed to the transport, in order. */
let sent: string[];
/** Flip to false to play "the socket is not open". */
let socketOpen: boolean;

function store() {
    const audio = useAudioStore();
    audio.attachTransport((frame) => {
        if (!socketOpen) return false;
        sent.push(frame);
        return true;
    });
    return audio;
}

/** A get_state answer, decoded exactly the way the service would decode it. */
function getState(players: Record<string, unknown>): GetStateMessage {
    const msg = decodeServerMessage({ msg: 'get_state', data: players });
    if (msg.kind !== 'get_state') throw new Error('expected get_state');
    return msg;
}

function audioReply(msgId: string, data: Record<string, string>): AudioQueryMessage {
    const msg = decodeServerMessage({ msg: 'audio', msg_id: msgId, data });
    if (msg.kind !== 'audio_query') throw new Error('expected audio_query');
    return msg;
}

/** The msg_id the store put on its Nth outgoing cover query. */
function coverMsgId(index = 0): string {
    const frames = sent.filter((frame) => frame.includes('get_cover_url'));
    return String(JSON.parse(frames[index]).msg_id);
}

const PLAYING = {
    playlist_current_track: '1',
    volume: '35',
    playlist_size: '3',
    time_elapsed: '42.5',
    status: 'playing',
    current_track: { title: 'Sunrise', artist: 'Orchestra', album: 'Vol. 1', duration: '187.2' },
};

beforeEach(() => {
    setActivePinia(createPinia());
    sent = [];
    socketOpen = true;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('reads before anything has landed', () => {
    it('answers with a blank state rather than undefined, so views need no guard', () => {
        const audio = store();
        const state = audio.stateFor('audio_1');
        expect(state.status).toBe('unknown');
        expect(state.volume).toBe(0);
        expect(state.track.title).toBe('');
        // The one field that says "this is a placeholder, not a stopped player".
        expect(state.known).toBe(false);
    });

    it('reports no cover and no answer about one', () => {
        const audio = store();
        expect(audio.coverUrlFor('audio_1')).toBe('');
        expect(audio.coverResolved('audio_1')).toBe(false);
    });
});

describe('requestDetails', () => {
    it('asks about every player in ONE frame', () => {
        store().requestDetails(['audio_1', 'audio_2']);
        expect(sent).toEqual(['{"msg":"get_state","data":{"items":["audio_1","audio_2"]}}']);
    });

    it('sends nothing for an empty house', () => {
        expect(store().requestDetails([])).toBe(false);
        expect(sent).toEqual([]);
    });

    it('reports the frame as dropped when the socket is closed', () => {
        socketOpen = false;
        expect(store().requestDetails(['audio_1'])).toBe(false);
    });

    it('warns instead of throwing when no transport was ever attached', () => {
        const audio = useAudioStore();
        expect(() => audio.requestDetails(['audio_1'])).not.toThrow();
        expect(console.warn).toHaveBeenCalled();
    });
});

describe('applyGetState', () => {
    it('ingests a player and marks it known', () => {
        const audio = store();
        audio.applyGetState(getState({ audio_1: PLAYING }));

        const state = audio.stateFor('audio_1');
        expect(state.known).toBe(true);
        expect(state.status).toBe('playing');
        expect(state.volume).toBe(35);
        expect(state.playlistSize).toBe(3);
        expect(state.track).toEqual({
            title: 'Sunrise',
            artist: 'Orchestra',
            album: 'Vol. 1',
            duration: 187.2,
        });
    });

    // Plain io state belongs to the home store, which learns it from
    // io_changed. This store only ever asked about players.
    it('ignores the non-player entries of the same answer', () => {
        const audio = store();
        audio.applyGetState(getState({ output_1: 'true', audio_1: PLAYING }));
        expect([...audio.states.keys()]).toEqual(['audio_1']);
    });

    it('asks for cover art once the track is known', () => {
        const audio = store();
        audio.applyGetState(getState({ audio_1: PLAYING }));

        const query = sent.find((frame) => frame.includes('get_cover_url'));
        expect(query).toBeDefined();
        expect(JSON.parse(query as string)).toMatchObject({
            msg: 'audio',
            data: { audio_action: 'get_cover_url', id: 'audio_1' },
        });
    });

    // Otherwise every 15 s re-anchor would re-fetch a picture already on screen.
    it('does not re-ask for the cover when the track has not changed', () => {
        const audio = store();
        audio.applyGetState(getState({ audio_1: PLAYING }));
        audio.applyAudioQuery(audioReply(coverMsgId(), { cover: 'http://lms/1.jpg' }));
        const before = sent.length;

        audio.applyGetState(getState({ audio_1: { ...PLAYING, time_elapsed: '60' } }));
        expect(sent).toHaveLength(before);
        expect(audio.coverUrlFor('audio_1')).toBe('http://lms/1.jpg');
    });

    it('re-asks — and drops the old picture — the moment the track changes', () => {
        const audio = store();
        audio.applyGetState(getState({ audio_1: PLAYING }));
        audio.applyAudioQuery(audioReply(coverMsgId(), { cover: 'http://lms/1.jpg' }));

        audio.applyGetState(
            getState({
                audio_1: { ...PLAYING, current_track: { title: 'Ambient', artist: 'Orchestra' } },
            }),
        );
        // Not the previous song's artwork, and not a stale "resolved" either.
        expect(audio.coverUrlFor('audio_1')).toBe('');
        expect(audio.coverResolved('audio_1')).toBe(false);
        expect(sent.filter((frame) => frame.includes('get_cover_url'))).toHaveLength(2);
    });
});

describe('cover art correlation', () => {
    it('attributes a reply to the player that asked, by echoed msg_id', () => {
        const audio = store();
        audio.applyGetState(getState({ audio_1: PLAYING, audio_2: { status: 'stop' } }));

        // audio_2's track is blank, so both players asked; answer only the first.
        audio.applyAudioQuery(audioReply(coverMsgId(0), { cover: 'http://lms/17.jpg' }));

        expect(audio.coverUrlFor('audio_1')).toBe('http://lms/17.jpg');
        expect(audio.coverResolved('audio_1')).toBe(true);
        expect(audio.coverResolved('audio_2')).toBe(false);
    });

    it('treats an empty cover as a real answer, not as still waiting', () => {
        const audio = store();
        audio.applyGetState(getState({ audio_1: PLAYING }));
        audio.applyAudioQuery(audioReply(coverMsgId(), { cover: '' }));

        expect(audio.coverUrlFor('audio_1')).toBe('');
        // Resolved: the view can stop waiting and try the base64 path.
        expect(audio.coverResolved('audio_1')).toBe(true);
    });

    it('treats an upstream error as "no artwork", not as a retry', () => {
        const audio = store();
        audio.applyGetState(getState({ audio_1: PLAYING }));
        audio.applyAudioQuery(audioReply(coverMsgId(), { error: 'unkown player_id' }));

        expect(audio.coverUrlFor('audio_1')).toBe('');
        expect(audio.coverResolved('audio_1')).toBe(true);
    });

    it('drops a reply that answers nobody', () => {
        const audio = store();
        audio.applyGetState(getState({ audio_1: PLAYING }));
        expect(() =>
            audio.applyAudioQuery(audioReply('not-a-request', { cover: 'http://lms/x.jpg' })),
        ).not.toThrow();
        expect(audio.coverUrlFor('audio_1')).toBe('');
    });

    // The song changed while the first query was in flight: its answer is the
    // previous song's artwork and must not be painted over the current one.
    it('drops a reply superseded by a newer request for the same player', () => {
        const audio = store();
        audio.applyGetState(getState({ audio_1: PLAYING }));
        const stale = coverMsgId(0);
        audio.applyGetState(
            getState({ audio_1: { ...PLAYING, current_track: { title: 'Ambient' } } }),
        );

        audio.applyAudioQuery(audioReply(stale, { cover: 'http://lms/old.jpg' }));
        expect(audio.coverUrlFor('audio_1')).toBe('');
        expect(audio.coverResolved('audio_1')).toBe(false);

        audio.applyAudioQuery(audioReply(coverMsgId(1), { cover: 'http://lms/new.jpg' }));
        expect(audio.coverUrlFor('audio_1')).toBe('http://lms/new.jpg');
    });

    it('resolves the cover as absent when the query could not even be sent', () => {
        const audio = store();
        socketOpen = false;
        audio.applyGetState(getState({ audio_1: PLAYING }));
        // No frame is in flight, so nothing will ever answer: say so rather
        // than leaving the view spinning on a request that never left.
        expect(audio.coverResolved('audio_1')).toBe(true);
        expect(audio.coverUrlFor('audio_1')).toBe('');
    });
});

describe('events', () => {
    it('follows a status change, in the event vocabulary', () => {
        const audio = store();
        audio.applyGetState(getState({ audio_1: PLAYING }));

        audio.handleAudioEvent('audio_status_changed', { player_id: 'audio_1', state: 'pause' });
        expect(audio.stateFor('audio_1').status).toBe('pause');

        audio.handleAudioEvent('audio_status_changed', { player_id: 'audio_1', state: 'play' });
        expect(audio.stateFor('audio_1').status).toBe('playing');
    });

    it('freezes the running position at the moment of a pause', () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(1_000_000);
            const audio = store();
            audio.applyGetState(getState({ audio_1: { ...PLAYING, time_elapsed: '40' } }));

            vi.setSystemTime(1_005_000);
            audio.handleAudioEvent('audio_status_changed', {
                player_id: 'audio_1',
                state: 'pause',
            });

            // 40 s at the anchor + the 5 s that ran before the finger landed.
            vi.setSystemTime(1_060_000);
            expect(audio.elapsedFor('audio_1', Date.now())).toBe(45);
        } finally {
            vi.useRealTimers();
        }
    });

    // Whether a stopped LMS rewinds to 0 is unverified, so it is asked rather
    // than assumed.
    it('re-reads the player after a stop instead of guessing the position', () => {
        const audio = store();
        audio.applyGetState(getState({ audio_1: PLAYING }));
        sent.length = 0;

        audio.handleAudioEvent('audio_status_changed', { player_id: 'audio_1', state: 'stop' });
        expect(sent).toContain('{"msg":"get_state","data":{"items":["audio_1"]}}');
    });

    it('does not re-read on an ordinary play or pause', () => {
        const audio = store();
        audio.applyGetState(getState({ audio_1: PLAYING }));
        sent.length = 0;

        audio.handleAudioEvent('audio_status_changed', { player_id: 'audio_1', state: 'pause' });
        audio.handleAudioEvent('audio_status_changed', { player_id: 'audio_1', state: 'play' });
        expect(sent).toEqual([]);
    });

    it('follows a volume change', () => {
        const audio = store();
        audio.applyGetState(getState({ audio_1: PLAYING }));

        audio.handleAudioEvent('audio_volume_changed', { player_id: 'audio_1', volume: '70' });
        expect(audio.stateFor('audio_1').volume).toBe(70);
    });

    // The song event carries nothing but the id — the new title, its duration
    // and its artwork all have to be fetched.
    it('restarts the position and re-reads the player on a song change', () => {
        const audio = store();
        audio.applyGetState(getState({ audio_1: PLAYING }));
        sent.length = 0;

        audio.handleAudioEvent('audio_song_changed', { player_id: 'audio_1' });
        expect(audio.stateFor('audio_1').timeElapsed).toBe(0);
        expect(sent).toContain('{"msg":"get_state","data":{"items":["audio_1"]}}');
    });

    it('accepts an event for a player whose detail has not landed yet', () => {
        const audio = store();
        audio.handleAudioEvent('audio_volume_changed', { player_id: 'audio_9', volume: '20' });

        expect(audio.stateFor('audio_9').volume).toBe(20);
        // Still not 'known': one event is not a description of the player.
        expect(audio.stateFor('audio_9').known).toBe(false);
    });

    it.each([
        ['audio_status_changed', { id: 'audio_1', state: 'play' }],
        ['audio_volume_changed', null],
        ['io_changed', { id: 'audio_1', state: 'onplay' }],
        ['playlist_reload', { player_id: 'audio_1' }],
    ])('ignores %s with payload %o without throwing', (typeStr, data) => {
        const audio = store();
        expect(() => audio.handleAudioEvent(typeStr, data)).not.toThrow();
        expect(audio.states.size).toBe(0);
    });
});

describe('commands', () => {
    it.each([
        ['play', '{"msg":"set_state","data":{"id":"audio_1","value":"play"}}'],
        ['pause', '{"msg":"set_state","data":{"id":"audio_1","value":"pause"}}'],
        ['stop', '{"msg":"set_state","data":{"id":"audio_1","value":"stop"}}'],
        ['next', '{"msg":"set_state","data":{"id":"audio_1","value":"next"}}'],
        ['previous', '{"msg":"set_state","data":{"id":"audio_1","value":"previous"}}'],
    ] as const)('%s sends exactly one frame', (action, frame) => {
        const audio = store();
        expect(audio[action]('audio_1')).toBe(true);
        expect(sent).toEqual([frame]);
    });

    it('sends volume as an absolute command with an explicit amount', () => {
        const audio = store();
        audio.setVolume('audio_1', 55);
        expect(sent).toEqual(['{"msg":"set_state","data":{"id":"audio_1","value":"volume set 55"}}']);
    });

    // Same rule as the home store: the screen changes when the server says so.
    it('does not move the stored volume until the server confirms it', () => {
        const audio = store();
        audio.applyGetState(getState({ audio_1: PLAYING }));

        audio.setVolume('audio_1', 55);
        expect(audio.stateFor('audio_1').volume).toBe(35);

        audio.handleAudioEvent('audio_volume_changed', { player_id: 'audio_1', volume: '55' });
        expect(audio.stateFor('audio_1').volume).toBe(55);
    });

    it('does not change the status optimistically on a transport press', () => {
        const audio = store();
        audio.applyGetState(getState({ audio_1: PLAYING }));

        audio.pause('audio_1');
        expect(audio.stateFor('audio_1').status).toBe('playing');
    });

    it('reports a dropped frame when the socket is closed', () => {
        socketOpen = false;
        expect(store().play('audio_1')).toBe(false);
    });
});

describe('clear', () => {
    it('empties state, covers and the in-flight correlations', () => {
        const audio = store();
        audio.applyGetState(getState({ audio_1: PLAYING }));
        const inFlight = coverMsgId();

        audio.clear();
        expect(audio.states.size).toBe(0);
        expect(audio.covers.size).toBe(0);

        // A reply that lands after a sign-out must not attach artwork to the
        // next session's player of the same id.
        audio.applyAudioQuery(audioReply(inFlight, { cover: 'http://lms/17.jpg' }));
        expect(audio.coverUrlFor('audio_1')).toBe('');
    });
});
