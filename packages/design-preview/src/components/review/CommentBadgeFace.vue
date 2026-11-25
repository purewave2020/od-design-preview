<!-- Avatar / pin face: the author's initial when the comment carries a name, else its pin number. -->
<script setup lang="ts">
import { computed } from 'vue';
import { commentAuthorInitials } from '../../review/comment-utils';
import type { PreviewComment } from '../../vendor/open-design/contracts/api/comments';

const props = defineProps<{ comment: PreviewComment; number: number }>();
const face = computed(() => {
  const name = props.comment.authorDisplayName?.trim();
  return name ? commentAuthorInitials(name) : String(props.number);
});
</script>

<template>{{ face }}</template>
