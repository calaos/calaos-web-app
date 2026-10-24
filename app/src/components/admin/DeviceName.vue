<script setup lang="ts">
// A phone's name as its owner (or its OS) wrote it: never trusted to keep
// to its place. Isolated so an RTL override cannot flip the sentence around
// it, and clamped so a long name cannot push the layout.

defineProps<{ name: string }>();
</script>

<template>
    <bdi class="device-name" :title="name">{{ name }}</bdi>
</template>

<style scoped>
.device-name {
    display: inline-block;
    max-inline-size: min(16rem, 100%);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: bottom;
    unicode-bidi: isolate;
}
</style>
