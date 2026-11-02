// The picture must stay on screen while the next snapshot replaces it.
//
// Chromium paints an <img decoding="async"> as empty for a couple of frames
// when its `src` changes (the new bytes have not been decoded yet); Firefox
// keeps the old picture. The blank is a compositor-level fact: `img.complete`,
// `naturalWidth` and screenshots taken at an arbitrary instant do not show it,
// so this spec records the frames Chromium actually presents (CDP screencast)
// and looks at the middle of every picture in each of them.
//
// The frames served are big noisy JPEGs generated in the page — a 96×72 PNG
// decodes too fast for the window to be reliably hit. Nothing leaves the
// machine: the snapshot route is answered by the test.

import { expect, loginAs, test } from './fixtures';
import type { Page } from '@playwright/test';

const isSnapshotRequest = (url: URL): boolean =>
    url.pathname === '/api' && url.searchParams.get('action') === 'camera';

/** The well behind the picture is #0b0b0b (luminance 11); the fake frames are above 100. */
const BLANK_BELOW = 60;
const OBSERVE_MS = 2500;
const SIDE = 24;
/** Same size as a real camera frame (4512×2512, ~860 kB): decode time is what the bug depends on. */
const NOISE = 34;
const QUALITY = 0.5;

async function fakeFramesJpeg(page: Page): Promise<string[]> {
    return await page.evaluate(async ({ NOISE, QUALITY }) => {
        const out: string[] = [];
        for (const hue of [30, 200]) {
            const canvas = document.createElement('canvas');
            canvas.width = 4512;
            canvas.height = 2512;
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = `hsl(${hue} 70% 55%)`;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
            for (let k = 0; k < pixels.data.length; k += 4) {
                const noise = (Math.random() * NOISE) | 0;
                pixels.data[k] = Math.min(255, pixels.data[k] + noise);
                pixels.data[k + 1] = Math.min(255, pixels.data[k + 1] + noise);
                pixels.data[k + 2] = Math.min(255, pixels.data[k + 2] + noise);
            }
            ctx.putImageData(pixels, 0, 0);
            const blob = await new Promise<Blob>((done) =>
                canvas.toBlob((b) => done(b!), 'image/jpeg', QUALITY),
            );
            const bytes = new Uint8Array(await blob.arrayBuffer());            let binary = '';
            for (let k = 0; k < bytes.length; k += 0x8000) {
                binary += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
            }
            out.push(btoa(binary));
        }
        return out;
    }, { NOISE, QUALITY });
}

interface Spot {
    x: number;
    y: number;
}

/** Centres of the pictures that are inside the viewport. */
async function visibleCentres(page: Page): Promise<Spot[]> {
    const viewport = page.viewportSize()!;
    const boxes = await page.locator('.camera-frame__picture').evaluateAll((imgs) =>
        imgs.map((img) => {
            const r = img.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }),
    );
    return boxes.filter((b) => b.x < viewport.width && b.y < viewport.height);
}

/**
 * Records what the browser presents for OBSERVE_MS and returns, for each
 * presented frame, the darkest luminance among the picture centres.
 */
async function presentedLuminance(page: Page, spots: Spot[]): Promise<number[]> {
    const viewport = page.viewportSize()!;
    const cdp = await page.context().newCDPSession(page);
    const frames: string[] = [];
    cdp.on('Page.screencastFrame', (event) => {
        frames.push(event.data);
        void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId });
    });
    await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 85,
        maxWidth: 480,
        maxHeight: 360,
        everyNthFrame: 1,
    });
    await page.waitForTimeout(OBSERVE_MS);
    await cdp.send('Page.stopScreencast');
    await cdp.detach();

    // Decoded in a separate page so the one under test is left alone.
    const reader = await page.context().newPage();
    try {
        return await reader.evaluate(
            async ({ data, centres, width, side }) => {
                const darkest: number[] = [];
                for (const b64 of data) {
                    const bitmap = await createImageBitmap(
                        await (await fetch(`data:image/jpeg;base64,${b64}`)).blob(),
                    );
                    const scale = bitmap.width / width;
                    let low = 255;
                    for (const c of centres) {
                        const canvas = new OffscreenCanvas(side, side);
                        const ctx = canvas.getContext('2d')!;
                        ctx.drawImage(
                            bitmap,
                            (c.x - side / 2) * scale,
                            (c.y - side / 2) * scale,
                            side * scale,
                            side * scale,
                            0,
                            0,
                            side,
                            side,
                        );
                        const px = ctx.getImageData(0, 0, side, side).data;
                        let sum = 0;
                        for (let k = 0; k < px.length; k += 4) sum += (px[k] + px[k + 1] + px[k + 2]) / 3;
                        low = Math.min(low, sum / (side * side));
                    }
                    darkest.push(Math.round(low));
                }
                return darkest;
            },
            { data: frames, centres: spots, width: viewport.width, side: SIDE },
        );
    } finally {
        await reader.close();
    }
}

test.beforeEach(async ({ mock }) => {
    await mock.reset();
});

for (const [view, hash, pictures] of [
    ['the list of cameras', '/#/security', 2],
    ['a single camera', '/#/security/0', 1],
] as const) {
    test(`${view} never blanks a picture between two frames`, async ({ page }) => {
        await page.goto('/');
        await loginAs(page);

        const jpegs = await fakeFramesJpeg(page);
        let served = 0;
        await page.route(isSnapshotRequest, async (route) => {
            served += 1;
            await route.fulfill({
                status: 200,
                contentType: 'image/jpeg',
                headers: { 'cache-control': 'no-store' },
                body: Buffer.from(jpegs[served % 2], 'base64'),
            });
        });

        await page.goto(hash);
        await expect(page.locator('.camera-frame__live')).toHaveCount(pictures);
        await page.waitForTimeout(600);

        const spots = await visibleCentres(page);
        expect(spots.length).toBeGreaterThan(0);
        const before = served;
        const darkest = await presentedLuminance(page, spots);

        // The window really contained frame swaps, and frames were presented.
        expect(served - before).toBeGreaterThanOrEqual(4);
        expect(darkest.length).toBeGreaterThan(20);
        expect(darkest.filter((luminance) => luminance < BLANK_BELOW)).toEqual([]);
    });
}
