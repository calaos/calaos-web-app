import js from '@eslint/js';
import globals from 'globals';

export default [
    {
        ignores: [
            'dist/**',
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
];
