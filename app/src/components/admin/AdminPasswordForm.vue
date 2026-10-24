<script setup lang="ts">
// The admin password, typed once (unlock) or twice (choose / change). The
// length rule is checked on submit, before the wire; the daemon still has
// the last word. Lengths count code points, as the daemon does.

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
        /** Adds a quiet Cancel next to the submit (the change dialog). */
        cancelLabel?: string;
    }>(),
    { error: '', refused: false, minLength: ADMIN_PASSWORD_MIN_LENGTH, cancelLabel: undefined },
);

const emit = defineEmits<{ submit: [password: string]; cancel: [] }>();

const { t } = useI18n();
const errorId = useId();

const password = ref('');
const confirm = ref('');
/** Local rules are only reported once the user tried to submit. */
const attempted = ref(false);
const needsConfirm = computed(() => props.mode !== 'unlock');

const localError = computed(() => {
    if (!needsConfirm.value || !attempted.value) return '';
    if ([...password.value].length < props.minLength) return t('admin.tooShort', { min: props.minLength });
    if (confirm.value !== password.value) return t('admin.mismatch');
    return '';
});

const shownError = computed(() => localError.value || props.error);

const canSubmit = computed(
    () => !props.busy && password.value !== '' && (!needsConfirm.value || confirm.value !== ''),
);

const labels = computed(() => ({
    field: t(`admin.${props.mode}.label`),
    submit: t(`admin.${props.mode}.submit`),
    submitting: props.mode === 'change' ? t('admin.bootstrap.submitting') : t(`admin.${props.mode}.submitting`),
}));

function submit(): void {
    if (!canSubmit.value) return;
    attempted.value = true;
    if (localError.value !== '') return;
    emit('submit', password.value);
}

// A refusal clears the field for the retype, as on the login screen.
watch(
    () => props.refused,
    (refused) => {
        if (refused) {
            password.value = '';
            confirm.value = '';
            attempted.value = false;
        }
    },
);

watch([password, confirm], () => {
    attempted.value = false;
});
</script>

<template>
    <form class="admin-password" @submit.prevent="submit">
        <!-- A fixed username keeps password managers from offering the
             sign-in password here, and lets them store this one apart. -->
        <input class="admin-password__account" type="text" name="username" autocomplete="username" value="admin" readonly tabindex="-1" aria-hidden="true" />
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

        <div class="admin-password__actions">
            <AdminButton
                v-if="cancelLabel !== undefined"
                variant="quiet"
                class="admin-password__cancel"
                :disabled="busy"
                @click="emit('cancel')"
            >
                {{ cancelLabel }}
            </AdminButton>
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
        </div>

        <!-- Height reserved: a button that jumps as you reach for it is a bug. -->
        <p :id="errorId" class="admin-password__error" role="alert">
            <span v-if="shownError !== ''" class="fade-in">{{ shownError }}</span>
        </p>
    </form>
</template>

<style scoped>
.admin-password__account {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    opacity: 0;
    pointer-events: none;
}

.admin-password__actions {
    display: flex;
    gap: var(--space-3);
    margin-block-start: var(--space-6);
}

.admin-password__cancel {
    flex: 1;
}

.admin-password__submit {
    flex: 1;
}

.admin-password__error {
    min-block-size: 2.25rem;
    padding-block-start: var(--space-3);
    color: var(--c-danger-text);
    font-size: 0.8125rem;
    line-height: 1.35;
}
</style>
