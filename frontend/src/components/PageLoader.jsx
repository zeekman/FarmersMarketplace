import React from 'react';

export default function PageLoader() {
  return (
    <div role="status" aria-label="Loading page" style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
    }}>
      <div style={{
        width: 40,
        height: 40,
        border: '4px solid #d8f3dc',
        borderTop: '4px solid #2d6a4f',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
