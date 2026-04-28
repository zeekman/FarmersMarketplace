import React, { useState, useEffect } from 'react';

const toastStyles = {
  container: {
    position: 'fixed',
    bottom: 24,
    right: 24,
    zIndex: 9999,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    pointerEvents: 'none'
  },
  toast: {
    background: '#2d6a4f',
    color: '#fff',
    borderRadius: 10,
    padding: '12px 18px',
    boxShadow: '0 4px 16px #0003',
    fontSize: 14,
    minWidth: 260,
    maxWidth: 360,
    pointerEvents: 'auto',
    animation: 'slideIn 0.3s ease-out'
  },
  toastError: {
    background: '#c0392b'
  },
  toastTitle: {
    fontWeight: 700,
    marginBottom: 3
  },
  toastSub: {
    fontSize: 12,
    opacity: 0.85
  }
};

// Add animation styles to document head
if (typeof document !== 'undefined' && !document.getElementById('toast-style')) {
  const style = document.createElement('style');
  style.id = 'toast-style';
  style.textContent = `
    @keyframes slideIn {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes slideOut {
      from { opacity: 1; transform: translateY(0); }
      to { opacity: 0; transform: translateY(12px); }
    }
  `;
  document.head.appendChild(style);
}

export function useToast() {
  const [toasts, setToasts] = useState([]);

  const addToast = (message, type = 'success', duration = 3000) => {
    const id = Date.now();
    const newToast = { id, message, type, duration };
    
    setToasts(prev => [...prev, newToast]);
    
    // Auto remove after duration
    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, duration);
    }
    
    return id;
  };

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const showSuccess = (message, duration = 3000) => {
    return addToast(message, 'success', duration);
  };

  const showError = (message, duration = 5000) => {
    return addToast(message, 'error', duration);
  };

  return { toasts, addToast, removeToast, showSuccess, showError };
}

export default function Toast({ toasts }) {
  return (
    <div style={toastStyles.container} aria-live="polite" aria-atomic="true">
      {toasts.map(t => (
        <div 
          key={t.id} 
          style={{
            ...toastStyles.toast,
            ...(t.type === 'error' ? toastStyles.toastError : {})
          }} 
          role="status"
          aria-label={t.type === 'error' ? `Error: ${t.message}` : `Success: ${t.message}`}
        >
          <div style={toastStyles.toastTitle}>
            {t.type === 'error' ? 'Error' : 'Success'}
          </div>
          <div style={toastStyles.toastSub}>{t.message}</div>
        </div>
      ))}
    </div>
  );
}
