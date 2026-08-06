// useAudioCover() — the cover-art fallback chain for one player.
//
// Three sources, tried in order, because none of them is reliable on its own
// (docs/audio-protocol.md "Cover art" and its "Unverified" list):
//
//  1. The URL from `get_cover_url`. It points at the MEDIA server — an LMS or
//     Roon host — not at calaos_server, so it may be on a network the browser
//     cannot reach even though the WebSocket works fine. Whether it resolves
//     is exactly the thing that could not be verified from source.
//  2. `POST /api {action:'get_cover'}`, where calaos_server downloads the
//     artwork itself and answers base64. Always reachable if the app loaded
//     at all, but costs the server a fetch and a re-encode.
//  3. Nothing — the view draws its placeholder glyph.
//
// Step 1 fails silently and asynchronously: the browser reports it as an
// `error` event on the `<img>`, which is why `onError` is returned for the
// component to bind rather than handled here. This module never touches the
// DOM, which is also what lets its spec drive the whole chain by hand.
//
// A track change resets the chain: the store hands over a new URL (or ''),
// and stage 1 starts again for the new artwork.

import { onScopeDispose, readonly, ref, toValue, watch } from 'vue';
import { fetchCoverDataUrl } from '../services/audio-cover';
import type { CoverCredentials } from '../services/audio-cover';
import type { MaybeRefOrGetter, Ref } from 'vue';

/** Which source the picture on screen came from — 'none' means placeholder. */
export type CoverStage = 'idle' | 'url' | 'base64' | 'none';

export interface AudioCover {
    /** Bind to the `<img>`; '' while there is nothing to show. */
    src: Readonly<Ref<string>>;
    /** True when every source has been tried and none produced a picture. */
    missing: Readonly<Ref<boolean>>;
    stage: Readonly<Ref<CoverStage>>;
    /** Bind to the img's `error` — advances the chain. */
    onError: () => void;
}

export interface AudioCoverOptions {
    /** Server-side thumbnail width for the base64 path (list tiles ask small). */
    width?: number;
}

export function useAudioCover(
    playerId: MaybeRefOrGetter<string>,
    coverUrl: MaybeRefOrGetter<string>,
    credentials: MaybeRefOrGetter<CoverCredentials>,
    /** False while the store is still waiting on `get_cover_url` — see below. */
    resolved: MaybeRefOrGetter<boolean>,
    options: AudioCoverOptions = {},
): AudioCover {
    const src = ref('');
    const stage = ref<CoverStage>('idle');
    const missing = ref(false);

    // Not state: a stale async answer must be droppable, and the counter that
    // decides it is never rendered.
    let generation = 0;
    let running = true;

    function reset(): void {
        generation += 1;
        src.value = '';
        stage.value = 'idle';
        missing.value = false;
    }

    function giveUp(): void {
        src.value = '';
        stage.value = 'none';
        missing.value = true;
    }

    /** Step 2. Guarded by `generation` so a slow answer for the previous song is dropped. */
    async function tryBase64(): Promise<void> {
        const mine = generation;
        const id = toValue(playerId);
        if (id === '') {
            giveUp();
            return;
        }
        const dataUrl = await fetchCoverDataUrl(id, toValue(credentials), {
            width: options.width,
        });
        if (!running || mine !== generation) return;
        if (dataUrl === '') {
            giveUp();
            return;
        }
        src.value = dataUrl;
        stage.value = 'base64';
        missing.value = false;
    }

    /**
     * Start (or restart) the chain. An empty URL is not "wait": the server
     * answered and has no artwork URL, so the base64 path — which resolves
     * artwork differently server-side — is still worth one try. Only an
     * UNRESOLVED cover means wait, and that is what `resolved` distinguishes.
     */
    function start(): void {
        reset();
        const url = toValue(coverUrl);
        if (url !== '') {
            src.value = url;
            stage.value = 'url';
            return;
        }
        if (!toValue(resolved)) return;
        void tryBase64();
    }

    /** The `<img>` could not load `src`. Advance, never retry the same source. */
    function onError(): void {
        if (stage.value === 'url') {
            void tryBase64();
            return;
        }
        // A base64 payload that will not decode is not going to decode on a
        // second attempt either.
        giveUp();
    }

    watch(
        () => [toValue(playerId), toValue(coverUrl), toValue(resolved)] as const,
        () => start(),
        { immediate: true },
    );

    onScopeDispose(() => {
        running = false;
    });

    return {
        src: readonly(src),
        missing: readonly(missing),
        stage: readonly(stage),
        onError,
    };
}
