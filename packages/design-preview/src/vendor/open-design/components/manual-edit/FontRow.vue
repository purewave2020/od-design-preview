<!-- Ported to Vue from nexu-io/open-design ManualEditPanel.tsx `FontRow` (Apache-2.0). -->
<script setup lang="ts">
import { computed } from 'vue';
import { FONT_OPTS, fontFamilyLabel, normalizeFontFamilyForSelect } from './panel-model';

const props = defineProps<{ label: string; value: string; placeholder?: string }>();
const emit = defineEmits<{ change: [value: string]; focus: [] }>();

const normalizedValue = computed(() => normalizeFontFamilyForSelect(props.value));
const customValue = computed(() => (normalizedValue.value === props.value ? props.value : ''));
const showCustom = computed(() => Boolean(customValue.value) && !FONT_OPTS.some((option) => option.value === customValue.value));
</script>

<template>
  <label class="cc-row">
    <span class="cc-label">{{ label }}</span>
    <span class="cc-value cc-select">
      <select :value="normalizedValue" @focus="emit('focus')" @change="emit('change', ($event.target as HTMLSelectElement).value)">
        <option v-if="!normalizedValue && placeholder" value="">{{ fontFamilyLabel(placeholder) }}</option>
        <option v-if="showCustom" :value="customValue">{{ fontFamilyLabel(customValue) }}</option>
        <option v-for="option in FONT_OPTS" :key="option.label" :value="option.value">{{ option.label }}</option>
      </select>
      <em class="cc-chevron">▾</em>
    </span>
  </label>
</template>
