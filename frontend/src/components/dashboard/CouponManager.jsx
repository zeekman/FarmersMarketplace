import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';

/**
 * CouponManager — create, list, and delete promotional coupon codes for a farmer.
 * Extracted from Dashboard.jsx (#1060).
 */
export default function CouponManager() {
  const [coupons, setCoupons] = useState([]);
  const [couponForm, setCouponForm] = useState({
    code: '',
    discount_type: 'percent',
    discount_value: '',
    max_uses: '',
    expires_at: '',
  });
  const [couponMsg, setCouponMsg] = useState(null);
  const [loading, setLoading] = useState(false);

  const s = {
    card: {
      background: '#fff',
      borderRadius: 12,
      padding: 24,
      boxShadow: '0 1px 8px #0001',
      marginBottom: 24,
    },
    label: { display: 'block', fontSize: 13, marginBottom: 4, color: '#555' },
    input: {
      width: '100%',
      padding: '9px 12px',
      border: '1px solid #ddd',
      borderRadius: 8,
      fontSize: 14,
      marginBottom: 4,
      boxSizing: 'border-box',
      minHeight: 40,
    },
    btn: {
      background: '#2d6a4f',
      color: '#fff',
      border: 'none',
      borderRadius: 8,
      padding: '10px 20px',
      cursor: 'pointer',
      fontWeight: 600,
      minHeight: 40,
    },
    del: {
      background: '#fee',
      color: '#c0392b',
      border: 'none',
      borderRadius: 6,
      padding: '4px 10px',
      cursor: 'pointer',
      fontSize: 12,
    },
    msg: { padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 14 },
    badge: (type) => ({
      display: 'inline-block',
      fontSize: 11,
      borderRadius: 4,
      padding: '2px 7px',
      fontWeight: 600,
      background: type === 'percent' ? '#d8f3dc' : '#dbeafe',
      color: type === 'percent' ? '#2d6a4f' : '#1e40af',
    }),
  };

  const loadCoupons = useCallback(async () => {
    try {
      const res = await api.getMyCoupons();
      setCoupons(res.data ?? []);
    } catch {
      setCoupons([]);
    }
  }, []);

  useEffect(() => {
    loadCoupons();
  }, [loadCoupons]);

  async function handleSubmit(e) {
    e.preventDefault();
    setCouponMsg(null);
    setLoading(true);
    try {
      await api.createCoupon({
        code: couponForm.code.trim().toUpperCase(),
        discount_type: couponForm.discount_type,
        discount_value: parseFloat(couponForm.discount_value),
        max_uses: couponForm.max_uses ? parseInt(couponForm.max_uses, 10) : null,
        expires_at: couponForm.expires_at || null,
      });
      setCouponForm({ code: '', discount_type: 'percent', discount_value: '', max_uses: '', expires_at: '' });
      setCouponMsg({ type: 'ok', text: 'Coupon created successfully.' });
      loadCoupons();
    } catch (err) {
      setCouponMsg({ type: 'err', text: err.message || 'Failed to create coupon.' });
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this coupon?')) return;
    try {
      await api.deleteCoupon(id);
      loadCoupons();
    } catch (err) {
      setCouponMsg({ type: 'err', text: err.message || 'Failed to delete coupon.' });
    }
  }

  return (
    <div style={s.card}>
      <h3 style={{ marginBottom: 16, color: '#333' }}>🎟️ Coupon Codes</h3>

      {couponMsg && (
        <div
          role="alert"
          style={{
            ...s.msg,
            background: couponMsg.type === 'ok' ? '#d8f3dc' : '#fee',
            color: couponMsg.type === 'ok' ? '#2d6a4f' : '#c0392b',
          }}
        >
          {couponMsg.text}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={s.label} htmlFor="coupon-code">Code</label>
            <input
              id="coupon-code"
              style={s.input}
              placeholder="e.g. SUMMER10"
              value={couponForm.code}
              onChange={(e) => setCouponForm((f) => ({ ...f, code: e.target.value }))}
              required
              maxLength={32}
            />
          </div>
          <div>
            <label style={s.label} htmlFor="coupon-type">Type</label>
            <select
              id="coupon-type"
              style={s.input}
              value={couponForm.discount_type}
              onChange={(e) => setCouponForm((f) => ({ ...f, discount_type: e.target.value }))}
            >
              <option value="percent">Percent (%)</option>
              <option value="fixed">Fixed (XLM)</option>
            </select>
          </div>
          <div>
            <label style={s.label} htmlFor="coupon-value">Value</label>
            <input
              id="coupon-value"
              style={s.input}
              type="number"
              min="0.01"
              step="any"
              placeholder={couponForm.discount_type === 'percent' ? 'e.g. 10' : 'e.g. 5'}
              value={couponForm.discount_value}
              onChange={(e) => setCouponForm((f) => ({ ...f, discount_value: e.target.value }))}
              required
            />
          </div>
          <div>
            <label style={s.label} htmlFor="coupon-max-uses">Max uses <span style={{ color: '#aaa', fontWeight: 400 }}>(optional)</span></label>
            <input
              id="coupon-max-uses"
              style={s.input}
              type="number"
              min="1"
              step="1"
              placeholder="Unlimited"
              value={couponForm.max_uses}
              onChange={(e) => setCouponForm((f) => ({ ...f, max_uses: e.target.value }))}
            />
          </div>
          <div>
            <label style={s.label} htmlFor="coupon-expires-at">Expires at <span style={{ color: '#aaa', fontWeight: 400 }}>(optional)</span></label>
            <input
              id="coupon-expires-at"
              style={s.input}
              type="datetime-local"
              value={couponForm.expires_at}
              onChange={(e) => setCouponForm((f) => ({ ...f, expires_at: e.target.value }))}
            />
          </div>
        </div>
        <button type="submit" style={s.btn} disabled={loading}>
          {loading ? 'Creating…' : 'Create Coupon'}
        </button>
      </form>

      {coupons.length === 0 ? (
        <p style={{ color: '#888', fontSize: 14, marginTop: 16 }}>No coupon codes yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginTop: 20 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #eee' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>Code</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>Discount</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>Uses</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>Expires</th>
              <th style={{ padding: '6px 8px' }}></th>
            </tr>
          </thead>
          <tbody>
            {coupons.map((c) => (
              <tr key={c.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1 }}>
                  {c.code}
                </td>
                <td style={{ padding: '6px 8px' }}>
                  <span style={s.badge(c.discount_type)}>
                    {c.discount_type === 'percent' ? `${c.discount_value}%` : `${c.discount_value} XLM`}
                  </span>
                </td>
                <td style={{ padding: '6px 8px', color: '#666' }}>
                  {c.uses_count ?? 0}
                  {c.max_uses ? ` / ${c.max_uses}` : ''}
                </td>
                <td style={{ padding: '6px 8px', fontSize: 12, color: '#888' }}>
                  {c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '—'}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                  <button style={s.del} onClick={() => handleDelete(c.id)}>
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
