import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { add, mul, formatXlm } from '../utils/money';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import Spinner from '../components/Spinner';
import ConfirmDialog from '../components/ConfirmDialog';

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

function CancelConfirmDialog({ sub, onConfirm, onCancel }) {
  const nextAmount = sub.product_price && sub.quantity
    ? `${(sub.product_price * sub.quantity).toFixed(2)} XLM`
    : null;

  return (
    <ConfirmDialog
      title="Cancel Subscription"
      confirmLabel="Cancel Subscription"
      cancelLabel="Keep Subscription"
      destructive
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p style={{ margin: '0 0 8px' }}>
        Are you sure you want to cancel your subscription for <strong>{sub.product_name}</strong>?
      </p>
      <div style={{ background: '#f8fdf9', border: '1px solid #b7e4c7', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>
        <div><span style={{ color: '#666' }}>Frequency:</span> {FREQ_LABEL[sub.frequency]}</div>
        <div><span style={{ color: '#666' }}>Quantity:</span> {sub.quantity} {sub.unit}</div>
        {nextAmount && <div><span style={{ color: '#666' }}>Next renewal amount:</span> {nextAmount}</div>}
        {sub.next_order_at && (
          <div>
            <span style={{ color: '#666' }}>Next renewal date:</span>{' '}
            {new Date(sub.next_order_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
          </div>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 13 }}>This action cannot be undone.</p>
    </ConfirmDialog>
  );
}

export default function Subscriptions() {
  const { user } = useAuth();
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const res = await fetch(`${API_URL}/api/subscriptions`, {
          headers: { Authorization: `Bearer ${user?.token}` },
        });
        if (!res.ok) throw new Error('Failed to load subscriptions');
        const data = await res.json();
        if (!cancelled) setSubscriptions(data.subscriptions || []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [user?.token]);

  if (loading) return <div className="p-6">Loading subscriptions…</div>;
  if (error) return <div className="p-6 text-red-600">{error}</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Subscriptions</h1>
      {subscriptions.length === 0 ? (
        <p className="text-gray-500">You have no active subscriptions.</p>
      ) : (
        <ul className="space-y-4">
          {subscriptions.map((sub) => {
            const total = mul(sub.product_price, sub.quantity);
            return (
              <li
                key={sub.id}
                className="border rounded-lg p-4 flex items-center justify-between"
              >
                <div>
                  <p className="font-semibold">{sub.product_name}</p>
                  <p className="text-sm text-gray-500">
                    {formatXlm(sub.product_price)} XLM × {sub.quantity}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono">{formatXlm(total)} XLM</p>
                  <Link
                    to={`/subscriptions/${sub.id}`}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Manage
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
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
                <div style={s.meta}>
                  Next renewal date: {sub.next_order_at && !isNaN(new Date(sub.next_order_at))
                    ? new Date(sub.next_order_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                    : 'Not scheduled'}
                </div>
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
