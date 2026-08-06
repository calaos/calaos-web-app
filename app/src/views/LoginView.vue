<script setup lang="ts">
// The login screen — the app's front door, and the one place the product has
// to introduce itself (the navbar is not mounted while unauthenticated).
//
// Identity kept from the old app (src/views/login.html): the word "Welcome",
// translucent fields floating on the backdrop, the shake on refusal, and the
// amber "No connection to Calaos" warning with its pulsing icon.
//
// Composition changed. The old screen was a centred stack of placeholder-only
// inputs; this one is left-aligned with real labels set in the same wide,
// uppercase micro-type as the footer tabs, so the form reads as an instrument
// panel rather than a web form. The signature is the FILAMENT: the focused
// field grows a 2 px band of cyan light along its bottom edge — the same
// device as the footer's travelling light and the same band that crosses the
// backdrop artwork, narrowed to one field at a time.
//
// Four old bugs are closed here, all of them about the form doing nothing
// visible:
//  1. Enter never submitted. The old markup had no submit handler at all —
//     `ng-click` on the button was the only path in. This is a real <form>
//     with a real type=submit button, so implicit submission works.
//  2. Submitting while disconnected was silently swallowed. The button is
//     disabled while the socket is not open, and the reason sits under it.
//  3. Submitting empty fields sent {cn_user:'',cn_pass:''} and got refused.
//     The button is disabled until both fields have content, so this app
//     never sends an empty login frame.
//  4. A refusal only shook the button — there was no message saying why.
//
// Navigation is NOT performed here. `auth.signIn()` raises the intent and the
// router's watcher (router/index.ts, startNavigationIntents) pushes /home once
// the house data lands. See docs/ARCHITECTURE.md "Service layer".

import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { onBeforeRouteLeave } from 'vue-router';
import IconAlert from '~icons/mdi/alert-outline';
import IconLoading from '~icons/mdi/loading';
import { useMinDuration } from '../composables/useMinDuration';
import { useAuthStore } from '../stores/auth';
import { useConnectionStore } from '../stores/connection';

const { t } = useI18n();
const auth = useAuthStore();
const connection = useConnectionStore();

// Seeded from the store, which matters in exactly one case: a re-login
// refused mid-session (see the watcher in router/index.ts) lands here with
// credentials still held, and retyping a username you already gave is busywork.
const username = ref(auth.user);
const password = ref('');

const usernameField = ref<HTMLInputElement | null>(null);
const passwordField = ref<HTMLInputElement | null>(null);

const isOffline = computed(() => !connection.isOpen);

// 'authed' still counts as busy: the login answer has landed but the house
// data has not, and the router only navigates on get_home. Without this the
// button would flick back to "Sign in" for the frames in between.
const isBusy = computed(() => auth.isPending || auth.isAuthed);

// A LAN calaos_server answers in single-digit milliseconds — measured against
// the mock through the dev proxy, login + get_home lands in 3 ms — so the raw
// pending flag would be on screen for less than one frame.
const progress = useMinDuration(isBusy);
const showSpinner = progress.active;

// The refusal waits for the progress beat to finish, so the interaction reads
// as press → working → refused instead of one ambiguous flicker.
const showError = computed(() => auth.hasFailed && !showSpinner.value);

const canSubmit = computed(
    () => !isOffline.value && !isBusy.value && username.value.trim() !== '' && password.value !== '',
);

/** Ties the button to whichever explanation is currently under it. */
const describedBy = computed(() => {
    const ids: string[] = [];
    if (isOffline.value) ids.push('login-offline');
    if (showError.value) ids.push('login-error');
    return ids.length > 0 ? ids.join(' ') : undefined;
});

function submit(): void {
    // The disabled button already blocks both the click and the implicit
    // Enter submission; this is the belt to that pair of braces, and it is
    // what a direct form.requestSubmit() would hit.
    if (!canSubmit.value) return;
    // Username trimmed, password never: a trailing space picked up from a
    // paste or an autofill is a silent rejection nobody can see.
    auth.signIn(username.value.trim(), password.value);
}

// Still not navigating: this is the view declining to be torn down mid-beat.
// The router raised the intent and the router performs the push (the whole
// point of startNavigationIntents); it just waits for the screen it is
// replacing to finish saying "signing in". Without it the sign-in reads as a
// teleport — 3 ms of spinner, then the house.
//
// The wait is only ever the unpaid remainder, so a slow server adds nothing.
// This is emphatically not the old app's flat 1.5 s $timeout on every login.
onBeforeRouteLeave(async () => {
    const owed = progress.remaining();
    if (owed <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, owed));
});

onMounted(() => {
    // A pre-filled username means the store still holds credentials the
    // server just refused, so the thing to fix is the password.
    const target = username.value === '' ? usernameField.value : passwordField.value;
    target?.focus();
});

watch(showError, async (visible) => {
    if (!visible) return;
    // Cleared rather than selected: on a wall-mounted tablet a pre-selected
    // field is one stray tap away from a partial edit, and the retry is
    // almost always a full retype anyway.
    password.value = '';
    await nextTick();
    passwordField.value?.focus();
});

watch(
    () => auth.state,
    (state) => {
        // 'idle' is only ever reached through signOut(). The view is normally
        // remounted by then, but clearing here makes "sign out empties the
        // form" true regardless of how the view got here.
        if (state !== 'idle') return;
        username.value = '';
        password.value = '';
    },
);
</script>

<template>
    <div class="login">
        <div class="login__panel">
            <header class="login__intro fade-in-down">
                <p class="login__eyebrow">{{ t('app.name') }}</p>
                <h1 class="login__welcome">{{ t('login.welcome') }}</h1>
            </header>

            <form class="login__form fade-in-up" @submit.prevent="submit">
                <div class="login__field">
                    <label class="login__label" for="login-username">
                        {{ t('login.username') }}
                    </label>
                    <div class="login__control">
                        <input
                            id="login-username"
                            ref="usernameField"
                            v-model="username"
                            class="login__input"
                            type="text"
                            name="username"
                            autocomplete="username"
                            autocapitalize="none"
                            autocorrect="off"
                            spellcheck="false"
                            required
                        />
                    </div>
                </div>

                <div class="login__field">
                    <label class="login__label" for="login-password">
                        {{ t('login.password') }}
                    </label>
                    <div class="login__control">
                        <input
                            id="login-password"
                            ref="passwordField"
                            v-model="password"
                            class="login__input"
                            type="password"
                            name="password"
                            autocomplete="current-password"
                            required
                        />
                    </div>
                </div>

                <button
                    type="submit"
                    class="login__submit pressable"
                    :class="{ shake: showError }"
                    :disabled="!canSubmit"
                    :aria-busy="showSpinner"
                    :aria-describedby="describedBy"
                >
                    <IconLoading v-if="showSpinner" class="login__spinner" aria-hidden="true" />
                    <span>{{ showSpinner ? t('login.submitting') : t('login.submit') }}</span>
                </button>

                <!-- Height is reserved: these two messages come and go, and a
                     button that jumps as you reach for it is its own bug. -->
                <div class="login__status" role="status" aria-live="polite">
                    <p v-if="isOffline" id="login-offline" class="login__offline fade-in">
                        <IconAlert class="login__offline-icon pulse-soft" aria-hidden="true" />
                        <span class="login__offline-title">{{ t('login.offline') }}</span>
                        <span class="login__offline-hint">{{ t('login.offlineHint') }}</span>
                    </p>

                    <p v-if="showError" id="login-error" class="login__error fade-in">
                        {{ t('login.error') }}
                    </p>
                </div>
            </form>
        </div>
    </div>
</template>

<style scoped>
.login {
    display: flex;
    /* The shell's content row is the only scroll container (App.vue); this
       fills it rather than declaring a viewport height of its own. */
    min-block-size: 100%;
    padding: var(--space-8) var(--space-4);
}

.login__panel {
    /* `margin: auto` inside a flex container, not `place-items: center`:
       centring that never makes the top of an overflowing panel unreachable
       on a short landscape phone. */
    margin: auto;
    inline-size: min(20rem, 100%);
    position: relative;
    /* Keeps the scrim's negative z-index inside this element instead of
       letting it fall behind the app background. */
    isolation: isolate;
}

/* The artwork's band of light crosses the viewport exactly where this panel
   sits. Rather than a card, a pool of darkness under the type — same idea as
   the backdrop, inverted. */
.login__panel::before {
    content: '';
    position: absolute;
    inset: -20% -25%;
    background-image: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.78), rgba(0, 0, 0, 0) 70%);
    z-index: -1;
    pointer-events: none;
}

.login__intro {
    margin-block-end: var(--space-8);
}

.login__eyebrow {
    /* Wide, uppercase, small — the footer tabs' type, reused: this is the app
       naming itself, not a heading. */
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-muted);
}

.login__welcome {
    margin-block-start: var(--space-2);
    /* The old screen's 40px display line, made fluid so it survives a 320px
       phone. Tight tracking against the eyebrow's wide tracking is the whole
       type treatment (see NavBar.vue). */
    font-size: clamp(1.75rem, 8vw, 2.375rem);
    font-weight: 400;
    letter-spacing: var(--tracking-tight);
    line-height: 1.1;
}

.login__field + .login__field {
    margin-block-start: var(--space-4);
}

.login__label {
    display: block;
    margin-block-end: var(--space-2);
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-muted);
}

.login__control {
    position: relative;
}

.login__input {
    display: block;
    inline-size: 100%;
    padding: var(--space-3) var(--space-4);
    appearance: none;
    background-color: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: var(--radius-md);
    color: var(--c-text);
    font-size: 1rem;
    transition:
        background-color 200ms ease,
        border-color 200ms ease;
}

/* The default focus ring is replaced, not removed: a focused field lifts its
   background, turns its border cyan AND grows the filament below. */
.login__input:focus,
.login__input:focus-visible {
    outline: none;
}

.login__control:focus-within .login__input {
    background-color: rgba(255, 255, 255, 0.1);
    border-color: rgba(56, 176, 211, 0.55);
}

/* ---- the filament: the footer's band of light, one field wide ---------- */

.login__control::after {
    content: '';
    position: absolute;
    inset-block-end: 0;
    inset-inline: 8%;
    block-size: 2px;
    background-image: linear-gradient(
        90deg,
        transparent,
        var(--c-accent) 30%,
        var(--c-accent) 70%,
        transparent
    );
    box-shadow: 0 0 12px var(--c-accent-glow);
    transform: scaleX(0);
    opacity: 0;
    transition:
        transform 260ms cubic-bezier(0.22, 0.61, 0.36, 1),
        opacity 200ms ease;
    pointer-events: none;
}

.login__control:focus-within::after {
    transform: scaleX(1);
    opacity: 1;
}

/* ---- submit ----------------------------------------------------------- */

.login__submit {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    inline-size: 100%;
    /* 44px: the smallest reliable tap target on a wall panel. */
    min-block-size: 2.75rem;
    margin-block-start: var(--space-6);
    padding: var(--space-3) var(--space-4);
    border: 0;
    border-radius: var(--radius-md);
    background-color: var(--c-accent);
    /* Near-black on cyan. The old button was the inverse (cyan on white),
       which is the only light-coloured slab in an otherwise black app. */
    color: #04222b;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    box-shadow: 0 0 18px var(--c-accent-glow);
    transition:
        background-color 200ms ease,
        box-shadow 200ms ease,
        transform var(--press-duration) ease;
}

.login__submit:hover:not(:disabled) {
    background-color: #4cc0e2;
}

.login__submit:disabled {
    background-color: rgba(255, 255, 255, 0.08);
    color: var(--c-text-muted);
    box-shadow: none;
    cursor: not-allowed;
}

.login__spinner {
    font-size: 1.125rem;
    animation: login-spin 900ms linear infinite;
}

@keyframes login-spin {
    to {
        transform: rotate(360deg);
    }
}

/* ---- status ----------------------------------------------------------- */

.login__status {
    /* Two lines of offline notice, held open so nothing below the button
       shifts when a message appears or clears. */
    min-block-size: 3.5rem;
    padding-block-start: var(--space-3);
    display: grid;
    gap: var(--space-2);
    align-content: start;
}

.login__offline {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 0 var(--space-2);
    font-size: 0.8125rem;
    line-height: 1.35;
}

.login__offline-icon {
    grid-row: span 2;
    font-size: 1.25rem;
    color: var(--c-warn);
}

.login__offline-title {
    /* Amber, like the connection banner: cyan means "working" everywhere else
       in this app, and this is the opposite of that. */
    color: var(--c-warn);
    font-weight: 500;
}

.login__offline-hint {
    color: var(--c-text-muted);
}

.login__error {
    color: var(--c-danger);
    font-size: 0.8125rem;
}

@media (prefers-reduced-motion: reduce) {
    .login__input,
    .login__submit {
        transition: none;
    }

    .login__control::after {
        transition: none;
    }

    .login__spinner {
        animation: none;
    }
}
</style>
