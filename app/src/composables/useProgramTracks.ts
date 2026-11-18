// What the detail view draws of the program: the slots of each direction,
// read once when it opens and kept fresh by `timerange_changed`. The editor
// reads its own copy; this one is read-only and only ever feeds the strips.

import { computed, onScopeDispose, reactive, ref, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { toValue } from 'vue';
import type { MaybeRefOrGetter } from 'vue';
import { useScheduleStore } from '../stores/schedule';
import { levelIos, programFromWire } from '../protocol/schedule';
import type { Direction, DirectionProgram } from '../protocol/schedule';
import type { IoItem } from '../protocol/types';

export interface UseProgramTracks {
    programs: ComputedRef<Partial<Record<Direction, DirectionProgram>>>;
    /** Value of an IO the program publishes (default setpoint, off flag), when known. */
    defaultOf: (direction: Direction) => number | undefined;
    coolOff: ComputedRef<boolean>;
    loading: Ref<boolean>;
    failed: Ref<boolean>;
    reload: () => Promise<void>;
}

export function useProgramTracks(io: MaybeRefOrGetter<IoItem>, enabled: MaybeRefOrGetter<boolean> = true): UseProgramTracks {
    const store = useScheduleStore();
    const ios = computed(() => toValue(io).device?.ios ?? {});
    const levels = computed(() => ({ heat: levelIos(ios.value, 'heat'), cool: levelIos(ios.value, 'cool') }));
    const read = reactive<Partial<Record<Direction, DirectionProgram>>>({});
    const loading = ref(false);
    const failed = ref(false);
    let alive = true;
    onScopeDispose(() => (alive = false));

    function numberValue(id: string | undefined): number | undefined {
        const raw = id ? store.values.get(id) : undefined;
        const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
        return Number.isFinite(n) ? n : undefined;
    }

    const programs = computed(() => {
        const out: Partial<Record<Direction, DirectionProgram>> = {};
        for (const d of ['heat', 'cool'] as Direction[]) {
            const p = read[d];
            if (!p) continue;
            out[d] = {
                ...p,
                levels: p.levels.map((l) => {
                    const v = numberValue(levels.value[d].find((x) => x.n === l.n)?.setpointId);
                    return v === undefined ? l : { ...l, setpoint: v };
                }),
            };
        }
        return out;
    });

    async function loadDirection(d: Direction): Promise<boolean> {
        const list = levels.value[d];
        if (list.length === 0) return true;
        const results = await Promise.all(list.map((l) => store.readRanges(l.id)));
        const ok = results.every((r) => r.error === '');
        // A level that failed to read would look empty: keep what was drawn instead.
        if (ok || !read[d]) {
            read[d] = programFromWire(
                d,
                list.map((l, i) => ({ n: l.n, ranges: results[i].ranges, setpoint: undefined })),
            );
        }
        return ok;
    }

    async function reload(): Promise<void> {
        const v = ios.value;
        const ids = [...levels.value.heat, ...levels.value.cool].map((l) => l.setpointId);
        store.watchValues([...ids, v.heat_default ?? '', v.cool_default ?? '', v.cool_default_off ?? '']);
        loading.value = read.heat === undefined && read.cool === undefined;
        const results = await Promise.all((['heat', 'cool'] as Direction[]).map(loadDirection));
        if (!alive) return;
        loading.value = false;
        failed.value = results.some((ok) => !ok);
    }

    watch(() => toValue(enabled), (on) => on && void reload(), { immediate: true });
    watch(
        () => store.changes,
        () => {
            const id = store.changedId;
            if (toValue(enabled) && [...levels.value.heat, ...levels.value.cool].some((l) => l.id === id)) void reload();
        },
    );

    const defaultOf = (d: Direction) => numberValue(d === 'heat' ? ios.value.heat_default : ios.value.cool_default);
    const coolOff = computed(() => store.values.get(ios.value.cool_default_off ?? '') === 'true');

    return { programs, defaultOf, coolOff, loading, failed, reload };
}
