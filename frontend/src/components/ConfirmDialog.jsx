import React, { useEffect, useId, useRef } from 'react';

const s = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    padding: 16,
  },
  box: {
    background: '#fff',
    borderRadius: 12,
    padding: 24,
    maxWidth: 420,
    width: '100%',
    boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
  },
  title: { fontWeight: 700, fontSize: 17, margin: '0 0 10px', color: '#222' },
  desc: { fontSize: 14, color: '#555', margin: '0 0 20px', lineHeight: 1.5 },
  actions: { display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' },
  btn: {
    padding: '9px 18px',
    borderRadius: 8,
    border: 'none',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: 40,
  },
  cancel: { background: '#f0f0f0', color: '#333' },
  confirm: { background: '#2d6a4f', color: '#fff' },
  // #b42318 on #fff → 6.1:1 (WCAG AA)
  destructive: { background: '#b42318', color: '#fff' },
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Accessible confirmation dialog used instead of window.confirm().
 *
 * - role="alertdialog" with labelled title and description
 * - focus moves into the dialog (Cancel by default) and is trapped there
 * - Escape or clicking the backdrop cancels
 * - focus returns to the previously focused element on close
 */
export default function ConfirmDialog({
  open = true,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}) {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    cancelRef.current?.focus();

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancelRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!dialogRef.current.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  const hasDescription = Boolean(description || children);

  return (
    <div
      style={s.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel?.();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hasDescription ? descId : undefined}
        style={s.box}
      >
        <h2 id={titleId} style={s.title}>{title}</h2>
        {hasDescription && (
          <div id={descId} style={s.desc}>
            {description}
            {children}
          </div>
        )}
        <div style={s.actions}>
          <button ref={cancelRef} type="button" style={{ ...s.btn, ...s.cancel }} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            style={{ ...s.btn, ...(destructive ? s.destructive : s.confirm) }}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
