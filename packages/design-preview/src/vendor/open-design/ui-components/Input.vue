<!-- Ported to Vue from nexu-io/open-design packages/components/src/form-controls.tsx (Apache-2.0). -->
<script setup lang="ts">
import { ref } from 'vue';
import styles from './form-controls.module.css';

defineOptions({ name: 'OdInput' });

const model = defineModel<string | number>({ default: '' });
const el = ref<HTMLInputElement | null>(null);
defineExpose({ el, focus: () => el.value?.focus() });
</script>

<template>
  <input ref="el" v-model="model" :class="styles.control" />
</template>
