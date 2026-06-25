import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCompare } from '../context/CompareContext';

export const MAX_RECENTLY_COMPARED = 10;
export const MAX_DISPLAY_PAIRS = 5;

const s = {
  strip: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    background: '#fff',
    borderTop: '1px solid #e0e0e0',
    boxShadow: '0 -2px 12px #0002',
    padding: '10px 20px',
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    zIndex: 1000,
    flexWrap: 'wrap',
  },
  label: { fontSize: 13, fontWeight: 700, color: '#2d6a4f', whiteSpace: 'nowrap' },
  items: { display: 'flex', gap: 10, flex: 1, overflowX: 'auto' },
  thumb: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    background: '#f5f5f5',
    borderRadius: 8,
    padding: '6px 10px',
    minWidth: 80,
    fontSize: 12,
    color: '#333',
    textAlign: 'center',
  },
  compareBtn: {
    background: '#2d6a4f',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '8px 16px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 13,
    whiteSpace: 'nowrap',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 18,
    color: '#888',
    lineHeight: 1,
    padding: '0 4px',
  },
};

export default function RecentlyCompared() {
  const navigate = useNavigate();
  const { history, clearHistory } = useCompare();
  const [productNames, setProductNames] = useState({});

  const latest = history[0];

  useEffect(() => {
    if (!latest) return;
    const missing = latest.productIds.filter(id => !productNames[id]);
    if (!missing.length) return;
    Promise.all(
      missing.map(id =>
        fetch(`/api/products/${id}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => ({ id, name: data?.data?.name || `Product ${id}` }))
          .catch(() => ({ id, name: `Product ${id}` }))
      )
    ).then(results => {
      const names = {};
      results.forEach(({ id, name }) => { names[id] = name; });
      setProductNames(prev => ({ ...prev, ...names }));
    });
  }, [latest]);

  if (!latest || dismissed) return null;

  const visible = latest.productIds.slice(0, MAX_VISIBLE);

  function handleCompareNow() {
    const ids = latest.productIds.join(',');
    navigate(`/compare?products=${ids}`);
  }

  function handleDismiss() {
    sessionStorage.setItem(SESSION_KEY, '1');
    setDismissed(true);
  }

  return (
    <div style={s.container}>
      <div style={s.header}>
        <h3 style={s.title}>📊 Recently Compared</h3>
        <button
          style={{ ...s.clearBtn, marginRight: 8, borderColor: '#2d6a4f', color: '#2d6a4f' }}
          onClick={() => navigate('/compare')}
        >
          View Compare Page
        </button>
        <button
          style={s.clearBtn}
          onClick={clearHistory}
          onMouseEnter={(e) => (e.target.style.background = '#fee')}
          onMouseLeave={(e) => (e.target.style.background = '#fff')}
        >
          Clear History
        </button>
      </div>

      {history.length === 0 ? (
        <div style={s.empty}>No comparison history yet</div>
      ) : (
        <div style={s.list}>
          {history.slice(0, MAX_DISPLAY_PAIRS).map((entry) => (
            <div
              key={entry.id}
              style={s.item}
              onMouseEnter={(e) => Object.assign(e.currentTarget.style, s.itemHover)}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = '';
                e.currentTarget.style.borderColor = '#ddd';
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={s.productNames}>
                  {entry.productIds
                    .map((id) => productNames[id] || `Product ${id}`)
                    .join(', ')}
                </div>
                <div style={s.timestamp}>{formatDate(entry.timestamp)}</div>
              </div>
              <button
                style={s.restoreBtn}
                onClick={() => handleRestore(entry)}
                onMouseEnter={(e) => {
                  e.target.style.background = '#2d6a4f';
                  e.target.style.color = '#fff';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = '#e8f5e9';
                  e.target.style.color = '#2d6a4f';
                }}
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
