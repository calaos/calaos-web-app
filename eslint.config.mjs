import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';

// eslint-plugin-vue's and typescript-eslint's shared presets don't scope
// every entry with `files` (some are meant to apply to a whole project), so
// each preset is force-scoped to the directories it is meant for — mock
// server .mjs files must not be parsed as TS, and vice versa.
// 'flat/essential' (not 'flat/recommended'): keep to bug-catching structural
// rules, no stylistic formatting rules — the repo has no formatter (see
// CLAUDE.md), so enforcing e.g. template indentation via lint would just be
// noise without an auto-fixer workflow.
const vueEssential = pluginVue.configs['flat/essential'].map((config) => ({
    ...config,
    files: ['app/**/*.vue'],
}));

const tsRecommended = tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['app/**/*.ts'],
}));

// Node-side TypeScript: the Playwright rig (T08) and the root Vite/Vitest
// config files.
const E2E_FILES = ['playwright.config.ts', 'e2e/**/*.ts'];
const ROOT_CONFIG_FILES = ['vite.config.ts', 'vitest.config.ts'];

const tsRecommendedNode = tseslint.configs.recommended.map((config) => ({
    ...config,
    files: [...E2E_FILES, ...ROOT_CONFIG_FILES],
}));

export default [
    {
        ignores: [
            // build output (committed, but never linted)
            'dist/**',
            'node_modules/**',
            // Playwright output (both gitignored)
            'test-results/**',
            'playwright-report/**',
        ],
    },
    js.configs.recommended,
    {
        // Mock calaos_server (T04): plain Node ESM, hence .mjs — the repo's
        // package.json has no "type":"module".
        files: ['mock-server/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
            },
        },
        rules: {
            'no-unused-vars': ['error', { args: 'none' }],
        },
    },
    ...tsRecommended,
    ...tsRecommendedNode,
    ...vueEssential,
    {
        // Layer the TS parser into vue-eslint-parser for <script lang="ts">
        // blocks (must come after vueEssential, which sets the base parser).
        files: ['app/**/*.vue'],
        languageOptions: {
            parserOptions: {
                parser: tseslint.parser,
            },
        },
    },
    {
        files: ['app/**/*.{ts,vue}'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
            },
        },
        rules: {
            // Server/user-provided room and IO names are just labels; this
            // repo's components are named after what they render, e.g.
            // App.vue, ShutterIo.vue.
            'vue/multi-word-component-names': 'off',
        },
    },
    {
        // Playwright specs are node code that also authors browser code:
        // `page.evaluate()` callbacks are written inline and reference
        // window/history/location, so both global sets are in scope here.
        files: E2E_FILES,
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.browser,
            },
        },
    },
    {
        // Vite/Vitest config files run in node.
        files: ROOT_CONFIG_FILES,
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
            },
        },
    },
];
