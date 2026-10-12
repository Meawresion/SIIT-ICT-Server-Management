import { useEffect, useId, useRef } from 'react';
import { CloseIcon } from './Icons.jsx';

export default function Modal({ title, onClose, children, footer, size = 'md', headerExtra }) {
  const titleId = useId();
  const panelRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        ref={panelRef}
      >
        {title && (
          <header className="modal-header">
            <h2 id={titleId}>{title}</h2>
            <div className="modal-header-right">
              {headerExtra}
              {onClose && (
                <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
                  <CloseIcon />
                </button>
              )}
            </div>
          </header>
        )}
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}
