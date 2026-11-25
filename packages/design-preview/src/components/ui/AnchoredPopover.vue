<!--
  A popover teleported to <body> and pinned under its anchor, so menus opened
  from the tab strip / toolbar are never clipped by the workspace panes
  (upstream's AnchoredMenuShell solves the same problem).
-->
<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, shallowRef, toRef, watch } from 'vue';
import { useDismiss } from '../../composables/hooks';
import { usePreviewScope } from '../../theme';

const props = withDefaults(
  defineProps<{
    anchor: HTMLElement | null | undefined;
    open: boolean;
    className?: string;
    align?: 'start' | 'end';
    role?: string;
  }>(),
  { className: undefined, align: 'end', role: 'menu' },
);
const emit = defineEmits<{ close: [] }>();

const scope = usePreviewScope();
const el = ref<HTMLDivElement | null>(null);
const anchorRef = toRef(props, 'anchor');
const pos = shallowRef<{ top: number; left: number } | null>(null);

useDismiss(() => props.open, el, () => emit('close'), anchorRef);

function place() {
  const a = props.anchor?.getBoundingClientRect();
  const node = el.value;
  if (!a || !node) return;
  const width = node.offsetWidth;
  const height = node.offsetHeight;
  let left = props.align === 'end' ? a.right - width : a.left;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  let top = a.bottom + 6;
  if (top + height > window.innerHeight - 8 && a.top - height - 6 > 8) top = a.top - height - 6;
  pos.value = { top, left };
}

let listening = false;
function listen(on: boolean) {
  if (on === listening) return;
  listening = on;
  const method = on ? 'addEventListener' : 'removeEventListener';
  window[method]('resize', place);
  window[method]('scroll', place, true);
}

watch(
  () => [props.open, props.anchor, props.align] as const,
  async ([open]) => {
    if (!open) {
      pos.value = null;
      listen(false);
      return;
    }
    await nextTick();
    place();
    listen(true);
  },
  { immediate: true },
);

onBeforeUnmount(() => listen(false));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="el"
      v-bind="scope"
      :class="className"
      :role="role"
      :style="{
        position: 'fixed',
        top: `${pos?.top ?? -9999}px`,
        left: `${pos?.left ?? -9999}px`,
        right: 'auto',
        bottom: 'auto',
        zIndex: 1200,
        visibility: pos ? 'visible' : 'hidden',
      }"
    >
      <slot />
    </div>
  </Teleport>
</template>
