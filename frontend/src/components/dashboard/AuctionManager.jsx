import React, { useState } from 'react';
import { api } from '../../api/client';

const s = {
  label: { display: 'block', fontSize: 13, marginBottom: 4, color: '#555' },
  input: { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 16, marginBottom: 4, boxSizing: 'border-box', minHeight: 44 },
  btn: { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, minHeight: 44 },
  msg: { padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 14 },
};

export default function AuctionManager({ products }) {
  const [form, setForm] = useState({ product_id: '', start_price: '', reserve_price: '', ends_at: '' });
  const [msg, setMsg] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg(null);

    // Client-side validation: end time must be in the future
    const endsAt = new Date(form.ends_at);
    if (endsAt <= new Date()) {
      setMsg({ type: 'err', text: 'End time must be in the future.' });
      return;
    }

    // Client-side validation: reserve price must be ≥ starting price (when provided)
    const startPrice = parseFloat(form.start_price);
    const reservePrice = form.reserve_price !== '' ? parseFloat(form.reserve_price) : null;
    if (reservePrice !== null && reservePrice < startPrice) {
      setMsg({ type: 'err', text: 'Reserve price must be greater than or equal to the starting price.' });
      return;
    }

    try {
      const payload = {
        product_id: parseInt(form.product_id),
        start_price: startPrice,
        ends_at: endsAt.toISOString(),
      };
      if (reservePrice !== null) {
        payload.reserve_price = reservePrice;
      }

      await api.createAuction(payload);
      setMsg({ type: 'ok', text: 'Auction created!' });
      setForm({ product_id: '', start_price: '', reserve_price: '', ends_at: '' });
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    }
  }

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001', marginTop: 24, maxWidth: 440 }}>
      <h3 style={{ marginBottom: 16, color: '#333' }}>🔨 Create Auction</h3>
      {msg && (
        <div
          role="alert"
          style={{ ...s.msg, background: msg.type === 'ok' ? '#d8f3dc' : '#fee', color: msg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}
        >
          {msg.text}
        </div>
      )}
      <form onSubmit={handleSubmit}>
        <label style={s.label} htmlFor="auction-product">Product</label>
        <select
          id="auction-product"
          style={s.input}
          value={form.product_id}
          onChange={e => setForm({ ...form, product_id: e.target.value })}
          required
        >
          <option value="">Select a product</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <label style={s.label} htmlFor="auction-start-price">Starting Price (XLM)</label>
        <input
          id="auction-start-price"
          style={s.input}
          type="number"
          min="0.01"
          step="0.01"
          value={form.start_price}
          onChange={e => setForm({ ...form, start_price: e.target.value })}
          required
        />

        <label style={s.label} htmlFor="auction-reserve-price">Reserve Price (XLM, optional)</label>
        <input
          id="auction-reserve-price"
          style={s.input}
          type="number"
          min="0.01"
          step="0.01"
          value={form.reserve_price}
          onChange={e => setForm({ ...form, reserve_price: e.target.value })}
        />

        <label style={s.label} htmlFor="auction-ends-at">Ends At</label>
        <input
          id="auction-ends-at"
          style={s.input}
          type="datetime-local"
          value={form.ends_at}
          onChange={e => setForm({ ...form, ends_at: e.target.value })}
          required
        />

        <button style={{ ...s.btn, background: '#e07b00' }} type="submit">Create Auction</button>
      </form>
    </div>
  );
}
