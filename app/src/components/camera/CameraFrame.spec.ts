import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import CameraFrame from './CameraFrame.vue';
import en from '../../i18n/en.json';
import { ERROR_LIMIT, FRAME_INTERVAL_MS } from '../../composables/useCameraPoll';
import { cameraSnapshotUrl } from '../../services/camera-url';
import { useAuthStore } from '../../stores/auth';
import { useCameraTokenStore } from '../../stores/cameraToken';
import { CAPTURE_TOKEN as TOKEN, grantCameraToken } from '../../stores/cameraTokenTestHarness';
import type { VueWrapper } from '@vue/test-utils';

const CAMERA = { id: 'camera_1', name: 'Entrée' };
const SESSION = { user: 'demo', pass: 'sécret' };

let wrapper: VueWrapper;
let mounted = false;

function mountFrame(variant?: 'tile' | 'single'): VueWrapper {
    wrapper = mount(CameraFrame, {
        props: variant === undefined ? { camera: CAMERA } : { camera: CAMERA, variant },
        global: {
            plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })],
        },
    });
    mounted = true;
    return wrapper;
}

function unmountFrame(): void {
    if (!mounted) return;
    wrapper.unmount();
    mounted = false;
}

/** The browser answering the pending request — or refusing to. */
async function frameArrives(): Promise<void> {
    await wrapper.get('.camera-frame__picture').trigger('load');
}

async function frameFails(times = 1): Promise<void> {
    for (let attempt = 0; attempt < times; attempt += 1) {
        await wrapper.get('.camera-frame__picture').trigger('error');
        // Let the backoff run out, as the browser would.
        vi.advanceTimersToNextTimer();
    }
}

beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    const auth = useAuthStore();
    auth.attachTransport(() => true);
    auth.user = SESSION.user;
    auth.pass = SESSION.pass;
    auth.state = 'authed';
    grantCameraToken();
});

afterEach(() => {
    unmountFrame();
    vi.useRealTimers();
});

describe('CameraFrame — the request', () => {
    it('asks for its own camera with the capture token, never the password', () => {
        const src = mountFrame().get('.camera-frame__picture').attributes('src') ?? '';

        // Built by the one module allowed to know how (services/camera-url.ts).
        expect(src.startsWith(`${cameraSnapshotUrl(CAMERA.id, TOKEN)}&t=`)).toBe(true);
        expect(src).not.toContain(encodeURIComponent(SESSION.pass));
        expect(src).not.toContain('cn_pass');
    });

    it('keeps the picture on screen across a token renewal', async () => {
        mountFrame();
        await frameArrives();
        const renewed = 'd'.repeat(64);
        const tokens = useCameraTokenStore();
        let msgId = '';
        tokens.attachTransport((frame) => {
            msgId = (JSON.parse(frame) as { msg_id: string }).msg_id;
            return true;
        });

        // The renewal is due before expiry, while a frame is on screen.
        vi.advanceTimersByTime(90_000);
        tokens.handleReply({ kind: 'camera_token', msgId, token: renewed, expiresIn: 120, error: '' });
        await wrapper.vm.$nextTick();

        expect(msgId).not.toBe('');
        expect(wrapper.get('.camera-frame__picture').classes()).not.toContain(
            'camera-frame__picture--blank',
        );
        await frameArrives();
        vi.advanceTimersByTime(FRAME_INTERVAL_MS);
        await wrapper.vm.$nextTick();
        expect(wrapper.get('.camera-frame__picture').attributes('src')).toContain(
            `camera_token=${renewed}&`,
        );
    });

    it('asks nothing more once a re-login is refused', async () => {
        mountFrame();
        await frameArrives();
        const auth = useAuthStore();

        // A credential rotation the server refuses: the state leaves 'authed'.
        auth.rotateCredentials(SESSION.user, 'wrong');
        auth.handleLoginResult(false);
        // The next frame was already scheduled by the load above.
        vi.advanceTimersByTime(60_000);
        await wrapper.vm.$nextTick();

        expect(wrapper.find('.camera-frame__picture').exists()).toBe(false);
    });

    it('carries a cache-buster, so every poll is a real request', async () => {
        const picture = mountFrame().get('.camera-frame__picture');
        const first = picture.attributes('src');

        await frameArrives();
        vi.advanceTimersByTime(FRAME_INTERVAL_MS);
        await wrapper.vm.$nextTick();

        expect(wrapper.get('.camera-frame__picture').attributes('src')).not.toBe(first);
    });

    it('names the picture for anyone who cannot see it', () => {
        expect(mountFrame().get('.camera-frame__picture').attributes('alt')).toBe(
            en.camera.snapshot.replace('{name}', CAMERA.name),
        );
    });
});

describe('CameraFrame — what it shows', () => {
    it('claims nothing until a frame has actually arrived', async () => {
        mountFrame();

        expect(wrapper.find('.camera-frame__live').exists()).toBe(false);
        // The picture is in the DOM (it is what fetches) but not yet shown.
        expect(wrapper.get('.camera-frame__picture').classes()).toContain(
            'camera-frame__picture--blank',
        );

        await frameArrives();

        expect(wrapper.get('.camera-frame__live').text()).toBe(en.camera.live);
        expect(wrapper.get('.camera-frame__picture').classes()).not.toContain(
            'camera-frame__picture--blank',
        );
    });

    it('holds the picture through a blink, and gives up after three failures', async () => {
        mountFrame();
        await frameArrives();

        await frameFails(ERROR_LIMIT - 1);
        expect(wrapper.find('.camera-frame__state--down').exists()).toBe(false);
        expect(wrapper.find('.camera-frame__live').exists()).toBe(true);

        await frameFails();

        const down = wrapper.get('.camera-frame__state--down');
        expect(down.text()).toContain(en.camera.unavailable);
        // A stale picture from a security camera is worse than none, and the
        // LIVE badge would be a lie.
        expect(wrapper.get('.camera-frame__picture').classes()).toContain(
            'camera-frame__picture--blank',
        );
        expect(wrapper.find('.camera-frame__live').exists()).toBe(false);
    });

    it('keeps polling behind the placeholder and recovers on its own', async () => {
        mountFrame();
        await frameFails(ERROR_LIMIT);
        expect(wrapper.find('.camera-frame__state--down').exists()).toBe(true);

        // The image element is still there, still asking — which is the whole
        // point of blanking it rather than unmounting it.
        await frameArrives();

        expect(wrapper.find('.camera-frame__state--down').exists()).toBe(false);
        expect(wrapper.find('.camera-frame__live').exists()).toBe(true);
    });
});

describe('CameraFrame — retry', () => {
    it('is offered on the single view', async () => {
        mountFrame('single');
        await frameFails(ERROR_LIMIT);

        expect(wrapper.get('.camera-frame__retry').text()).toBe(en.camera.retry);
    });

    it('is not offered on a tile, where the frame lives inside a link', async () => {
        mountFrame('tile');
        await frameFails(ERROR_LIMIT);

        // A <button> inside the <a> that opens the camera is invalid markup;
        // the tile recovers by itself instead.
        expect(wrapper.find('.camera-frame__retry').exists()).toBe(false);
        expect(wrapper.find('.camera-frame__state--down').exists()).toBe(true);
    });

    it('clears the placeholder and asks again immediately', async () => {
        mountFrame('single');
        await frameFails(ERROR_LIMIT);
        const stale = wrapper.get('.camera-frame__picture').attributes('src');
        // The seconds it takes to notice the placeholder and press the button.
        vi.advanceTimersByTime(500);

        await wrapper.get('.camera-frame__retry').trigger('click');

        expect(wrapper.find('.camera-frame__state--down').exists()).toBe(false);
        expect(wrapper.get('.camera-frame__picture').attributes('src')).not.toBe(stale);
    });
});

describe('CameraFrame — lifetime', () => {
    it('stops asking the moment it is unmounted', async () => {
        // The token's own expiry outlives the frame, by design.
        const before = vi.getTimerCount();
        mountFrame();
        await frameArrives();
        expect(vi.getTimerCount()).toBeGreaterThan(before);

        unmountFrame();

        expect(vi.getTimerCount()).toBe(before);
    });
});
