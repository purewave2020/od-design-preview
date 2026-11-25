<!--
  Project chip at the left of the tab strip: switch project (demo / folder /
  files / Open Design daemon), copy a deep link, see where edits are saved,
  discard browser edits, and pick language + theme.
-->
<script setup lang="ts">
import { AnchoredPopover, RemixIcon, type PreviewSource } from '@od-design/preview';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AppLocale } from '../i18n';
import type { ThemePref } from '../stores/preview';
import DaemonConnectModal from './DaemonConnectModal.vue';

const props = defineProps<{
  source: PreviewSource;
  theme: ThemePref;
  locale: AppLocale;
  /** Live folder access (File System Access API) is available. */
  canOpenFolderLive: boolean;
  /** The source can drop its browser-side edits. */
  canDiscardLocalChanges: boolean;
}>();
const emit = defineEmits<{
  theme: [theme: ThemePref];
  locale: [locale: AppLocale];
  openDemo: [];
  openFolderLive: [];
  openFolderInput: [];
  openFilesInput: [];
  openDaemonProject: [origin: string, projectId: string, label: string];
  copyLink: [];
  discardLocalChanges: [];
}>();

const { t } = useI18n();
const open = ref(false);
const daemonOpen = ref(false);
const triggerRef = ref<HTMLButtonElement | null>(null);

function run(fn: () => void) {
  open.value = false;
  fn();
}

function sourceIcon(kind: PreviewSource['kind']): string {
  if (kind === 'daemon') return 'global-line';
  if (kind === 'local') return 'folder-line';
  return 'layout-grid-line';
}

function writeModeKey(mode: NonNullable<PreviewSource['writeMode']>): string {
  if (mode === 'disk') return 'app.writeModeDisk';
  if (mode === 'daemon') return 'app.writeModeDaemon';
  if (mode === 'browser') return 'app.writeModeBrowser';
  return 'app.writeModeMemory';
}

const LOCALES: Array<{ value: AppLocale; label: string }> = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en', label: 'EN' },
];
const THEMES: Array<{ value: ThemePref; key: string }> = [
  { value: 'system', key: 'app.themeSystem' },
  { value: 'light', key: 'app.themeLight' },
  { value: 'dark', key: 'app.themeDark' },
];

function onOpenDaemonProject(origin: string, projectId: string, label: string) {
  daemonOpen.value = false;
  emit('openDaemonProject', origin, projectId, label);
}
</script>

<template>
  <button
    ref="triggerRef"
    type="button"
    class="odp-project-chip"
    aria-haspopup="menu"
    :aria-expanded="open"
    :title="`${source.label}${source.description ? `\n${source.description}` : ''}`"
    data-testid="project-switcher"
    @click="open = !open"
  >
    <span class="odp-project-chip-mark" aria-hidden="true">
      <RemixIcon :name="sourceIcon(source.kind)" :size="14" />
    </span>
    <span class="odp-project-chip-label">{{ source.label }}</span>
    <span
      v-if="source.kind === 'local' && source.description?.includes('live')"
      class="odp-live-dot"
      :title="t('app.liveBadge')"
      :aria-label="t('app.liveBadge')"
    />
    <RemixIcon name="arrow-down-s-line" :size="14" />
  </button>
  <AnchoredPopover :anchor="triggerRef" :open="open" class-name="odp-menu" align="start" @close="open = false">
    <div class="odp-menu-section-label">{{ t('app.switchProject') }}</div>
    <button type="button" role="menuitem" class="odp-menu-item" @click="run(() => emit('openDemo'))">
      <RemixIcon name="layout-grid-line" :size="15" />
      <span class="odp-menu-copy">
        <span>{{ t('app.demoProject') }}</span>
        <small>{{ t('app.demoProjectDesc') }}</small>
      </span>
    </button>
    <button v-if="canOpenFolderLive" type="button" role="menuitem" class="odp-menu-item" @click="run(() => emit('openFolderLive'))">
      <RemixIcon name="folder-line" :size="15" />
      <span class="odp-menu-copy">
        <span>{{ t('app.openFolderLive') }}</span>
        <small>{{ t('app.openFolderDesc') }}</small>
      </span>
    </button>
    <button type="button" role="menuitem" class="odp-menu-item" @click="run(() => emit('openFolderInput'))">
      <RemixIcon name="folder-2-line" :size="15" />
      <span class="odp-menu-copy">
        <span>{{ t('app.openFolder') }}</span>
        <small v-if="!canOpenFolderLive">{{ t('app.openFolderDesc') }}</small>
      </span>
    </button>
    <button type="button" role="menuitem" class="odp-menu-item" @click="run(() => emit('openFilesInput'))">
      <RemixIcon name="file-line" :size="15" />
      <span class="odp-menu-copy">
        <span>{{ t('app.openFiles') }}</span>
      </span>
    </button>
    <button type="button" role="menuitem" class="odp-menu-item" @click="run(() => (daemonOpen = true))">
      <RemixIcon name="global-line" :size="15" />
      <span class="odp-menu-copy">
        <span>{{ t('app.connectDaemon') }}</span>
        <small>{{ t('app.connectDaemonDesc') }}</small>
      </span>
    </button>
    <div class="odp-menu-separator" role="separator" />
    <button type="button" role="menuitem" class="odp-menu-item" @click="run(() => emit('copyLink'))">
      <RemixIcon name="link" :size="15" />
      <span class="odp-menu-copy">
        <span>{{ t('app.copyLink') }}</span>
      </span>
    </button>
    <div v-if="source.writeMode" class="odp-menu-note" data-testid="write-mode-note">
      <RemixIcon name="information-line" :size="14" />
      <span>{{ t(writeModeKey(source.writeMode)) }}</span>
    </div>
    <button
      v-if="canDiscardLocalChanges && source.hasLocalChanges?.()"
      type="button"
      role="menuitem"
      class="odp-menu-item"
      data-testid="discard-local-changes"
      @click="run(() => emit('discardLocalChanges'))"
    >
      <RemixIcon name="reset-left-line" :size="15" />
      <span class="odp-menu-copy">
        <span>{{ t('app.discardLocalChanges') }}</span>
      </span>
    </button>
    <div class="odp-menu-separator" role="separator" />
    <div class="odp-menu-row">
      <span class="odp-menu-row-label">
        <RemixIcon name="translate-2" :size="15" />
        {{ t('app.language') }}
      </span>
      <div class="viewer-tabs odp-seg">
        <button
          v-for="item in LOCALES"
          :key="item.value"
          type="button"
          :class="['viewer-tab', { active: props.locale === item.value }]"
          @click="emit('locale', item.value)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>
    <div class="odp-menu-row">
      <span class="odp-menu-row-label">
        <RemixIcon :name="theme === 'dark' ? 'moon-line' : 'sun-line'" :size="15" />
        {{ t('app.theme') }}
      </span>
      <div class="viewer-tabs odp-seg">
        <button
          v-for="item in THEMES"
          :key="item.value"
          type="button"
          :class="['viewer-tab', { active: theme === item.value }]"
          @click="emit('theme', item.value)"
        >
          {{ t(item.key) }}
        </button>
      </div>
    </div>
  </AnchoredPopover>
  <DaemonConnectModal v-if="daemonOpen" @close="daemonOpen = false" @open="onOpenDaemonProject" />
</template>
