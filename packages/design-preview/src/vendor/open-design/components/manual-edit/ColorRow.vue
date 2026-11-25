<!-- Ported to Vue from nexu-io/open-design ManualEditPanel.tsx `ColorRow` (Apache-2.0). -->
<script setup lang="ts">
import { ref, watch } from 'vue';
import { EDITOR_SWATCH_COLORS, normalizeColorForPicker } from './panel-model';

defineProps<{ label: string; value: string; placeholder?: string; compact?: boolean }>();
const emit = defineEmits<{ change: [value: string]; focus: [] }>();

const open = ref(false);
const rootRef = ref<HTMLSpanElement | null>(null);

watch(open, (isOpen, _prev, onCleanup) => {
  if (!isOpen) return;
  const onDocClick = (event: MouseEvent) => {
    if (!rootRef.value) return;
    if (rootRef.value.contains(event.target as Node)) return;
    open.value = false;
  };
  document.addEventListener('mousedown', onDocClick);
  onCleanup(() => document.removeEventListener('mousedown', onDocClick));
});

function pick(hex: string) {
  emit('change', hex);
  open.value = false;
}
function onInputFocus() {
  open.value = true;
  emit('focus');
}
</script>

<template>
  <label class="cc-row">
    <span v-if="!compact" class="cc-label">{{ label }}</span>
    <span ref="rootRef" :class="['cc-value', 'cc-color', compact ? 'cc-color-compact' : '']">
      <button type="button" class="cc-swatch" :style="{ background: value || 'transparent' }" :aria-label="`Pick ${label}`" @click="open = !open" />
      <input
        :value="value"
        :placeholder="placeholder || '#000000'"
        @input="emit('change', ($event.target as HTMLInputElement).value)"
        @focus="onInputFocus"
      />
      <div v-if="open" class="cc-color-popover">
        <div class="cc-color-grid">
          <button
            v-for="hex in EDITOR_SWATCH_COLORS"
            :key="hex"
            type="button"
            class="cc-color-tile"
            :style="{ background: hex }"
            :aria-label="hex"
            @click="pick(hex)"
          />
        </div>
        <input
          type="color"
          class="cc-color-native"
          :value="normalizeColorForPicker(value)"
          @input="emit('change', ($event.target as HTMLInputElement).value)"
        />
      </div>
    </span>
  </label>
</template>
