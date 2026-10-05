import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
export function Dialog({
  title,
  children,
  onClose,
  onBack,
  footer,
  eyebrow = 'Демонстрационная запись',
  className = '',
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  eyebrow?: string;
  className?: string;
  onClose: () => void;
  onBack?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const actions = useRef({ onClose, onBack });
  const markerRef = useRef(crypto.randomUUID());
  const lifecycle = useRef(0);
  actions.current = { onClose, onBack };
  useEffect(() => {
    const generation = ++lifecycle.current;
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('h2')?.focus();
    document.body.style.overflow = 'hidden';
    const marker = markerRef.current;
    if (history.state?.medipathOverlay !== marker)
      history.pushState({ medipathOverlay: marker }, '', location.href);
    const pop = () => {
      if (actions.current.onBack) {
        history.pushState({ medipathOverlay: marker }, '', location.href);
        actions.current.onBack();
      } else actions.current.onClose();
    };
    const updateHeight = () =>
      dialog.style.setProperty(
        '--visible-height',
        `${window.visualViewport?.height ?? window.innerHeight}px`,
      );
    updateHeight();
    window.visualViewport?.addEventListener('resize', updateHeight);
    window.addEventListener('popstate', pop);
    return () => {
      window.removeEventListener('popstate', pop);
      window.visualViewport?.removeEventListener('resize', updateHeight);
      dialog.close();
      document.body.style.overflow = oldOverflow;
      // React StrictMode replays effects. Only a real unmount removes the history marker.
      queueMicrotask(() => {
        if (lifecycle.current === generation && history.state?.medipathOverlay === marker) history.back();
      });
      if (previous?.isConnected && previous !== document.body && previous !== document.documentElement) previous.focus({ preventScroll: true });
      else document.getElementById('main')?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${className}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby={titleId}
    >
      <div className="dialog-header">
        <div>
          <span className="muted small">{eyebrow}</span>
          <h2 id={titleId} tabIndex={-1}>
            {title}
          </h2>
        </div>
        <button className="icon-button" aria-label="Закрыть окно" onClick={onClose}>
          <X />
        </button>
      </div>
      <div className="dialog-content">{children}</div>
      {footer && <div className="dialog-footer">{footer}</div>}
    </dialog>
  );
}
