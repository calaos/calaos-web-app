// Every interactive IO type, from the tap to the wire and back again.
//
// Two claims per spec, and they are separate claims:
//
//   1. WHAT WENT OUT. The mock records every frame it receives, so the exact
//      `{msg:'set_state', data:{id, value}}` is asserted against the log
//      rather than against a spy on the store. These action strings are the
//      old AngularJS app's, transcribed verbatim (protocol/io-states.ts), and
//      a rename anywhere between the button and the socket breaks here.
//
//   2. WHEN THE ROW MOVED. Nothing in this app is optimistic
//      (docs/ARCHITECTURE.md): `sendSetState` records the IO as pending and
//      the state on screen keeps coming from the server. Proving that needs
//      the echo to be LATE, which is what `/control {op:'latency'}` is for —
//      without it the round trip through localhost is a few milliseconds and
//      an optimistic row would pass every assertion here.
//
// The mock's own transitions are the other half of the fixture (mock-server/
// state.mjs): `set N` answers `N`, `inc`/`dec` move a var_int by one, a
// shutter's `stop` freezes and a `scenario` answers with NOTHING at all. That
// last one is not a gap — it is how the pending indicator's other end (the
// 5 s timeout) is reachable at all.

import { MESSAGES, SIGN_IN_FRAMES, expect, loginAs, test } from './fixtures';
import type { LoggedFrame, MockControl } from './fixtures';
import type { Locator, Page } from '@playwright/test';

/**
 * Long enough that "the row has not moved yet" is a claim about the app and
 * not about how fast this machine is, short enough to stay well inside the
 * store's 5 s pending timeout (PENDING_TIMEOUT_MS) — otherwise the dot would
 * clear on the timer rather than on the echo and the specs would be measuring
 * the wrong thing.
 */
const SLOW_ECHO_MS = 1500;

/** Room ids are indices into the hits-desc room list (see home-rooms.spec). */
const ROOM = { cuisine: 0, outside: 1, lounge: 2, bedroom: 3 } as const;

/** The fixture IOs these specs drive (mock-server/fixtures/home.json). */
const IO = {
    /** `light`, starts on. */
    light: { id: 'output_1', name: 'Plafonnier', room: ROOM.lounge },
    /** `light_dimmer`, starts at `'set 50'`. */
    dimmer: { id: 'output_2', name: 'Applique', room: ROOM.lounge },
    /** `scenario` — the mock never answers this one. */
    scenario: { id: 'output_5', name: 'Ambiance cinéma', room: ROOM.lounge },
    /** `light_rgb`, starts at `'0'` — off, and black in the picker. */
    rgb: { id: 'output_15', name: 'Éclairage terrasse', room: ROOM.outside },
    /** `var_int`, starts at 7, carries a unit. */
    varInt: { id: 'output_8', name: 'Nombre de cafés', room: ROOM.cuisine },
    /** `shutter`, starts open. */
    shutter: { id: 'output_10', name: 'Volet cuisine', room: ROOM.cuisine },
    /** The one `rw:"false"` IO in the fixture. */
    readOnly: { id: 'output_7', name: 'Spots plan de travail', room: ROOM.cuisine },
    /** The one `visible:"false"` IO in the fixture. */
    invisible: { id: 'output_14', name: 'LED de debug', room: ROOM.bedroom },
} as const;

// ---------------------------------------------------------------- locators ---

/** One row, by the name the server gave the IO. */
function ioRow(page: Page, name: string): Locator {
    return page.locator('.io-row').filter({ has: page.locator('.io-row__name', { hasText: name }) });
}

/**
 * An action button inside a row.
 *
 * `template` is the raw i18n string ("Turn off {name}") rather than the
 * finished label, so the specs assert against the app's own catalogue and a
 * reworded button is a one-file change (fixtures.ts re-exports en.json).
 */
function action(row: Locator, template: string, name: string): Locator {
    return row.getByRole('button', { name: template.replace('{name}', name), exact: true });
}

/** The crossfading glyph. Its `aria-label` IS the state the row is showing. */
function stateIcon(row: Locator): Locator {
    return row.locator('.state-icon');
}

// ------------------------------------------------------------------ actions ---

/** Signs in and opens one room, the way a user reaches it. */
async function openRoom(page: Page, roomId: number): Promise<void> {
    await page.goto('/');
    await loginAs(page);
    await page.locator('.room-tile').nth(roomId).click();
    await expect(page).toHaveURL(new RegExp(`#/home/${roomId}$`));
}

async function boxOf(locator: Locator): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
}> {
    const box = await locator.boundingBox();
    if (box === null) throw new Error('expected the element to have a bounding box');
    return box;
}

// ------------------------------------------------------------------- frames ---

/** The frame the app is expected to have put on the wire. */
function setStateFrame(id: string, value: string): { msg: string; data: Record<string, string> } {
    return { msg: 'set_state', data: { id, value } };
}

/** Every logged frame that is a set_state for one IO, in arrival order. */
async function setStateLog(mock: MockControl, id: string): Promise<LoggedFrame[]> {
    const entries = await mock.log();
    return entries.filter(
        (entry) => entry.frame?.msg === 'set_state' && entry.frame.data?.id === id,
    );
}

async function setStateFrames(mock: MockControl, id: string): Promise<LoggedFrame['frame'][]> {
    return (await setStateLog(mock, id)).map((entry) => entry.frame);
}

/** The raw JSON strings, for the one spec that asserts the bytes. */
async function setStateRaws(mock: MockControl, id: string): Promise<string[]> {
    return (await setStateLog(mock, id)).map((entry) => entry.raw);
}

/** `#rrggbb` as the browser reports it back from `getComputedStyle`. */
function cssColor(hex: string): string {
    const n = Number.parseInt(hex.slice(1), 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

// --------------------------------------------------------------------- specs ---

test.beforeEach(async ({ mock }) => {
    await mock.reset();
});

test('a light sends true/false and its bulb waits for the echo', async ({ page, mock }) => {
    await openRoom(page, IO.light.room);
    const row = ioRow(page, IO.light.name);
    await expect(stateIcon(row)).toHaveAttribute('aria-label', MESSAGES.io.on);

    // Hold the answer back so the two assertions below are about ordering
    // rather than about winning a race with localhost.
    await mock.latency(SLOW_ECHO_MS);
    await action(row, MESSAGES.io.turnOff, IO.light.name).click();

    // What went out, byte for byte — encodeSetState preserves key order
    // precisely so a spec may assert the string and not just the shape.
    await expect
        .poll(() => setStateRaws(mock, IO.light.id))
        .toEqual([`{"msg":"set_state","data":{"id":"${IO.light.id}","value":"false"}}`]);

    // The frame is on the wire and the answer is not: the bulb is still lit,
    // and the row says it is waiting. An optimistic row fails right here.
    await expect(stateIcon(row)).toHaveAttribute('aria-label', MESSAGES.io.on);
    await expect(row).toHaveAttribute('aria-busy', 'true');

    // Only io_changed moves it.
    await expect(stateIcon(row)).toHaveAttribute('aria-label', MESSAGES.io.off);
    await expect(row).not.toHaveAttribute('aria-busy', 'true');

    await mock.latency(0);
    await action(row, MESSAGES.io.turnOn, IO.light.name).click();
    await expect(stateIcon(row)).toHaveAttribute('aria-label', MESSAGES.io.on);

    await expect
        .poll(() => setStateFrames(mock, IO.light.id))
        .toEqual([setStateFrame(IO.light.id, 'false'), setStateFrame(IO.light.id, 'true')]);
});

test('a dimmer commits once per gesture, by key and by drag', async ({ page, mock }) => {
    await openRoom(page, IO.dimmer.room);
    const row = ioRow(page, IO.dimmer.name);
    const slider = row.locator('input[type="range"]');
    const reading = row.locator('.light-dimmer-io__reading');

    // The fixture state is `'set 50'` — an echo shape, not a number, which is
    // exactly what parseLightDimmer's second branch exists for.
    await expect(reading).toHaveText('50%');
    await expect(slider).toHaveValue('50');

    // --- the keyboard path ------------------------------------------------
    //
    // An arrow key produces `input` then the browser's own `change`, with no
    // pointer session at all. One nudge, one frame, at a value we can name.
    await slider.press('ArrowRight');
    await expect
        .poll(() => setStateFrames(mock, IO.dimmer.id))
        .toEqual([setStateFrame(IO.dimmer.id, 'set 51')]);
    // And the reading is the SERVER's answer: the mock turns `set 51` into
    // the bare `51` a real calaos_server reports.
    await expect(reading).toHaveText('51%');

    // --- the pointer path -------------------------------------------------
    //
    // A real press-drag-release. The old template bound `ng-mouseup` straight
    // to the input, which sent nothing at all from a touchscreen; BaseSlider
    // listens on pointer events instead and this is the gesture that proves
    // it — dragging must move the thumb and send NOTHING until the release.
    const box = await boxOf(slider);
    const midY = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.25, midY);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, midY, { steps: 5 });
    await page.mouse.move(box.x + box.width * 0.75, midY, { steps: 5 });
    await page.mouse.up();

    // The thumb's own value is what the release committed.
    const dragged = Number(await slider.inputValue());
    expect(dragged).toBeGreaterThan(51);
    expect(dragged).toBeLessThanOrEqual(100);

    // EXACTLY one more frame. A per-`input` sender would have opened with the
    // value under the pointer at mousedown (~28%), so this list can never be
    // transiently right on the way to being long.
    await expect
        .poll(() => setStateFrames(mock, IO.dimmer.id))
        .toEqual([
            setStateFrame(IO.dimmer.id, 'set 51'),
            setStateFrame(IO.dimmer.id, `set ${dragged}`),
        ]);
    await expect(reading).toHaveText(`${dragged}%`);
});

test('the colour picker sends set #rrggbb and the lamp lights on the echo', async ({
    page,
    mock,
}) => {
    await openRoom(page, IO.rgb.room);
    const row = ioRow(page, IO.rgb.name);
    // Fixture state '0' — the old app's spelling of "off" for an RGB lamp.
    await expect(stateIcon(row)).toHaveAttribute('aria-label', MESSAGES.io.off);

    await action(row, MESSAGES.io.setColor, IO.rgb.name).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Aim high and bright in the saturation field: a black lamp opens the
    // picker at #000000, and a click near the bottom would confirm it again.
    const field = dialog.locator('.vc-saturation');
    const box = await boxOf(field);
    await field.click({ position: { x: box.width * 0.8, y: box.height * 0.2 } });

    // The readout is the contract: the dialog states what confirm will send,
    // so the spec can assert the wire against the UI rather than against a
    // colour it hardcoded (the widget works in HSV; hex is a lossy trip).
    const hex = ((await dialog.locator('.color-dialog__hex').textContent()) ?? '').trim();
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(hex).not.toBe('#000000');

    await dialog.getByRole('button', { name: MESSAGES.dialog.color.confirm, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await expect
        .poll(() => setStateFrames(mock, IO.rgb.id))
        .toEqual([setStateFrame(IO.rgb.id, `set ${hex}`)]);

    // The lamp was off and is now alight — a state change the row could only
    // have learned from io_changed, since 'set #hex' answers with the bare
    // colour (state.mjs) and nothing in the row invents that.
    await expect(stateIcon(row)).toHaveAttribute('aria-label', MESSAGES.io.on);
    await expect(row.locator('.light-rgb-io__swatch')).toHaveCSS('background-color', cssColor(hex));
});

test('var_int nudges send inc and dec, and the reading follows the server', async ({
    page,
    mock,
}) => {
    await openRoom(page, IO.varInt.room);
    const row = ioRow(page, IO.varInt.name);
    const reading = row.locator('.var-int-io__reading');
    await expect(reading).toHaveText('7 tasses');

    await action(row, MESSAGES.io.increase, IO.varInt.name).click();
    // The mock moves a var_int by one; the row shows what came back, unit and
    // all, never the arithmetic it could have done itself.
    await expect(reading).toHaveText('8 tasses');

    await action(row, MESSAGES.io.decrease, IO.varInt.name).click();
    await expect(reading).toHaveText('7 tasses');

    await expect
        .poll(() => setStateFrames(mock, IO.varInt.id))
        .toEqual([setStateFrame(IO.varInt.id, 'inc'), setStateFrame(IO.varInt.id, 'dec')]);
});

test('a scenario plays with one true frame and keeps waiting for an answer', async ({
    page,
    mock,
}) => {
    await openRoom(page, IO.scenario.room);
    const row = ioRow(page, IO.scenario.name);
    await expect(row).not.toHaveAttribute('aria-busy', 'true');

    await action(row, MESSAGES.io.run, IO.scenario.name).click();

    await expect
        .poll(() => setStateFrames(mock, IO.scenario.id))
        .toEqual([setStateFrame(IO.scenario.id, 'true')]);

    // A scenario is fire-and-forget: it changes OTHER rows, so the server
    // sends no io_changed for it (state.mjs) and the dot is the only feedback
    // there is — it stays up until the store's own 5 s timeout retires it.
    await expect(row).toHaveAttribute('aria-busy', 'true');
    await expect(row.locator('.io-row__pending')).toBeVisible();
});

test('a shutter sends up, stop and down verbatim', async ({ page, mock }) => {
    await openRoom(page, IO.shutter.room);
    const row = ioRow(page, IO.shutter.name);
    await expect(stateIcon(row)).toHaveAttribute('aria-label', MESSAGES.io.open);

    await action(row, MESSAGES.io.raise, IO.shutter.name).click();
    await expect
        .poll(() => setStateFrames(mock, IO.shutter.id))
        .toEqual([setStateFrame(IO.shutter.id, 'up')]);

    await action(row, MESSAGES.io.stop, IO.shutter.name).click();
    await expect
        .poll(() => setStateFrames(mock, IO.shutter.id))
        .toEqual([setStateFrame(IO.shutter.id, 'up'), setStateFrame(IO.shutter.id, 'stop')]);

    await action(row, MESSAGES.io.lower, IO.shutter.name).click();
    await expect
        .poll(() => setStateFrames(mock, IO.shutter.id))
        .toEqual([
            setStateFrame(IO.shutter.id, 'up'),
            setStateFrame(IO.shutter.id, 'stop'),
            setStateFrame(IO.shutter.id, 'down'),
        ]);

    // Three presses, one visible change: the shutter was already open, `stop`
    // freezes a cover with no reported position, and only `down` is a state
    // the server can report back.
    await expect(stateIcon(row)).toHaveAttribute('aria-label', MESSAGES.io.closed);
});

test('the pending dot covers the wait and clears on the echo', async ({ page, mock }) => {
    await openRoom(page, IO.light.room);
    const row = ioRow(page, IO.light.name);
    const dot = row.locator('.io-row__pending');

    // A resting row is not busy and carries no dot — `aria-busy` is absent
    // rather than "false", so there is nothing for AT to read at rest.
    await expect(row).not.toHaveAttribute('aria-busy', 'true');
    await expect(dot).toHaveCount(0);

    await mock.latency(SLOW_ECHO_MS);
    await action(row, MESSAGES.io.turnOff, IO.light.name).click();

    // Both halves of the indicator: the dot for eyes, aria-busy for AT.
    await expect(row).toHaveAttribute('aria-busy', 'true');
    await expect(dot).toBeVisible();

    // And both of them go away on the answer, not on a timer of their own.
    await expect(stateIcon(row)).toHaveAttribute('aria-label', MESSAGES.io.off);
    await expect(row).not.toHaveAttribute('aria-busy', 'true');
    await expect(dot).toHaveCount(0);

    await mock.latency(0);
});

test('a push from the server repaints the room with nobody touching it', async ({ page, mock }) => {
    await openRoom(page, IO.light.room);
    const light = ioRow(page, IO.light.name);
    const dimmer = ioRow(page, IO.dimmer.name);
    await expect(stateIcon(light)).toHaveAttribute('aria-label', MESSAGES.io.on);
    await expect(dimmer.locator('.light-dimmer-io__reading')).toHaveText('50%');

    // Someone else's phone, a wall switch, a scenario: an io_changed nobody
    // in this browser asked for.
    expect((await mock.pushIo(IO.light.id, 'false')).known).toBe(true);
    expect((await mock.pushIo(IO.dimmer.id, '80')).known).toBe(true);

    await expect(stateIcon(light)).toHaveAttribute('aria-label', MESSAGES.io.off);
    await expect(dimmer.locator('.light-dimmer-io__reading')).toHaveText('80%');
    // The slider resyncs too — it only refuses an update mid-drag.
    await expect(dimmer.locator('input[type="range"]')).toHaveValue('80');

    // No re-fetch of the house and no answering frame: the event patched the
    // two IOs in place, which is the whole point of the normalized store.
    // (The audio follow-up of the sign-in is the only other traffic — see
    // SIGN_IN_FRAMES.)
    await expect.poll(async () => await mock.frameKinds()).toEqual(SIGN_IN_FRAMES);
});

test('an IO the server marked invisible has no row to press', async ({ page, mock }) => {
    await openRoom(page, IO.invisible.room);

    // RoomView filters it out of the list, so it is not a hidden row: there
    // is no row (docs/ARCHITECTURE.md — "never rendered" is a property of the
    // list, not of the row).
    await expect(page.locator('.io-row')).toHaveCount(4);
    await expect(ioRow(page, IO.invisible.name)).toHaveCount(0);
    await expect(page.getByText(IO.invisible.name)).toHaveCount(0);

    expect(await setStateFrames(mock, IO.invisible.id)).toEqual([]);
});

test('an IO the server marked read-only shows its state and offers no controls', async ({
    page,
}) => {
    await openRoom(page, IO.readOnly.room);
    const row = ioRow(page, IO.readOnly.name);

    // The row exists and still reports — `rw` hides the actions, not the IO.
    await expect(row).toBeVisible();
    await expect(stateIcon(row)).toHaveAttribute('aria-label', MESSAGES.io.off);
    await expect(row.getByRole('button')).toHaveCount(0);
    await expect(row.locator('.io-row__actions')).toHaveCount(0);

    // A writable row in the same list still has its pair, so this is the
    // fixture's `rw:"false"` doing the work and not a missing renderer. The
    // old app never looked at `rw` for a light at all.
    await expect(ioRow(page, IO.varInt.name).getByRole('button')).toHaveCount(2);
});
