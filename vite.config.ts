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
            outDir: '../dist-next',
            emptyOutDir: true,
        },
    };
});
