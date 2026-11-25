<!-- Ported to Vue from nexu-io/open-design ManualEditPanel.tsx `DropdownRow` (Apache-2.0). -->
<script setup lang="ts">
import { computed } from 'vue';
import { dropdownOptionLabel, dropdownOptionValue, type DropdownOption } from './panel-model';

const props = defineProps<{
  label: string;
  value: string;
  options: ReadonlyArray<DropdownOption>;
  placeholder?: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ change: [value: string]; focus: [] }>();

const optionValues = computed(() => props.options.map(dropdownOptionValue));
</script>

<template>
  <label class="cc-row">
    <span class="cc-label">{{ label }}</span>
    <span class="cc-value cc-select">
      <select
        :value="value"
        :disabled="disabled"
        @focus="emit('focus')"
        @change="emit('change', ($event.target as HTMLSelectElement).value)"
      >
        <option v-if="!optionValues.includes(value) && value" :value="value">{{ value }}</option>
        <option v-for="opt in options" :key="dropdownOptionValue(opt) || '__'" :value="dropdownOptionValue(opt)">
          {{ dropdownOptionLabel(opt, placeholder) }}
        </option>
      </select>
      <em class="cc-chevron">▾</em>
    </span>
  </label>
</template>
