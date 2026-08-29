import React, { useState } from 'react';
import { api } from '../../api/client';

/**
 * BulkPricePanel — lets farmers apply a percentage or per-product price update
 * across all their listings in one action.
 * Extracted from Dashboard.jsx (#1060).
 *
 * Props:
 *   products – array of current product objects
 *   onUpdated – callback invoked (with no args) after a successful update so the
 *               parent can reload its product list
 */
export default function BulkPricePanel({ products = [], onUpdated }) {
  const [bulkPriceSelections, setBulkPriceSelections] = useState({});
  const [bulkAdjustPct, setBulkAdjustPct] = useState('');
  const [bulkPriceMsg, setBulkPriceMsg] = useState(null);

  const s = {
    card: { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001', marginBottom: 24 },
    label: { display: 'block', fontSize: 13, marginBottom: 4, color: '#555' },
    input: {
      width: '100%',
      padding: '9px 12px',
      border: '1px solid #ddd',
      borderRadius: 8,
      fontSize: 16,
      marginBottom: 4,
      boxSizing: 'border-box',
      minHeight: 44,
    },
    btn: {
      background: '#2d6a4f',
      color: '#fff',
      border: 'none',
      borderRadius: 8,
      padding: '10px 20px',
      cursor: 'pointer',
      fontWeight: 600,
      minHeight: 44,
    },
    msg: { padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 14 },
  };

  async function handleBulkPriceUpdate() {
    setBulkPriceMsg(null);
    const updates = Object.entries(bulkPriceSelections)
      .filter(([, v]) => v !== '')
      .map(([productId, newPrice]) => ({ product_id: Number(productId), price: parseFloat(newPrice) }));

    if (updates.length === 0 && bulkAdjustPct === '') {
      setBulkPriceMsg({ type: 'err', text: 'Enter a percentage adjustment or individual prices.' });
      return;
    }

    const adjustmentPercent = bulkAdjustPct !== '' ? parseFloat(bulkAdjustPct) : undefined;
    const payload = { updates, adjustment_percent: adjustmentPercent };

    try {
      const res = await api.bulkUpdatePrices(payload.updates, payload.adjustment_percent);
      setBulkPriceMsg({
        type: 'ok',
        text: `Updated ${res.data?.updated ?? updates.length} product(s).`,
      });
      setBulkPriceSelections({});
      setBulkAdjustPct('');
      onUpdated?.();
    } catch (e) {
      setBulkPriceMsg({ type: 'err', text: e.message || 'Bulk update failed' });
    }
  }

  return (
    <div style={s.card}>
      <h3 style={{ marginBottom: 12, color: '#333' }}>💰 Bulk Price Update</h3>
      {bulkPriceMsg && (
        <div
          style={{
            ...s.msg,
            background: bulkPriceMsg.type === 'ok' ? '#d8f3dc' : '#fee',
            color: bulkPriceMsg.type === 'ok' ? '#2d6a4f' : '#c0392b',
          }}
        >
          {bulkPriceMsg.text}
        </div>
      )}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
        <label style={{ ...s.label, marginBottom: 0 }}>% Adjustment (all products):</label>
        <input
          style={{ ...s.input, width: 100, marginBottom: 0 }}
          type="number"
          step="any"
          placeholder="e.g. +10"
          value={bulkAdjustPct}
          onChange={(e) => setBulkAdjustPct(e.target.value)}
        />
        <span style={{ fontSize: 13, color: '#888' }}>or set individual prices below</span>
      </div>
      <table
        style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 12 }}
      >
        <thead>
          <tr style={{ borderBottom: '2px solid #eee' }}>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>Product</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>
              Current Price (XLM)
            </th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>
              New Price (XLM)
            </th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={{ padding: '6px 8px' }}>{p.name}</td>
              <td style={{ padding: '6px 8px', color: '#666' }}>{p.price}</td>
              <td style={{ padding: '6px 8px' }}>
                <input
                  style={{ ...s.input, width: 100, marginBottom: 0, padding: '5px 8px' }}
                  type="number"
                  min="0.0000001"
                  step="any"
                  placeholder="—"
                  value={bulkPriceSelections[p.id] || ''}
                  onChange={(e) =>
                    setBulkPriceSelections((prev) => ({ ...prev, [p.id]: e.target.value }))
                  }
                  disabled={bulkAdjustPct !== ''}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button style={s.btn} onClick={handleBulkPriceUpdate}>
        Apply Price Update
      </button>
    </div>
  );
}
