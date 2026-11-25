<!-- Shown by the app-level ErrorBoundary instead of a blank page. -->
<script setup lang="ts">
import { Button, Result } from 'ant-design-vue';
import { useI18n } from 'vue-i18n';

defineProps<{ error: Error }>();
const emit = defineEmits<{ retry: [] }>();
const { t } = useI18n();

const reload = () => window.location.reload();
</script>

<template>
  <div class="odp-crash" role="alert" data-testid="app-crash">
    <Result status="error" :title="t('app.crashTitle')" :sub-title="t('app.crashBody')">
      <template #extra>
        <Button @click="emit('retry')">{{ t('app.crashRetry') }}</Button>
        <Button type="primary" @click="reload">{{ t('app.crashReload') }}</Button>
      </template>
      <pre class="odp-crash-detail">{{ error.message }}</pre>
    </Result>
  </div>
</template>
