<!--
  Key remaps for the vendored surfaces below it (read by vendor/open-design/shims/i18n):
  lets this library relabel an upstream control — e.g. the Mark tool's chat
  "Send" → "Save as comment" — without editing the ported component.
-->
<script setup lang="ts">
import { provideTranslationScope } from '../../locales';

const props = defineProps<{ remap: Record<string, string> }>();
provideTranslationScope(props.remap);
</script>

<template>
  <slot />
</template>
