<script setup lang="ts">
import { DesignPreviewProvider, ErrorBoundary } from '@od-design/preview';
import { ConfigProvider, theme as antTheme } from 'ant-design-vue';
import enUS from 'ant-design-vue/es/locale/en_US';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import CrashScreen from './components/CrashScreen.vue';
import { usePreviewStore } from './stores/preview';

const { locale } = useI18n();
const store = usePreviewStore();

const antLocale = computed(() => (locale.value === 'zh-CN' ? zhCN : enUS));
const antThemeConfig = computed(() => ({
  algorithm: store.theme === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
}));
</script>

<template>
  <ConfigProvider :locale="antLocale" :theme="antThemeConfig">
    <DesignPreviewProvider>
      <ErrorBoundary name="app">
        <RouterView />
        <template #fallback="{ error, reset }">
          <CrashScreen :error="error" @retry="reset" />
        </template>
      </ErrorBoundary>
    </DesignPreviewProvider>
  </ConfigProvider>
</template>
