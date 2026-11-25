<!-- Ported to Vue from nexu-io/open-design packages/components/src/form-controls.tsx (Apache-2.0). -->
<script setup lang="ts">
import { ref } from 'vue';
import { joinClassNames } from './class-names';
import styles from './form-controls.module.css';

defineOptions({ name: 'OdTextarea' });

const model = defineModel<string>({ default: '' });
const el = ref<HTMLTextAreaElement | null>(null);
const className = joinClassNames(styles.control, styles.textarea);
defineExpose({ el, focus: () => el.value?.focus() });
</script>

<template>
  <textarea ref="el" v-model="model" :class="className" />
</template>
