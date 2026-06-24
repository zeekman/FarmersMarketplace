import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCompare } from '../context/CompareContext';

export const MAX_RECENTLY_COMPARED = 10;
const SESSION_KEY = 'rc_strip_dismissed';
const MAX_VISIBLE = 4;

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
  const { history, products: compareProducts, addProduct } = useCompare();
  const [dismissed, setDismissed] = useState(
    () => !!sessionStorage.getItem(SESSION_KEY)
  );
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
    <div style={s.strip} role="region" aria-label="Recently compared products">
      <span style={s.label}>📊 Recently Compared</span>
      <div style={s.items}>
        {visible.map(id => (
          <div key={id} style={s.thumb}>
            <span style={{ fontSize: 20 }}>🥬</span>
            <span style={{ marginTop: 4 }}>{productNames[id] || `#${id}`}</span>
          </div>
        ))}
        {latest.productIds.length > MAX_VISIBLE && (
          <div style={{ ...s.thumb, justifyContent: 'center' }}>
            +{latest.productIds.length - MAX_VISIBLE} more
          </div>
        )}
      </div>
      <button style={s.compareBtn} onClick={handleCompareNow}>Compare now</button>
      <button style={s.closeBtn} onClick={handleDismiss} aria-label="Dismiss">✕</button>
    </div>
  );
}
