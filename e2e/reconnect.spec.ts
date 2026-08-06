// The reconnect, end to end: the mock kills the socket, the app banners,
// dials back, re-authenticates itself, and the user never leaves the room
// they were in.
//
// This is the spec for the single worst bug in the old app: `ws.onerror`
// called `signOut()` and `$state.go('login')`, so a lift ride, a Wi-Fi roam
// or a server restart threw the session away and dropped the user on the
// login form. Everything asserted below is the shape of NOT doing that.

import {
    CREDENTIALS,
    HOME_URL,
    appChrome,
    connectionBanner,
    expect,
    loginAs,
    loginForm,
    recordNavigation,
    test,
} from './fixtures';

test.beforeEach(async ({ mock }) => {
    await mock.reset();
});

test('a dropped socket banners, reconnects, re-logs in, and keeps the session', async ({
    page,
    context,
    mock,
}) => {
    // Installed before the first navigation so it sees every route the app
    // takes, not just the one it settles on.
    const navigationLog = await recordNavigation(page);

    await page.goto('/');
    await loginAs(page);

    const banner = connectionBanner(page);
    await expect(banner).toBeHidden();
    expect(await mock.frameKinds()).toEqual(['login', 'get_home']);

    // --- the outage ------------------------------------------------------
    //
    // `drop` terminates the socket server-side with no close frame, which is
    // what a server restart or a killed router looks like.
    expect(await mock.drop()).toBeGreaterThan(0);

    // The banner is debounced by 1000 ms (stores/connection.ts) and the
    // socket's first retry is also at 1000 ms (protocol/socket.ts) — that tie
    // is deliberate product behaviour (a blip that heals on the first retry
    // must never flash a banner), and it makes "the banner appears" a coin
    // toss unless the outage is held open. Offline emulation holds it: the
    // retries keep failing until it is lifted. The gap between the two calls
    // is a couple of local milliseconds against a 1000 ms retry, so the app
    // cannot sneak a reconnect in between.
    await context.setOffline(true);

    await expect(banner).toBeVisible({ timeout: 5_000 });

    // Mid-outage the session is untouched: still authed (the chrome is only
    // mounted while `auth.isAuthed`), still on the same route.
    await expect(page).toHaveURL(HOME_URL);
    await expect(appChrome(page).navBar).toBeVisible();
    await expect(loginForm(page).submit).toHaveCount(0);

    // --- the heal --------------------------------------------------------

    await context.setOffline(false);

    // Backoff is 1000 ms × 1.5 per failed attempt, so the next attempt after
    // a ~1.3 s outage is at most a couple of seconds out.
    await expect(banner).toBeHidden({ timeout: 15_000 });

    await expect(page).toHaveURL(HOME_URL);
    await expect(appChrome(page).navBar).toBeVisible();
    await expect(appChrome(page).footerNav).toBeVisible();

    // The app re-authenticated itself and re-fetched the house, with no help
    // from the user and no second form.
    expect(await mock.frameKinds()).toEqual(['login', 'get_home', 'login', 'get_home']);

    const logins = await mock.loginFrames();
    expect(logins).toHaveLength(2);
    expect(logins[1].frame?.data).toEqual({
        cn_user: CREDENTIALS.user,
        cn_pass: CREDENTIALS.pass,
    });
    // A genuinely new connection, not the old one still limping along: the
    // mock assigns clientIds per accepted socket.
    expect(logins[1].clientId).not.toBe(logins[0].clientId);

    // --- and never a bounce ----------------------------------------------
    //
    // The final URL alone cannot see a trip to /#/login and back, which is
    // exactly what the old app did.
    const hashes = await navigationLog();
    expect(hashes).toContain('#/home');
    expect(hashes.slice(hashes.indexOf('#/home'))).not.toContain('#/login');
    expect(hashes[hashes.length - 1]).toBe('#/home');
});
