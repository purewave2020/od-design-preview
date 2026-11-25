<!-- Ported to Vue from nexu-io/open-design ManualEditPanel.tsx `Section` (Apache-2.0). -->
<script setup lang="ts">
defineProps<{ title: string; inactive?: boolean }>();
</script>

<template>
  <section :class="['cc-section', { 'cc-section-inactive': inactive }]">
    <header class="cc-section-head">{{ title }}</header>
    <div class="cc-section-body"><slot /></div>
  </section>
</template>
