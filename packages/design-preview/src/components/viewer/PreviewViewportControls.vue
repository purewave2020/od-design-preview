<!-- Port of upstream FileViewer.tsx `PreviewViewportControls` (Desktop / Tablet / Mobile). -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { useDismiss } from '../../composables/hooks';
import { uniqueId } from '../../lib/util';
import type { TranslateFn } from '../../locales';
import type { PreviewViewportId } from '../../types';
import Icon from '../../vendor/open-design/components/Icon.vue';
import RemixIcon from '../../vendor/open-design/components/RemixIcon.vue';
import { PREVIEW_VIEWPORT_PRESETS, previewViewportIcon } from '../../viewer/preview-geometry';

const props = defineProps<{ viewport: PreviewViewportId; t: TranslateFn }>();
const emit = defineEmits<{ viewport: [viewport: PreviewViewportId] }>();

const open = ref(false);
const menuRef = ref<HTMLDivElement | null>(null);
const listboxId = uniqueId('odp-viewport');
const activePreset = computed(() => PREVIEW_VIEWPORT_PRESETS.find((preset) => preset.id === props.viewport) ?? PREVIEW_VIEWPORT_PRESETS[0]!);
useDismiss(open, menuRef, () => {
  open.value = false;
});

function choose(id: PreviewViewportId) {
  emit('viewport', id);
  open.value = false;
}
</script>

<template>
  <div ref="menuRef" class="viewer-viewport-switcher">
    <button
      type="button"
      :class="['viewer-action', 'viewer-viewport-trigger', { 'od-tooltip': !open }]"
      :aria-label="t('fileViewer.viewportAria')"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="open ? listboxId : undefined"
      :title="t(activePreset.titleKey)"
      :data-tooltip="open ? undefined : t(activePreset.titleKey)"
      data-tooltip-placement="bottom"
      data-testid="viewport-trigger"
      @click="open = !open"
    >
      <RemixIcon :name="previewViewportIcon(activePreset.id)" :size="14" class="viewer-viewport-icon" />
      <span>{{ t(activePreset.labelKey) }}</span>
      <RemixIcon name="arrow-down-s-line" :size="14" />
    </button>
    <div v-if="open" :id="listboxId" class="viewer-viewport-menu" role="listbox" :aria-label="t('fileViewer.viewportAria')">
      <button
        v-for="preset in PREVIEW_VIEWPORT_PRESETS"
        :key="preset.id"
        type="button"
        :class="['viewer-viewport-menu-item', { active: viewport === preset.id }]"
        role="option"
        :aria-selected="viewport === preset.id"
        :title="t(preset.titleKey)"
        :data-testid="`viewport-option-${preset.id}`"
        @click="choose(preset.id)"
      >
        <span class="viewer-viewport-menu-label">
          <RemixIcon :name="previewViewportIcon(preset.id)" :size="14" />
          <span>{{ t(preset.labelKey) }}</span>
        </span>
        <Icon v-if="viewport === preset.id" name="check" :size="13" />
      </button>
    </div>
  </div>
</template>
