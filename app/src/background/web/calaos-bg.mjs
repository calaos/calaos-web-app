import { layout, pickVariant } from '../src/layout.mjs';
import { variants } from '../assets/variants.mjs';

// Fills `el` (positioned, sized by the page) with the Calaos background.
// `assetsUrl` is needed once bundled: import.meta.url then no longer points
// next to assets/. Returns a function that detaches it.
export function mountBackground(el, { assetsUrl = new URL('../assets/', import.meta.url) } = {}) {
    const assets = new URL(assetsUrl, document.baseURI);
    if (!assets.pathname.endsWith('/'))
        assets.pathname += '/';
    const url = (v, file) => new URL(`${v === variants.phone ? 'phone' : 'desktop'}/${file}`, assets).href;
    el.classList.add('calaos-bg');
    const dots = {};
    for (const k of ['a', 'b']) {
        dots[k] = document.createElement('div');
        dots[k].className = 'calaos-bg__dots';
        el.appendChild(dots[k]);
    }

    let current = null;
    const apply = () => {
        const w = el.clientWidth, h = el.clientHeight;
        const v = pickVariant(variants, w, h);
        if (v !== current) {
            current = v;
            el.style.backgroundImage = `url("${url(v, 'base.png')}")`;
            for (const k in dots) {
                dots[k].style.backgroundImage = `url("${url(v, 'dot.png')}")`;
                dots[k].style.backgroundSize = `${v.pitch[0]}px ${v.pitch[1]}px`;
                const mask = `url("${url(v, `mask-${k}.png`)}")`;
                dots[k].style.maskImage = mask;
                dots[k].style.webkitMaskImage = mask;
            }
        }
        const boxes = layout(v, w, h);
        for (const k in dots) {
            const b = boxes[k], s = dots[k].style;
            s.left = `${b.x}px`;
            s.top = `${b.y}px`;
            s.width = `${b.width}px`;
            s.height = `${b.height}px`;
            s.opacity = b.opacity;
            // The mask spans the whole background, not just the dot box.
            const size = `${w}px ${h}px`, pos = `${-b.x}px ${-b.y}px`;
            s.maskSize = s.webkitMaskSize = size;
            s.maskPosition = s.webkitMaskPosition = pos;
        }
    };

    const ro = new ResizeObserver(apply);
    ro.observe(el);
    apply();
    return () => {
        ro.disconnect();
        for (const k in dots) dots[k].remove();
        el.classList.remove('calaos-bg');
        el.style.backgroundImage = '';
    };
}
