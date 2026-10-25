<script setup lang="ts">
// The box's network interfaces, and a change applied as a trial that the
// user confirms, from the new address if it moved.

import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
    <div class="network-view">
        <h1 class="visually-hidden">{{ t('admin.network.title') }}</h1>
    </div>
</template>
