<script setup lang="ts">
// One setting: its key, the registry's description, and the editor its type
// calls for. Switches and lists save as they change; typed values save on
// demand. A secret only says whether one is stored.

import { computed, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ConfigOption } from '../../protocol/admin-config';
import { configEditor, isOn, selectChoices } from './configEditors';
import AdminButton from './AdminButton.vue';

const props = defineProps<{
    option: ConfigOption;
    /** Another admin request is running: nothing can be saved meanwhile. */
    disabled: boolean;
    saving: boolean;
    saved: boolean;
    error: string;
}>();

const emit = defineEmits<{ save: [value: string]; secret: [] }>();

const { t } = useI18n();
const nameId = useId();
const hintId = useId();
const errorId = useId();

const editor = computed(() => configEditor(props.option));
const draft = ref(props.option.value ?? '');
const dirty = computed(() => draft.value !== (props.option.value ?? ''));

// A saved value comes back from the server; a draft being typed is kept.
watch(
    () => props.option.value,
    (value, previous) => {
        if (draft.value === (previous ?? '')) draft.value = value ?? '';
    },
);

const inputMode = computed(() => {
    if (editor.value === 'integer') return 'numeric';
    if (editor.value === 'decimal') return 'decimal';
    if (editor.value === 'email') return 'email';
    return 'text';
});

const defaultLine = computed(() =>
    props.option.default === ''
        ? t('admin.config.defaultEmpty')
        : t('admin.config.defaultValue', { value: props.option.default }),
);

/** Back to the default: offered once a value of its own is stored. */
const canReset = computed(
    () =>
        !props.option.secret &&
        editor.value !== 'bool' &&
        props.option.set &&
        props.option.value !== props.option.default,
);

const describedBy = computed(() => (props.error !== '' ? `${hintId} ${errorId}` : hintId));

function submit(): void {
    if (dirty.value) emit('save', draft.value);
}

function choiceLabel(choice: string): string {
    return choice === '' ? t('admin.config.systemDefault') : choice;
}
</script>

<template>
    <li class="config-row" :class="{ 'config-row--stacked': editor !== 'bool' && editor !== 'select' && editor !== 'secret' }">
        <div class="config-row__text">
            <span :id="nameId" class="config-row__name">{{ option.key }}</span>
            <span :id="hintId" class="config-row__hint">
                <span v-if="option.description !== ''" class="config-row__description">{{ option.description }}</span>
                <span class="config-row__meta">
                    <span v-if="!option.secret">{{ defaultLine }}</span>
                    <span v-if="option.restart" class="config-row__restart">{{ t('admin.config.afterRestart') }}</span>
                </span>
            </span>
        </div>

        <div class="config-row__control">
            <button
                v-if="editor === 'bool'"
                type="button"
                role="switch"
                class="config-switch pressable"
                :aria-checked="isOn(option.value)"
                :aria-labelledby="nameId"
                :aria-describedby="describedBy"
                :aria-busy="saving || undefined"
                :disabled="disabled"
                @click="emit('save', isOn(option.value) ? 'false' : 'true')"
            >
                <span class="config-switch__track" aria-hidden="true"><span class="config-switch__thumb" /></span>
                <span class="config-switch__state">{{ isOn(option.value) ? t('admin.config.on') : t('admin.config.off') }}</span>
            </button>

            <div v-else-if="editor === 'select'" class="config-row__select">
                <select
                    class="config-row__field"
                    :value="option.value ?? ''"
                    :aria-labelledby="nameId"
                    :aria-describedby="describedBy"
                    :aria-busy="saving || undefined"
                    :disabled="disabled"
                    @change="emit('save', ($event.target as HTMLSelectElement).value)"
                >
                    <option v-for="choice in selectChoices(option)" :key="choice" :value="choice">
                        {{ choiceLabel(choice) }}
                    </option>
                </select>
            </div>

            <template v-else-if="editor === 'secret'">
                <span class="config-row__secret" :class="{ 'config-row__secret--set': option.set }">
                    {{ option.set ? t('admin.config.secretSet') : t('admin.config.secretUnset') }}
                </span>
                <AdminButton
                    variant="quiet"
                    :busy="saving"
                    :disabled="disabled"
                    :aria-describedby="describedBy"
                    @click="emit('secret')"
                >
                    {{ t('admin.config.secretChange') }}
                </AdminButton>
            </template>

            <form v-else class="config-row__form" @submit.prevent="submit">
                <div class="config-row__input">
                    <input
                        v-model="draft"
                        class="config-row__field"
                        type="text"
                        :inputmode="inputMode"
                        :aria-labelledby="nameId"
                        :aria-describedby="describedBy"
                        :aria-invalid="error !== '' || undefined"
                        :disabled="disabled"
                        :placeholder="option.default"
                        autocomplete="off"
                        autocapitalize="none"
                        autocorrect="off"
                        spellcheck="false"
                    />
                </div>
                <AdminButton
                    type="submit"
                    variant="quiet"
                    :busy="saving"
                    :busy-label="t('admin.config.saving')"
                    :disabled="disabled || !dirty"
                >
                    {{ t('admin.config.save') }}
                </AdminButton>
            </form>
        </div>

        <div v-if="canReset || saved || error !== ''" class="config-row__after">
            <p v-if="error !== ''" :id="errorId" class="config-row__error fade-in" role="alert">{{ error }}</p>
            <p v-else-if="saved" class="config-row__saved fade-in" role="status">{{ t('admin.config.saved') }}</p>
            <button
                v-if="canReset"
                type="button"
                class="config-row__reset"
                :disabled="disabled"
                @click="emit('save', '')"
            >
                {{ t('admin.config.reset') }}
            </button>
        </div>
    </li>
</template>

<style scoped>
.config-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    padding: var(--space-4) var(--space-2);
    border-block-end: 1px solid var(--c-border);
}

.config-row--stacked {
    grid-template-columns: minmax(0, 1fr);
}

.config-row__text {
    display: grid;
    gap: var(--space-1);
    min-inline-size: 0;
}

.config-row__name {
    font-size: 1rem;
    overflow-wrap: anywhere;
}

.config-row__hint {
    display: grid;
    gap: var(--space-1);
    color: var(--c-text-muted);
    font-size: 0.875rem;
    line-height: 1.4;
}

.config-row__description {
    max-inline-size: 60ch;
}

.config-row__meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    font-size: 0.8125rem;
    overflow-wrap: anywhere;
}

.config-row__restart {
    color: var(--c-warn);
}

.config-row__control {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-inline-size: 0;
}

.config-row__form {
    display: flex;
    flex: 1;
    align-items: stretch;
    gap: var(--space-3);
    min-inline-size: 0;
}

.config-row__input {
    position: relative;
    flex: 1;
    min-inline-size: 0;
}

.config-row__field {
    display: block;
    inline-size: 100%;
    min-block-size: 2.75rem;
    padding: var(--space-2) var(--space-4);
    appearance: none;
    background-color: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: var(--radius-md);
    color: var(--c-text);
    font: inherit;
    font-size: 1rem;
    transition:
        background-color 200ms ease,
        border-color 200ms ease;
}

.config-row__field:focus,
.config-row__field:focus-visible {
    outline: none;
    background-color: rgba(255, 255, 255, 0.1);
    border-color: rgba(56, 176, 211, 0.55);
}

.config-row__field:disabled {
    opacity: 0.6;
}

.config-row__field[aria-invalid='true'] {
    border-color: rgba(224, 86, 86, 0.6);
}

/* The filament under the focused field, as everywhere else in the app. */
.config-row__input::after {
    content: '';
    position: absolute;
    inset-block-end: 0;
    inset-inline: 8%;
    block-size: 2px;
    background-image: linear-gradient(90deg, transparent, var(--c-accent) 30%, var(--c-accent) 70%, transparent);
    box-shadow: 0 0 12px var(--c-accent-glow);
    transform: scaleX(0);
    opacity: 0;
    transition:
        transform 260ms cubic-bezier(0.22, 0.61, 0.36, 1),
        opacity 200ms ease;
    pointer-events: none;
}

.config-row__input:focus-within::after {
    transform: scaleX(1);
    opacity: 1;
}

.config-row__select {
    position: relative;
    min-inline-size: 8rem;
}

.config-row__select::after {
    content: '';
    position: absolute;
    inset-inline-end: var(--space-4);
    inset-block-start: 50%;
    inline-size: 0.5rem;
    block-size: 0.5rem;
    border-inline-end: 2px solid var(--c-text-muted);
    border-block-end: 2px solid var(--c-text-muted);
    transform: translateY(-70%) rotate(45deg);
    pointer-events: none;
}

.config-row__select .config-row__field {
    padding-inline-end: calc(var(--space-4) * 2 + 0.5rem);
    cursor: pointer;
}

.config-row__select option {
    background-color: var(--c-surface-raised);
}

.config-row__secret {
    color: var(--c-text-muted);
    font-size: 0.875rem;
    white-space: nowrap;
}

.config-row__secret--set {
    color: var(--c-success);
}

.config-row__after {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2) var(--space-4);
}

.config-row__error {
    color: var(--c-danger-text);
    font-size: 0.875rem;
    line-height: 1.4;
}

.config-row__saved {
    color: var(--c-success);
    font-size: 0.875rem;
}

.config-row__reset {
    margin-inline-start: auto;
    padding: var(--space-1) 0;
    border: 0;
    background: none;
    color: var(--c-accent);
    font: inherit;
    font-size: 0.875rem;
    cursor: pointer;
}

.config-row__reset:disabled {
    color: var(--c-text-muted);
    cursor: not-allowed;
}

/* ---- the switch ----------------------------------------------------- */

.config-switch {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    min-block-size: 2.75rem;
    padding: 0;
    border: 0;
    background: none;
    color: var(--c-text-muted);
    font: inherit;
    font-size: 0.875rem;
    cursor: pointer;
}

.config-switch__track {
    position: relative;
    inline-size: 2.75rem;
    block-size: 1.5rem;
    border-radius: 0.75rem;
    background-color: rgba(255, 255, 255, 0.1);
    border: 1px solid var(--c-border-strong);
    transition:
        background-color 200ms ease,
        border-color 200ms ease,
        box-shadow 200ms ease;
}

.config-switch__thumb {
    position: absolute;
    inset-block-start: 50%;
    inset-inline-start: 0.1875rem;
    inline-size: 1.0625rem;
    block-size: 1.0625rem;
    border-radius: 50%;
    background-color: var(--c-text-muted);
    transform: translateY(-50%);
    transition:
        transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1),
        background-color 200ms ease;
}

.config-switch[aria-checked='true'] {
    color: var(--c-text);
}

.config-switch[aria-checked='true'] .config-switch__track {
    background-color: rgba(56, 176, 211, 0.3);
    border-color: var(--c-accent);
    box-shadow: 0 0 12px var(--c-accent-glow);
}

.config-switch[aria-checked='true'] .config-switch__thumb {
    background-color: var(--c-accent);
    transform: translate(1.25rem, -50%);
}

.config-switch:disabled {
    cursor: not-allowed;
    opacity: 0.6;
}

.config-switch__state {
    min-inline-size: 5.5rem;
    text-align: start;
}

@media (max-width: 479px) {
    .config-row {
        grid-template-columns: minmax(0, 1fr);
    }

    .config-row__form {
        flex-direction: column;
    }
}

@media (prefers-reduced-motion: reduce) {
    .config-row__field,
    .config-row__input::after,
    .config-switch__track,
    .config-switch__thumb {
        transition: none;
    }
}
</style>
