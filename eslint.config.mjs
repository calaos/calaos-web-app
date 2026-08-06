import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';

// eslint-plugin-vue's and typescript-eslint's shared presets don't scope
// every entry with `files` (some are meant to apply to a whole project).
// This repo lints the legacy AngularJS app (src/, tools/) alongside the new
// Vue app (app/), so every entry is force-scoped to app/** to guarantee the
// old ES5 code is parsed and linted exactly as before.
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

export default [
    {
        ignores: [
            'dist/**',
            'dist-next/**',
            'node_modules/**',
            // npm runtime libs synced into src/libs by tools/common.js
            'src/libs/**',
            // vendored third-party code
            'src/vendor/**',
            'src/scripts/reconnecting-websocket.js',
        ],
    },
    js.configs.recommended,
    {
        files: ['src/scripts/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: {
                ...globals.browser,
                ...globals.jquery,
                angular: 'readonly',
                // cross-file globals: no module system, scripts share the global scope
                calaosDevConfig: 'writable',
                ReconnectingWebSocket: 'writable',
                getRoomTypeString: 'writable',
                getRoomTypeIcon: 'writable',
            },
        },
        rules: {
            'no-unused-vars': ['warn', { args: 'none' }],
            // files define these globals themselves; only flag same-file redeclares
            'no-redeclare': ['error', { builtinGlobals: false }],
        },
    },
    {
        files: ['tools/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
            },
        },
        rules: {
            'no-unused-vars': ['warn', { args: 'none' }],
        },
    },
    ...tsRecommended,
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
];
