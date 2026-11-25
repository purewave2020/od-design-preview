<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue';
import Icon from '../../vendor/open-design/components/Icon.vue';

const props = defineProps<{ src: string; title: string }>();
const emit = defineEmits<{ open: [] }>();

const imageRef = ref<HTMLImageElement | null>(null);
const settled = shallowRef<{ src: string; status: 'loaded' | 'error' } | null>(null);
const status = computed(() => (settled.value?.src === props.src ? settled.value.status : 'loading'));

watch(
  () => props.src,
  async (src) => {
    await nextTick();
    const image = imageRef.value;
    if (!image?.complete) return;
    settled.value = { src, status: image.naturalWidth > 0 ? 'loaded' : 'error' };
  },
  { immediate: true },
);
</script>

<template>
  <button type="button" class="df-card-thumb" :data-image-status="status" :title="title" :aria-label="title" @click="emit('open')">
    <span v-if="status === 'loading'" class="df-image-skeleton" aria-hidden="true" />
    <span v-if="status === 'error'" class="df-image-error" aria-hidden="true">
      <Icon name="image" :size="24" />
    </span>
    <img
      ref="imageRef"
      :src="src"
      alt=""
      loading="lazy"
      :data-loaded="status === 'loaded' ? 'true' : 'false'"
      @load="settled = { src, status: 'loaded' }"
      @error="settled = { src, status: 'error' }"
    />
  </button>
</template>
