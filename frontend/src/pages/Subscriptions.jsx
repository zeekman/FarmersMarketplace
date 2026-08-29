import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import Spinner from '../components/Spinner';

const FREQUENCIES = ['weekly', 'biweekly', 'monthly'];
const FREQ_LABEL = { weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month' };

const s = {
  page:    { maxWidth: 800, margin: '0 auto', padding: 24 },
  title:   { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 4 },
  sub:     { color: '#888', fontSize: 14, marginBottom: 24 },
  card:    { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001', marginBottom: 24 },
  label:   { display: 'block', fontSize: 13, marginBottom: 4, color: '#555' },
  input:   { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, marginBottom: 12, boxSizing: 'border-box' },
  btn:     { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600 },
  msg:     { padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 14 },
  row:     { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 0', borderBottom: '1px solid #f0f0f0', gap: 12 },
  name:    { fontWeight: 600, fontSize: 15, marginBottom: 4 },
  meta:    { fontSize: 13, color: '#666', marginBottom: 2 },
  badge:   { display: 'inline-block', fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 600 },
  actions: { display: 'flex', gap: 8, flexShrink: 0 },
  smBtn:   { fontSize: 12, padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600 },
  picker:    { position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #ddd', borderRadius: 8, boxShadow: '0 4px 12px #0002', maxHeight: 220, overflowY: 'auto', zIndex: 10, marginTop: -8, marginBottom: 12 },
  pickerRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', fontSize: 14 },
  pickerImg: { width: 32, height: 32, borderRadius: 6, objectFit: 'cover', flexShrink: 0, background: '#d8f3dc', fontSize: 16 },
};

const STATUS_STYLE = {
  active:    { background: '#d8f3dc', color: '#2d6a4f' },
  paused:    { background: '#fff3cd', color: '#856404' },
  cancelled: { background: '#fee',    color: '#c0392b' },
};

export default function Subscriptions() {
  const [subs, setSubs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm]       = useState({ product_id: '', quantity: 1, frequency: 'weekly' });
  const [msg, setMsg]         = useState(null);
  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);

  useEffect(() => {
    const q = productQuery.trim();
    if (!q || selectedProduct) { setProductResults([]); return; }
    let active = true;
    api.searchProducts(q).then(res => { if (active) setProductResults(res.data ?? []); }).catch(() => {});
    return () => { active = false; };
  }, [productQuery, selectedProduct]);

  function pickProduct(p) {
    setSelectedProduct(p);
    setProductQuery(p.name);
    setProductResults([]);
    setForm(f => ({ ...f, product_id: p.id }));
  }

  async function load() {
    setLoading(true);
    try {
      const res = await api.getSubscriptions();
      setSubs(res.data ?? []);
    } catch { setSubs([]); }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setMsg(null);
    if (!form.product_id) {
      setMsg({ type: 'err', text: 'Please select a product from the search results' });
      return;
    }
    try {
      await api.createSubscription({ ...form, quantity: parseInt(form.quantity) });
      setMsg({ type: 'ok', text: 'Subscription created!' });
      setForm({ product_id: '', quantity: 1, frequency: 'weekly' });
      setSelectedProduct(null);
      setProductQuery('');
      load();
    } catch (err) { setMsg({ type: 'err', text: err.message }); }
  }

  async function handleAction(id, action) {
    try {
      if (action === 'cancel')  await api.cancelSubscription(id);
      if (action === 'pause')   await api.pauseSubscription(id);
      if (action === 'resume')  await api.resumeSubscription(id);
      load();
    } catch (err) { alert(err.message); }
  }

  return (
    <div style={s.page}>
      <div style={s.title}>🔄 Subscriptions</div>
      <div style={s.sub}>Set up recurring orders for your favourite products</div>

      <div style={s.card}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>New Subscription</h3>
        {msg && (
          <div style={{ ...s.msg, background: msg.type === 'ok' ? '#d8f3dc' : '#fee', color: msg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>
            {msg.text}
          </div>
        )}
        <form onSubmit={handleCreate}>
          <label style={s.label}>Product</label>
          <div style={{ position: 'relative' }}>
            <input
              style={s.input} type="text" required autoComplete="off"
              placeholder="Search for a product…"
              value={productQuery}
              onChange={e => {
                setProductQuery(e.target.value);
                setSelectedProduct(null);
                setForm(f => ({ ...f, product_id: '' }));
              }}
            />
            {productResults.length > 0 && (
              <div style={s.picker}>
                {productResults.map(p => (
                  <div key={p.id} style={s.pickerRow} onClick={() => pickProduct(p)}>
                    {p.image_url
                      ? <img src={p.image_url} alt={p.name} style={s.pickerImg} />
                      : <div style={{ ...s.pickerImg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🥬</div>
                    }
                    <span>{p.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <label style={s.label}>Quantity</label>
          <input
            style={s.input} type="number" min="1" required
            value={form.quantity}
            onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
          />
          <label style={s.label}>Frequency</label>
          <select style={s.input} value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
            {FREQUENCIES.map(fr => <option key={fr} value={fr}>{FREQ_LABEL[fr]}</option>)}
          </select>
          <button style={s.btn} type="submit">Subscribe</button>
        </form>
      </div>

      <div style={s.card}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>My Subscriptions ({subs.length})</h3>
        {loading ? <Spinner /> : subs.length === 0 ? (
          <p style={{ color: '#888', fontSize: 14 }}>No active subscriptions.</p>
        ) : subs.map(sub => (
          <div key={sub.id} style={s.row}>
            <div>
              <div style={s.name}>{sub.product_name}</div>
              <div style={s.meta}>{sub.quantity} {sub.unit} · {FREQ_LABEL[sub.frequency]} · {sub.product_price} XLM/unit</div>
              <div style={s.meta}>
                Next order: {sub.next_order_at && !isNaN(new Date(sub.next_order_at))
                  ? new Date(sub.next_order_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                  : 'Not scheduled'}
              </div>
            </div>
            <div style={s.actions}>
              <span style={{ ...s.badge, ...STATUS_STYLE[sub.status] }}>{sub.status}</span>
              {sub.status === 'active' && (
                <button style={{ ...s.smBtn, background: '#fff3cd', color: '#856404' }} onClick={() => handleAction(sub.id, 'pause')}>Pause</button>
              )}
              {sub.status === 'paused' && (
                <button style={{ ...s.smBtn, background: '#d8f3dc', color: '#2d6a4f' }} onClick={() => handleAction(sub.id, 'resume')}>Resume</button>
              )}
              <button style={{ ...s.smBtn, background: '#fee', color: '#c0392b' }} onClick={() => { if (confirm('Cancel this subscription?')) handleAction(sub.id, 'cancel'); }}>Cancel</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
