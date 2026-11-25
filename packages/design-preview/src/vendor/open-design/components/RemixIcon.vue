<!--
  Ported to Vue from nexu-io/open-design apps/web/src/components/RemixIcon.tsx (Apache-2.0).
  Remix Icon glyphs rendered as inline SVG (no icon font: packaged od:// documents
  cannot load url() fonts). Unknown names render an empty placeholder of the same footprint.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { REMIX_ICON_PATHS } from './remix-icon-paths';

defineOptions({ name: 'OdRemixIcon' });

const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 14 });
const d = computed(() => REMIX_ICON_PATHS[props.name]);
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
    style="display: inline-block; vertical-align: middle; flex-shrink: 0"
  >
    <path v-if="d" :d="d" />
  </svg>
</template>
