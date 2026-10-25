import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { messages } from '../../i18n/messages';
import type { NetInterface } from '../../protocol/admin-network';
import NetworkForm from './NetworkForm.vue';

const t = messages.en.admin.network;

const ETH0: NetInterface = {
    name: 'eth0',
    ipv4: '192.168.1.10/24',
    gateway: '192.168.1.1',
    mac: 'b8:27:eb:12:34:56',
    state: 'routable',
    dhcp: false,
    dnsServers: ['192.168.1.1'],
    searchDomains: ['lan'],
};

function mountForm(intf: NetInterface = ETH0) {
    return mount(NetworkForm, {
        props: { intf },
        global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
    });
}

function inputs(wrapper: ReturnType<typeof mountForm>) {
    const fields = wrapper.findAll('.admin-field__input');
    return { ipv4: fields[0], gateway: fields[1], dns: fields[2], domains: fields[3] };
}

describe('NetworkForm', () => {
    it('refuses a bare address, a bad gateway and lists over 4, before any code', async () => {
        const wrapper = mountForm();
        const field = inputs(wrapper);
        await field.ipv4.setValue('192.168.1.20');
        await field.gateway.setValue('192.168.1');
        await field.dns.setValue('1.1.1.1, 8.8.8.8, 9.9.9.9, 1.0.0.1, 8.8.4.4');
        await field.domains.setValue('-bad');
        await wrapper.find('form').trigger('submit');
        expect(wrapper.emitted('apply')).toBeUndefined();
        const errors = wrapper.findAll('.net-form__note--error').map((note) => note.text());
        expect(errors).toEqual([t.form.error.ipv4, t.form.error.gateway, t.form.error.dns_servers, t.form.error.search_domains]);
        expect(field.ipv4.attributes('aria-invalid')).toBe('true');
    });

    it('sends the typed fields, the gateway optional, the lists split on commas and spaces', async () => {
        const wrapper = mountForm();
        const field = inputs(wrapper);
        await field.ipv4.setValue(' 10.0.0.2/8 ');
        await field.gateway.setValue('');
        await field.dns.setValue('10.0.0.1,  1.1.1.1');
        await field.domains.setValue('home.lan lan');
        await wrapper.find('form').trigger('submit');
        expect(wrapper.emitted('apply')).toEqual([
            [{ intf: 'eth0', dhcp: false, ipv4: '10.0.0.2/8', gateway: '', dnsServers: ['10.0.0.1', '1.1.1.1'], searchDomains: ['home.lan', 'lan'] }],
        ]);
    });

    it('DHCP carries no address field and hides them', async () => {
        const wrapper = mountForm();
        await wrapper.findAll('.net-form__radio')[0].setValue(true);
        expect(wrapper.findAll('.admin-field__input')).toHaveLength(0);
        await wrapper.find('form').trigger('submit');
        expect(wrapper.emitted('apply')).toEqual([[{ intf: 'eth0', dhcp: true }]]);
    });

    it('says so rather than applying the settings already in use', async () => {
        const wrapper = mountForm();
        await wrapper.find('form').trigger('submit');
        expect(wrapper.emitted('apply')).toBeUndefined();
        expect(wrapper.find('.net-form__status').text()).toBe(t.form.unchanged);
    });
});
