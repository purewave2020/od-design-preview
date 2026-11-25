<!--
  Ported to Vue from nexu-io/open-design apps/web/src/components/DeckSlideThumbnail.tsx (Apache-2.0).

  Renders one deck slide as inert DOM inside a shadow root — the lightweight
  replacement for a full-deck `<iframe srcDoc>` thumbnail: adopt the deck's
  stylesheets (shared per deck), rebuild the wrapper chain the slide's
  selectors expect, clone the single slide and scale the design canvas to fit.
  No scripts execute. If the build throws, `error` lets the parent fall back
  to the iframe thumbnail.
-->
<script setup lang="ts">
import { ref, watch } from 'vue';
import type { ParsedDeckThumbnails } from '../runtime/deck-thumbnail-parser';
import { ensureDeckFonts, getDeckCss } from './deck-thumbnails';

const props = defineProps<{
  parsed: ParsedDeckThumbnails;
  index: number;
}>();
const emit = defineEmits<{
  /** The shadow build failed: render the iframe instead. */
  error: [];
  /** The thumbnail has a non-zero viewport and has been scaled. */
  ready: [];
}>();

const hostRef = ref<HTMLDivElement | null>(null);

watch(
  () => [hostRef.value, props.parsed, props.index] as const,
  ([host, parsed, index], _prev, onCleanup) => {
    if (!host) return;
    let cleanup: (() => void) | undefined;
    let ready = false;
    const markReady = () => {
      if (ready) return;
      ready = true;
      emit('ready');
    };
    try {
      ensureDeckFonts(parsed);
      const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
      root.replaceChildren();

      const { css, sheet } = getDeckCss(parsed);
      let adopted = false;
      if (sheet && 'adoptedStyleSheets' in root) {
        try {
          (root as ShadowRoot).adoptedStyleSheets = [sheet];
          adopted = true;
        } catch {
          adopted = false;
        }
      }
      if (!adopted) {
        const styleEl = document.createElement('style');
        styleEl.textContent = css;
        root.appendChild(styleEl);
      }

      const canvas = document.createElement('div');
      canvas.className = 'od-thumb-canvas';
      canvas.style.cssText =
        `position:absolute;top:0;left:0;transform-origin:top left;overflow:hidden;` +
        `width:${parsed.designWidth}px;height:${parsed.designHeight}px;`;

      let mountPoint: HTMLElement = canvas;
      for (const ancestor of parsed.ancestors) {
        const el = document.createElement(ancestor.tag);
        for (const [name, value] of ancestor.attributes) {
          try {
            el.setAttribute(name, value);
          } catch {
            // Ignore invalid attribute names carried over from the source.
          }
        }
        el.setAttribute('data-od-thumb-wrap', '');
        mountPoint.appendChild(el);
        mountPoint = el;
      }

      const template = document.createElement('template');
      template.innerHTML = parsed.slides[index] ?? '';
      const slide = template.content.firstElementChild as HTMLElement | null;
      if (!slide) throw new Error('deck thumbnail: empty slide markup');
      // Inert already (parsed via <template>), but drop scripts defensively.
      slide.querySelectorAll('script').forEach((s) => s.remove());
      slide.classList.add('active', 'is-active', 'current', 'visible');
      slide.setAttribute('data-od-deck-active', '');
      slide.setAttribute('data-od-thumb-slide', '');
      slide.removeAttribute('hidden');
      slide.setAttribute('aria-hidden', 'false');
      mountPoint.appendChild(slide);
      root.appendChild(canvas);

      const apply = () => {
        const w = host.clientWidth;
        const h = host.clientHeight;
        if (!w || !h) return;
        const scale = Math.min(w / parsed.designWidth, h / parsed.designHeight);
        canvas.style.transform = `scale(${scale})`;
        canvas.style.left = `${(w - parsed.designWidth * scale) / 2}px`;
        canvas.style.top = `${(h - parsed.designHeight * scale) / 2}px`;
        markReady();
      };
      apply();

      let frameOne = 0;
      let frameTwo = 0;
      if (typeof requestAnimationFrame !== 'undefined') {
        frameOne = requestAnimationFrame(() => {
          apply();
          frameTwo = requestAnimationFrame(apply);
        });
      }

      let observer: ResizeObserver | null = null;
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(apply);
        observer.observe(host);
      }
      cleanup = () => {
        observer?.disconnect();
        if (frameOne) cancelAnimationFrame(frameOne);
        if (frameTwo) cancelAnimationFrame(frameTwo);
      };
    } catch {
      emit('error');
    }
    onCleanup(() => cleanup?.());
  },
  { immediate: true, flush: 'post' },
);
</script>

<template>
  <div ref="hostRef" class="deck-thumbnail-shadow-host" aria-hidden="true" />
</template>
