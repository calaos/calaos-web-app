<script setup lang="ts">
// The MCP endpoint and its token, for setting up an AI assistant. The token
// is masked until asked for, and forgotten when the card goes. A new one
// cannot be undone: it asks once.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { mcpUrl } from '../../protocol/admin-mcp';
import { useAdminStore } from '../../stores/admin';
import { useAdminMcpStore } from '../../stores/adminMcp';
import { useAdminText } from '../../composables/useAdminText';
import BaseDialog from '../ui/BaseDialog.vue';
import AdminButton from './AdminButton.vue';

const COPIED_MS = 2_000;
const FRESH_MS = 6_000;
/** Fixed length, so the mask does not tell how long the token is. */
const MASK = '•'.repeat(24);

const { t } = useI18n();
const admin = useAdminStore();
const mcp = useAdminMcpStore();
const { errorText } = useAdminText();

const revealed = ref(false);
const copied = ref<'url' | 'token' | null>(null);
const copyFailed = ref(false);
const fresh = ref(false);
const confirming = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
let freshTimer: ReturnType<typeof setTimeout> | undefined;

const url = computed(() => (mcp.info === null ? '' : mcpUrl(window.location.origin, mcp.info.urlPath)));
const problem = computed(() => (mcp.error === null ? '' : errorText(mcp.error)));
const failure = computed(() =>
    admin.notice !== null && admin.noticeSource === 'box' ? errorText(admin.notice) : '',
);

watch(
    () => mcp.renewed,
    () => {
        revealed.value = false;
        fresh.value = true;
        clearTimeout(freshTimer);
        freshTimer = setTimeout(() => (fresh.value = false), FRESH_MS);
    },
);

/** The async clipboard first; the old copy command where it is missing. */
async function writeClipboard(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard !== undefined) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // Refused (permissions, focus): try the old way.
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let done: boolean;
    try {
        done = document.execCommand('copy');
    } catch {
        done = false;
    }
    area.remove();
    return done;
}

async function copy(what: 'url' | 'token'): Promise<void> {
    const text = what === 'url' ? url.value : (mcp.info?.token ?? '');
    if (text === '') return;
    const done = await writeClipboard(text);
    copyFailed.value = !done;
    copied.value = done ? what : null;
    clearTimeout(copiedTimer);
    if (done) copiedTimer = setTimeout(() => (copied.value = null), COPIED_MS);
}

function regenerate(): void {
    confirming.value = false;
    void mcp.regenerate();
}

onMounted(() => {
    if (admin.isUnlocked) void mcp.load();
});

onBeforeUnmount(() => {
    clearTimeout(copiedTimer);
    clearTimeout(freshTimer);
    mcp.reset();
});
</script>

<template>
    <section class="mcp" :aria-label="t('admin.mcp.title')">
        <ul class="mcp__list admin-list">
            <li v-if="mcp.info === null && mcp.error !== null" class="mcp__row admin-card">
                <div class="mcp__text">
                    <span class="mcp__name">{{ t('admin.mcp.loadFailed') }}</span>
                    <span class="mcp__problem">{{ problem }}</span>
                </div>
                <AdminButton variant="quiet" :busy="mcp.loading" @click="mcp.load()">
                    {{ t('admin.mcp.retry') }}
                </AdminButton>
            </li>

            <li v-else-if="mcp.info === null" class="mcp__row admin-card">
                <span class="mcp__muted" role="status">{{ t('admin.mcp.loading') }}</span>
            </li>

            <template v-else>
                <li class="mcp__row admin-card" data-field="url">
                    <div class="mcp__text">
                        <span class="mcp__name">{{ t('admin.mcp.url') }}</span>
                        <code class="mcp__value">{{ url }}</code>
                    </div>
                    <div class="mcp__buttons">
                        <AdminButton variant="quiet" @click="copy('url')">
                            {{ copied === 'url' ? t('admin.mcp.copied') : t('admin.mcp.copy') }}
                        </AdminButton>
                    </div>
                </li>

                <li class="mcp__row admin-card" :class="{ 'mcp__row--fresh': fresh }" data-field="token">
                    <div class="mcp__text">
                        <span class="mcp__name">{{ t('admin.mcp.token') }}</span>
                        <code v-if="revealed" class="mcp__value mcp__token">{{ mcp.info.token }}</code>
                        <span v-else class="mcp__value mcp__mask" role="img" :aria-label="t('admin.mcp.hidden')">{{ MASK }}</span>
                        <span v-if="fresh" class="mcp__fresh" role="status">{{ t('admin.mcp.renewed') }}</span>
                    </div>
                    <div class="mcp__buttons">
                        <AdminButton variant="quiet" :aria-pressed="revealed" @click="revealed = !revealed">
                            {{ revealed ? t('admin.mcp.hide') : t('admin.mcp.show') }}
                        </AdminButton>
                        <AdminButton variant="quiet" @click="copy('token')">
                            {{ copied === 'token' ? t('admin.mcp.copied') : t('admin.mcp.copy') }}
                        </AdminButton>
                    </div>
                </li>
            </template>

            <li class="mcp__row admin-card" data-field="regenerate">
                <div class="mcp__text">
                    <span class="mcp__name">{{ t('admin.actions.mcp') }}</span>
                    <span class="mcp__hint">{{ t('admin.actions.mcpHint') }}</span>
                </div>
                <AdminButton
                    variant="quiet"
                    :disabled="admin.busy !== null"
                    :busy="admin.busy === 'mcp_regenerate'"
                    @click="confirming = true"
                >
                    {{ t('admin.actions.regenerate') }}
                </AdminButton>
            </li>
        </ul>

        <p v-if="copyFailed" class="mcp__error fade-in" role="alert">{{ t('admin.mcp.copyFailed') }}</p>
        <p v-if="failure !== ''" class="mcp__error fade-in" role="alert">{{ failure }}</p>

        <BaseDialog
            :open="confirming"
            :title="t('admin.actions.mcpConfirmTitle')"
            :confirm-label="t('admin.actions.mcpConfirm')"
            :cancel-label="t('dialog.cancel')"
            @confirm="regenerate"
            @cancel="confirming = false"
        >
            <p class="mcp__dialog-hint">{{ t('admin.actions.mcpConfirmHint') }}</p>
        </BaseDialog>
    </section>
</template>

<style scoped>
.mcp__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
}

/* A new token: the accent filament, long enough to be seen, then gone. */
.mcp__row--fresh {
    animation: mcp-fresh 6s ease-out;
}

@keyframes mcp-fresh {
    0%,
    60% {
        background-color: color-mix(in srgb, var(--c-accent) 14%, transparent);
        box-shadow: inset 3px 0 0 var(--c-accent);
    }

    100% {
        background-color: transparent;
        box-shadow: inset 3px 0 0 transparent;
    }
}

.mcp__text {
    display: grid;
    gap: var(--space-1);
    min-inline-size: 0;
}

.mcp__name {
    font-size: 1rem;
}

.mcp__value {
    font-family: ui-monospace, 'Ubuntu Mono', 'DejaVu Sans Mono', Menlo, Consolas, monospace;
    font-size: 0.875rem;
    color: var(--c-text);
    overflow-wrap: anywhere;
    word-break: break-all;
}

.mcp__mask {
    color: var(--c-text-muted);
    letter-spacing: 0.1em;
}

.mcp__fresh {
    color: var(--c-text);
    font-size: 0.875rem;
}

.mcp__muted,
.mcp__hint {
    color: var(--c-text-muted);
    font-size: 0.875rem;
}

.mcp__hint {
    line-height: 1.4;
}

.mcp__dialog-hint {
    color: var(--c-text-muted);
    font-size: 0.9375rem;
    line-height: 1.45;
}

.mcp__problem,
.mcp__error {
    color: var(--c-danger-text);
    font-size: 0.875rem;
    line-height: 1.4;
}

.mcp__error {
    margin-block-start: var(--space-3);
    padding-inline: var(--space-2);
}

.mcp__buttons {
    display: flex;
    flex: none;
    gap: var(--space-2);
}

@media (max-width: 479px) {
    .mcp__row {
        flex-direction: column;
        align-items: stretch;
    }

    .mcp__buttons > * {
        flex: 1;
    }
}

@media (prefers-reduced-motion: reduce) {
    .mcp__row--fresh {
        animation: none;
        box-shadow: inset 3px 0 0 var(--c-accent);
    }
}
</style>
