import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { useIo } from './useIo';
import { useHomeStore } from '../stores/home';
import { toHomeData } from '../protocol/guards';

let sent: string[];

function seedHome(): ReturnType<typeof useHomeStore> {
    const home = useHomeStore();
    home.attachTransport((frame) => {
        sent.push(frame);
        return true;
    });
    home.setHome(
        toHomeData({
            home: [
                {
                    name: 'Salon',
                    type: 'lounge',
                    hits: '1',
                    items: [
                        {
                            id: 'light_1',
                            name: 'Plafonnier',
                            gui_type: 'light',
                            state: 'false',
                            visible: 'true',
                            rw: 'true',
                            unit: '',
                        },
                        {
                            id: 'dimmer_1',
                            name: 'Applique',
                            gui_type: 'light_dimmer',
                            state: 'set 50',
                            visible: 'true',
                            rw: 'true',
                            unit: '',
                        },
                    ],
                },
            ],
        }),
    );
    return home;
}

beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    sent = [];
    vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('useIo', () => {
    it('resolves the IO from the store', () => {
        const home = seedHome();
        const { io } = useIo('light_1');

        expect(io.value).toBe(home.getIo('light_1'));
        expect(io.value?.name).toBe('Plafonnier');
    });

    it('is undefined for an unknown id, and set() still does not throw', () => {
        seedHome();
        const { io, isPending, set } = useIo('ghost');

        expect(io.value).toBeUndefined();
        expect(isPending.value).toBe(false);
        expect(set('true')).toBe(true);
    });

    it('follows an io_changed patch without re-reading the store', () => {
        const home = seedHome();
        const { io } = useIo('light_1');
        expect(io.value?.state).toBe('false');

        home.handleEvent({ kind: 'io_changed', id: 'light_1', state: 'true', name: 'Lustre' });

        expect(io.value?.state).toBe('true');
        expect(io.value?.name).toBe('Lustre');
    });

    it('follows a reactive id', () => {
        seedHome();
        const id = ref('light_1');
        const { io } = useIo(id);
        expect(io.value?.id).toBe('light_1');

        id.value = 'dimmer_1';
        expect(io.value?.id).toBe('dimmer_1');
    });

    it('set() sends the frame through the store and raises isPending', () => {
        seedHome();
        const { isPending, set } = useIo('dimmer_1');

        expect(set('set 42')).toBe(true);

        expect(sent).toEqual(['{"msg":"set_state","data":{"id":"dimmer_1","value":"set 42"}}']);
        expect(isPending.value).toBe(true);
    });

    it('isPending drops on the matching io_changed', () => {
        const home = seedHome();
        const { isPending, set } = useIo('light_1');
        set('true');
        expect(isPending.value).toBe(true);

        // Another IO's event must not clear it.
        home.handleEvent({ kind: 'io_changed', id: 'dimmer_1', state: '42' });
        expect(isPending.value).toBe(true);

        home.handleEvent({ kind: 'io_changed', id: 'light_1', state: 'true' });
        expect(isPending.value).toBe(false);
    });

    it('isPending drops on the 5 s timeout', () => {
        seedHome();
        const { isPending, set } = useIo('light_1');
        set('true');

        vi.advanceTimersByTime(5000);

        expect(isPending.value).toBe(false);
    });

    it('reports failure when the socket refused the frame', () => {
        const home = seedHome();
        home.attachTransport(() => false);
        const { isPending, set } = useIo('light_1');

        expect(set('true')).toBe(false);
        expect(isPending.value).toBe(false);
    });
});
