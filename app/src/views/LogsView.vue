<script setup lang="ts">
// The box's journal: filters, paging by cursor and follow.

import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
    <div class="logs-view">
        <h1 class="visually-hidden">{{ t('admin.logs.title') }}</h1>
    </div>
</template>
