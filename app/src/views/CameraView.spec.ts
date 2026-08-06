import { beforeEach, describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory } from 'vue-router';
import CameraView from './CameraView.vue';
import en from '../i18n/en.json';
import { createAppRouter } from '../router';
import { toHomeData } from '../protocol/guards';
import { cameraSnapshotUrl } from '../services/camera-url';
import { useAuthStore } from '../stores/auth';
import { useHomeStore } from '../stores/home';
import type { CameraItem } from '../protocol/types';
import type { Router } from 'vue-router';
import type { VueWrapper } from '@vue/test-utils';

const SESSION = { user: 'demo', pass: 'sécret' };

const CAMERAS: CameraItem[] = [
    { id: 'camera_1', name: 'Entrée' },
    { id: 'camera_2', name: 'Jardin' },
];

let router: Router;

function loadHouse(): void {
    useHomeStore().setHome(toHomeData({ home: [], cameras: CAMERAS, audio: [] }));
}

async function mountCamera(path = '/security/1'): Promise<VueWrapper> {
    await router.push(path);
    await router.isReady();

    return mount(CameraView, {
        global: {
            plugins: [router, createI18n({ legacy: false, locale: 'en', messages: { en } })],
        },
    });
}

beforeEach(() => {
    setActivePinia(createPinia());
    const auth = useAuthStore();
    auth.user = SESSION.user;
    auth.pass = SESSION.pass;
    auth.state = 'authed';
    router = createAppRouter(createMemoryHistory());
});

describe('CameraView', () => {
    it('introduces the camera the route asked for', async () => {
        loadHouse();

        const wrapper = await mountCamera('/security/1');

        expect(wrapper.get('.camera__name').text()).toBe('Jardin');
        // The room header's eyebrow, naming the glyph beside it.
        expect(wrapper.get('.camera__eyebrow').text()).toBe(en.camera.label);
        expect(wrapper.find('.camera__icon').exists()).toBe(true);
    });

    it('shows that camera’s picture, and only that one', async () => {
        loadHouse();

        const wrapper = await mountCamera('/security/1');

        const pictures = wrapper.findAll('.camera-frame__picture');
        expect(pictures).toHaveLength(1);
        expect(
            (pictures[0].attributes('src') ?? '').startsWith(
                `${cameraSnapshotUrl('camera_2', SESSION)}&t=`,
            ),
        ).toBe(true);
    });

    it('frames it as the single view: larger, uncropped, retryable', async () => {
        loadHouse();

        const wrapper = await mountCamera('/security/0');

        expect(wrapper.get('.camera-frame').classes()).toContain('camera-frame--single');
    });

    it('follows the route param to another camera without remounting', async () => {
        // /security/0 → /security/1 reuses this component, so only the poll's
        // URL changes (composables/useCameraPoll.ts restarts on it).
        loadHouse();
        const wrapper = await mountCamera('/security/0');
        expect(wrapper.get('.camera__name').text()).toBe('Entrée');

        await router.push('/security/1');
        await flushPromises();

        expect(wrapper.get('.camera__name').text()).toBe('Jardin');
        expect(
            (wrapper.get('.camera-frame__picture').attributes('src') ?? '').startsWith(
                `${cameraSnapshotUrl('camera_2', SESSION)}&t=`,
            ),
        ).toBe(true);
    });

    it('renders nothing at all while the store has no such camera', async () => {
        // Signing out empties the store before the navigation to /login
        // completes; the guard cannot help for that one frame.
        loadHouse();
        const wrapper = await mountCamera('/security/1');
        expect(wrapper.find('.camera__name').exists()).toBe(true);

        useHomeStore().clear();
        await flushPromises();

        expect(wrapper.find('.camera').exists()).toBe(false);
        expect(wrapper.find('.camera-frame__picture').exists()).toBe(false);
    });
});
