import React from 'react';
import { useModalA11y } from '../hooks/useModalA11y';

/**
 * Shared modal component with accessibility features (focus trap, Escape to close, focus restore).
 * 
 * @param {boolean} open - Whether the modal is open
 * @param {function} onClose - Handler called when modal should close (Escape key or backdrop click)
 * @param {string} title - Modal title (for aria-labelledby)
 * @param {ReactNode} children - Modal content
 * @param {Object} styles - Optional style overrides
 */
export default function Modal({ open, onClose, title, titleId, children, styles = {} }) {
  const dialogRef = useModalA11y(open, onClose);
  
  if (!open) return null;

  const defaultStyles = {
    overlay: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: 16,
    },
    dialog: {
      background: '#fff',
      borderRadius: 12,
      padding: 24,
      maxWidth: 500,
      width: '100%',
      maxHeight: '90vh',
      overflowY: 'auto',
      boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
    },
    title: {
      fontSize: 18,
      fontWeight: 700,
      color: '#2d6a4f',
      marginBottom: 16,
      marginTop: 0,
    },
  };

  const mergedStyles = {
    overlay: { ...defaultStyles.overlay, ...styles.overlay },
    dialog: { ...defaultStyles.dialog, ...styles.dialog },
    title: { ...defaultStyles.title, ...styles.title },
  };

  return (
    <div
      style={mergedStyles.overlay}
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId || 'modal-title'}
        style={mergedStyles.dialog}
      >
        {title && (
          <h2 id={titleId || 'modal-title'} style={mergedStyles.title}>
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}
