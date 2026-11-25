<!-- Ported to Vue from nexu-io/open-design ManualEditPanel.tsx `PageInspector` (Apache-2.0). -->
<script setup lang="ts">
import { ref } from 'vue';
import { useT } from '../../shims/i18n';
import type { ManualEditStyles } from '../../edit-mode/types';
import ColorRow from './ColorRow.vue';
import EditSection from './EditSection.vue';
import FontRow from './FontRow.vue';
import UnitRow from './UnitRow.vue';

defineProps<{ enabled: boolean }>();
const emit = defineEmits<{ styleChange: [styles: Partial<ManualEditStyles>] }>();
const t = useT();

const bg = ref('');
const font = ref('');
const size = ref('');

function setBg(value: string) {
  bg.value = value;
  emit('styleChange', { backgroundColor: value });
}
function setFont(value: string) {
  font.value = value;
  emit('styleChange', { fontFamily: value });
}
function setSize(value: string) {
  size.value = value;
  emit('styleChange', { fontSize: value });
}
</script>

<template>
  <div class="cc-inspector">
    <EditSection :title="t('manualEdit.sectionPage')">
      <template v-if="enabled">
        <ColorRow :label="t('manualEdit.pageBackground')" :value="bg" @change="setBg" />
        <FontRow :label="t('manualEdit.fontFamily')" :value="font" @change="setFont" />
        <UnitRow :label="t('manualEdit.pageBaseSize')" :value="size" unit="px" auto-unit @change="setSize" />
      </template>
      <p v-else class="cc-section-hint">{{ t('manualEdit.pageStylesHtmlOnly') }}</p>
    </EditSection>
  </div>
</template>
