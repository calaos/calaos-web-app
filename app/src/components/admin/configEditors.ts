// Which editor a setting gets, from the registry's type id (ConfigOptions.cpp
// `typeId()`, passed through by `config_list`). An unknown type is a text
// field: the registry still validates what is typed.

import type { ConfigOption } from '../../protocol/admin-config';

export type ConfigEditor = 'secret' | 'bool' | 'select' | 'integer' | 'decimal' | 'email' | 'text';

const INTEGER_TYPES = new Set(['int', 'port']);
const DECIMAL_TYPES = new Set(['float', 'double']);
const SECRET_TYPES = new Set(['password', 'token']);

export function configEditor(option: Pick<ConfigOption, 'type' | 'secret' | 'choices'>): ConfigEditor {
    if (option.secret || SECRET_TYPES.has(option.type)) return 'secret';
    if (option.type === 'bool') return 'bool';
    if (option.choices !== null && option.choices.length > 0) return 'select';
    if (INTEGER_TYPES.has(option.type)) return 'integer';
    if (DECIMAL_TYPES.has(option.type)) return 'decimal';
    if (option.type === 'email' || option.type === 'email_list') return 'email';
    return 'text';
}

/** The choices of a select, with the stored value first when the list lacks it (an empty `lang`). */
export function selectChoices(option: Pick<ConfigOption, 'value' | 'choices'>): string[] {
    const choices = option.choices ?? [];
    const value = option.value ?? '';
    return choices.includes(value) ? choices : [value, ...choices];
}

/** The registry also accepts `1` for a bool (`ota_enabled`); the switch only ever writes `true`/`false`. */
export function isOn(value: string | null): boolean {
    return value === 'true' || value === '1';
}

/** Groups in the order the server lists them, keys in theirs. */
export function groupOptions(options: ConfigOption[]): { group: string; options: ConfigOption[] }[] {
    const groups = new Map<string, ConfigOption[]>();
    for (const option of options) {
        const list = groups.get(option.group);
        if (list === undefined) groups.set(option.group, [option]);
        else list.push(option);
    }
    return [...groups].map(([group, list]) => ({ group, options: list }));
}
