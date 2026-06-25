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
  overlay: { position: 'fixed', inset: 0, background: '#0005', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
};

const STATUS_STYLE = {
  active:    { background: '#d8f3dc', color: '#2d6a4f' },
  paused:    { background: '#fff3cd', color: '#856404' },
  cancelled: { background: '#fee',    color: '#c0392b' },
};

function CancelConfirmDialog({ sub, onConfirm, onCancel }) {
  const cancelRef = React.useRef(null);

  React.useEffect(() => {
    cancelRef.current?.focus();
    function onKey(e) { if (e.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const nextAmount = sub.product_price && sub.quantity
    ? `${(sub.product_price * sub.quantity).toFixed(2)} XLM`
    : null;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="cancel-dialog-title" style={s.overlay}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 28, maxWidth: 400, width: '90%', boxShadow: '0 4px 24px #0003' }}>
        <div id="cancel-dialog-title" style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>Cancel Subscription</div>
        <p style={{ fontSize: 14, color: '#555', marginBottom: 8 }}>
          Are you sure you want to cancel your subscription for <strong>{sub.product_name}</strong>?
        </p>
        <div style={{ background: '#f8fdf9', border: '1px solid #b7e4c7', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
          <div><span style={{ color: '#888' }}>Frequency:</span> {FREQ_LABEL[sub.frequency]}</div>
          <div><span style={{ color: '#888' }}>Quantity:</span> {sub.quantity} {sub.unit}</div>
          {nextAmount && <div><span style={{ color: '#888' }}>Next renewal amount:</span> {nextAmount}</div>}
          {sub.next_order_at && (
            <div>
              <span style={{ color: '#888' }}>Next renewal date:</span>{' '}
              {new Date(sub.next_order_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
            </div>
          )}
        </div>
        <p style={{ fontSize: 13, color: '#888', marginBottom: 20 }}>This action cannot be undone.</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button ref={cancelRef} style={{ ...s.smBtn, background: '#f0f0f0', color: '#333', padding: '8px 16px' }} onClick={onCancel}>Keep Subscription</button>
          <button style={{ ...s.smBtn, background: '#fee', color: '#c0392b', padding: '8px 16px' }} onClick={onConfirm}>Cancel Subscription</button>
        </div>
      </div>
    </div>
  );
}

export default function Subscriptions() {
  const [subs, setSubs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm]       = useState({ product_id: '', quantity: 1, frequency: 'weekly' });
  const [msg, setMsg]         = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null); // sub object pending cancellation

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
      if (action === 'pause')   await api.pauseSubscription(id);
      if (action === 'resume')  await api.resumeSubscription(id);
      load();
    } catch (err) { setMsg({ type: 'err', text: err.message }); }
  }

  async function confirmCancel() {
    const id = cancelTarget.id;
    setCancelTarget(null);
    try {
      await api.cancelSubscription(id);
      setMsg({ type: 'ok', text: 'Subscription cancelled.' });
      load();
    } catch (err) { setMsg({ type: 'err', text: err.message }); }
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
        ) : subs.map(sub => {
          const nextAmount = sub.product_price && sub.quantity
            ? `${(sub.product_price * sub.quantity).toFixed(2)} XLM`
            : null;
          return (
            <div key={sub.id} style={s.row}>
              <div>
                <div style={s.name}>{sub.product_name}</div>
                <div style={s.meta}>{sub.quantity} {sub.unit} · {FREQ_LABEL[sub.frequency]}</div>
                {nextAmount && <div style={s.meta}>Next renewal amount: <strong>{nextAmount}</strong></div>}
                <div style={s.meta}>Next renewal date: {new Date(sub.next_order_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</div>
                {sub.next_billing_at ? (
                  <div style={s.meta}>Next billing: {new Date(sub.next_billing_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</div>
                ) : (
                  <div style={s.meta}>Next billing: Billing date not set</div>
                )}
              </div>
              <div style={s.actions}>
                <span style={{ ...s.badge, background: '#e8f4fd', color: '#1e40af' }}>{sub.frequency}</span>
                <span style={{ ...s.badge, ...STATUS_STYLE[sub.status] }}>{sub.status}</span>
                {sub.status === 'active' && (
                  <button style={{ ...s.smBtn, background: '#fff3cd', color: '#856404' }} onClick={() => handleAction(sub.id, 'pause')}>Pause</button>
                )}
                {sub.status === 'paused' && (
                  <button style={{ ...s.smBtn, background: '#d8f3dc', color: '#2d6a4f' }} onClick={() => handleAction(sub.id, 'resume')}>Resume</button>
                )}
                {sub.status !== 'cancelled' && (
                  <button style={{ ...s.smBtn, background: '#fee', color: '#c0392b' }} onClick={() => setCancelTarget(sub)}>Cancel</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {cancelTarget && (
        <CancelConfirmDialog
          sub={cancelTarget}
          onConfirm={confirmCancel}
          onCancel={() => setCancelTarget(null)}
        />
      )}
    </div>
  );
}
