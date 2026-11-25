import { shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue';
import type { PreviewSource } from '../sources/types';
import type { ProjectFile } from '../types';

/**
 * Read a file's text from its source, re-reading when the file (mtime), the
 * refresh key or `enabled` change. `text` is null until the first read lands.
 */
export function useFileText(
  source: MaybeRefOrGetter<PreviewSource>,
  file: MaybeRefOrGetter<ProjectFile>,
  refreshKey: MaybeRefOrGetter<number>,
  enabled: MaybeRefOrGetter<boolean> = true,
) {
  const text = shallowRef<string | null>(null);
  const error = shallowRef(false);
  watch(
    () => [toValue(source), toValue(file).name, toValue(file).mtime, toValue(refreshKey), toValue(enabled)] as const,
    ([src, name, , , on], _prev, onCleanup) => {
      if (!on) return;
      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
      });
      error.value = false;
      void src.readText(name, { fresh: true }).then((next) => {
        if (cancelled) return;
        if (next === null) error.value = true;
        text.value = next ?? '';
      });
    },
    { immediate: true },
  );
  return { text, error };
}
