<!-- Port of upstream FileViewer.tsx `CodeWithLines`. -->
<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ text: string }>();
const gutter = computed(() =>
  props.text
    .split('\n')
    .map((_, i) => `${i + 1}`)
    .join('\n'),
);
</script>

<template>
  <pre class="code-viewer"><code class="gutter" aria-hidden="true">{{ gutter }}</code><code class="lines">{{ text }}</code></pre>
</template>
