import React from 'react';

/**
 * BundleDiscountPanel — lets farmers configure automatic multi-product
 * discount tiers for buyers.
 * Extracted from Dashboard.jsx (#1060).
 *
 * Props:
 *   bundleDiscounts – array of { id, min_products, discount_percent }
 *   bdForm          – { min_products: string, discount_percent: string }
 *   bdMsg           – { type: 'ok'|'error', text: string } | null
 *   onFormChange    – (field: string, value: string) => void
 *   onSubmit        – (e: Event) => void
 *   onDelete        – (id: number) => void
 */
export default function BundleDiscountPanel({
  bundleDiscounts = [],
  bdForm = { min_products: '', discount_percent: '' },
  bdMsg = null,
  onFormChange,
  onSubmit,
  onDelete,
}) {
  const s = {
    card: { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001', marginTop: 24 },
    label: { display: 'block', fontSize: 13, marginBottom: 4, color: '#555' },
    input: {
      width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8,
      fontSize: 16, marginBottom: 4, boxSizing: 'border-box', minHeight: 44,
    },
    btn: {
      background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8,
      padding: '10px 20px', cursor: 'pointer', fontWeight: 600, minHeight: 44,
    },
    msg: { padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 14 },
  };

  return (
    <div style={s.card}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#2d6a4f', marginBottom: 12 }}>
        🏷️ Bundle Discounts
      </div>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
        Buyers who order multiple different products from you get an automatic discount.
        Add tiers below (e.g. 3+ products = 10% off).
      </p>
      {bdMsg && (
        <div style={{
          ...s.msg,
          background: bdMsg.type === 'ok' ? '#d8f3dc' : '#fee',
          color: bdMsg.type === 'ok' ? '#2d6a4f' : '#c0392b',
        }}>
          {bdMsg.text}
        </div>
      )}
      <form
        onSubmit={onSubmit}
        style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}
      >
        <div>
          <label style={s.label}>Min. distinct products</label>
          <input
            style={{ ...s.input, width: 120 }}
            type="number"
            min="2"
            placeholder="e.g. 3"
            value={bdForm.min_products}
            onChange={(e) => onFormChange?.('min_products', e.target.value)}
            required
          />
        </div>
        <div>
          <label style={s.label}>Discount %</label>
          <input
            style={{ ...s.input, width: 120 }}
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            placeholder="e.g. 10"
            value={bdForm.discount_percent}
            onChange={(e) => onFormChange?.('discount_percent', e.target.value)}
            required
          />
        </div>
        <button type="submit" style={s.btn}>Add Tier</button>
      </form>

      {bundleDiscounts.length === 0 ? (
        <div style={{ color: '#888', fontSize: 13 }}>No discount tiers configured.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #eee', color: '#555' }}>
                Min. products
              </th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #eee', color: '#555' }}>
                Discount
              </th>
              <th style={{ padding: '8px 10px', borderBottom: '2px solid #eee' }}></th>
            </tr>
          </thead>
          <tbody>
            {bundleDiscounts.map((bd) => (
              <tr key={bd.id}>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid #f0f0f0' }}>
                  {bd.min_products}+ products
                </td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid #f0f0f0', color: '#2d6a4f', fontWeight: 600 }}>
                  {bd.discount_percent}% off
                </td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid #f0f0f0', textAlign: 'right' }}>
                  <button
                    style={{ background: '#fee', color: '#c0392b', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}
                    onClick={() => onDelete?.(bd.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
