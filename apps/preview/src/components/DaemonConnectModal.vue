<!-- Connect to an Open Design daemon and pick a project (Ant Design Vue modal). -->
<script setup lang="ts">
import { listDaemonProjects, type DaemonProjectSummary } from '@od-design/preview';
import { Alert, Button, Form, FormItem, Input, List, ListItem, Modal, Space, TypographyText } from 'ant-design-vue';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

const emit = defineEmits<{
  close: [];
  open: [origin: string, projectId: string, label: string];
}>();

const DAEMON_ORIGIN_KEY = 'od-preview:daemon-origin';

const { t } = useI18n();
const origin = ref(
  (() => {
    try {
      return window.localStorage.getItem(DAEMON_ORIGIN_KEY) ?? '';
    } catch {
      return '';
    }
  })(),
);
const projects = ref<DaemonProjectSummary[] | null>(null);
const projectId = ref('');
const busy = ref(false);
const error = ref<string | null>(null);

async function load() {
  busy.value = true;
  error.value = null;
  try {
    window.localStorage.setItem(DAEMON_ORIGIN_KEY, origin.value.trim());
  } catch {
    /* storage blocked */
  }
  try {
    projects.value = await listDaemonProjects(origin.value);
  } catch (err) {
    projects.value = null;
    error.value = t('app.daemonError', { message: err instanceof Error ? err.message : String(err) });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal
    :open="true"
    :title="t('app.daemonTitle')"
    :width="560"
    :footer="null"
    :mask-closable="true"
    destroy-on-close
    wrap-class-name="odp-daemon-modal"
    @cancel="emit('close')"
  >
    <TypographyText type="secondary">{{ t('app.connectDaemonDesc') }}</TypographyText>
    <Form layout="vertical" style="margin-top: 16px" @submit.prevent="load">
      <FormItem :label="t('app.daemonOrigin')" :extra="t('app.daemonOriginHint')">
        <Space.Compact style="width: 100%">
          <Input v-model:value="origin" type="url" placeholder="http://127.0.0.1:7456" data-testid="daemon-origin" />
          <Button html-type="submit" :loading="busy">{{ t('app.daemonLoadProjects') }}</Button>
        </Space.Compact>
      </FormItem>
      <Alert v-if="error" type="error" :message="error" show-icon style="margin-bottom: 16px" />
      <FormItem v-if="projects">
        <List v-if="projects.length" size="small" bordered :data-source="projects" style="max-height: 260px; overflow: auto">
          <template #renderItem="{ item }">
            <ListItem style="cursor: pointer" role="option" :aria-selected="false" @click="emit('open', origin, item.id, item.name)">
              <span class="odp-project-name">{{ item.name }}</span>
              <TypographyText type="secondary" code>{{ item.id }}</TypographyText>
            </ListItem>
          </template>
        </List>
        <TypographyText v-else type="secondary">{{ t('app.daemonNoProjects') }}</TypographyText>
      </FormItem>
      <FormItem :label="t('app.daemonProjectId')">
        <Space.Compact style="width: 100%">
          <Input v-model:value="projectId" placeholder="proj_…" />
          <Button type="primary" :disabled="!projectId.trim()" @click="emit('open', origin, projectId.trim(), projectId.trim())">
            {{ t('app.daemonOpen') }}
          </Button>
        </Space.Compact>
      </FormItem>
    </Form>
  </Modal>
</template>
