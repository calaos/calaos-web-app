import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import vue from '@vitejs/plugin-vue';
import Icons from 'unplugin-icons/vite';

// Non-VITE env var, deliberately not exposed to the client bundle: the app
// always talks to same-origin /api and Vite's dev/preview server proxies it
// to the real (or mock) calaos_server. See docs/ARCHITECTURE.md "Dev server
// override".
const DEFAULT_CALAOS_SERVER = 'http://localhost:5454';

export default defineConfig(({ mode }) => {
    // Third argument '' loads every env var (not just VITE_-prefixed ones)
    // from .env* files in the repo root, matching where CALAOS_SERVER lives.
    const env = loadEnv(mode, process.cwd(), '');

    if (mode === 'production') {
        const leaked = Object.keys(env).filter((key) => key.startsWith('VITE_CALAOS'));
        if (leaked.length > 0) {
            throw new Error(
                `Refusing to build in production mode: ${leaked.join(', ')} would leak into the ` +
                    'client bundle. The app derives its WebSocket URL from window.location and must ' +
                    'never ship a non-empty host (see docs/ARCHITECTURE.md "Dev server override").',
            );
        }
    }

    const apiProxy: ProxyOptions = {
        target: env.CALAOS_SERVER || DEFAULT_CALAOS_SERVER,
        changeOrigin: true,
        ws: true,
    };

    return {
        // MUST stay relative. calaos_server does NOT serve this app at the
        // origin root: its HTTP router (calaos_base
        // src/bin/calaos_server/HttpClient.cpp) redirects `/`, `/app` and
        // `/app/` to `/app/index.html`, serves static files only for paths
        // under `/app/`, routes `/api` to the API, and answers EVERYTHING
        // else with a 404 whose Content-Type is text/html. With the default
        // `base: '/'` the built index.html asks for `/assets/index-*.js`,
        // which escapes the `/app/` prefix, 404s, and kills the app with a
        // module-script MIME error (the AngularJS app it replaced survived
        // only because its asset paths happened to be relative).
        // `./` resolves against the document, so the same bundle works both
        // under `/app/` and at the root (dev, `vite preview`, E2E).
        // The app's own absolute `/api` URLs are NOT affected and must stay
        // absolute — the API really does live at the server root.
        // Regression test: e2e/app-prefix.spec.ts + e2e/calaos-server-sim.mjs.
        base: './',
        root: 'app',
        envDir: process.cwd(),
        plugins: [vue(), Icons({ compiler: 'vue3' })],
        server: {
            proxy: {
                '/api': apiProxy,
            },
        },
        preview: {
            proxy: {
                '/api': apiProxy,
            },
        },
        build: {
            // Repo-root dist/ (root is 'app', so one level up). Committed to
            // git — the sole input to the Docker image and the distro package.
            outDir: '../dist',
            emptyOutDir: true,
        },
    };
});
