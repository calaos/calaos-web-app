import { describe, expect, it } from 'vitest';
import { configEditor, groupOptions, isOn, selectChoices } from './configEditors';
import type { ConfigOption } from '../../protocol/admin-config';

function option(patch: Partial<ConfigOption>): ConfigOption {
    return {
        key: 'k',
        group: 'G',
        type: 'string',
        description: '',
        value: '',
        default: '',
        secret: false,
        set: false,
        restart: false,
        choices: null,
        ...patch,
    };
}

describe('configEditor', () => {
    it('maps each registry type to its editor', () => {
        expect(configEditor(option({ type: 'bool' }))).toBe('bool');
        expect(configEditor(option({ type: 'int' }))).toBe('integer');
        expect(configEditor(option({ type: 'port' }))).toBe('integer');
        expect(configEditor(option({ type: 'float' }))).toBe('decimal');
        expect(configEditor(option({ type: 'enum', choices: ['1', '2'] }))).toBe('select');
        expect(configEditor(option({ type: 'email_list' }))).toBe('email');
        expect(configEditor(option({ type: 'host' }))).toBe('text');
        expect(configEditor(option({ type: 'csv' }))).toBe('text');
        expect(configEditor(option({ type: 'something_new' }))).toBe('text');
    });

    it('lets a value list win over a number, and a secret over everything', () => {
        expect(configEditor(option({ type: 'int', choices: ['0', '1'] }))).toBe('select');
        expect(configEditor(option({ type: 'string', secret: true }))).toBe('secret');
        expect(configEditor(option({ type: 'token', secret: false }))).toBe('secret');
        expect(configEditor(option({ type: 'bool', secret: true }))).toBe('secret');
    });

    it('treats an empty value list as no list', () => {
        expect(configEditor(option({ type: 'enum', choices: [] }))).toBe('text');
    });
});

describe('selectChoices', () => {
    it('keeps a stored value the list does not have', () => {
        expect(selectChoices(option({ value: '', choices: ['en', 'fr'] }))).toEqual(['', 'en', 'fr']);
        expect(selectChoices(option({ value: 'fr', choices: ['en', 'fr'] }))).toEqual(['en', 'fr']);
    });
});

describe('isOn / groupOptions', () => {
    it('reads only "true" as on', () => {
        expect(isOn('true')).toBe(true);
        expect(isOn('1')).toBe(false);
        expect(isOn(null)).toBe(false);
    });

    it('groups in server order', () => {
        const grouped = groupOptions([
            option({ key: 'a', group: 'X' }),
            option({ key: 'b', group: 'Y' }),
            option({ key: 'c', group: 'X' }),
        ]);
        expect(grouped.map((g) => [g.group, g.options.map((o) => o.key)])).toEqual([
            ['X', ['a', 'c']],
            ['Y', ['b']],
        ]);
    });
});
