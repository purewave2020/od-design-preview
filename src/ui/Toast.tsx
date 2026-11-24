import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../vendor/open-design/components/Icon';

export type ToastTone = 'default' | 'success' | 'error' | 'loading';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  ttlMs: number;
}

const TONE_ICON: Partial<Record<ToastTone, IconName>> = {
  success: 'check',
  error: 'alert-triangle',
  loading: 'spinner',
};

type ShowToast = (message: string, options?: { tone?: ToastTone; ttlMs?: number }) => number;

const ToastContext = createContext<{ show: ShowToast; dismiss: (id: number) => void }>({
  show: () => 0,
  dismiss: () => {},
});

/** Same markup/classes as upstream components/Toast.tsx (`.od-toast`). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const [leaving, setLeaving] = useState(false);
  const seq = useRef(0);
  const show = useCallback<ShowToast>((message, options) => {
    seq.current += 1;
    setLeaving(false);
    setToast({ id: seq.current, message, tone: options?.tone ?? 'default', ttlMs: options?.ttlMs ?? 2600 });
    return seq.current;
  }, []);
  const dismiss = useCallback((id: number) => {
    setToast((current) => (current?.id === id ? null : current));
  }, []);
  useEffect(() => {
    if (!toast || toast.tone === 'loading') return;
    const fade = window.setTimeout(() => setLeaving(true), Math.max(0, toast.ttlMs - 200));
    const done = window.setTimeout(() => setToast((c) => (c?.id === toast.id ? null : c)), toast.ttlMs);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, [toast]);
  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  const iconName = toast ? TONE_ICON[toast.tone] : undefined;
  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast
        ? createPortal(
            <div
              className={`od-toast tone-${toast.tone} placement-bottom${leaving ? ' leaving' : ''}`}
              role={toast.tone === 'error' ? 'alert' : 'status'}
              aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
            >
              <div className="od-toast-body">
                {iconName ? (
                  <span className="od-toast-icon" aria-hidden>
                    <Icon name={iconName} size={14} />
                  </span>
                ) : null}
                <div className="od-toast-message">{toast.message}</div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
