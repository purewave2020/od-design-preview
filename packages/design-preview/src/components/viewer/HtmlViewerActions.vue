<!--
  The HTML viewer's header actions (Present / Export), teleported into the
  tab strip like upstream (`.ws-tabs-file-actions`), or rendered inline in
  embed / host-less mode.
-->
<script setup lang="ts">
import { ref } from 'vue';
import type { TranslateFn } from '../../locales';
import RemixIcon from '../../vendor/open-design/components/RemixIcon.vue';
import type { ExportFormat } from '../../viewer/sandbox';
import AnchoredPopover from '../ui/AnchoredPopover.vue';

defineProps<{
  t: TranslateFn;
  hasContent: boolean;
  hasSource: boolean;
  isDeck: boolean;
  fileUrl: string;
  downloadName: string;
}>();
const emit = defineEmits<{
  present: [kind: 'tab' | 'fullscreen'];
  presentNewTab: [];
  export: [format: ExportFormat];
  copySource: [];
}>();

const presentMenuOpen = ref(false);
const exportMenuOpen = ref(false);
const presentTriggerRef = ref<HTMLButtonElement | null>(null);
const exportTriggerRef = ref<HTMLButtonElement | null>(null);

function present(kind: 'tab' | 'fullscreen') {
  presentMenuOpen.value = false;
  emit('present', kind);
}
function presentNewTab() {
  presentMenuOpen.value = false;
  emit('presentNewTab');
}
function runExport(format: ExportFormat) {
  exportMenuOpen.value = false;
  emit('export', format);
}
function copySource() {
  exportMenuOpen.value = false;
  emit('copySource');
}
</script>

<template>
  <div class="present-wrap chrome-present-wrap">
    <button
      ref="presentTriggerRef"
      type="button"
      class="chrome-action chrome-action-secondary chrome-action-icon present-trigger od-tooltip"
      aria-haspopup="menu"
      :aria-expanded="presentMenuOpen"
      :aria-label="t('fileViewer.present')"
      :data-tooltip="t('fileViewer.present')"
      data-tooltip-placement="bottom"
      :title="t('fileViewer.present')"
      data-testid="present-trigger"
      :disabled="!hasContent"
      @click="presentMenuOpen = !presentMenuOpen"
    >
      <RemixIcon name="slideshow-3-line" :size="15" />
    </button>
    <AnchoredPopover :anchor="presentTriggerRef" :open="presentMenuOpen" class-name="present-menu odp-floating-menu" @close="presentMenuOpen = false">
      <button role="menuitem" data-testid="present-in-tab" @click="present('tab')">
        <span class="present-icon"><RemixIcon name="eye-line" :size="14" /></span>
        <span class="present-menu-copy">
          <span>{{ t('fileViewer.presentInTab') }}</span>
          <small v-if="isDeck">{{ t('fileViewer.presentInTabDeckHint') }}</small>
        </span>
      </button>
      <button role="menuitem" data-testid="present-fullscreen" @click="present('fullscreen')">
        <span class="present-icon"><RemixIcon name="play-line" :size="14" /></span>
        {{ t('fileViewer.presentFullscreen') }}
      </button>
      <button role="menuitem" data-testid="present-new-tab" @click="presentNewTab">
        <span class="present-icon"><RemixIcon name="share-forward-line" :size="14" /></span>
        {{ t('fileViewer.presentNewTab') }}
      </button>
    </AnchoredPopover>
  </div>
  <div class="chrome-file-action-menus">
    <div class="share-menu chrome-share-menu chrome-share-menu--unified">
      <button
        ref="exportTriggerRef"
        type="button"
        class="chrome-action chrome-action-secondary chrome-action-with-label chrome-action-text-only chrome-action-unified"
        aria-haspopup="menu"
        :aria-expanded="exportMenuOpen"
        :aria-label="t('fileViewer.unifiedExportTab')"
        data-testid="export-trigger"
        :disabled="!hasContent"
        @click="exportMenuOpen = !exportMenuOpen"
      >
        <RemixIcon name="download-line" :size="15" />
        <span>{{ t('fileViewer.unifiedExportTab') }}</span>
      </button>
      <AnchoredPopover
        :anchor="exportTriggerRef"
        :open="exportMenuOpen"
        class-name="share-menu-popover chrome-unified-popover odp-floating-menu"
        @close="exportMenuOpen = false"
      >
        <div class="chrome-unified-panel">
          <button type="button" class="share-menu-item" role="menuitem" @click="runExport('pdf')">
            <span class="share-menu-icon"><RemixIcon name="file-line" :size="15" /></span>
            <span>{{ t('fileViewer.exportPdf') }}</span>
          </button>
          <button type="button" class="share-menu-item" role="menuitem" @click="runExport('image')">
            <span class="share-menu-icon"><RemixIcon name="image-line" :size="15" /></span>
            <span>{{ t('fileViewer.exportImage') }}</span>
          </button>
          <button type="button" class="share-menu-item" role="menuitem" @click="runExport('zip')">
            <span class="share-menu-icon"><RemixIcon name="file-zip-line" :size="15" /></span>
            <span>{{ t('fileViewer.exportZip') }}</span>
          </button>
          <button type="button" class="share-menu-item" role="menuitem" @click="runExport('html')">
            <span class="share-menu-icon"><RemixIcon name="file-code-line" :size="15" /></span>
            <span>{{ t('fileViewer.exportHtml') }}</span>
          </button>
          <a class="share-menu-item" role="menuitem" :href="fileUrl" :download="downloadName" @click="exportMenuOpen = false">
            <span class="share-menu-icon"><RemixIcon name="download-line" :size="15" /></span>
            <span>{{ t('app.downloadOriginal') }}</span>
          </a>
          <button type="button" class="share-menu-item" role="menuitem" :disabled="!hasSource" @click="copySource">
            <span class="share-menu-icon"><RemixIcon name="file-copy-line" :size="15" /></span>
            <span>{{ t('app.copySource') }}</span>
          </button>
        </div>
      </AnchoredPopover>
    </div>
  </div>
</template>
