// Toast state (one toast at a time, like upstream components/Toast.tsx).
// A module-level store so any component — or host code outside components —
// can raise a toast; <ToastHost> (mounted by <DesignPreviewProvider>) renders it.
import { shallowRef } from 'vue';

export type ToastTone = 'default' | 'success' | 'error' | 'loading';

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  ttlMs: number;
}

export interface ToastOptions {
  tone?: ToastTone;
  ttlMs?: number;
}

export const currentToast = shallowRef<ToastItem | null>(null);
export const toastLeaving = shallowRef(false);

let seq = 0;
let fadeTimer: number | null = null;
let doneTimer: number | null = null;

function clearTimers() {
  if (fadeTimer !== null) window.clearTimeout(fadeTimer);
  if (doneTimer !== null) window.clearTimeout(doneTimer);
  fadeTimer = null;
  doneTimer = null;
}

export function showToast(message: string, options?: ToastOptions): number {
  seq += 1;
  const item: ToastItem = { id: seq, message, tone: options?.tone ?? 'default', ttlMs: options?.ttlMs ?? 2600 };
  clearTimers();
  toastLeaving.value = false;
  currentToast.value = item;
  if (item.tone !== 'loading') {
    fadeTimer = window.setTimeout(() => {
      toastLeaving.value = true;
    }, Math.max(0, item.ttlMs - 200));
    doneTimer = window.setTimeout(() => {
      if (currentToast.value?.id === item.id) currentToast.value = null;
    }, item.ttlMs);
  }
  return item.id;
}

export function dismissToast(id: number): void {
  if (currentToast.value?.id !== id) return;
  clearTimers();
  currentToast.value = null;
}

export interface ToastApi {
  show: (message: string, options?: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const api: ToastApi = { show: showToast, dismiss: dismissToast };

export function useToast(): ToastApi {
  return api;
}
