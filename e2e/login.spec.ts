// The front door, against the built bundle and the mock.
//
// The first spec here is the regression that motivated most of the auth
// store: the old app's `ws.onopen` unconditionally sent
// `{cn_user:'',cn_pass:''}`, the server refused it, and the login form shook
// at a user who had not typed anything yet. Unit tests cover the store's
// guard; only an E2E can show that nothing on the real wire sends that frame.

import {
    CREDENTIALS,
    HOME_URL,
    LOGIN_URL,
    MESSAGES,
    SIGN_IN_FRAMES,
    appChrome,
    expect,
    loginAs,
    loginForm,
    test,
} from './fixtures';

test.beforeEach(async ({ mock }) => {
    await mock.reset();
});

test('a cold load opens the socket and sends nothing down it', async ({ page, mock }) => {
    await page.goto('/');
    await expect(page).toHaveURL(LOGIN_URL);

    // Without this the assertion below would also pass for an app that never
    // dialled at all: zero frames is only interesting once there IS a socket.
    await expect
        .poll(async () => (await mock.status()).clients, {
            message: 'the app never opened a WebSocket to the mock',
        })
        .toBeGreaterThan(0);

    const form = loginForm(page);
    // `#login-offline` is rendered while the socket is not open; its absence
    // means the app has PROCESSED the open, so `resumeSession()` has already
    // had its chance to send a login frame.
    await expect(form.offline).toBeHidden();

    // Typing is not submitting: credentials sitting in the fields must not
    // reach the wire either.
    await form.username.fill(CREDENTIALS.user);
    await form.password.fill(CREDENTIALS.pass);
    await expect(form.submit).toBeEnabled();

    // A "nothing happened" assertion has no event to wait for, so it waits on
    // the clock. Everything above already proves the socket is up and the app
    // has reacted to it; this is slack for a slow machine.
    await page.waitForTimeout(500);

    expect(await mock.log()).toEqual([]);
    await expect(page).toHaveURL(LOGIN_URL);
});

test('a refused sign-in shakes, explains, and stays put', async ({ page, mock }) => {
    await page.goto('/');
    const form = loginForm(page);

    await form.username.fill(CREDENTIALS.user);
    await form.password.fill('wrong');
    await expect(form.submit).toBeEnabled();
    await form.submit.click();

    // The old app's only feedback was the shake. Both are asserted because
    // the message is the fix and the shake is the identity kept from it.
    await expect(form.submit).toHaveClass(/\bshake\b/);
    await expect(form.error).toBeVisible();
    await expect(form.error).toHaveText(MESSAGES.login.error);

    // No navigation, and no chrome: a refusal must not half-mount the app.
    await expect(page).toHaveURL(LOGIN_URL);
    await expect(appChrome(page).footerNav).toBeHidden();

    // Exactly one attempt, carrying exactly what was typed — no retry storm.
    const logins = await mock.loginFrames();
    expect(logins).toHaveLength(1);
    expect(logins[0].frame?.data).toEqual({ cn_user: CREDENTIALS.user, cn_pass: 'wrong' });

    // The password is cleared for the retype, the username is not.
    await expect(form.password).toHaveValue('');
    await expect(form.username).toHaveValue(CREDENTIALS.user);
});

test('a good sign-in lands on /#/home with the chrome mounted', async ({ page, mock }) => {
    await page.goto('/');

    const elapsedMs = await loginAs(page);

    await expect(page).toHaveURL(HOME_URL);
    await expect(appChrome(page).navBar).toBeVisible();
    await expect(appChrome(page).footerNav).toBeVisible();
    await expect(loginForm(page).submit).toHaveCount(0);

    // The mock answers in single-digit ms, so anything at all on screen is
    // LoginView's 400 ms progress floor (composables/useMinDuration.ts)
    // holding the beat. Measured from the click, so a real server that takes
    // longer only makes this pass more comfortably.
    expect(elapsedMs).toBeGreaterThanOrEqual(400);

    // The whole conversation, in order and with nothing else in it: see
    // SIGN_IN_FRAMES for what the audio follow-up is doing there.
    await expect.poll(async () => await mock.frameKinds()).toEqual(SIGN_IN_FRAMES);
});
