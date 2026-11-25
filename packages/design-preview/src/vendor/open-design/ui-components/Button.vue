<!-- Ported to Vue from nexu-io/open-design packages/components/src/button.tsx (Apache-2.0). -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { buttonClassName, type ButtonSize, type ButtonVariant } from './button';

defineOptions({ name: 'OdButton' });

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariant;
    size?: ButtonSize;
    type?: 'button' | 'submit' | 'reset';
  }>(),
  { variant: 'default', size: 'default', type: 'button' },
);

const el = ref<HTMLButtonElement | null>(null);
const className = computed(() => buttonClassName(props.variant, props.size));
defineExpose({ el });
</script>

<template>
  <button ref="el" :type="type" :class="className"><slot /></button>
</template>
