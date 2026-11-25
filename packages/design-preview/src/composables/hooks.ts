// Small composables shared by the preview components (Vue ports of the
// React hooks in the original lib/hooks.ts).
import {
  computed,
  onBeforeUnmount,
  shallowRef,
  toValue,
  watch,
  watchEffect,
  type MaybeRefOrGetter,
  type Ref,
  type ShallowRef,
  type WritableComputedRef,
} from 'vue';

/** A ref mirrored into localStorage under `key` (JSON). `key` may be reactive. */
export function usePersistentState<T>(
  key: MaybeRefOrGetter<string | null>,
  initial: T,
  validate?: (value: unknown) => value is T,
): WritableComputedRef<T> {
  const read = (k: string | null): T => {
    if (!k) return initial;
    try {
      const raw = window.localStorage.getItem(k);
      if (raw == null) return initial;
      const parsed = JSON.parse(raw) as unknown;
      if (validate && !validate(parsed)) return initial;
      return parsed as T;
    } catch {
      return initial;
    }
  };
  const state = shallowRef<T>(read(toValue(key)));
  watch(
    () => toValue(key),
    (k) => {
      state.value = read(k);
    },
  );
  return computed({
    get: () => state.value,
    set: (value: T) => {
      state.value = value;
      const k = toValue(key);
      if (!k) return;
      try {
        window.localStorage.setItem(k, JSON.stringify(value));
      } catch {
        /* quota / blocked */
      }
    },
  });
}

/**
 * Close a popover on outside pointerdown, Escape, or when focus moves into a
 * (sandboxed) iframe — clicks inside the preview never reach the host
 * document, so the window blur is the only signal (upstream OPEND-2035).
 */
export function useDismiss(
  open: MaybeRefOrGetter<boolean>,
  el: Ref<HTMLElement | null | undefined>,
  onDismiss: () => void,
  extra?: Ref<HTMLElement | null | undefined>,
): void {
  watchEffect((onCleanup) => {
    if (!toValue(open)) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (el.value?.contains(target)) return;
      if (extra?.value?.contains(target)) return;
      onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    const onBlur = () => {
      if (document.activeElement instanceof HTMLIFrameElement) onDismiss();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onBlur);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onBlur);
    });
  });
}

export interface ElementSize {
  width: number;
  height: number;
}

/** Observe an element's content-box size (clientWidth / clientHeight). */
export function useElementSize(target: Ref<HTMLElement | null | undefined>): ShallowRef<ElementSize | null> {
  const size = shallowRef<ElementSize | null>(null);
  watch(
    target,
    (node, _prev, onCleanup) => {
      if (!node) return;
      const apply = () => {
        const width = node.clientWidth;
        const height = node.clientHeight;
        const prev = size.value;
        if (!prev || prev.width !== width || prev.height !== height) size.value = { width, height };
      };
      apply();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(apply);
      observer.observe(node);
      onCleanup(() => observer.disconnect());
    },
    { immediate: true, flush: 'post' },
  );
  return size;
}

/** window / document listener bound to the component's lifetime. */
export function useEventListener<K extends keyof WindowEventMap>(
  target: Window,
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options?: AddEventListenerOptions | boolean,
): void;
export function useEventListener<K extends keyof DocumentEventMap>(
  target: Document,
  type: K,
  listener: (event: DocumentEventMap[K]) => void,
  options?: AddEventListenerOptions | boolean,
): void;
export function useEventListener(
  target: Window | Document,
  type: string,
  listener: (event: Event) => void,
  options?: AddEventListenerOptions | boolean,
): void {
  target.addEventListener(type, listener, options);
  onBeforeUnmount(() => target.removeEventListener(type, listener, options));
}
