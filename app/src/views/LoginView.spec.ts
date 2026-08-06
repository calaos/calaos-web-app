import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { RouterView, createMemoryHistory } from 'vue-router';
import LoginView from './LoginView.vue';
import en from '../i18n/en.json';
import { MIN_SPINNER_MS } from '../composables/useMinDuration';
import { createAppRouter } from '../router';
import { encodeLogin } from '../protocol/messages';
import { useAuthStore } from '../stores/auth';
import { useConnectionStore } from '../stores/connection';
import type { Router } from 'vue-router';
import type { VueWrapper } from '@vue/test-utils';

let router: Router;
let wrapper: VueWrapper | null = null;
/** Every frame the auth store handed to the (fake) socket. */
let sent: string[] = [];

function openSocket(): void {
    useConnectionStore().applyStatus({ status: 'open', attempt: 0, nextRetryMs: 0 });
}

function dropSocket(): void {
    useConnectionStore().applyStatus({ status: 'reconnecting', attempt: 1, nextRetryMs: 1000 });
}

/**
 * Rendered through a RouterView rather than mounted bare: LoginView registers
 * an `onBeforeRouteLeave` guard, and vue-router only attaches one to a
 * component that is a child of a router outlet.
 */
const Harness = defineComponent({
    name: 'LoginHarness',
    setup: () => () => h(RouterView),
});

async function mountLogin(): Promise<VueWrapper> {
    await router.push('/login');
    await router.isReady();
    // Proves the route is wired to the real view, not T06's placeholder.
    expect(router.currentRoute.value.matched[0]?.components?.default).toBe(LoginView);

    // attachTo: the view moves focus on mount and after a refusal, and an
    // element outside the document can never be the active one.
    wrapper = mount(Harness, {
        attachTo: document.body,
        global: {
            plugins: [router, createI18n({ legacy: false, locale: 'en', messages: { en } })],
        },
    });
    return wrapper;
}

function submitButton(view: VueWrapper): HTMLButtonElement {
    return view.get('.login__submit').element as HTMLButtonElement;
}

function usernameInput(view: VueWrapper): HTMLInputElement {
    return view.get('#login-username').element as HTMLInputElement;
}

function passwordInput(view: VueWrapper): HTMLInputElement {
    return view.get('#login-password').element as HTMLInputElement;
}

async function fill(view: VueWrapper, user: string, pass: string): Promise<void> {
    await view.get('#login-username').setValue(user);
    await view.get('#login-password').setValue(pass);
}

beforeEach(() => {
    setActivePinia(createPinia());
    sent = [];
    useAuthStore().attachTransport((frame) => {
        sent.push(frame);
        return true;
    });
    openSocket();
    router = createAppRouter(createMemoryHistory());
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
});

describe('LoginView — identity', () => {
    it('introduces the app and greets the user', async () => {
        const view = await mountLogin();

        expect(view.get('.login__eyebrow').text()).toBe(en.app.name);
        expect(view.get('.login__welcome').text()).toBe(en.login.welcome);
    });

    it('labels both fields for real, instead of leaning on placeholders', async () => {
        const view = await mountLogin();

        const labels = view.findAll('.login__label').map((label) => label.text());
        expect(labels).toEqual([en.login.username, en.login.password]);
        expect(view.find('label[for="login-username"]').exists()).toBe(true);
        expect(view.find('label[for="login-password"]').exists()).toBe(true);
        expect(usernameInput(view).getAttribute('autocomplete')).toBe('username');
        expect(passwordInput(view).getAttribute('autocomplete')).toBe('current-password');
    });

    it('focuses the username field on arrival', async () => {
        const view = await mountLogin();

        expect(document.activeElement).toBe(usernameInput(view));
    });
});

describe('LoginView — submitting', () => {
    it('sends nothing until the user submits', async () => {
        await mountLogin();

        // The old app's ws.onopen fired an empty login frame on every cold
        // load; this view must add no frames of its own on mount.
        expect(sent).toEqual([]);
    });

    it('submits on Enter, not only on a button click', async () => {
        const view = await mountLogin();
        await fill(view, 'demo', 'demo');

        // Implicit submission: pressing Enter in a text field fires the
        // form's submit event when the form has a non-disabled default
        // button. Both facts are asserted, and the event itself is the exact
        // one a browser dispatches. The old markup had neither — its only
        // entry point was ng-click on the button.
        expect(submitButton(view).type).toBe('submit');
        expect(submitButton(view).disabled).toBe(false);

        await view.get('form').trigger('submit');

        expect(sent).toEqual([encodeLogin('demo', 'demo')]);
    });

    it('submits on a button click too', async () => {
        const view = await mountLogin();
        await fill(view, 'demo', 'demo');

        await view.get('.login__submit').trigger('click');

        expect(sent).toEqual([encodeLogin('demo', 'demo')]);
    });

    it('trims the username but never the password', async () => {
        const view = await mountLogin();
        await fill(view, '  demo  ', ' demo ');

        await view.get('form').trigger('submit');

        expect(sent).toEqual([encodeLogin('demo', ' demo ')]);
    });

    it('refuses to send an empty login frame', async () => {
        const view = await mountLogin();

        expect(submitButton(view).disabled).toBe(true);

        await fill(view, 'demo', '');
        expect(submitButton(view).disabled).toBe(true);

        await fill(view, '   ', 'demo');
        expect(submitButton(view).disabled).toBe(true);

        // Even bypassing the button, the way a stray requestSubmit() would.
        await view.get('form').trigger('submit');
        expect(sent).toEqual([]);
    });

    it('never navigates by itself', async () => {
        const view = await mountLogin();
        const auth = useAuthStore();
        await fill(view, 'demo', 'demo');
        await view.get('form').trigger('submit');

        auth.handleLoginResult(true);
        auth.notifyHomeLoaded();
        await nextTick();

        // The intent is raised; performing it is the router's job
        // (startNavigationIntents), so the view stays put on its own.
        expect(auth.pendingNavigation).toBe('home');
        expect(router.currentRoute.value.path).toBe('/login');
    });
});

describe('LoginView — progress', () => {
    it('shows progress on the button while the sign-in is in flight', async () => {
        const view = await mountLogin();
        await fill(view, 'demo', 'demo');
        await view.get('form').trigger('submit');

        expect(submitButton(view).getAttribute('aria-busy')).toBe('true');
        expect(view.get('.login__submit').text()).toBe(en.login.submitting);
        expect(view.find('.login__spinner').exists()).toBe(true);
        // Disabled while busy: no double submit.
        expect(submitButton(view).disabled).toBe(true);
    });

    it('keeps showing progress after the login is accepted, until the house lands', async () => {
        const view = await mountLogin();
        await fill(view, 'demo', 'demo');
        await view.get('form').trigger('submit');

        useAuthStore().handleLoginResult(true);
        await nextTick();

        // 'authed' is not "done" from here: the router only navigates on
        // get_home, and the button must not flick back to "Sign in" in
        // between.
        expect(view.get('.login__submit').text()).toBe(en.login.submitting);
    });

    it(`stays on screen for ${MIN_SPINNER_MS} ms before the router may replace it`, async () => {
        vi.useFakeTimers();
        const view = await mountLogin();
        const auth = useAuthStore();
        await fill(view, 'demo', 'demo');
        await view.get('form').trigger('submit');

        // Measured through the dev proxy against the mock server: login +
        // get_home lands in 3 ms. Without the hold the sign-in is a teleport.
        vi.advanceTimersByTime(3);
        auth.handleLoginResult(true);
        await nextTick();

        // Exactly what startNavigationIntents does once the house has landed.
        const navigation = router.push('/home');
        await nextTick();
        expect(router.currentRoute.value.path).toBe('/login');

        vi.advanceTimersByTime(MIN_SPINNER_MS);
        await navigation;

        expect(router.currentRoute.value.path).toBe('/home');
    });

    it('adds no wait of its own once the beat has already played', async () => {
        vi.useFakeTimers();
        const view = await mountLogin();
        const auth = useAuthStore();
        await fill(view, 'demo', 'demo');
        await view.get('form').trigger('submit');

        // A server that took longer than the floor owes nothing: this
        // resolves without any timer being advanced, or the test times out.
        vi.advanceTimersByTime(MIN_SPINNER_MS + 200);
        auth.handleLoginResult(true);
        await nextTick();

        await router.push('/home');

        expect(router.currentRoute.value.path).toBe('/home');
    });

    it(`holds progress for ${MIN_SPINNER_MS} ms before revealing a refusal`, async () => {
        vi.useFakeTimers();
        const view = await mountLogin();
        await fill(view, 'demo', 'nope');
        await view.get('form').trigger('submit');

        // A LAN calaos_server refuses in single-digit milliseconds.
        vi.advanceTimersByTime(4);
        useAuthStore().handleLoginResult(false);
        await nextTick();

        expect(view.get('.login__submit').text()).toBe(en.login.submitting);
        expect(view.find('.login__error').exists()).toBe(false);
        expect(view.get('.login__submit').classes()).not.toContain('shake');

        vi.advanceTimersByTime(MIN_SPINNER_MS - 4 - 1);
        await nextTick();
        expect(view.find('.login__error').exists()).toBe(false);

        vi.advanceTimersByTime(1);
        await nextTick();
        expect(view.get('.login__submit').text()).toBe(en.login.submit);
        expect(view.find('.login__error').exists()).toBe(true);
    });
});

describe('LoginView — refused credentials', () => {
    /** Submits, lets the server refuse, and waits out the progress floor. */
    async function refuse(view: VueWrapper, user = 'demo', pass = 'nope'): Promise<void> {
        await fill(view, user, pass);
        await view.get('form').trigger('submit');
        useAuthStore().handleLoginResult(false);
        await vi.waitFor(() => expect(view.find('.login__error').exists()).toBe(true));
    }

    it('shakes the button and says what went wrong', async () => {
        const view = await mountLogin();

        await refuse(view);

        expect(view.get('.login__submit').classes()).toContain('shake');
        expect(view.get('.login__error').text()).toBe(en.login.error);
        // The error is tied to the control it explains.
        expect(submitButton(view).getAttribute('aria-describedby')).toBe('login-error');
    });

    it('stays on the login route', async () => {
        const view = await mountLogin();

        await refuse(view);

        expect(router.currentRoute.value.path).toBe('/login');
    });

    it('keeps the username, clears the password and puts the cursor in it', async () => {
        const view = await mountLogin();

        await refuse(view, 'demo', 'nope');

        expect(usernameInput(view).value).toBe('demo');
        expect(passwordInput(view).value).toBe('');
        expect(document.activeElement).toBe(passwordInput(view));
    });

    it('lets the user retry, and clears the error when they do', async () => {
        const view = await mountLogin();
        await refuse(view, 'demo', 'nope');

        await view.get('#login-password').setValue('demo');
        await view.get('form').trigger('submit');

        expect(sent).toEqual([encodeLogin('demo', 'nope'), encodeLogin('demo', 'demo')]);
        expect(view.find('.login__error').exists()).toBe(false);
        expect(view.get('.login__submit').classes()).not.toContain('shake');
    });

    it('arrives already showing the error after a refused re-login', async () => {
        // The mid-session case: the router pushes /login while the store is
        // still 'failed' (see router/index.ts), so the view mounts into it.
        const auth = useAuthStore();
        auth.signIn('demo', 'demo');
        auth.handleLoginResult(false);
        sent = [];

        const view = await mountLogin();
        await nextTick();

        expect(view.get('.login__error').text()).toBe(en.login.error);
        // The username the server refused is still there to correct.
        expect(usernameInput(view).value).toBe('demo');
        expect(document.activeElement).toBe(passwordInput(view));
        expect(sent).toEqual([]);
    });
});

describe('LoginView — no connection', () => {
    it('explains the outage instead of swallowing the submit', async () => {
        dropSocket();
        const view = await mountLogin();
        await fill(view, 'demo', 'demo');

        const offline = view.get('.login__offline');
        expect(offline.text()).toContain(en.login.offline);
        expect(offline.text()).toContain(en.login.offlineHint);
        expect(submitButton(view).disabled).toBe(true);
        expect(submitButton(view).getAttribute('aria-describedby')).toBe('login-offline');
    });

    it('sends nothing even if the form is submitted anyway', async () => {
        dropSocket();
        const view = await mountLogin();
        await fill(view, 'demo', 'demo');

        await view.get('form').trigger('submit');

        // The old app's sign_in() returned early with no feedback at all.
        expect(sent).toEqual([]);
    });

    it('hides the warning and arms the button once the socket is back', async () => {
        dropSocket();
        const view = await mountLogin();
        await fill(view, 'demo', 'demo');

        openSocket();
        await nextTick();

        expect(view.find('.login__offline').exists()).toBe(false);
        expect(submitButton(view).disabled).toBe(false);
        expect(submitButton(view).getAttribute('aria-describedby')).toBeNull();
    });
});

describe('LoginView — signing out', () => {
    it('comes back to an empty form', async () => {
        const view = await mountLogin();
        const auth = useAuthStore();
        await fill(view, 'demo', 'demo');
        await view.get('form').trigger('submit');
        auth.handleLoginResult(true);
        await nextTick();

        auth.signOut();
        await nextTick();

        expect(usernameInput(view).value).toBe('');
        expect(passwordInput(view).value).toBe('');
        expect(view.find('.login__error').exists()).toBe(false);
        // The progress floor outlives the sign-out here because the whole
        // test runs inside it; the button settles back once it expires.
        await vi.waitFor(() => expect(view.get('.login__submit').text()).toBe(en.login.submit));
        expect(submitButton(view).disabled).toBe(true);
    });
});
