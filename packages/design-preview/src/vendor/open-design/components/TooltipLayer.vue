<!--
  Ported to Vue from nexu-io/open-design apps/web/src/components/TooltipLayer.tsx (Apache-2.0).

  全应用共用的一枚提示气泡（body teleport），读 `.od-tooltip[data-tooltip]`。
  节点常驻挂载，只切 opacity（淡入淡出）；隐藏时 aria-hidden，读屏不会念到；
  目标之间切换时不淡；按下 / 触发元素消失时立刻收起（instant）。
  行为与上游逐条对应，见上游 docblock。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { getTopModalDialog, observeModalStack } from '../ui-components/modal-stack';
import { usePreviewScope } from '../../../theme';

const scope = usePreviewScope();

type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';
type InputModality = 'keyboard' | 'pointer';

interface TooltipStyle {
  x: number;
  y: number;
  visibility: 'hidden' | 'visible';
}

interface TooltipState {
  target: HTMLElement;
  text: string;
  placement: TooltipPlacement;
  /** 气泡此刻该不该看得见（隐藏时保留 target / text / style，只翻这一位，节点淡出）。 */
  visible: boolean;
  /** 这次隐藏不许淡，立刻不可见（已按下 / 触发元素已离开 DOM）。 */
  instant: boolean;
  style: TooltipStyle;
}

const TOOLTIP_MARGIN = 8;
/** 气泡和触发元素之间的距离（稿子 `bottom: calc(100% + 6px)`）。 */
const TOOLTIP_GAP = 6;

function isTooltipTarget(el: Element | null): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    el.classList.contains('od-tooltip') &&
    Boolean(el.dataset.tooltip?.trim()) &&
    el.getAttribute('aria-expanded') !== 'true'
  );
}

function readTooltipTarget(start: EventTarget | null): HTMLElement | null {
  if (!(start instanceof Element)) return null;
  const candidate = start.closest('.od-tooltip[data-tooltip]');
  return isTooltipTarget(candidate) ? candidate : null;
}

function isActiveTooltipTarget(target: HTMLElement): boolean {
  if (!target.isConnected || target.closest('[inert], [hidden], [aria-hidden="true"]')) return false;
  const modal = getTopModalDialog(target.ownerDocument);
  return !modal || modal.contains(target);
}

function tooltipPlacement(target: HTMLElement): TooltipPlacement {
  const raw = target.dataset.tooltipPlacement;
  return raw === 'bottom' || raw === 'left' || raw === 'right' ? raw : 'top';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function positionTooltip(target: HTMLElement, tooltip: HTMLElement, placement: TooltipPlacement): TooltipStyle {
  const rect = target.getBoundingClientRect();
  const tip = tooltip.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxLeft = Math.max(TOOLTIP_MARGIN, viewportWidth - tip.width - TOOLTIP_MARGIN);
  const maxTop = Math.max(TOOLTIP_MARGIN, viewportHeight - tip.height - TOOLTIP_MARGIN);

  let left = rect.left + rect.width / 2 - tip.width / 2;
  let top = rect.top - tip.height - TOOLTIP_GAP;

  if (placement === 'bottom') {
    top = rect.bottom + TOOLTIP_GAP;
  } else if (placement === 'left') {
    left = rect.left - tip.width - TOOLTIP_GAP;
    top = rect.top + rect.height / 2 - tip.height / 2;
  } else if (placement === 'right') {
    left = rect.right + TOOLTIP_GAP;
    top = rect.top + rect.height / 2 - tip.height / 2;
  }

  return {
    x: Math.round(clamp(left, TOOLTIP_MARGIN, maxLeft)),
    y: Math.round(clamp(top, TOOLTIP_MARGIN, maxTop)),
    visibility: 'visible',
  };
}

function sameStyle(left: TooltipStyle, right: TooltipStyle): boolean {
  return left.x === right.x && left.y === right.y && left.visibility === right.visibility;
}

const tooltipRef = ref<HTMLDivElement | null>(null);
const state = shallowRef<TooltipState | null>(null);
let rafId: number | null = null;
let lastInput: InputModality = 'pointer';
let suppressedTitle: { target: HTMLElement; title: string } | null = null;

function update(updater: (current: TooltipState | null) => TooltipState | null) {
  const next = updater(state.value);
  if (next !== state.value) state.value = next;
}

function restoreNativeTitle() {
  const suppressed = suppressedTitle;
  if (!suppressed) return;
  if (document.contains(suppressed.target)) {
    if (!suppressed.target.hasAttribute('title')) suppressed.target.setAttribute('title', suppressed.title);
    suppressed.target.removeAttribute('data-od-tooltip-native-title');
  }
  suppressedTitle = null;
}

function suppressNativeTitle(target: HTMLElement) {
  if (suppressedTitle?.target === target) return;
  restoreNativeTitle();
  const title = target.getAttribute('title');
  if (!title) return;
  target.setAttribute('data-od-tooltip-native-title', title);
  target.removeAttribute('title');
  suppressedTitle = { target, title };
}

function hideTooltip(options: { restoreTitle?: boolean; instant?: boolean } = {}) {
  if (rafId !== null) {
    window.cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (options.restoreTitle !== false) restoreNativeTitle();
  const instant = options.instant === true;
  update((current) =>
    current === null || (!current.visible && current.instant === instant) ? current : { ...current, visible: false, instant },
  );
}

function hideTooltipForActivation(target: HTMLElement | null) {
  if (!target) {
    hideTooltip({ instant: true });
    return;
  }
  suppressNativeTitle(target);
  hideTooltip({ restoreTitle: false, instant: true });
}

function showTooltip(target: HTMLElement) {
  if (!isActiveTooltipTarget(target)) {
    hideTooltip({ instant: true });
    return;
  }
  const text = target.dataset.tooltip?.trim();
  if (!text) return;
  suppressNativeTitle(target);
  const placement = tooltipPlacement(target);
  update((current) => {
    if (current?.target === target) {
      if (current.text === text && current.placement === placement && current.visible) return current;
      return { ...current, text, placement, visible: true, instant: false };
    }
    return {
      target,
      text,
      placement,
      visible: true,
      instant: false,
      // 换目标时沿用上一次量到的位置当种子，只把 visibility 打回 hidden 标成「还没量」。
      style: current ? { ...current.style, visibility: 'hidden' } : { x: 0, y: 0, visibility: 'hidden' },
    };
  });
}

function updatePosition() {
  update((current) => {
    if (!current) return null;
    // 已经在淡出的气泡不再跟着滚动 / 缩放重新定位。
    if (!current.visible) return current;
    // 触发元素没了就立刻收，别对着空气淡。
    if (!isActiveTooltipTarget(current.target)) return { ...current, visible: false, instant: true };
    if (current.target.getAttribute('aria-expanded') === 'true') return { ...current, visible: false, instant: false };
    const node = tooltipRef.value;
    if (!node) return current;
    const placement = tooltipPlacement(current.target);
    const nextText = current.target.dataset.tooltip?.trim() ?? current.text;
    const nextStyle = positionTooltip(current.target, node, placement);
    if (current.text === nextText && current.placement === placement && sameStyle(current.style, nextStyle)) return current;
    return { ...current, text: nextText, placement, style: nextStyle };
  });
}

function scheduleUpdatePosition() {
  if (rafId !== null) return;
  rafId = window.requestAnimationFrame(() => {
    rafId = null;
    updatePosition();
  });
}

// Measure after every render of the bubble, before paint (upstream useLayoutEffect).
watch(
  state,
  (current) => {
    if (!current?.visible) return;
    const node = tooltipRef.value;
    if (node && isActiveTooltipTarget(current.target) && current.target.getAttribute('aria-expanded') !== 'true') {
      const placement = tooltipPlacement(current.target);
      const text = current.target.dataset.tooltip?.trim() ?? current.text;
      if (text === current.text && placement === current.placement && sameStyle(current.style, positionTooltip(current.target, node, placement))) {
        return;
      }
    }
    updatePosition();
  },
  { flush: 'post' },
);

// 只在气泡看得见时盯着触发元素。
watch(
  () => [state.value?.target, state.value?.visible] as const,
  ([target, visible], _prev, onCleanup) => {
    if (!visible || !target || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => {
      if (!isTooltipTarget(target)) hideTooltip({ restoreTitle: false });
    });
    observer.observe(target, { attributes: true, attributeFilter: ['aria-expanded', 'class', 'data-tooltip', 'disabled'] });
    onCleanup(() => observer.disconnect());
  },
);

// A modal can arrive while the pointer stays still: dismiss immediately.
watch(
  () => [state.value?.target, state.value?.visible] as const,
  ([target, visible], _prev, onCleanup) => {
    if (!visible || !target) return;
    const dismissInactive = () => {
      if (!isActiveTooltipTarget(target)) hideTooltip({ instant: true });
    };
    dismissInactive();
    onCleanup(observeModalStack(document, dismissInactive));
  },
);

function shouldShowForFocus(target: HTMLElement) {
  if (lastInput === 'keyboard') return true;
  try {
    return target.matches(':focus-visible');
  } catch {
    return false;
  }
}
const onPointerOver = (event: PointerEvent) => {
  lastInput = 'pointer';
  const target = readTooltipTarget(event.target);
  if (target) showTooltip(target);
};
const onPointerOut = (event: PointerEvent) => {
  const target = readTooltipTarget(event.target);
  if (!target) return;
  const next = event.relatedTarget;
  if (next instanceof Node && target.contains(next)) return;
  hideTooltip();
};
const onPointerDown = (event: PointerEvent) => {
  lastInput = 'pointer';
  hideTooltipForActivation(readTooltipTarget(event.target));
};
const onPointerCancel = () => {
  lastInput = 'pointer';
  hideTooltip();
};
const onClick = (event: MouseEvent) => {
  hideTooltipForActivation(readTooltipTarget(event.target));
};
const onFocusIn = (event: FocusEvent) => {
  const target = readTooltipTarget(event.target);
  if (!target) return;
  if (shouldShowForFocus(target)) {
    showTooltip(target);
    return;
  }
  suppressNativeTitle(target);
};
const onFocusOut = (event: FocusEvent) => {
  const target = readTooltipTarget(event.target);
  if (!target) return;
  const next = event.relatedTarget;
  if (next instanceof Node && target.contains(next)) return;
  hideTooltip();
};
const onKeyDown = (event: KeyboardEvent) => {
  lastInput = 'keyboard';
  if (event.key === 'Escape') hideTooltip();
  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    hideTooltipForActivation(readTooltipTarget(event.target));
  }
};

onMounted(() => {
  document.addEventListener('pointerover', onPointerOver);
  document.addEventListener('pointerout', onPointerOut);
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointercancel', onPointerCancel);
  document.addEventListener('click', onClick);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', scheduleUpdatePosition);
  window.addEventListener('scroll', scheduleUpdatePosition, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerover', onPointerOver);
  document.removeEventListener('pointerout', onPointerOut);
  document.removeEventListener('pointerdown', onPointerDown);
  document.removeEventListener('pointercancel', onPointerCancel);
  document.removeEventListener('click', onClick);
  document.removeEventListener('focusin', onFocusIn);
  document.removeEventListener('focusout', onFocusOut);
  document.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('resize', scheduleUpdatePosition);
  window.removeEventListener('scroll', scheduleUpdatePosition, true);
  if (rafId !== null) window.cancelAnimationFrame(rafId);
  restoreNativeTitle();
});

const visible = computed(() => state.value?.visible === true);
const measured = computed(() => state.value !== null && state.value.style.visibility === 'visible');
// visibility 只挡三种不该画出来的帧：还没有目标 / 新目标还没量 / instant 收场。
const painted = computed(() => state.value !== null && (visible.value ? measured.value : !state.value.instant));
const tooltipContext = computed(() => (state.value?.target.closest('[role="menu"]') ? 'menu' : undefined));
</script>

<template>
  <Teleport to="body">
    <div
      ref="tooltipRef"
      v-bind="scope"
      class="od-tooltip-layer"
      role="tooltip"
      :aria-hidden="visible ? undefined : 'true'"
      :data-tooltip-context="tooltipContext"
      :style="{
        transform: `translate3d(${state?.style.x ?? 0}px, ${state?.style.y ?? 0}px, 0)`,
        visibility: painted ? 'visible' : 'hidden',
        opacity: visible ? 1 : 0,
      }"
    >
      {{ state?.text ?? '' }}
    </div>
  </Teleport>
</template>
