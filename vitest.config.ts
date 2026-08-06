import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
    plugins: [vue()],
    test: {
        environment: 'happy-dom',
        include: ['app/**/*.{test,spec}.ts', 'mock-server/*.test.js'],
    },
});
