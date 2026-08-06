import { describe, expect, it } from 'vitest';
import { GUI_TYPES } from './types';

describe('GUI_TYPES', () => {
    it('lists exactly the 14 gui_types dispatched by the old app (room.html ng-switch)', () => {
        expect(GUI_TYPES).toEqual([
            'temp',
            'analog_in',
            'string_in',
            'light',
            'analog_out',
            'light_dimmer',
            'light_rgb',
            'shutter',
            'shutter_smart',
            'var_bool',
            'var_int',
            'var_string',
            'string_out',
            'scenario',
        ]);
    });

    it('does not contain the synthetic fallback discriminant "unknown"', () => {
        expect(GUI_TYPES).not.toContain('unknown');
    });
});
