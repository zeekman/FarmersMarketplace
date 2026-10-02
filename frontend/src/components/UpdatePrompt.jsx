import React, { useEffect, useState } from 'react';

const bannerStyle = {
  position: 'fixed',
  bottom: 0,
  left: 0,
  right: 0,
  background: '#2d6a4f',
  color: '#fff',
  padding: '12px 20px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  zIndex: 9999,
};

const btnBase = {
  border: 'none',
  borderRadius: '4px',
  padding: '6px 14px',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.875rem',
};

export default function UpdatePrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    function handleMessage(event) {
      if (event.data && event.data.type === 'SW_UPDATED') {
        setShow(true);
      }
    }

    navigator.serviceWorker?.addEventListener('message', handleMessage);
    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleMessage);
    };
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;

    // A new sw.js (with a fresh build hash in its cache name) is byte-different
    // after every deploy, so the browser installs it and fires updatefound.
    // Surface the prompt as soon as the new worker is installed and waiting.
    function handleControllerChange() {
      setShow(true);
    }

    function watchRegistration(registration) {
      if (!registration) return;
      if (registration.waiting && navigator.serviceWorker.controller) {
        setShow(true);
      }
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            setShow(true);
          }
        });
      });
    }

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
    navigator.serviceWorker.ready.then(watchRegistration).catch(() => {});

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  function handleRefresh() {
    // Tell the waiting service worker to skip waiting, then reload.
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
    }
    window.location.reload();
  }

  function handleDismiss() {
    setShow(false);
  }

  if (!show) return null;

  return (
    <div style={bannerStyle} role="alert" aria-live="polite">
      <span>🔄 A new version is available — click to refresh</span>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={handleRefresh}
          style={{ ...btnBase, background: '#fff', color: '#2d6a4f' }}
          aria-label="Refresh to apply the update"
        >
          Refresh
        </button>
        <button
          onClick={handleDismiss}
          style={{ ...btnBase, background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.6)' }}
          aria-label="Dismiss update notification"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
