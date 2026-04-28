import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCompare } from '../context/CompareContext';

export const MAX_RECENTLY_COMPARED = 10;

const s = {
  container: {
    marginBottom: 36,
    padding: 20,
    background: '#f9f9f9',
    borderRadius: 12,
    border: '1px solid #e0e0e0',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    color: '#2d6a4f',
    margin: 0,
  },
  clearBtn: {
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid #ddd',
    background: '#fff',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    color: '#666',
    transition: 'all 0.2s',
  },
  list: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
  },
  item: {
    padding: 12,
    background: '#fff',
    borderRadius: 8,
    border: '1px solid #ddd',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  itemHover: {
    boxShadow: '0 2px 8px #0001',
    borderColor: '#2d6a4f',
  },
  productNames: {
    fontSize: 13,
    color: '#333',
    fontWeight: 500,
  },
  timestamp: {
    fontSize: 11,
    color: '#999',
    marginTop: 4,
  },
  restoreBtn: {
    padding: '6px 10px',
    borderRadius: 4,
    border: '1px solid #2d6a4f',
    background: '#e8f5e9',
    color: '#2d6a4f',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 600,
    transition: 'all 0.2s',
  },
  empty: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
  },
};

export default function RecentlyCompared() {
  const navigate = useNavigate();
  const { history, clearHistory, saveToHistory } = useCompare();
  const [productNames, setProductNames] = useState({});

  // Fetch product names for history entries
  useEffect(() => {
    const fetchNames = async () => {
      const names = {};
      for (const entry of history) {
        for (const productId of entry.productIds) {
          if (!names[productId]) {
            try {
              const res = await fetch(`/api/products/${productId}`);
              if (res.ok) {
                const data = await res.json();
                names[productId] = data.data?.name || `Product ${productId}`;
              }
            } catch (e) {
              names[productId] = `Product ${productId}`;
            }
          }
        }
      }
      setProductNames(names);
    };

    if (history.length > 0) {
      fetchNames();
    }
  }, [history]);

  if (history.length === 0) {
    return null;
  }

  const handleRestore = (entry) => {
    // Navigate to compare page with product IDs
    const ids = entry.productIds.join(',');
    navigate(`/compare?products=${ids}`);
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div style={s.container}>
      <div style={s.header}>
        <h3 style={s.title}>📊 Recently Compared</h3>
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
          {history.map((entry) => (
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
                onMouseEnter={(e) => (e.target.style.background = '#2d6a4f')}
                onMouseLeave={(e) => (e.target.style.background = '#e8f5e9')}
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
