<!--
  The standalone page: the preview workspace for the project named in the URL
  (demo / static folder / Open Design daemon project / a local folder), with
  the project switcher in the tab strip. `?embed=1&file=…` renders only that
  file's viewer.
-->
<script setup lang="ts">
import {
  copyText,
  DaemonSource,
  EmbeddedViewer,
  LocalSource,
  localSourceFromDrop,
  PreviewWorkspace,
  usePreviewScope,
  useToast,
  type PreviewSource,
} from '@od-design/preview';
import { Modal } from 'ant-design-vue';
import { storeToRefs } from 'pinia';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import ProjectSwitcher from '../components/ProjectSwitcher.vue';
import { setAppLocale, type AppLocale } from '../i18n';
import { usePreviewStore, type ThemePref } from '../stores/preview';
import { demoSource, queryFor, readUrlState } from '../url-state';

const { t, locale } = useI18n();
const toast = useToast();
const route = useRoute();
const router = useRouter();
const store = usePreviewStore();
const { source, initialFile, themePref } = storeToRefs(store);
const scope = usePreviewScope();

// The URL decides the project once, on load; later switches write the URL.
const initial = readUrlState(route.query, t('app.demoProject'));
if (!store.source) store.setSource(initial.source, initial.file);
const embedFile = initial.embed && initial.file ? initial.file : null;

const folderInputRef = ref<HTMLInputElement | null>(null);
const filesInputRef = ref<HTMLInputElement | null>(null);
onMounted(() => {
  // `webkitdirectory` has no Vue/TS binding; set the attribute directly.
  folderInputRef.value?.setAttribute('webkitdirectory', '');
});

watch(
  source,
  (current, _prev, onCleanup) => {
    if (!current) return;
    document.title = `${current.label} · Open Design Preview`;
    onCleanup(() => current.dispose?.());
  },
  { immediate: true },
);

function syncUrl(next: PreviewSource, file: string | null) {
  void router.replace({ query: queryFor(route.query, next, file) });
}

function switchSource(next: PreviewSource) {
  store.setSource(next, null);
  syncUrl(next, null);
}

function onActiveFileChange(name: string | null) {
  store.activeFile = name;
  if (store.source) syncUrl(store.source, name);
}

const canOpenFolderLive = LocalSource.isLiveFolderSupported();
async function openFolderLive() {
  try {
    const next = await LocalSource.pickDirectory();
    if (next) switchSource(next);
  } catch (err) {
    toast.show(String(err instanceof Error ? err.message : err), { tone: 'error' });
  }
}

function onInputFiles(event: Event) {
  const input = event.currentTarget as HTMLInputElement;
  const list = input.files ? Array.from(input.files) : [];
  input.value = '';
  if (list.length) switchSource(LocalSource.fromFiles(list));
}

function onDropFiles(dataTransfer: DataTransfer) {
  void localSourceFromDrop(dataTransfer).then(
    (next) => {
      if (next) switchSource(next);
    },
    (err: unknown) => toast.show(String(err instanceof Error ? err.message : err), { tone: 'error' }),
  );
}

function copyLink() {
  if (!store.source) return;
  const href = new URL(router.resolve({ query: queryFor(route.query, store.source, store.activeFile) }).href, window.location.origin).href;
  void copyText(href).then(() => toast.show(t('app.linkCopied'), { tone: 'success' }));
}

const canDiscard = computed(() => Boolean(source.value?.discardLocalChanges));
function discardLocalChanges() {
  const current = store.source;
  if (!current?.discardLocalChanges) return;
  Modal.confirm({
    title: t('app.discardLocalChangesConfirm'),
    okType: 'danger',
    onOk: () => current.discardLocalChanges?.().then(() => toast.show(t('app.localChangesDiscarded'), { tone: 'success' })),
  });
}

function setTheme(next: ThemePref) {
  themePref.value = next;
}
function setLocale(next: AppLocale) {
  setAppLocale(next);
}
</script>

<template>
  <EmbeddedViewer v-if="embedFile && source" :source="source" :file="embedFile" />
  <div v-else-if="source" v-bind="scope" class="app odp-app">
    <PreviewWorkspace
      :key="source.id"
      :source="source"
      :initial-file="initialFile"
      @active-file-change="onActiveFileChange"
      @drop-files="onDropFiles"
    >
      <template #leading>
        <ProjectSwitcher
          :source="source"
          :theme="themePref"
          :locale="locale as AppLocale"
          :can-open-folder-live="canOpenFolderLive"
          :can-discard-local-changes="canDiscard"
          @theme="setTheme"
          @locale="setLocale"
          @open-demo="switchSource(demoSource(t('app.demoProject')))"
          @open-folder-live="void openFolderLive()"
          @open-folder-input="folderInputRef?.click()"
          @open-files-input="filesInputRef?.click()"
          @open-daemon-project="(origin, id, label) => switchSource(new DaemonSource(origin, id, label))"
          @copy-link="copyLink"
          @discard-local-changes="discardLocalChanges"
        />
      </template>
    </PreviewWorkspace>
    <input ref="folderInputRef" type="file" multiple hidden @change="onInputFiles" />
    <input ref="filesInputRef" type="file" multiple hidden @change="onInputFiles" />
  </div>
</template>
