import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { useMediaQuery } from './useMediaQuery';

const original = window.matchMedia;

afterEach(() => {
    window.matchMedia = original;
});

function host(query: string) {
    let result!: ReturnType<typeof useMediaQuery>;
    const wrapper = mount(
        defineComponent({
            setup() {
                result = useMediaQuery(query);
                return () => h('div');
            },
        }),
    );
    return { wrapper, matches: result };
}

describe('useMediaQuery', () => {
    it('starts at the current answer and follows the browser', () => {
        let listener: (event: MediaQueryListEvent) => void = () => undefined;
        window.matchMedia = vi.fn(() => ({
            matches: true,
            addEventListener: (_: string, fn: typeof listener) => (listener = fn),
            removeEventListener: vi.fn(),
        })) as unknown as typeof window.matchMedia;

        const { matches } = host('(min-width: 64rem)');
        expect(matches.value).toBe(true);

        listener({ matches: false } as MediaQueryListEvent);
        expect(matches.value).toBe(false);
    });

    it('stops listening with its component', () => {
        const removeEventListener = vi.fn();
        window.matchMedia = vi.fn(() => ({
            matches: false,
            addEventListener: vi.fn(),
            removeEventListener,
        })) as unknown as typeof window.matchMedia;

        host('(min-width: 64rem)').wrapper.unmount();

        expect(removeEventListener).toHaveBeenCalledOnce();
    });

    it('is false where there is no matchMedia', () => {
        window.matchMedia = undefined as unknown as typeof window.matchMedia;

        expect(host('(min-width: 64rem)').matches.value).toBe(false);
    });
});
