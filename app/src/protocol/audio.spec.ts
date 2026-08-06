import { describe, expect, it } from 'vitest';
import {
    AUDIO_NEXT,
    AUDIO_PAUSE,
    AUDIO_PLAY,
    AUDIO_PREVIOUS,
    AUDIO_STOP,
    clampVolume,
    elapsedAt,
    formatClock,
    isPlaying,
    normalizeAudioStatus,
    toAudioEvent,
    toAudioPlayerState,
    toAudioTrack,
    toSeconds,
    trackKey,
    volumeSet,
} from './audio';
import type { AudioPlayerState } from './types';

/** Every shape a malformed frame could take, reused across the guard suites. */
const GARBAGE = [null, undefined, 42, NaN, true, false, 'a string', '', [], [1, 2], () => {}];

describe('transport command strings', () => {
    it('spells the five transport verbs exactly as AudioPlayer::set_value reads them', () => {
        expect(AUDIO_PLAY).toBe('play');
        expect(AUDIO_PAUSE).toBe('pause');
        expect(AUDIO_STOP).toBe('stop');
        expect(AUDIO_NEXT).toBe('next');
    });

    // The single most consequential correction T16 made: the old app sent
    // 'prev', which set_value does not know — it echoed it and did nothing.
    it('spells previous "previous", never "prev"', () => {
        expect(AUDIO_PREVIOUS).toBe('previous');
    });
});

describe('volumeSet', () => {
    it('builds the absolute form with an explicit amount', () => {
        expect(volumeSet(55)).toBe('volume set 55');
        expect(volumeSet(0)).toBe('volume set 0');
        expect(volumeSet(100)).toBe('volume set 100');
    });

    it('clamps and rounds, so no out-of-range value ever reaches the mixer', () => {
        expect(volumeSet(-10)).toBe('volume set 0');
        expect(volumeSet(140)).toBe('volume set 100');
        expect(volumeSet(35.7)).toBe('volume set 36');
    });

    it.each([[NaN], [Infinity], [-Infinity]])('turns %o into 0 rather than a broken frame', (n) => {
        expect(clampVolume(n)).toBe(0);
    });
});

describe('normalizeAudioStatus — the one bridge between the two vocabularies', () => {
    // get_state answers 'playing'; audio_status_changed answers 'play'. Both
    // describe the same player doing the same thing.
    it.each([
        ['play', 'playing'],
        ['playing', 'playing'],
        ['pause', 'pause'],
        ['stop', 'stop'],
        ['error', 'error'],
        ['song_change', 'song_change'],
    ])('normalizes %o to %o', (raw, expected) => {
        expect(normalizeAudioStatus(raw)).toBe(expected);
    });

    it.each(GARBAGE.map((g) => [g]))('reads %o as unknown rather than guessing', (garbage) => {
        expect(normalizeAudioStatus(garbage)).toBe('unknown');
    });

    it('treats only "playing" as moving', () => {
        expect(isPlaying('playing')).toBe(true);
        for (const status of ['pause', 'stop', 'error', 'song_change', 'unknown'] as const) {
            expect(isPlaying(status)).toBe(false);
        }
    });
});

describe('toSeconds', () => {
    // `Utils::to_string(double)`'s exact precision is unverified, so every
    // spelling of the same number has to mean the same number.
    it.each([['42.5', 42.5], ['42.500000', 42.5], ['42', 42], ['243.435', 243.435]])(
        'parses %o as %o',
        (raw, expected) => {
            expect(toSeconds(raw)).toBe(expected);
        },
    );

    // Numbers are coerced defensively, like everywhere else in the guards: a
    // server that ever sent a real JSON number instead of a string still works.
    it('accepts a numeric reading as well as a string one', () => {
        expect(toSeconds(42)).toBe(42);
    });

    it.each([null, undefined, NaN, true, false, 'a string', '', [], [1, 2], () => {}].map((g) => [g]))(
        'falls back to 0 for %o',
        (garbage) => {
            expect(toSeconds(garbage)).toBe(0);
        },
    );

    it('reads a negative reading as 0 — a player is never before its own start', () => {
        expect(toSeconds('-3')).toBe(0);
    });
});

describe('toAudioTrack', () => {
    it('reads the four keys every backend agrees on and ignores the rest', () => {
        expect(
            toAudioTrack({
                id: '1042',
                title: 'Sunrise Over Wago',
                artist: 'Calaos Orchestra',
                album: 'Home Automation Vol. 1',
                genre: 'Electronic',
                coverart: '1',
                duration: '187.2',
                bitrate: '320kbps CBR',
            }),
        ).toEqual({
            title: 'Sunrise Over Wago',
            artist: 'Calaos Orchestra',
            album: 'Home Automation Vol. 1',
            duration: 187.2,
        });
    });

    // A radio stream reports four keys and a duration of '0'; which tags a
    // real LMS returns per media type is on the spec's unverified list, so a
    // partial track is an ordinary outcome, never an error.
    it('keeps a partial track partial rather than inventing values', () => {
        expect(toAudioTrack({ title: 'FIP', duration: '0' })).toEqual({
            title: 'FIP',
            artist: '',
            album: '',
            duration: 0,
        });
    });

    it.each(GARBAGE.map((g) => [g]))('never throws on %o', (garbage) => {
        expect(toAudioTrack(garbage)).toEqual({ title: '', artist: '', album: '', duration: 0 });
    });
});

describe('toAudioPlayerState', () => {
    it('reads a full get_state expansion', () => {
        const state = toAudioPlayerState(
            {
                playlist_current_track: '1',
                volume: '35',
                playlist_size: '3',
                time_elapsed: '42.5',
                status: 'playing',
                current_track: { title: 'T', artist: 'A', album: 'B', duration: '187.2' },
            },
            1_000,
        );

        expect(state).toEqual({
            status: 'playing',
            volume: 35,
            playlistSize: 3,
            playlistCurrentTrack: 1,
            timeElapsed: 42.5,
            anchoredAt: 1_000,
            track: { title: 'T', artist: 'A', album: 'B', duration: 187.2 },
            known: true,
        });
    });

    it.each(GARBAGE.map((g) => [g]))('degrades %o to a blank but usable state', (garbage) => {
        const state = toAudioPlayerState(garbage, 7);
        expect(state.status).toBe('unknown');
        expect(state.volume).toBe(0);
        expect(state.timeElapsed).toBe(0);
        expect(state.track.title).toBe('');
        // Still 'known': the server answered for this id, it just answered
        // with nothing the app recognizes.
        expect(state.known).toBe(true);
    });
});

// ---------------------------------------------------------------------------

function stateAt(overrides: Partial<AudioPlayerState> = {}): AudioPlayerState {
    return {
        status: 'playing',
        volume: 35,
        playlistSize: 3,
        playlistCurrentTrack: 0,
        timeElapsed: 40,
        anchoredAt: 10_000,
        track: { title: 'T', artist: 'A', album: 'B', duration: 100 },
        known: true,
        ...overrides,
    };
}

describe('elapsedAt — the local clock', () => {
    it('advances with the wall clock while playing', () => {
        expect(elapsedAt(stateAt(), 10_000)).toBe(40);
        expect(elapsedAt(stateAt(), 15_000)).toBe(45);
    });

    it.each([['pause'], ['stop'], ['error'], ['unknown']] as const)(
        'freezes at the reading while %s',
        (status) => {
            expect(elapsedAt(stateAt({ status }), 15_000)).toBe(40);
        },
    );

    // Whether a stopped LMS rewinds time_elapsed to 0 could not be verified
    // from source; either way the display must never outrun the track.
    it('clamps to the duration rather than counting past the end of the song', () => {
        expect(elapsedAt(stateAt(), 999_999)).toBe(100);
    });

    it('leaves an unbounded stream unbounded (duration 0 means no end)', () => {
        const stream = stateAt({ track: { title: 'FIP', artist: '', album: '', duration: 0 } });
        expect(elapsedAt(stream, 20_000)).toBe(50);
    });

    it('never returns a negative position, even if the clock went backwards', () => {
        expect(elapsedAt(stateAt(), 0)).toBe(40);
        expect(elapsedAt(stateAt({ timeElapsed: -5, status: 'pause' }), 10_000)).toBe(0);
    });
});

describe('formatClock', () => {
    it.each([
        [0, '0:00'],
        [7, '0:07'],
        [42.9, '0:42'],
        [187.2, '3:07'],
        [3600, '1:00:00'],
        [3723, '1:02:03'],
    ])('renders %o as %o', (seconds, expected) => {
        expect(formatClock(seconds)).toBe(expected);
    });

    it.each([[-1], [NaN], [Infinity]])('renders %o as 0:00 rather than nonsense', (seconds) => {
        expect(formatClock(seconds)).toBe('0:00');
    });
});

describe('trackKey', () => {
    it('changes when the metadata changes', () => {
        const a = { title: 'One', artist: 'A', album: 'B', duration: 10 };
        expect(trackKey(a)).toBe(trackKey({ ...a, duration: 999 }));
        expect(trackKey(a)).not.toBe(trackKey({ ...a, title: 'Two' }));
    });

    // Not the playlist index: `next` on a one-track playlist wraps to the same
    // index, and a radio stream changes song without changing index at all.
    it('identifies a track by what it is, not by where it sits', () => {
        const blank = { title: '', artist: '', album: '', duration: 0 };
        expect(trackKey(blank)).toBe(trackKey({ ...blank }));
        expect(trackKey(blank)).not.toBe(trackKey({ ...blank, album: 'B' }));
    });
});

describe('toAudioEvent', () => {
    it('reads a status event, normalizing the event vocabulary', () => {
        expect(toAudioEvent('audio_status_changed', { player_id: 'audio_1', state: 'play' })).toEqual(
            { kind: 'status', playerId: 'audio_1', status: 'playing' },
        );
    });

    it('reads a volume event', () => {
        expect(toAudioEvent('audio_volume_changed', { player_id: 'audio_1', volume: '55' })).toEqual(
            { kind: 'volume', playerId: 'audio_1', volume: 55 },
        );
    });

    it('reads a song event, which carries nothing but the id', () => {
        expect(toAudioEvent('audio_song_changed', { player_id: 'audio_2' })).toEqual({
            kind: 'song',
            playerId: 'audio_2',
        });
    });

    // io_changed says `id`; audio events say `player_id`. Reading the wrong
    // key is the mistake this function exists to make impossible.
    it('ignores an event keyed the io_changed way', () => {
        expect(toAudioEvent('audio_status_changed', { id: 'audio_1', state: 'play' })).toBeNull();
    });

    it.each([['io_changed'], ['playlist_reload'], ['new_io'], ['']])(
        'ignores the unrelated type %o',
        (typeStr) => {
            expect(toAudioEvent(typeStr, { player_id: 'audio_1' })).toBeNull();
        },
    );

    it.each(GARBAGE.map((g) => [g]))('never throws on payload %o', (garbage) => {
        expect(toAudioEvent('audio_status_changed', garbage)).toBeNull();
    });
});
