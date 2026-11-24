import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useDismiss } from '../lib/hooks';

/**
 * A popover portaled to <body> and pinned under its anchor, so menus opened
 * from the tab strip / toolbar are never clipped by the workspace panes
 * (upstream's AnchoredMenuShell solves the same problem).
 */
export function AnchoredPopover({
  anchor,
  open,
  onClose,
  className,
  align = 'end',
  role = 'menu',
  children,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  className?: string;
  align?: 'start' | 'end';
  role?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useDismiss(open, ref, onClose, anchor);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      let left = align === 'end' ? a.right - width : a.left;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      let top = a.bottom + 6;
      if (top + height > window.innerHeight - 8 && a.top - height - 6 > 8) top = a.top - height - 6;
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchor, align]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={className}
      role={role}
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        right: 'auto',
        bottom: 'auto',
        zIndex: 1200,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
