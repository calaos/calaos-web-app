import { beforeEach, describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory } from 'vue-router';
import CameraListView from './CameraListView.vue';
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

/** Wire order is the order the list renders — cameras are never sorted. */
const CAMERAS: CameraItem[] = [
    { id: 'camera_1', name: 'Entrée' },
    { id: 'camera_2', name: 'Jardin' },
    { id: 'camera_3', name: 'Garage' },
];

let router: Router;

function loadHouse(cameras: CameraItem[] = CAMERAS): void {
    useHomeStore().setHome(toHomeData({ home: [], cameras, audio: [] }));
}

async function mountList(): Promise<VueWrapper> {
    await router.push('/security');
    await router.isReady();

    return mount(CameraListView, {
        global: {
            plugins: [router, createI18n({ legacy: false, locale: 'en', messages: { en } })],
        },
    });
}

const texts = (wrapper: VueWrapper, selector: string): string[] =>
    wrapper.findAll(selector).map((node) => node.text());

beforeEach(() => {
    setActivePinia(createPinia());
    const auth = useAuthStore();
    auth.user = SESSION.user;
    auth.pass = SESSION.pass;
    auth.state = 'authed';
    router = createAppRouter(createMemoryHistory());
});

describe('CameraListView — the grid', () => {
    it('renders one tile per camera, in the order the server sent them', async () => {
        loadHouse();

        const wrapper = await mountList();

        expect(texts(wrapper, '.camera-tile__name')).toEqual(['Entrée', 'Jardin', 'Garage']);
    });

    it('links every tile to its camera by index', async () => {
        loadHouse();

        const wrapper = await mountList();

        expect(wrapper.findAll('.camera-tile').map((tile) => tile.attributes('href'))).toEqual([
            '/security/0',
            '/security/1',
            '/security/2',
        ]);
    });

    it('gives every tile its own live frame, pointed at its own camera', async () => {
        loadHouse();

        const wrapper = await mountList();

        // Three independent polls — the reason the frame is a component at
        // all. Each asks for the camera of the tile it sits in.
        const sources = wrapper
            .findAll('.camera-frame__picture')
            .map((picture) => picture.attributes('src') ?? '');
        expect(sources).toHaveLength(CAMERAS.length);
        for (const [index, camera] of CAMERAS.entries()) {
            expect(sources[index].startsWith(`${cameraSnapshotUrl(camera.id, SESSION)}&t=`)).toBe(
                true,
            );
        }
    });

    it('offers no retry button inside the link that opens the camera', async () => {
        loadHouse();

        const wrapper = await mountList();

        // Interactive content nested in an anchor; the tile recovers on its
        // own instead (see components/camera/CameraFrame.vue).
        expect(wrapper.findAll('.camera-tile button')).toHaveLength(0);
    });

    it('gives every tile press feedback', async () => {
        loadHouse();

        const wrapper = await mountList();

        for (const tile of wrapper.findAll('.camera-tile')) {
            expect(tile.classes()).toContain('pressable');
        }
    });
});

describe('CameraListView — no cameras', () => {
    it('says so instead of rendering an empty page', async () => {
        // A house with no camera at all is the common case: the guard only
        // requires a session, and the Security tab is always in the footer.
        const wrapper = await mountList();

        expect(wrapper.find('.cameras__grid').exists()).toBe(false);
        expect(wrapper.get('.cameras__empty').text()).toContain(en.camera.empty);
        expect(wrapper.get('.cameras__empty').text()).toContain(en.camera.emptyHint);
    });

    it('drops the message as soon as a house lands', async () => {
        const wrapper = await mountList();

        loadHouse();
        await flushPromises();

        expect(wrapper.find('.cameras__empty').exists()).toBe(false);
        expect(wrapper.findAll('.camera-tile')).toHaveLength(CAMERAS.length);
    });
});
