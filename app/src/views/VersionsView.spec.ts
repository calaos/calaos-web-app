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
    it('lists only OS, Debian and kernel on top, and the components in the packages', async () => {
        const w = await mountView({ ok: true, data: { result: { server: '4.8.0', system } } });
        expect(w.find('[data-testid="versions-os"]').text()).toBe('4.8.0');
        expect(w.find('[data-testid="versions-debian"]').text()).toBe('13.1');
        expect(w.find('[data-testid="versions-client-value"]').exists()).toBe(false);
        expect(w.find('[data-testid="versions-server"]').exists()).toBe(false);
        expect(w.find('[data-testid="versions-container"]').exists()).toBe(false);
        expect(w.find('[data-testid="versions-kernel"]').text()).toBe('6.12');
        expect(w.findAll('[data-testid="versions-package"]')).toHaveLength(1);
        expect(w.find('[data-testid="versions-unreachable"]').exists()).toBe(false);
    });

    it('hides the Calaos OS row when it is empty, and the card when nothing is left', async () => {
        const w = await mountView({ ok: true, data: { result: { server: '4.8.0', system: { ...system, calaos_os: '' } } } });
        expect(w.find('[data-testid="versions-os"]').exists()).toBe(false);
        expect(w.find('[data-testid="versions-kernel"]').exists()).toBe(true);
        const bare = await mountView({
            ok: true,
            data: { result: { server: '4.8.0', system: { packages: [{ name: 'calaos-home', version: '4.5.0' }] } } },
        });
        expect(bare.find('[data-testid="versions-client"]').exists()).toBe(false);
    });

    it('falls back to the server and the client when the package list is empty', async () => {
        const w = await mountView({ ok: true, data: { result: { server: '4.8.0', system: { ...system, packages: [] } } } });
        expect(w.find('[data-testid="versions-server"]').text()).toBe('4.8.0');
        expect(w.find('[data-testid="versions-client-value"]').text()).toBe('test');
    });

    it('shows server and client, plus a message, when the container is unreachable', async () => {
        const w = await mountView({ ok: true, data: { result: { server: '4.8.0', system: null, error: 'daemon_unreachable' } } });
        expect(w.find('[data-testid="versions-server"]').text()).toBe('4.8.0');
        expect(w.find('[data-testid="versions-client-value"]').text()).toBe('test');
        expect(w.find('[data-testid="versions-unreachable"]').text()).toContain('daemon_unreachable');
        expect(w.find('[data-testid="versions-packages"]').exists()).toBe(false);
    });

    it('shows an error state and no copy when the request fails', async () => {
        const w = await mountView({ ok: false, error: { code: 'internal' } as never });
        expect(w.find('[data-testid="versions-failed"]').exists()).toBe(true);
        expect(w.find('[data-testid="versions-copy"]').attributes('disabled')).toBeDefined();
    });

    it.each(['invalid_request', 'not_allowed', 'old_server', 'timeout'])('says to update calaos-server on %s, and still copies', async (code) => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        const w = await mountView({ ok: false, error: { code } as never });
        expect(w.find('[data-testid="versions-old-server"]').text()).toContain('update calaos-server');
        expect(w.find('[data-testid="versions-failed"]').exists()).toBe(false);
        expect(w.find('[data-testid="versions-unreachable"]').exists()).toBe(false);
        expect(w.find('[data-testid="versions-copy"]').attributes('disabled')).toBeUndefined();
        await w.find('[data-testid="versions-copy"]').trigger('click');
        await flushPromises();
        const text = writeText.mock.calls[0][0] as string;
        expect(text).toMatch(/\ncalaos-server unavailable\ncalaos-container unreachable \(old_server\)$/);
        vi.unstubAllGlobals();
    });

    it('says to update calaos-container on daemon_too_old, and still copies', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        const w = await mountView({ ok: true, data: { result: { server: '4.8.0', system: null, error: 'daemon_too_old' } } });
        expect(w.find('[data-testid="versions-daemon-too-old"]').text()).toContain('update calaos-container');
        expect(w.find('[data-testid="versions-unreachable"]').exists()).toBe(false);
        expect(w.find('[data-testid="versions-server"]').text()).toBe('4.8.0');
        await w.find('[data-testid="versions-copy"]').trigger('click');
        await flushPromises();
        expect(writeText.mock.calls[0][0] as string).toMatch(/calaos-container unreachable \(daemon_too_old\)$/);
        vi.unstubAllGlobals();
    });

    it('shows the unreachable state without a reason when system is null and silent', async () => {
        const w = await mountView({ ok: true, data: { result: { server: '4.8.0', system: null } } });
        expect(w.find('[data-testid="versions-unreachable"]').exists()).toBe(true);
        expect(w.find('[data-testid="versions-unreachable"]').text()).not.toContain('Reason');
    });

    it('treats a result that is not an object as a generic failure', async () => {
        const w = await mountView({ ok: true, data: { result: 'nope' } });
        expect(w.find('[data-testid="versions-failed"]').exists()).toBe(true);
        expect(w.find('[data-testid="versions-unreachable"]').exists()).toBe(false);
    });

    it('resets the copy state when refreshed', async () => {
        vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
        const w = await mountView({ ok: true, data: { result: { server: '4.8.0', system } } });
        await w.find('[data-testid="versions-copy"]').trigger('click');
        await flushPromises();
        expect(w.find('[data-testid="versions-copy-state"]').exists()).toBe(true);
        await w.find('[data-testid="versions-refresh"]').trigger('click');
        await flushPromises();
        expect(w.find('[data-testid="versions-copy-state"]').exists()).toBe(false);
        vi.unstubAllGlobals();
    });

    it('falls back to a selection copy when navigator.clipboard is missing', async () => {
        vi.stubGlobal('navigator', {});
        const exec = vi.fn().mockReturnValue(true);
        Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
        const w = await mountView({ ok: true, data: { result: { server: '4.8.0', system } } });
        await w.find('[data-testid="versions-copy"]').trigger('click');
        await flushPromises();
        expect(exec).toHaveBeenCalledWith('copy');
        expect(w.find('[data-testid="versions-copy-state"]').text()).toBe('Copied');
        vi.unstubAllGlobals();
    });

    it('says the copy failed when both the clipboard and the fallback fail', async () => {
        vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
        Object.defineProperty(document, 'execCommand', { value: vi.fn().mockReturnValue(false), configurable: true });
        const w = await mountView({ ok: true, data: { result: { server: '4.8.0', system } } });
        await w.find('[data-testid="versions-copy"]').trigger('click');
        await flushPromises();
        expect(w.find('[data-testid="versions-copy-state"]').text()).toBe('Copy failed');
        vi.unstubAllGlobals();
    });

    it('copies the contract text', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        const w = await mountView({ ok: true, data: { result: { server: '4.8.0', system } } });
        await w.find('[data-testid="versions-copy"]').trigger('click');
        await flushPromises();
        const text = writeText.mock.calls[0][0] as string;
        expect(text).toMatch(/^Calaos versions \(\d{4}-\d{2}-\d{2}\)\ncalaos-os 4\.8\.0 · debian 13\.1 · kernel 6\.12\ncalaos-home 4\.5\.0$/);
        expect(w.find('[data-testid="versions-copy-state"]').text()).toBe('Copied');
        vi.unstubAllGlobals();
    });
});
