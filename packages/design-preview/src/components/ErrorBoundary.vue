<!--
  Last line of defence. Without a boundary, one render error can leave a
  blank surface; with it the host shows what broke and a way back, and
  isolated layers (the shared tooltip) fail on their own.

  <ErrorBoundary name="app">
    <App />
    <template #fallback="{ error, reset }"><CrashScreen :error="error" @retry="reset" /></template>
  </ErrorBoundary>
-->
<script setup lang="ts">
import { onErrorCaptured, shallowRef } from 'vue';

const props = defineProps<{ name: string }>();
defineSlots<{
  default?: () => unknown;
  fallback?: (scope: { error: Error; reset: () => void }) => unknown;
}>();

const error = shallowRef<Error | null>(null);
const reset = () => {
  error.value = null;
};

onErrorCaptured((err, _instance, info) => {
  error.value = err instanceof Error ? err : new Error(String(err));
  console.error(`[od-design-preview] ${props.name} crashed`, err, info);
  // Handled here: do not propagate to app.config.errorHandler / parents.
  return false;
});
</script>

<template>
  <slot v-if="!error" />
  <slot v-else name="fallback" :error="error" :reset="reset" />
</template>
