<!-- Ported to Vue from nexu-io/open-design ManualEditPanel.tsx `UnitRow` (Apache-2.0). -->
<script setup lang="ts">
import { computed } from 'vue';
import { formatSteppedNumber, isNumericInput, stripPxUnit } from './panel-model';

const props = defineProps<{
  label: string;
  value: string;
  unit: string;
  autoUnit?: boolean;
  disabled?: boolean;
  placeholder?: string;
}>();
const emit = defineEmits<{ change: [value: string]; focus: [] }>();

const display = computed(() => (props.unit === 'px' ? stripPxUnit(props.value) : props.value));
const step = computed(() => (props.unit === 'px' ? 1 : 0.1));
const canStep = computed(() => !props.disabled && isNumericInput(display.value));

function valueFromDisplay(raw: string): string {
  const trimmed = raw.trim();
  if (props.autoUnit && trimmed && isNumericInput(trimmed)) return `${trimmed}px`;
  if (props.autoUnit && /^-?\d+(\.\d+)?px$/i.test(trimmed)) return trimmed.toLowerCase();
  return raw;
}
function handle(raw: string) {
  const next = valueFromDisplay(raw);
  if (next !== props.value) emit('change', next);
}
function stepBy(direction: -1 | 1) {
  if (!canStep.value) return;
  const next = formatSteppedNumber(Number(display.value) + direction * step.value, display.value, step.value);
  emit('change', valueFromDisplay(next));
}
</script>

<template>
  <label class="cc-row">
    <span class="cc-label">{{ label }}</span>
    <span class="cc-value">
      <button type="button" class="cc-step" :disabled="!canStep" :aria-label="`${label} decrease`" @click="stepBy(-1)">−</button>
      <input
        :value="display"
        :placeholder="placeholder ? stripPxUnit(placeholder) : ''"
        :disabled="disabled"
        @focus="emit('focus')"
        @input="emit('change', valueFromDisplay(($event.target as HTMLInputElement).value))"
        @blur="handle(($event.target as HTMLInputElement).value)"
      />
      <button type="button" class="cc-step" :disabled="!canStep" :aria-label="`${label} increase`" @click="stepBy(1)">+</button>
      <!-- px is implied for length fields; any non-px unit still renders. -->
      <em v-if="unit && unit !== 'px'" class="cc-unit">{{ unit }}</em>
    </span>
  </label>
</template>
