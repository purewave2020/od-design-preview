<!-- Ported to Vue from nexu-io/open-design ManualEditPanel.tsx `ContentInspector` (Apache-2.0). -->
<script setup lang="ts">
import { useT } from '../../shims/i18n';
import type { ManualEditTarget } from '../../edit-mode/types';
import EditSection from './EditSection.vue';
import type { ManualEditDraft } from './panel-model';

const props = defineProps<{ target: ManualEditTarget; draft: ManualEditDraft }>();
const emit = defineEmits<{ draftChange: [draft: ManualEditDraft] }>();
const t = useT();

function update(patch: Partial<ManualEditDraft>) {
  emit('draftChange', { ...props.draft, ...patch });
}
function value(event: Event): string {
  return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
}
</script>

<template>
  <div class="cc-inspector manual-edit-content-inspector">
    <EditSection :title="t('manualEdit.sectionContent')">
      <template v-if="target.kind === 'image'">
        <label class="manual-edit-field compact">
          <span>{{ t('manualEdit.imageUrl') }}</span>
          <input :value="draft.src" @input="update({ src: value($event) })" />
        </label>
        <label class="manual-edit-field compact">
          <span>{{ t('manualEdit.altText') }}</span>
          <input :value="draft.alt" @input="update({ alt: value($event) })" />
        </label>
      </template>
      <template v-else-if="target.kind === 'link'">
        <label class="manual-edit-field">
          <span>{{ t('manualEdit.text') }}</span>
          <textarea :value="draft.text" rows="3" @input="update({ text: value($event) })" />
        </label>
        <label class="manual-edit-field compact">
          <span>{{ t('manualEdit.href') }}</span>
          <input :value="draft.href" @input="update({ href: value($event) })" />
        </label>
      </template>
      <label v-else-if="target.kind === 'text' || target.kind === 'token'" class="manual-edit-field">
        <span>{{ t('manualEdit.text') }}</span>
        <textarea :value="draft.text" rows="4" @input="update({ text: value($event) })" />
      </label>
      <label v-else class="manual-edit-field">
        <span>{{ t('manualEdit.selectedHtml') }}</span>
        <textarea class="manual-edit-code" :value="draft.outerHtml" @input="update({ outerHtml: value($event) })" />
      </label>
    </EditSection>
  </div>
</template>
