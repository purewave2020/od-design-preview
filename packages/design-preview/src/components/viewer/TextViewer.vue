<!-- Port of upstream FileViewer.tsx `TextViewer` (code / JSON with line numbers, reload, copy). -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { useFileText } from '../../composables/useFileText';
import { copyText } from '../../lib/util';
import { useT } from '../../locales';
import type { PreviewSource } from '../../sources/types';
import type { ProjectFile } from '../../types';
import Icon from '../../vendor/open-design/components/Icon.vue';
import CodeWithLines from './CodeWithLines.vue';

const props = defineProps<{ source: PreviewSource; file: ProjectFile; filesRefreshKey: number }>();
const t = useT();
const reloadKey = ref(0);
const copied = ref(false);
const { text } = useFileText(
  () => props.source,
  () => props.file,
  () => props.filesRefreshKey + reloadKey.value,
);

function isJsonFile(file: ProjectFile): boolean {
  return file.name.toLowerCase().endsWith('.json') || file.mime.toLowerCase().startsWith('application/json');
}

function formatForDisplay(file: ProjectFile, value: string): string {
  if (!isJsonFile(file)) return value;
  try {
    const parsed = JSON.parse(value) as unknown;
    // Keep the original bytes when re-serialising could change a number.
    const roundTrip = JSON.stringify(parsed);
    if (/\d{16,}|\d\.\d{15,}/.test(value) && roundTrip.length !== value.replace(/\s+/g, '').length) return value;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}

const displayText = computed(() => (text.value == null ? null : formatForDisplay(props.file, text.value)));
const lineCount = computed(() => (displayText.value ? displayText.value.split('\n').length : 0));

function copy() {
  if (text.value == null) return;
  void copyText(text.value).then((ok) => {
    if (!ok) return;
    copied.value = true;
    window.setTimeout(() => {
      copied.value = false;
    }, 1500);
  });
}
</script>

<template>
  <div class="viewer text-viewer">
    <div class="viewer-toolbar">
      <div class="viewer-toolbar-left" />
      <div class="viewer-toolbar-actions">
        <button
          type="button"
          class="viewer-action od-tooltip"
          :title="t('fileViewer.reloadDisk')"
          :data-tooltip="t('fileViewer.reloadDisk')"
          data-tooltip-placement="bottom"
          @click="reloadKey += 1"
        >
          <Icon name="reload" :size="13" />
          <span>{{ t('fileViewer.reload') }}</span>
        </button>
        <button
          type="button"
          class="viewer-action od-tooltip"
          :title="t('fileViewer.copyTitle')"
          :data-tooltip="t('fileViewer.copyTitle')"
          data-tooltip-placement="bottom"
          @click="copy"
        >
          <Icon :name="copied ? 'check' : 'copy'" :size="13" />
          <span>{{ copied ? t('fileViewer.copied') : t('fileViewer.copy') }}</span>
        </button>
      </div>
    </div>
    <div class="viewer-body">
      <div v-if="text === null" class="viewer-empty">{{ t('fileViewer.loading') }}</div>
      <CodeWithLines v-else-if="displayText !== null && lineCount > 0" :text="displayText" />
      <pre v-else class="viewer-source">{{ displayText }}</pre>
    </div>
  </div>
</template>
