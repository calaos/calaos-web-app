import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import Icons from 'unplugin-icons/vite';

export default defineConfig({
    // Icons(): component specs import components that import `~icons/mdi/*`,
    // which is a virtual module — without the plugin those imports fail to
    // resolve here even though `vite build` is fine.
    plugins: [vue(), Icons({ compiler: 'vue3' })],
    test: {
        environment: 'happy-dom',
        // mock-server/ is plain Node ESM (.mjs, see eslint.config.mjs); its
        // suite opts into the node environment with a @vitest-environment
        // docblock.
        include: ['app/**/*.{test,spec}.ts', 'mock-server/*.test.{js,mjs}'],
    },
});
