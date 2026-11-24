import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** useState mirrored into localStorage under `key` (JSON). */
export function usePersistentState<T>(
  key: string | null,
  initial: T,
  validate?: (value: unknown) => value is T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const read = useCallback((): T => {
    if (!key) return initial;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw == null) return initial;
      const parsed = JSON.parse(raw) as unknown;
      if (validate && !validate(parsed)) return initial;
      return parsed as T;
    } catch {
      return initial;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const [state, setState] = useState<T>(read);
  const keyRef = useRef(key);
  if (keyRef.current !== key) {
    keyRef.current = key;
  }
  useEffect(() => {
    setState(read());
  }, [read]);
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setState((prev) => {
        const value = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        if (keyRef.current) {
          try {
            window.localStorage.setItem(keyRef.current, JSON.stringify(value));
          } catch {
            /* quota / blocked */
          }
        }
        return value;
      });
    },
    [],
  );
  return [state, set];
}

/**
 * Close a popover on outside pointerdown, Escape, or when focus moves into a
 * (sandboxed) iframe — clicks inside the preview never reach the host
 * document, so the window blur is the only signal (upstream OPEND-2035).
 */
export function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, onDismiss: () => void, extra?: RefObject<HTMLElement | null>) {
  const cb = useRef(onDismiss);
  cb.current = onDismiss;
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target)) return;
      if (extra?.current?.contains(target)) return;
      cb.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cb.current();
    };
    const onBlur = () => {
      if (document.activeElement instanceof HTMLIFrameElement) cb.current();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onBlur);
    };
  }, [open, ref, extra]);
}

/** Observe an element's content-box size. */
export function useElementSize<T extends HTMLElement>(): [
  (node: T | null) => void,
  { width: number; height: number } | null,
] {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    if (!node) return;
    const apply = () => {
      const width = node.clientWidth;
      const height = node.clientHeight;
      setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, size];
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand('copy');
    } finally {
      document.body.removeChild(ta);
    }
  }
}

export function relativeTime(ts: number, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const diff = Date.now() - ts;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return t('common.justNow');
  if (diff < hr) return t('common.minutesAgo', { n: Math.floor(diff / min) });
  if (diff < day) return t('common.hoursAgo', { n: Math.floor(diff / hr) });
  if (diff < 7 * day) return t('common.daysAgo', { n: Math.floor(diff / day) });
  if (diff < 30 * day) return t('designFiles.weeksAgo', { n: Math.floor(diff / (7 * day)) });
  return new Date(ts).toLocaleDateString();
}
