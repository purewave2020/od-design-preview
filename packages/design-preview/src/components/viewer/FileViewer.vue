<!--
  Dispatcher — same routing as upstream FileViewer: renderer registry first
  (react-component → deck-html → html → markdown → svg), then file kind.
  Sketch documents (`*.sketch.json`) open in the sketch editor, as they do in
  upstream's FileWorkspace.
-->
<script setup lang="ts">
import { computed, defineAsyncComponent, h } from 'vue';
import type { PreviewSource } from '../../sources/types';
import type { ProjectFile } from '../../types';
import { isSketchJsonFileName } from '../../vendor/open-design/components/sketch-model';
import { resolveRenderer } from '../../viewer/renderer';
import FileViewerLoadingSkeleton from './FileViewerLoadingSkeleton.vue';
import HtmlViewer from './HtmlViewer.vue';
import MarkdownViewer from './MarkdownViewer.vue';
import MediaViewer from './MediaViewer.vue';
import ReactComponentViewer from './ReactComponentViewer.vue';
import SvgViewer from './SvgViewer.vue';
import TextViewer from './TextViewer.vue';

// Excalidraw is large; load the sketch editor only when a sketch opens.
const SketchFileViewer = defineAsyncComponent({
  loader: () => import('../sketch/SketchFileViewer.vue'),
  loadingComponent: {
    name: 'SketchLoading',
    render: () => h('div', { class: 'viewer' }, [h('div', { class: 'viewer-body' }, [h(FileViewerLoadingSkeleton)])]),
  },
  delay: 0,
});

const props = withDefaults(
  defineProps<{
    source: PreviewSource;
    file: ProjectFile;
    filesRefreshKey: number;
    active: boolean;
    actionsHost: HTMLElement | null;
    /** Floating host for the comments panel (upstream comment-float-host). */
    commentHost?: HTMLElement | null;
    projectFiles: ProjectFile[];
    viewerOnly?: boolean;
    isDeckHint?: boolean;
  }>(),
  { commentHost: null, viewerOnly: false, isDeckHint: false },
);
const emit = defineEmits<{ openFile: [name: string] }>();

type Route =
  | { kind: 'sketch' }
  | { kind: 'html'; deck: boolean }
  | { kind: 'react-component' }
  | { kind: 'markdown' }
  | { kind: 'svg' }
  | { kind: 'text' }
  | { kind: 'media'; variant: 'image' | 'video' | 'audio' | 'binary' | 'document' };

const route = computed<Route>(() => {
  const file = props.file;
  if (isSketchJsonFileName(file.name)) return { kind: 'sketch' };
  const renderer = resolveRenderer(file, props.isDeckHint);
  if (renderer === 'html' || renderer === 'deck-html') return { kind: 'html', deck: renderer === 'deck-html' };
  if (renderer === 'react-component') return { kind: 'react-component' };
  if (renderer === 'markdown') return { kind: 'markdown' };
  if (renderer === 'svg') return { kind: 'svg' };
  if (file.kind === 'image' || file.kind === 'sketch') {
    return /\.json$/i.test(file.name) ? { kind: 'text' } : { kind: 'media', variant: 'image' };
  }
  if (file.kind === 'video') return { kind: 'media', variant: 'video' };
  if (file.kind === 'audio') return { kind: 'media', variant: 'audio' };
  if (file.kind === 'text' || file.kind === 'code') return { kind: 'text' };
  if (file.kind === 'pdf' || file.kind === 'document' || file.kind === 'presentation' || file.kind === 'spreadsheet') {
    return { kind: 'media', variant: 'document' };
  }
  return { kind: 'media', variant: 'binary' };
});
</script>

<template>
  <SketchFileViewer
    v-if="route.kind === 'sketch'"
    :source="source"
    :file="file"
    :active="active"
    :viewer-only="viewerOnly"
    @open-file="emit('openFile', $event)"
  />
  <HtmlViewer
    v-else-if="route.kind === 'html'"
    :source="source"
    :file="file"
    :files-refresh-key="filesRefreshKey"
    :is-deck-hint="route.deck"
    :active="active"
    :actions-host="actionsHost"
    :comment-host="commentHost"
    :viewer-only="viewerOnly"
  />
  <ReactComponentViewer
    v-else-if="route.kind === 'react-component'"
    :source="source"
    :file="file"
    :files-refresh-key="filesRefreshKey"
  />
  <MarkdownViewer
    v-else-if="route.kind === 'markdown'"
    :source="source"
    :file="file"
    :files-refresh-key="filesRefreshKey"
    :project-files="projectFiles"
    :viewer-only="viewerOnly"
    @open-file="emit('openFile', $event)"
  />
  <SvgViewer v-else-if="route.kind === 'svg'" :source="source" :file="file" :files-refresh-key="filesRefreshKey" />
  <TextViewer v-else-if="route.kind === 'text'" :source="source" :file="file" :files-refresh-key="filesRefreshKey" />
  <MediaViewer v-else :source="source" :file="file" :files-refresh-key="filesRefreshKey" :variant="route.variant" />
</template>
