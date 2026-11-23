// Dot placement shared by the web and QML renderers; tools/pack.py holds the
// same rule and checks it against the XCF. Sizes are in CSS / QML logical px.

const mod = (a, p) => ((a % p) + p) % p;

// Portrait screens use the phone artwork, everything else the desktop one.
export function pickVariant(variants, width, height) {
    return height > width ? variants.phone : variants.desktop;
}

// Grid a is centred inside its clip box so the margins stay symmetric at any
// size; grid b keeps its half-pitch offset to a so the two still interleave.
// Only whole dots are drawn. At the XCF size this gives the XCF dots exactly.
function axis(extent, grids, i) {
    const p = grids.a.pitch[i];
    const ref = grids.a;
    const lo = ref.clip[i], hi = extent - ref.clip[i + 2], d = ref.size[i];
    const n = Math.floor((hi - lo - d) / p) + 1;
    const origin = lo + Math.floor((hi - lo - ((n - 1) * p + d)) / 2);
    const out = {};
    for (const k of Object.keys(grids)) {
        const g = grids[k];
        const glo = g.clip[i], ghi = extent - g.clip[i + 2], gd = g.size[i];
        const first = glo + mod(origin + g.offset[i] - glo, p);
        const count = first + gd > ghi ? 0 : Math.floor((ghi - gd - first) / p) + 1;
        out[k] = { first, count };
    }
    return out;
}

// For each grid: the box covering exactly its dots (x, y, width, height), the
// dot tile repeating from the box origin.
export function layout(variant, width, height) {
    const grids = {};
    for (const k of Object.keys(variant.grids))
        grids[k] = Object.assign({ pitch: variant.pitch }, variant.grids[k]);
    const ax = axis(Math.floor(width), grids, 0);
    const ay = axis(Math.floor(height), grids, 1);
    const out = {};
    for (const k of Object.keys(grids)) {
        const g = grids[k], x = ax[k], y = ay[k];
        out[k] = {
            x: x.first,
            y: y.first,
            width: x.count ? (x.count - 1) * variant.pitch[0] + g.size[0] : 0,
            height: y.count ? (y.count - 1) * variant.pitch[1] + g.size[1] : 0,
            opacity: g.opacity,
        };
    }
    return out;
}
