<!--
  Mount once around the part of the host app that shows preview components:
  renders the shared toast and the vendored tooltip layer (each isolated so a
  glitch in either never takes the page down).

  <DesignPreviewProvider>
    <PreviewWorkspace :source="source" />
  </DesignPreviewProvider>
-->
<script setup lang="ts">
import TooltipLayer from '../vendor/open-design/components/TooltipLayer.vue';
import ErrorBoundary from './ErrorBoundary.vue';
import ToastHost from './ui/ToastHost.vue';
</script>

<template>
  <slot />
  <ToastHost />
  <ErrorBoundary name="tooltip-layer">
    <TooltipLayer />
  </ErrorBoundary>
</template>
