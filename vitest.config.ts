import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
    plugins: [vue()],
    test: {
        environment: 'happy-dom',
        // mock-server/ is plain Node ESM (.mjs, see eslint.config.mjs); its
        // suite opts into the node environment with a @vitest-environment
        // docblock.
        include: ['app/**/*.{test,spec}.ts', 'mock-server/*.test.{js,mjs}'],
    },
});
