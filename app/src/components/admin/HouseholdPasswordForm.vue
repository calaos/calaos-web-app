<script setup lang="ts">
// The sign-in (household) password, which the admin bootstrap refuses to
// run on top of the factory `user` / `pass`. Same shape as the admin form so
// the two screens read as one sequence.

import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import AdminButton from './AdminButton.vue';
import AdminField from './AdminField.vue';

const props = withDefaults(
    defineProps<{
        /** The current username, as a starting point. */
        user: string;
        busy: boolean;
        error?: string;
    }>(),
    { error: '' },
);

const emit = defineEmits<{ submit: [user: string, password: string] }>();

const { t } = useI18n();
const errorId = useId();

const username = ref(props.user);
const password = ref('');
const confirm = ref('');

const localError = computed(() =>
    confirm.value !== '' && confirm.value !== password.value ? t('admin.mismatch') : '',
);
const shownError = computed(() => localError.value || props.error);

const canSubmit = computed(
    () =>
        !props.busy &&
        username.value.trim() !== '' &&
        password.value !== '' &&
        confirm.value === password.value &&
        // The factory pair is exactly what this screen exists to replace.
        !(username.value.trim() === 'user' && password.value === 'pass'),
);

function submit(): void {
    if (!canSubmit.value) return;
    emit('submit', username.value.trim(), password.value);
}
</script>

<template>
    <form class="household-form" @submit.prevent="submit">
        <AdminField
            v-model="username"
            :label="t('admin.household.user')"
            autocomplete="username"
            autofocus
            :disabled="busy"
        />
        <AdminField
            v-model="password"
            :label="t('admin.household.password')"
            type="password"
            autocomplete="new-password"
            :disabled="busy"
            :described-by="shownError !== '' ? errorId : undefined"
            :invalid="shownError !== ''"
        />
        <AdminField
            v-model="confirm"
            :label="t('admin.household.confirm')"
            type="password"
            autocomplete="new-password"
            :disabled="busy"
        />

        <AdminButton
            type="submit"
            class="household-form__submit"
            block
            :disabled="!canSubmit"
            :busy="busy"
            :busy-label="t('admin.household.submitting')"
        >
            {{ t('admin.household.submit') }}
        </AdminButton>

        <p :id="errorId" class="household-form__error" role="alert">
            <span v-if="shownError !== ''" class="fade-in">{{ shownError }}</span>
        </p>
    </form>
</template>

<style scoped>
.household-form__submit {
    margin-block-start: var(--space-6);
}

.household-form__error {
    min-block-size: 2.25rem;
    padding-block-start: var(--space-3);
    color: var(--c-danger);
    font-size: 0.8125rem;
    line-height: 1.35;
}
</style>
