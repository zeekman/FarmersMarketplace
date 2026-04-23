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
    try {
      await api.createSubscription({ ...form, quantity: parseInt(form.quantity) });
      setMsg({ type: 'ok', text: 'Subscription created!' });
      setForm({ product_id: '', quantity: 1, frequency: 'weekly' });
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
          <label style={s.label}>Product ID</label>
          <input
            style={s.input} type="number" min="1" required
            placeholder="Enter product ID from the marketplace"
            value={form.product_id}
            onChange={e => setForm(f => ({ ...f, product_id: e.target.value }))}
          />
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
              <div style={s.meta}>Next order: {new Date(sub.next_order_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</div>
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
