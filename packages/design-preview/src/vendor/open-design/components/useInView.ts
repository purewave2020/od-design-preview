// Ported to Vue from nexu-io/open-design apps/web/src/components/plugins-home/useInView.ts (Apache-2.0).
// IntersectionObserver-backed visibility composable used by preview tiles to
// defer expensive work (srcDoc iframes, image fetches) until the card scrolls
// into view. Once a tile has been visible it stays "armed" (unless once=false).
import { ref, shallowRef, watch, type Ref } from 'vue';

export interface UseInViewOptions {
  rootMargin?: string;
  /** Stop observing after the first time the node becomes visible. */
  once?: boolean;
  /**
   * Observe against this scroll container instead of the viewport (needed
   * when the target lives in an overflow container). Read at observe time.
   */
  root?: Ref<Element | null | undefined>;
}

export function useInView<T extends Element = HTMLElement>(
  options: UseInViewOptions = {},
): { ref: Ref<T | null>; inView: Ref<boolean> } {
  const target = shallowRef<T | null>(null) as Ref<T | null>;
  const inView = ref(false);

  watch(
    target,
    (node, _prev, onCleanup) => {
      if (!node) return;
      if (typeof IntersectionObserver === 'undefined') {
        inView.value = true;
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              inView.value = true;
              if (options.once !== false) observer.disconnect();
            } else if (options.once === false) {
              inView.value = false;
            }
          }
        },
        {
          rootMargin: options.rootMargin ?? '240px',
          root: options.root?.value ?? null,
        },
      );
      observer.observe(node);
      onCleanup(() => observer.disconnect());
    },
    { immediate: true, flush: 'post' },
  );

  return { ref: target, inView };
}
