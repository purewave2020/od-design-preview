<!-- Same markup / classes as upstream components/Toast.tsx (`.od-toast`). -->
<script setup lang="ts">
import { computed } from 'vue';
import Icon from '../../vendor/open-design/components/Icon.vue';
import type { IconName } from '../../vendor/open-design/components/Icon';
import { currentToast, toastLeaving, type ToastTone } from '../../ui/toast';
import { usePreviewScope } from '../../theme';

const scope = usePreviewScope();

const TONE_ICON: Partial<Record<ToastTone, IconName>> = {
  success: 'check',
  error: 'alert-triangle',
  loading: 'spinner',
};

const iconName = computed(() => (currentToast.value ? TONE_ICON[currentToast.value.tone] : undefined));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="currentToast"
      v-bind="scope"
      :key="currentToast.id"
      :class="['od-toast', `tone-${currentToast.tone}`, 'placement-bottom', { leaving: toastLeaving }]"
      :role="currentToast.tone === 'error' ? 'alert' : 'status'"
      :aria-live="currentToast.tone === 'error' ? 'assertive' : 'polite'"
    >
      <div class="od-toast-body">
        <span v-if="iconName" class="od-toast-icon" aria-hidden="true">
          <Icon :name="iconName" :size="14" />
        </span>
        <div class="od-toast-message">{{ currentToast.message }}</div>
      </div>
    </div>
  </Teleport>
</template>
