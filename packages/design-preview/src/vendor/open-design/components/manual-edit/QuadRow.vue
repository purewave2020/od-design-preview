<!-- Ported to Vue from nexu-io/open-design ManualEditPanel.tsx `QuadRow` + `QuadCell` (Apache-2.0). -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { formatSteppedNumber, isNumericInput, stripPxUnit, type QuadSide } from './panel-model';

type Quad = { t: string; r: string; b: string; l: string };

const props = defineProps<{ label: string; values: Quad; axes?: Quad }>();
const emit = defineEmits<{ change: [side: QuadSide, value: string]; focus: [] }>();

const open = ref(true);
const sides: QuadSide[] = ['t', 'r', 'b', 'l'];
const allEqualValue = computed(() => {
  const v = props.values.t;
  return v === props.values.r && v === props.values.b && v === props.values.l ? v : null;
});

function axisLabel(side: QuadSide): string {
  return props.axes?.[side] ?? side.toUpperCase();
}
function display(side: QuadSide): string {
  return stripPxUnit(props.values[side]);
}
function stepBy(side: QuadSide, direction: -1 | 1) {
  const current = display(side);
  if (!isNumericInput(current)) return;
  emit('change', side, `${formatSteppedNumber(Number(current) + direction, current, 1)}px`);
}
function onInput(side: QuadSide, event: Event) {
  const rawValue = (event.target as HTMLInputElement).value;
  const raw = rawValue.trim();
  if (raw === '') emit('change', side, '');
  else if (isNumericInput(raw)) emit('change', side, `${raw}px`);
  else if (/^-?\d+(\.\d+)?px$/i.test(raw)) emit('change', side, raw.toLowerCase());
  else emit('change', side, rawValue);
}
function onBlur(side: QuadSide, event: Event) {
  const rawValue = (event.target as HTMLInputElement).value;
  const v = rawValue.trim();
  const next = v && isNumericInput(v) ? `${v}px` : rawValue;
  if (next !== props.values[side]) emit('change', side, next);
}
</script>

<template>
  <!-- focusin bubbles, so any focused cell input activates the row. -->
  <div class="cc-quad" @focusin="emit('focus')">
    <button type="button" class="cc-quad-head" @click="open = !open">
      <span>{{ label }}</span>
      <em v-if="!open && allEqualValue !== null">{{ stripPxUnit(allEqualValue) || '0' }}</em>
      <span v-else class="cc-chevron-small">{{ open ? '▾' : '▸' }}</span>
    </button>
    <div v-if="open" class="cc-quad-grid">
      <span v-for="side in sides" :key="side" class="cc-quad-cell">
        <em class="cc-quad-axis">{{ axisLabel(side) }}</em>
        <button
          type="button"
          class="cc-step cc-step-quad"
          :disabled="!isNumericInput(display(side))"
          :aria-label="`${axisLabel(side)} decrease`"
          @click="stepBy(side, -1)"
        >
          −
        </button>
        <input :value="display(side)" placeholder="0" @input="onInput(side, $event)" @blur="onBlur(side, $event)" />
        <button
          type="button"
          class="cc-step cc-step-quad"
          :disabled="!isNumericInput(display(side))"
          :aria-label="`${axisLabel(side)} increase`"
          @click="stepBy(side, 1)"
        >
          +
        </button>
      </span>
    </div>
  </div>
</template>
