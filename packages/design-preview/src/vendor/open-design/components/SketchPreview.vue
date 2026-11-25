<!--
  Ported to Vue from nexu-io/open-design apps/web/src/components/SketchPreview.tsx (Apache-2.0).
  Read-only sketch rendering: Excalidraw's own SVG export when the scene is
  small enough, otherwise a lightweight SVG of the converted items.
-->
<script setup lang="ts">
import { computed, h, shallowRef, watch, type FunctionalComponent, type VNode } from 'vue';
import type { WorkspaceCollabContext } from '../contracts/index';
import { workspaceIdentityCacheKey } from '../shims/workspace-identity';
import { fetchProjectFileText } from '../shims/registry';
import type { ProjectFile } from '../shims/types';
import { clampSketchNumber, clampSketchSize, normalizeSketchText, type SketchItem } from './sketch-model';
import {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  buildSketchPreviewState,
  computeSketchPreviewGeometry,
  isRenderableSketchJson,
  previewCache,
  rememberSketchPreview,
  sketchPreviewCacheKey,
  type SketchPreviewState,
} from './sketch/preview-model';

const props = defineProps<{
  projectId: string;
  file: Pick<ProjectFile, 'kind' | 'name' | 'mtime'>;
  className?: string;
  workspaceContext?: WorkspaceCollabContext | null;
}>();

const workspaceIdentity = computed(() => workspaceIdentityCacheKey(props.workspaceContext));
const renderable = computed(() => isRenderableSketchJson(props.file));
const initialKey = renderable.value
  ? sketchPreviewCacheKey(props.projectId, props.file.name, props.file.mtime, workspaceIdentity.value)
  : null;
const preview = shallowRef<SketchPreviewState | null>(initialKey ? previewCache.get(initialKey) ?? null : null);

watch(
  () => [props.file.kind, props.file.name, props.file.mtime, props.projectId, props.workspaceContext, workspaceIdentity.value] as const,
  (_deps, _prev, onCleanup) => {
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    if (!isRenderableSketchJson(props.file)) return;
    const nextCacheKey = sketchPreviewCacheKey(props.projectId, props.file.name, props.file.mtime, workspaceIdentity.value);
    const cached = previewCache.get(nextCacheKey);
    if (cached) {
      preview.value = cached;
      return;
    }
    preview.value = null;
    void fetchProjectFileText(props.projectId, props.file.name, {
      cache: 'no-store',
      ...(props.workspaceContext ? { workspaceContext: props.workspaceContext } : {}),
    }).then(async (text) => {
      if (cancelled) return;
      const nextPreview = await buildSketchPreviewState(text);
      if (cancelled) return;
      rememberSketchPreview(nextCacheKey, nextPreview);
      preview.value = nextPreview;
    });
  },
  { immediate: true },
);

const geometry = computed(() => computeSketchPreviewGeometry(preview.value?.items ?? []));

function renderSketchSvgItem(item: SketchItem, index: number): VNode | VNode[] | null {
  const stroke = {
    stroke: item.color,
    'stroke-width': clampSketchSize(item.size),
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    fill: 'none',
  };
  if (item.kind === 'pen') {
    if (item.points.length === 0) return null;
    if (item.points.length === 1) {
      const point = item.points[0]!;
      return h('circle', {
        'data-sketch-item': index,
        cx: clampSketchNumber(point.x),
        cy: clampSketchNumber(point.y),
        r: Math.max(1, clampSketchSize(item.size) / 2),
        fill: item.color,
      });
    }
    const path = item.points
      .map((point, pointIndex) => `${pointIndex === 0 ? 'M' : 'L'} ${clampSketchNumber(point.x)} ${clampSketchNumber(point.y)}`)
      .join(' ');
    return h('path', { 'data-sketch-item': index, d: path, ...stroke });
  }
  if (item.kind === 'rect') {
    const x = clampSketchNumber(item.x);
    const y = clampSketchNumber(item.y);
    const w = clampSketchNumber(item.w);
    const hgt = clampSketchNumber(item.h);
    return h('rect', {
      'data-sketch-item': index,
      x: Math.min(x, x + w),
      y: Math.min(y, y + hgt),
      width: Math.abs(w),
      height: Math.abs(hgt),
      ...stroke,
    });
  }
  if (item.kind === 'arrow') {
    const x1 = clampSketchNumber(item.x1);
    const y1 = clampSketchNumber(item.y1);
    const x2 = clampSketchNumber(item.x2);
    const y2 = clampSketchNumber(item.y2);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = 10 + clampSketchSize(item.size) * 2;
    const leftX = x2 - head * Math.cos(angle - Math.PI / 6);
    const leftY = y2 - head * Math.sin(angle - Math.PI / 6);
    const rightX = x2 - head * Math.cos(angle + Math.PI / 6);
    const rightY = y2 - head * Math.sin(angle + Math.PI / 6);
    return [
      h('path', { 'data-sketch-item': index, d: `M ${x1} ${y1} L ${x2} ${y2}`, ...stroke }),
      h('path', { d: `M ${x2} ${y2} L ${leftX} ${leftY} M ${x2} ${y2} L ${rightX} ${rightY}`, ...stroke }),
    ];
  }
  return h(
    'text',
    {
      'data-sketch-item': index,
      x: clampSketchNumber(item.x),
      y: clampSketchNumber(item.y),
      fill: item.color,
      'font-size': Math.max(12, clampSketchSize(item.size)),
      'font-family': 'Albert Sans, PingFang SC, Microsoft YaHei, sans-serif',
    },
    normalizeSketchText(item.text),
  );
}

const SketchItems: FunctionalComponent<{ items: SketchItem[] }> = (p) =>
  p.items.flatMap((item, index) => {
    const node = renderSketchSvgItem(item, index);
    return node === null ? [] : Array.isArray(node) ? node : [node];
  });
SketchItems.props = ['items'];
</script>

<template>
  <div
    v-if="renderable"
    :class="['sketch-preview', { loading: preview === null }, className]"
    data-testid="sketch-preview-svg"
  >
    <div v-if="preview?.svgMarkup" class="sketch-preview-svg-inner" role="img" aria-label="Sketch preview" v-html="preview.svgMarkup" />
    <svg
      v-else
      :viewBox="`${geometry.viewBoxX} ${geometry.viewBoxY} ${geometry.viewBoxWidth} ${geometry.viewBoxHeight}`"
      preserveAspectRatio="xMidYMid meet"
      :width="DEFAULT_WIDTH"
      :height="DEFAULT_HEIGHT"
      role="img"
      aria-label="Sketch preview"
    >
      <defs>
        <pattern id="sketch-preview-grid" width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="8" cy="8" r="1" fill="#d7d4ce" />
        </pattern>
      </defs>
      <rect :x="geometry.viewBoxX" :y="geometry.viewBoxY" :width="geometry.viewBoxWidth" :height="geometry.viewBoxHeight" fill="#f7f5f1" />
      <rect
        :x="geometry.viewBoxX"
        :y="geometry.viewBoxY"
        :width="geometry.viewBoxWidth"
        :height="geometry.viewBoxHeight"
        fill="url(#sketch-preview-grid)"
      />
      <SketchItems v-if="geometry.items.length > 0" :items="geometry.items" />
      <g v-else class="sketch-preview-empty-mark">
        <path d="M80 80h160M80 120h120" />
      </g>
    </svg>
  </div>
</template>
