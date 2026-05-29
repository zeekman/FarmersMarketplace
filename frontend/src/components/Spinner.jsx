import React from 'react';

/**
 * Centered loading spinner for use in page sections
 * Shows a spinning animation with optional message
 */
export default function Spinner({ message = 'Loading...', size = 40 }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '60px 20px',
      gap: 16,
    }}>
      <div style={{
        width: size,
        height: size,
        border: `4px solid #f3f3f3`,
        borderTop: `4px solid #2d6a4f`,
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
      }} />
      <div style={{
        color: '#666',
        fontSize: 14,
        textAlign: 'center',
      }}>
        {message}
      </div>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
