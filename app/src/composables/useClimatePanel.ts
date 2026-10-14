// Which climate device has its settings open. Module-level on purpose: the
// panel is drawn by the row but the room view beside it has to make space, and
// there is only ever one open.

import { ref } from 'vue';

export const openClimateId = ref<string | null>(null);

export function openClimate(id: string): void {
    openClimateId.value = id;
}

export function closeClimate(id?: string): void {
    if (id === undefined || openClimateId.value === id) openClimateId.value = null;
}
