<script setup lang="ts">
// New settings for one interface. The checks are the box's own (IPv4 only,
// an explicit prefix, an optional gateway), so a code is never spent on a
// change the box would refuse.

import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import {
    NETWORK_LIST_MAX,
    isIpv4,
    isIpv4Cidr,
    isSearchDomain,
} from '../../protocol/admin-network';
import type { NetInterface, NetworkChange } from '../../protocol/admin-network';
import AdminButton from './AdminButton.vue';
import AdminField from './AdminField.vue';

const props = defineProps<{ intf: NetInterface; disabled?: boolean }>();
const emit = defineEmits<{ apply: [change: NetworkChange]; cancel: [] }>();

const { t } = useI18n();
const ids = { mode: useId(), ipv4: useId(), gateway: useId(), dns: useId(), domains: useId(), status: useId() };

const dhcp = ref(props.intf.dhcp);
const ipv4 = ref(props.intf.ipv4);
const gateway = ref(props.intf.gateway);
const dns = ref(props.intf.dnsServers.join(', '));
const domains = ref(props.intf.searchDomains.join(', '));
/** Errors show once the user tried to apply, then follow the typing. */
const tried = ref(false);

function list(value: string): string[] {
    return value.split(/[\s,]+/).filter((item) => item !== '');
}

const problems = computed(() => {
    if (dhcp.value) return { ipv4: false, gateway: false, dns_servers: false, search_domains: false };
    const gw = gateway.value.trim();
    const servers = list(dns.value);
    const names = list(domains.value);
    return {
        ipv4: !isIpv4Cidr(ipv4.value.trim()),
        gateway: gw !== '' && !isIpv4(gw),
        dns_servers: servers.length > NETWORK_LIST_MAX || !servers.every(isIpv4),
        search_domains: names.length > NETWORK_LIST_MAX || !names.every(isSearchDomain),
    };
});

const valid = computed(() => !Object.values(problems.value).some(Boolean));

const change = computed<NetworkChange>(() => {
    if (dhcp.value) return { intf: props.intf.name, dhcp: true };
    return {
        intf: props.intf.name,
        dhcp: false,
        ipv4: ipv4.value.trim(),
        gateway: gateway.value.trim(),
        dnsServers: list(dns.value),
        searchDomains: list(domains.value),
    };
});

const unchanged = computed(() => {
    const c = change.value;
    const i = props.intf;
    if (c.dhcp !== i.dhcp) return false;
    if (c.dhcp) return true;
    return (
        c.ipv4 === i.ipv4 &&
        c.gateway === i.gateway &&
        (c.dnsServers ?? []).join(',') === i.dnsServers.join(',') &&
        (c.searchDomains ?? []).join(',') === i.searchDomains.join(',')
    );
});

function shows(field: keyof typeof problems.value): boolean {
    return tried.value && problems.value[field];
}

function submit(): void {
    tried.value = true;
    if (!valid.value || unchanged.value || props.disabled) return;
    emit('apply', change.value);
}
</script>

<template>
    <form class="net-form fade-in" novalidate @submit.prevent="submit">
        <fieldset class="net-form__mode">
            <legend class="net-form__legend">{{ t('admin.network.form.mode') }}</legend>
            <label class="net-form__choice" :class="{ 'net-form__choice--on': dhcp }">
                <input v-model="dhcp" type="radio" :name="ids.mode" :value="true" class="net-form__radio" />
                <span>{{ t('admin.network.dhcp') }}</span>
            </label>
            <label class="net-form__choice" :class="{ 'net-form__choice--on': !dhcp }">
                <input v-model="dhcp" type="radio" :name="ids.mode" :value="false" class="net-form__radio" />
                <span>{{ t('admin.network.static') }}</span>
            </label>
        </fieldset>

        <p v-if="dhcp" class="net-form__hint">{{ t('admin.network.form.dhcpHint') }}</p>

        <div v-else class="net-form__fields">
            <div class="net-form__field">
                <AdminField
                    v-model="ipv4"
                    :label="t('admin.network.form.address')"
                    :described-by="ids.ipv4"
                    :invalid="shows('ipv4')"
                    autofocus
                />
                <p :id="ids.ipv4" class="net-form__note" :class="{ 'net-form__note--error': shows('ipv4') }">
                    {{ shows('ipv4') ? t('admin.network.form.error.ipv4') : t('admin.network.form.addressHint') }}
                </p>
            </div>
            <div class="net-form__field">
                <AdminField
                    v-model="gateway"
                    :label="t('admin.network.form.gateway')"
                    :described-by="ids.gateway"
                    :invalid="shows('gateway')"
                />
                <p :id="ids.gateway" class="net-form__note" :class="{ 'net-form__note--error': shows('gateway') }">
                    {{ shows('gateway') ? t('admin.network.form.error.gateway') : t('admin.network.form.gatewayHint') }}
                </p>
            </div>
            <div class="net-form__field">
                <AdminField
                    v-model="dns"
                    :label="t('admin.network.form.dns')"
                    :described-by="ids.dns"
                    :invalid="shows('dns_servers')"
                />
                <p :id="ids.dns" class="net-form__note" :class="{ 'net-form__note--error': shows('dns_servers') }">
                    {{ shows('dns_servers') ? t('admin.network.form.error.dns_servers') : t('admin.network.form.dnsHint') }}
                </p>
            </div>
            <div class="net-form__field">
                <AdminField
                    v-model="domains"
                    :label="t('admin.network.form.domains')"
                    :described-by="ids.domains"
                    :invalid="shows('search_domains')"
                />
                <p :id="ids.domains" class="net-form__note" :class="{ 'net-form__note--error': shows('search_domains') }">
                    {{
                        shows('search_domains')
                            ? t('admin.network.form.error.search_domains')
                            : t('admin.network.form.domainsHint')
                    }}
                </p>
            </div>
        </div>

        <p v-if="tried && unchanged" :id="ids.status" class="net-form__status" role="status">
            {{ t('admin.network.form.unchanged') }}
        </p>

        <div class="net-form__actions">
            <AdminButton variant="quiet" @click="emit('cancel')">{{ t('admin.network.form.cancel') }}</AdminButton>
            <AdminButton type="submit" :disabled="disabled">{{ t('admin.network.form.apply') }}</AdminButton>
        </div>
    </form>
</template>

<style scoped>
.net-form {
    display: grid;
    gap: var(--space-4);
    padding-block: var(--space-4) var(--space-2);
}

.net-form__mode {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    border: 0;
}

.net-form__legend {
    margin-block-end: var(--space-2);
    padding: 0;
    color: var(--c-text-muted);
    font-size: 0.875rem;
}

/* Two pills: the chosen one carries the cyan rim the focused field has. */
.net-form__choice {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-block-size: 44px;
    padding: var(--space-2) var(--space-4);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 999px;
    background-color: rgba(255, 255, 255, 0.04);
    color: var(--c-text-muted);
    font-size: 0.9375rem;
    cursor: pointer;
    transition:
        border-color 200ms ease,
        color 200ms ease,
        background-color 200ms ease;
}

.net-form__choice--on {
    border-color: rgba(56, 176, 211, 0.6);
    background-color: rgba(56, 176, 211, 0.1);
    color: var(--c-text);
}

.net-form__radio {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
}

.net-form__choice:focus-within {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
}

.net-form__hint,
.net-form__status {
    color: var(--c-text-muted);
    font-size: 0.9375rem;
    line-height: 1.45;
    max-inline-size: 48ch;
}

.net-form__status {
    color: var(--c-warn);
}

.net-form__fields {
    display: grid;
    gap: var(--space-4);
}

@media (min-width: 560px) {
    .net-form__fields {
        grid-template-columns: 1fr 1fr;
        column-gap: var(--space-4);
    }
}

.net-form__note {
    margin-block-start: var(--space-1);
    color: var(--c-text-muted);
    font-size: 0.8125rem;
    line-height: 1.4;
}

.net-form__note--error {
    color: var(--c-danger-text);
}

.net-form__actions {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: var(--space-3);
}

@media (max-width: 479px) {
    .net-form__actions > * {
        flex: 1 1 100%;
    }
}

@media (prefers-reduced-motion: reduce) {
    .net-form__choice {
        transition: none;
    }
}
</style>
