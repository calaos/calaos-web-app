<script setup lang="ts">
// Files the box would refuse to restore from a backup, with why. Shown by the
// panel and, after a restore that changed the household login, by the sign-in page.

import { useI18n } from 'vue-i18n';
import type { UnrestorableFile } from '../../protocol/admin-config';

defineProps<{ files: UnrestorableFile[]; safety: boolean }>();

const { t, te } = useI18n();

function causeText(cause: string): string {
    return te(`admin.config.unrestorableCause.${cause}`)
        ? t(`admin.config.unrestorableCause.${cause}`)
        : t('admin.config.unrestorableCause.unknown');
}
</script>

<template>
    <div class="unrestorable fade-in" role="alert">
        <p>{{ t(safety ? 'admin.config.unrestorableSafety' : 'admin.config.unrestorableIntro') }}</p>
        <ul>
            <li v-for="(item, index) in files" :key="`${item.file}/${item.cause}/${index}`">
                <code>{{ item.file }}</code>{{ t('admin.config.unrestorableSeparator') }}{{ causeText(item.cause) }}
            </li>
        </ul>
    </div>
</template>

<style scoped>
.unrestorable {
    flex-basis: 100%;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--c-warn-border);
    border-radius: var(--radius-md);
    background-color: var(--c-warn-bg);
    color: var(--c-warn);
    font-size: 0.875rem;
    line-height: 1.45;
    overflow-wrap: anywhere;
}

.unrestorable ul {
    margin: var(--space-2) 0 0;
    padding-left: var(--space-5);
}

.unrestorable li + li {
    margin-top: var(--space-2);
}
</style>
