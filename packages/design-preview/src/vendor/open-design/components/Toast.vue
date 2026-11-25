<!--
  Ported to Vue from nexu-io/open-design apps/web/src/components/Toast.tsx (Apache-2.0).
  A local toast (`.od-toast`) with optional details, action, code body and
  auto-dismiss; animation is owned by CSS (`od-toast-in` / `.leaving`).
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useT } from '../shims/i18n';
import Icon from './Icon.vue';
import { usePreviewScope } from '../../../theme';

const scope = usePreviewScope();

const props = withDefaults(
  defineProps<{
    message: string;
    className?: string;
    details?: string | null;
    actionLabel?: string | null;
    actionAriaLabel?: string;
    onAction?: () => void;
    /** Code body: pins the toast open (no auto-dismiss) so it can be copied. */
    code?: string | null;
    ttlMs?: number;
    onDismiss?: () => void;
    role?: 'status' | 'alert';
    tone?: 'default' | 'success' | 'error' | 'loading';
    placement?: 'bottom' | 'top';
    /** Escape ancestor stacking contexts by rendering into <body>. */
    portalToBody?: boolean;
    topOffsetPx?: number;
  }>(),
  {
    className: undefined,
    details: null,
    actionLabel: null,
    actionAriaLabel: undefined,
    onAction: undefined,
    code: null,
    ttlMs: 4000,
    onDismiss: undefined,
    role: 'status',
    tone: 'default',
    placement: 'bottom',
    portalToBody: false,
    topOffsetPx: undefined,
  },
);

// Exit fade duration — kept in sync with the .od-toast.leaving CSS animation.
const EXIT_MS = 160;
const TONE_ICON = { default: null, success: 'check', error: 'alert-triangle', loading: 'spinner' } as const;

const t = useT();
const leaving = ref(false);
const effectiveTtl = computed(() => (props.code ? 0 : props.ttlMs));
const hasDismiss = computed(() => Boolean(props.onDismiss));
const iconName = computed(() => TONE_ICON[props.tone]);

// Re-arm only on the values that should (message / details / code / ttl), so
// parent re-renders never push the deadline forward.
watch(
  [() => props.message, () => props.details, () => props.code, effectiveTtl, hasDismiss],
  (_values, _prev, onCleanup) => {
    leaving.value = false;
    const ttl = effectiveTtl.value;
    if (!hasDismiss.value || !Number.isFinite(ttl) || ttl <= 0) return;
    const fadeId = window.setTimeout(() => {
      leaving.value = true;
    }, Math.max(0, ttl - EXIT_MS));
    const dismissId = window.setTimeout(() => props.onDismiss?.(), ttl);
    onCleanup(() => {
      window.clearTimeout(fadeId);
      window.clearTimeout(dismissId);
    });
  },
  { immediate: true },
);
</script>

<template>
  <Teleport to="body" :disabled="!portalToBody">
    <div
      v-bind="portalToBody ? scope : {}"
      :class="['od-toast', `tone-${tone}`, `placement-${placement}`, className, { leaving }]"
      :role="role"
      :aria-live="role === 'alert' ? 'assertive' : 'polite'"
      :style="placement === 'top' && topOffsetPx ? { top: `calc(64px + ${topOffsetPx}px)` } : undefined"
    >
      <div class="od-toast-body">
        <span v-if="iconName" class="od-toast-icon" aria-hidden="true">
          <Icon :name="iconName" :size="14" />
        </span>
        <div class="od-toast-message">{{ message }}</div>
      </div>
      <div v-if="details" class="od-toast-details">{{ details }}</div>
      <pre v-if="code" class="od-toast-code">{{ code }}</pre>
      <button
        v-if="actionLabel && onAction"
        type="button"
        class="od-toast-action"
        :aria-label="actionAriaLabel ?? actionLabel"
        @click="onAction()"
      >
        {{ actionLabel }}
      </button>
      <button v-if="!code && onDismiss" type="button" class="od-toast-close" :aria-label="t('common.dismiss')" @click="onDismiss()">
        <Icon name="close" :size="13" />
      </button>
      <button v-if="code && onDismiss" type="button" class="od-toast-dismiss" :aria-label="t('common.dismiss')" @click="onDismiss()">
        {{ t('common.dismiss') }}
      </button>
    </div>
  </Teleport>
</template>
