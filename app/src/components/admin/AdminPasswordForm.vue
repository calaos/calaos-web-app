<script setup lang="ts">
// The admin password, typed once (unlock) or twice (choose / change). The
// length rule is checked here before the wire so the usual mistake gets its
// answer without a round trip; the daemon still has the last word.

import { computed, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ADMIN_PASSWORD_MIN_LENGTH } from '../../protocol/admin';
import AdminButton from './AdminButton.vue';
import AdminField from './AdminField.vue';

const props = withDefaults(
    defineProps<{
        mode: 'unlock' | 'bootstrap' | 'change';
        busy: boolean;
        /** The server's refusal, already translated; '' for none. */
        error?: string;
        /** Shakes the button and clears the field, like the login form. */
        refused?: boolean;
        minLength?: number;
    }>(),
    { error: '', refused: false, minLength: ADMIN_PASSWORD_MIN_LENGTH },
);

const emit = defineEmits<{ submit: [password: string] }>();

const { t } = useI18n();
const errorId = useId();

const password = ref('');
const confirm = ref('');
const needsConfirm = computed(() => props.mode !== 'unlock');

const localError = computed(() => {
    if (!needsConfirm.value) return '';
    if (password.value !== '' && password.value.length < props.minLength) {
        return t('admin.tooShort', { min: props.minLength });
    }
    if (confirm.value !== '' && confirm.value !== password.value) return t('admin.mismatch');
    return '';
});

const shownError = computed(() => localError.value || props.error);

const canSubmit = computed(() => {
    if (props.busy || password.value === '') return false;
    if (!needsConfirm.value) return true;
    return password.value.length >= props.minLength && confirm.value === password.value;
});

const labels = computed(() => ({
    field: t(`admin.${props.mode}.label`),
    submit: t(`admin.${props.mode}.submit`),
    submitting: props.mode === 'change' ? t('admin.bootstrap.submitting') : t(`admin.${props.mode}.submitting`),
}));

function submit(): void {
    if (!canSubmit.value) return;
    emit('submit', password.value);
}

// A refusal clears the field for the retype, as on the login screen.
watch(
    () => props.refused,
    (refused) => {
        if (refused) {
            password.value = '';
            confirm.value = '';
        }
    },
);
</script>

<template>
    <form class="admin-password" @submit.prevent="submit">
        <AdminField
            v-model="password"
            :label="labels.field"
            type="password"
            :autocomplete="mode === 'unlock' ? 'current-password' : 'new-password'"
            autofocus
            :disabled="busy"
            :described-by="shownError !== '' ? errorId : undefined"
            :invalid="shownError !== ''"
        />
        <AdminField
            v-if="needsConfirm"
            v-model="confirm"
            :label="t(`admin.${mode}.confirm`)"
            type="password"
            autocomplete="new-password"
            :disabled="busy"
        />

        <AdminButton
            type="submit"
            class="admin-password__submit"
            :class="{ shake: refused }"
            block
            :disabled="!canSubmit"
            :busy="busy"
            :busy-label="labels.submitting"
        >
            {{ labels.submit }}
        </AdminButton>

        <!-- Height reserved: a button that jumps as you reach for it is a bug. -->
        <p :id="errorId" class="admin-password__error" role="alert">
            <span v-if="shownError !== ''" class="fade-in">{{ shownError }}</span>
        </p>
    </form>
</template>

<style scoped>
.admin-password__submit {
    margin-block-start: var(--space-6);
}

.admin-password__error {
    min-block-size: 2.25rem;
    padding-block-start: var(--space-3);
    color: var(--c-danger);
    font-size: 0.8125rem;
    line-height: 1.35;
}
</style>
