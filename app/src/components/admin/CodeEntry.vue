<script setup lang="ts">
// The code received on an approver phone: six cells over one real input
// (so paste, the keyboard's one-time-code suggestion and screen readers all
// see a single field), and under them the app's cyan filament, draining
// over the code's 60 s. The sixth digit submits.

import { computed, onMounted, onUnmounted, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { CODE_LENGTH, CODE_LIFETIME_S } from '../../protocol/admin';
import type { ApproverWork, Challenge } from '../../stores/approvers';
import { useAdminText } from '../../composables/useAdminText';
import AdminButton from './AdminButton.vue';
import DeviceName from './DeviceName.vue';

const props = withDefaults(
    defineProps<{
        challenge: Challenge;
        working: ApproverWork;
        /** The other enrolled phone, offered when this one is not at hand. */
        alternative?: string | null;
    }>(),
    { alternative: null },
);
const emit = defineEmits<{ submit: [code: string]; resend: []; other: []; cancel: [] }>();

const { t } = useI18n();
const { errorText } = useAdminText();
const inputId = useId();
const statusId = useId();

const code = ref('');
const input = ref<HTMLInputElement | null>(null);
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
    ticker = setInterval(() => {
        now.value = Date.now();
    }, 250);
    input.value?.focus();
});

onUnmounted(() => {
    if (ticker !== null) clearInterval(ticker);
});

const remaining = computed(() => Math.max(0, Math.ceil((props.challenge.expiresAt - now.value) / 1000)));
const expired = computed(() => remaining.value === 0 || props.challenge.error?.code === 'code_expired');
const fraction = computed(() => (expired.value ? 0 : Math.min(1, remaining.value / CODE_LIFETIME_S)));
const resendWait = computed(() => Math.max(0, Math.ceil((props.challenge.resendAt - now.value) / 1000)));
const busy = computed(() => props.working !== null);

const title = computed(() => t(`admin.code.${props.challenge.step}.title`));

const message = computed(() => {
    const error = props.challenge.error;
    if (error?.code === 'bad_code') {
        const left = error.attemptsLeft;
        return left === null ? errorText(error) : t('admin.code.wrong', { count: left }, left);
    }
    if (expired.value) return t('admin.code.expired');
    if (error !== null) return errorText(error);
    return '';
});

const cells = computed(() => Array.from({ length: CODE_LENGTH }, (_, i) => code.value[i] ?? ''));
const canSubmit = computed(() => code.value.length === CODE_LENGTH && !busy.value && !expired.value);

function onInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    code.value = target.value.replace(/\D/g, '').slice(0, CODE_LENGTH);
    target.value = code.value;
    if (canSubmit.value) submit();
}

function submit(): void {
    if (!canSubmit.value) return;
    emit('submit', code.value);
}

// A refused or replaced code is retyped from scratch.
function restart(): void {
    code.value = '';
    input.value?.focus();
}

// Post-flush: the input is disabled while the check runs, and a disabled
// input cannot take the focus back.
watch(() => props.challenge.codeId, restart, { flush: 'post' });
watch(
    () => props.challenge.error,
    (error) => {
        if (error?.code === 'bad_code' || error?.code === 'code_expired') restart();
    },
    { flush: 'post' },
);
</script>

<template>
    <form class="code-entry" @submit.prevent="submit">
        <h3 class="code-entry__title">{{ title }}</h3>
        <i18n-t :keypath="`admin.code.${challenge.step}.hint`" tag="p" class="code-entry__hint" scope="global">
            <template #phone>
                <DeviceName v-if="challenge.phone !== ''" :name="challenge.phone" />
                <template v-else>{{ t('admin.code.phoneUnknown') }}</template>
            </template>
        </i18n-t>
        <i18n-t
            v-if="challenge.restartPhone !== ''"
            keypath="admin.code.restartHint"
            tag="p"
            class="code-entry__hint"
            scope="global"
        >
            <template #phone><DeviceName :name="challenge.restartPhone" /></template>
        </i18n-t>

        <label class="code-entry__label" :for="inputId">{{ t('admin.code.label') }}</label>
        <div class="code-entry__field" :class="{ 'code-entry__field--expired': expired }">
            <input
                :id="inputId"
                ref="input"
                class="code-entry__input"
                :value="code"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                autocomplete="one-time-code"
                :maxlength="CODE_LENGTH"
                :disabled="busy"
                :aria-describedby="statusId"
                :aria-invalid="challenge.error?.code === 'bad_code' || undefined"
                data-autofocus
                @input="onInput"
            />
            <span class="code-entry__cells" aria-hidden="true">
                <span
                    v-for="(digit, index) in cells"
                    :key="index"
                    class="code-entry__cell"
                    :class="{ 'code-entry__cell--next': index === code.length && !busy }"
                    >{{ digit }}</span
                >
            </span>
            <span
                class="code-entry__clock"
                :class="{ 'code-entry__clock--low': remaining <= 10 }"
                :style="{ transform: `scaleX(${fraction})` }"
                aria-hidden="true"
            />
        </div>

        <div :id="statusId" class="code-entry__status">
            <p v-if="message !== ''" class="code-entry__error fade-in" role="alert">{{ message }}</p>
            <p v-else class="code-entry__time">
                <span>{{ t('admin.code.expiresIn', { seconds: remaining }) }}</span>
                <span v-if="challenge.attemptsLeft !== null">
                    {{ t('admin.code.attempts', { count: challenge.attemptsLeft }, challenge.attemptsLeft) }}
                </span>
            </p>
        </div>

        <div class="code-entry__actions">
            <AdminButton variant="quiet" :disabled="busy" @click="emit('cancel')">
                {{ t('dialog.cancel') }}
            </AdminButton>
            <AdminButton
                type="submit"
                class="code-entry__submit"
                :disabled="!canSubmit"
                :busy="working === 'checking'"
                :busy-label="t('admin.code.checking')"
            >
                {{ t('admin.code.submit') }}
            </AdminButton>
        </div>

        <p class="code-entry__resend">
            <button
                type="button"
                class="code-entry__resend-button"
                :disabled="busy || resendWait > 0"
                @click="emit('resend')"
            >
                <template v-if="working === 'sending'">{{ t('admin.code.sending') }}</template>
                <template v-else-if="resendWait > 0">{{ t('admin.code.resendIn', { seconds: resendWait }) }}</template>
                <template v-else>{{ t('admin.code.resend') }}</template>
            </button>
            <button
                v-if="alternative !== null"
                type="button"
                class="code-entry__resend-button"
                :disabled="busy || resendWait > 0"
                @click="emit('other')"
            >
                <i18n-t keypath="admin.code.sendToOther" scope="global">
                    <template #phone><DeviceName :name="alternative" /></template>
                </i18n-t>
            </button>
            <span class="code-entry__help">{{ t('admin.code.notReceived') }}</span>
        </p>
    </form>
</template>

<style scoped>
.code-entry__title {
    font-size: 1.125rem;
    font-weight: 400;
    letter-spacing: var(--tracking-tight);
}

.code-entry__hint {
    margin-block-start: var(--space-2);
    color: var(--c-text-muted);
    font-size: 0.9375rem;
    line-height: 1.45;
}

.code-entry__label {
    display: block;
    margin-block: var(--space-6) var(--space-2);
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-muted);
}

.code-entry__field {
    position: relative;
    padding-block-end: var(--space-3);
}

/* The real input covers the cells: taps, paste and the caret land on it. */
.code-entry__input {
    position: absolute;
    inset: 0;
    inline-size: 100%;
    block-size: 100%;
    opacity: 0;
    font-size: 16px;
    z-index: 1;
}

.code-entry__cells {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: var(--space-2);
}

.code-entry__cell {
    display: grid;
    place-items: center;
    block-size: 3.25rem;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: var(--radius-md);
    background-color: rgba(255, 255, 255, 0.06);
    font-size: 1.625rem;
    font-variant-numeric: tabular-nums;
    transition: border-color 200ms ease, background-color 200ms ease;
}

.code-entry__field:focus-within .code-entry__cell--next {
    border-color: rgba(56, 176, 211, 0.75);
    background-color: rgba(255, 255, 255, 0.1);
}

.code-entry__input[aria-invalid='true'] + .code-entry__cells .code-entry__cell {
    border-color: rgba(224, 86, 86, 0.6);
}

.code-entry__field--expired .code-entry__cell {
    opacity: 0.5;
}

/* The code's lifetime: the login screen's filament, burning down. */
.code-entry__clock {
    position: absolute;
    inset-block-end: 0;
    inset-inline: 0;
    block-size: 2px;
    border-radius: 1px;
    background-color: var(--c-accent);
    box-shadow: 0 0 12px var(--c-accent-glow);
    transform-origin: left center;
    transition: transform 250ms linear, background-color 400ms ease;
}

.code-entry__clock--low {
    background-color: var(--c-warn);
    box-shadow: 0 0 12px rgba(224, 163, 86, 0.45);
}

.code-entry__status {
    min-block-size: 2.75rem;
    padding-block-start: var(--space-2);
    font-size: 0.8125rem;
    line-height: 1.35;
}

.code-entry__time {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    color: var(--c-text-muted);
    font-variant-numeric: tabular-nums;
}

.code-entry__error {
    color: var(--c-danger-text);
}

.code-entry__actions {
    display: flex;
    gap: var(--space-3);
}

.code-entry__actions > * {
    flex: 1;
}

.code-entry__resend {
    display: grid;
    gap: var(--space-1);
    margin-block-start: var(--space-4);
    font-size: 0.8125rem;
    line-height: 1.4;
}

.code-entry__resend-button {
    justify-self: start;
    padding: var(--space-1) 0;
    border: none;
    background: none;
    color: var(--c-accent);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
}

.code-entry__resend-button:disabled {
    color: var(--c-text-muted);
    cursor: default;
}

.code-entry__resend-button:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
}

.code-entry__help {
    color: var(--c-text-muted);
}

@media (max-width: 479px) {
    .code-entry__resend-button {
        min-block-size: 44px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .code-entry__cell,
    .code-entry__clock {
        transition: none;
    }
}
</style>
