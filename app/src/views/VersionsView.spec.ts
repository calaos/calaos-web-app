import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import VersionsView from './VersionsView.vue';
import en from '../i18n/en.json';
import { useAdminStore } from '../stores/admin';
import type { Outcome } from '../stores/admin';

async function mountView(outcome: Outcome) {
    const admin = useAdminStore();
    vi.spyOn(admin, 'readVersions').mockResolvedValue(outcome);
    const wrapper = mount(VersionsView, {
        global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] },
    });
    await flushPromises();
    return wrapper;
}

const system = {
    calaos_os: '4.8.0',
    debian: '13.1',
    kernel: '6.12',
    container: '1.9.1',
    packages: [{ name: 'calaos-home', version: '4.5.0' }],
};

beforeEach(() => {
    setActivePinia(createPinia());
});

describe('VersionsView', () => {
    it('lists the client, server, container, OS and packages', async () => {
        const w = await mountView({ ok: true, data: { result: { server: '4.8.0', system } } });
        expect(w.find('[data-testid="versions-client-value"]').text()).toBe('test');
        expect(w.find('[data-testid="versions-server"]').text()).toBe('4.8.0');
        expect(w.find('[data-testid="versions-container"]').text()).toBe('1.9.1');
        expect(w.find('[data-testid="versions-kernel"]').text()).toBe('6.12');
        expect(w.findAll('[data-testid="versions-package"]')).toHaveLength(1);
        expect(w.find('[data-testid="versions-unreachable"]').exists()).toBe(false);
    });

    it('shows server and client, plus a message, when the container is unreachable', async () => {
        const w = await mountView({ ok: true, data: { result: { server: '4.8.0', system: null, error: 'no answer' } } });
        expect(w.find('[data-testid="versions-server"]').text()).toBe('4.8.0');
        expect(w.find('[data-testid="versions-unreachable"]').text()).toContain('no answer');
        expect(w.find('[data-testid="versions-packages"]').exists()).toBe(false);
    });

    it('shows an error state and no copy when the request fails', async () => {
        const w = await mountView({ ok: false, error: { code: 'timeout' } as never });
        expect(w.find('[data-testid="versions-failed"]').exists()).toBe(true);
        expect(w.find('[data-testid="versions-copy"]').attributes('disabled')).toBeDefined();
    });

    it('copies the contract text', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        const w = await mountView({ ok: true, data: { result: { server: '4.8.0', system } } });
        await w.find('[data-testid="versions-copy"]').trigger('click');
        await flushPromises();
        const text = writeText.mock.calls[0][0] as string;
        expect(text).toMatch(/^Calaos versions \(\d{4}-\d{2}-\d{2}\)\nclient: calaos-web-app test\ncalaos-server 4\.8\.0\n/);
        expect(text).toContain('calaos-home 4.5.0');
        expect(w.find('[data-testid="versions-copy-state"]').text()).toBe('Copied');
        vi.unstubAllGlobals();
    });
});
