import React, { useState } from 'react';
import { api } from '../../api/client';
import { getErrorMessage } from '../../utils/errorMessages';

const s = {
  label: { display: 'block', fontSize: 13, marginBottom: 4, color: '#555' },
  input: { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 16, marginBottom: 4, boxSizing: 'border-box', minHeight: 44 },
  btn: { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, minHeight: 44 },
  msg: { padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 14 },
};

export default function FlashSaleManager({ products, onChanged }) {
  const [form, setForm] = useState({ product_id: '', flash_sale_price: '', flash_sale_ends_at: '' });
  const [msg, setMsg] = useState(null);
  const [endsAtError, setEndsAtError] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(null); // { id, name } of product pending cancel

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg(null);
    setEndsAtError('');

    const endsAt = new Date(form.flash_sale_ends_at);
    if (!form.flash_sale_ends_at || endsAt <= new Date()) {
      setEndsAtError('End time must be in the future.');
      return;
    }

    try {
      const res = await api.setFlashSale(parseInt(form.product_id, 10), {
        flash_sale_price: parseFloat(form.flash_sale_price),
        flash_sale_ends_at: endsAt.toISOString(),
      });
      setMsg({ type: 'ok', text: `Flash sale set for product #${res.data.id}` });
      onChanged?.();
    } catch (e) {
      setMsg({ type: 'err', text: getErrorMessage(e) });
    }
  }

  function requestCancel(product) {
    setConfirmCancel({ id: product.id, name: product.name });
  }

  async function confirmCancelSale() {
    const { id } = confirmCancel;
    setConfirmCancel(null);
    try {
      await api.cancelFlashSale(id);
      setMsg({ type: 'ok', text: `Flash sale canceled for product #${id}` });
      onChanged?.();
    } catch (e) {
      setMsg({ type: 'err', text: getErrorMessage(e) });
    }
  }

  function dismissConfirm() {
    setConfirmCancel(null);
  }

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001', marginBottom: 24 }}>
      <h3 style={{ marginBottom: 12, color: '#333' }}>Flash Sales</h3>
      {msg && (
        <div role={msg.type === 'ok' ? 'status' : 'alert'} style={{ ...s.msg, background: msg.type === 'ok' ? '#d8f3dc' : '#fee', color: msg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>
          {msg.text}
        </div>
      )}

      {confirmCancel && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-flash-sale-title"
          style={{ background: '#fff7f7', border: '1px solid #c0392b', borderRadius: 10, padding: 20, marginBottom: 16 }}
        >
          <p id="cancel-flash-sale-title" style={{ marginBottom: 12, fontWeight: 600, color: '#333' }}>
            Cancel flash sale for <strong>{confirmCancel.name}</strong>? This will end the promotion immediately.
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              style={{ ...s.btn, background: '#c0392b' }}
              onClick={confirmCancelSale}
            >
              Yes, cancel sale
            </button>
            <button
              type="button"
              style={{ ...s.btn, background: '#888' }}
              onClick={dismissConfirm}
            >
              Keep sale
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 10, alignItems: 'end' }}>
        <div>
          <label style={s.label}>Product</label>
          <select style={s.input} value={form.product_id} onChange={e => setForm(f => ({ ...f, product_id: e.target.value }))} required>
            <option value="">Select product</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label style={s.label}>Flash Price (XLM)</label>
          <input style={s.input} type="number" min="0" step="any" required value={form.flash_sale_price} onChange={e => setForm(f => ({ ...f, flash_sale_price: e.target.value }))} />
        </div>
        <div>
          <label style={s.label}>Ends At</label>
          <input
            style={{ ...s.input, ...(endsAtError ? { borderColor: '#c0392b' } : {}) }}
            type="datetime-local"
            required
            value={form.flash_sale_ends_at}
            onChange={e => { setEndsAtError(''); setForm(f => ({ ...f, flash_sale_ends_at: e.target.value })); }}
            aria-describedby={endsAtError ? 'ends-at-error' : undefined}
          />
          {endsAtError && (
            <span id="ends-at-error" role="alert" style={{ color: '#c0392b', fontSize: 12 }}>
              {endsAtError}
            </span>
          )}
        </div>
        <button type="submit" style={s.btn}>Set Flash Sale</button>
      </form>
      <div style={{ marginTop: 14 }}>
        {products.filter(p => p.flash_sale_price && p.flash_sale_ends_at).map(p => (
          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #eee', paddingTop: 10, marginTop: 10 }}>
            <div style={{ fontSize: 14 }}>
              <strong>{p.name}</strong> – {p.flash_sale_price} XLM until {new Date(p.flash_sale_ends_at).toLocaleString()}
            </div>
            <button type="button" style={{ ...s.btn, background: '#c0392b' }} onClick={() => requestCancel(p)}>Cancel</button>
          </div>
        ))}
      </div>
    </div>
  );
}
