<!-- One closable file tab of the `ws-tabs-shell` strip (upstream FileWorkspace tab markup). -->
<script setup lang="ts">
import { computed } from 'vue';
import type { ProjectFileKind } from '../../types';
import Icon from '../../vendor/open-design/components/Icon.vue';
import type { IconName } from '../../vendor/open-design/components/Icon';

const props = defineProps<{
  label: string;
  title: string;
  active: boolean;
  kind?: ProjectFileKind;
  closeLabel: string;
}>();
const emit = defineEmits<{ activate: []; close: [] }>();

function kindIconName(kind: ProjectFileKind | undefined, name?: string): IconName {
  if (name?.endsWith('.sketch.json')) return 'pencil';
  switch (kind) {
    case 'html':
      return 'file-code';
    case 'image':
    case 'sketch':
      return 'image';
    case 'video':
      return 'video-ai';
    case 'audio':
      return 'volume';
    case 'text':
      return 'file-text';
    case 'code':
      return 'file-code';
    case 'presentation':
      return 'slides';
    default:
      return 'file';
  }
}

const icon = computed(() => kindIconName(props.kind, props.title));

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    emit('activate');
  }
}
function onAuxClick(event: MouseEvent) {
  if (event.button === 1) {
    event.preventDefault();
    emit('close');
  }
}
</script>

<template>
  <div
    :class="['ws-tab', 'od-tooltip', { active }]"
    role="tab"
    :aria-selected="active"
    tabindex="0"
    :title="title"
    :data-tooltip="title"
    data-tooltip-placement="bottom"
    :data-testid="`ws-tab-${title}`"
    @click="emit('activate')"
    @keydown="onKeydown"
    @auxclick="onAuxClick"
  >
    <span class="tab-icon" aria-hidden="true">
      <Icon :name="icon" :size="13" />
    </span>
    <span class="ws-tab-text">
      <span class="ws-tab-label">{{ label }}</span>
    </span>
    <button
      type="button"
      class="ws-tab-close od-tooltip"
      :title="closeLabel"
      :data-tooltip="closeLabel"
      data-tooltip-placement="bottom"
      :aria-label="closeLabel"
      @click.stop="emit('close')"
    >
      <Icon name="close" :size="11" />
    </button>
  </div>
</template>
