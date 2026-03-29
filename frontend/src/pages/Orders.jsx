import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';

const ALL_STATUSES = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'failed'];
const FILTER_TABS = ['all', ...ALL_STATUSES];

const STATUS_STYLE = {
  paid:       { bg: '#d8f3dc', color: '#2d6a4f' },
  pending:    { bg: '#fff3cd', color: '#856404' },
  processing: { bg: '#cce5ff', color: '#004085' },
  shipped:    { bg: '#d1ecf1', color: '#0c5460' },
  delivered:  { bg: '#d4edda', color: '#155724' },
  failed:     { bg: '#fee',    color: '#c0392b' },
};

const STATUS_ICON = {
  pending: '⏳', paid: '✅', processing: '⚙️', shipped: '🚚', delivered: '📦', failed: '❌',
};

// Timeline steps shown in order detail
const TIMELINE_STEPS = ['pending', 'paid', 'processing', 'shipped', 'delivered'];

const s = {
  page:      { maxWidth: 900, margin: '0 auto', padding: 24 },
  title:     { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 4 },
  sub:       { color: '#888', fontSize: 14, marginBottom: 24 },
  stats:     { display: 'flex', gap: 16, marginBottom: 28, flexWrap: 'wrap' },
  statCard:  { flex: '1 1 140px', background: '#fff', borderRadius: 12, padding: '16px 20px', boxShadow: '0 1px 8px #0001', textAlign: 'center' },
  statNum:   { fontSize: 28, fontWeight: 700, color: '#2d6a4f' },
  statLabel: { fontSize: 12, color: '#888', marginTop: 4 },
  tabs:      { display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' },
  tab:       { padding: '7px 18px', borderRadius: 20, border: '1px solid #ddd', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: '#f5f5f5', color: '#555', transition: 'all 0.15s' },
  tabActive: { background: '#2d6a4f', color: '#fff', border: '1px solid #2d6a4f' },
  card:      { background: '#fff', borderRadius: 12, boxShadow: '0 1px 8px #0001', overflow: 'hidden' },
  row:       { display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, padding: '16px 20px', borderBottom: '1px solid #f0f0f0', alignItems: 'start' },
  name:      { fontWeight: 600, fontSize: 15, marginBottom: 4, color: '#222' },
  meta:      { fontSize: 13, color: '#666', marginBottom: 2 },
  address:   { fontSize: 12, color: '#888', marginTop: 4, fontStyle: 'italic' },
  hash:      { fontSize: 11, color: '#aaa', fontFamily: 'monospace', marginTop: 6, wordBreak: 'break-all' },
  badge:     { fontSize: 12, padding: '4px 12px', borderRadius: 20, fontWeight: 600, whiteSpace: 'nowrap' },
  empty:     { padding: '48px 20px', textAlign: 'center', color: '#aaa', fontSize: 15 },
  right:     { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 },
  price:     { fontWeight: 700, fontSize: 16, color: '#2d6a4f' },
  timeline:  { display: 'flex', alignItems: 'center', gap: 0, marginTop: 10, flexWrap: 'wrap' },
  step:      { display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: 10, color: '#bbb', minWidth: 60 },
  stepDot:   { width: 10, height: 10, borderRadius: '50%', background: '#ddd', marginBottom: 3 },
  stepLine:  { flex: 1, height: 2, background: '#eee', minWidth: 20 },
};

function StatusTimeline({ status }) {
  if (status === 'failed') return <div style={{ fontSize: 12, color: '#c0392b', marginTop: 8 }}>❌ Order failed</div>;
  const currentIdx = TIMELINE_STEPS.indexOf(status);
  return (
    <div style={s.timeline}>
      {TIMELINE_STEPS.map((step, i) => {
        const done = i <= currentIdx;
        return (
          <React.Fragment key={step}>
            <div style={s.step}>
              <div style={{ ...s.stepDot, background: done ? '#2d6a4f' : '#ddd' }} />
              <span style={{ color: done ? '#2d6a4f' : '#bbb', fontWeight: done ? 600 : 400 }}>
                {STATUS_ICON[step]} {step}
              </span>
            </div>
            {i < TIMELINE_STEPS.length - 1 && (
              <div style={{ ...s.stepLine, background: i < currentIdx ? '#2d6a4f' : '#eee' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function Orders() {
  const [allOrders, setAllOrders] = useState([]);
  const [activeTab, setActiveTab]  = useState('all');
  const [loading, setLoading]      = useState(true);
  const [error, setError]          = useState(null);
  const [hovered, setHovered]      = useState(null);
  const { user } = useAuth();
  const [claimingId, setClaimingId] = useState(null);
  const [claimError, setClaimError] = useState({});
  const [bundleOrders, setBundleOrders] = useState([]);
  const [returnModal, setReturnModal] = useState(null); // orderId
  const [returnReason, setReturnReason] = useState('');
  const [returnLoading, setReturnLoading] = useState(false);
  const [returnMsg, setReturnMsg] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, bundleData] = await Promise.all([
        api.getOrders(),
        api.getBundleOrders().catch(() => ({ data: [] })),
      ]);
      setAllOrders(Array.isArray(data) ? data : (data?.data ?? []));
      setBundleOrders(bundleData?.data ?? []);
    } catch (err) {
      setError(err?.message || 'Failed to load orders');
      setAllOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleClaim(orderId) {
    setClaimingId(orderId);
    setClaimError(prev => ({ ...prev, [orderId]: '' }));
    try {
      await api.claimPreorder(orderId);
      load();
    } catch (e) {
      setClaimError(prev => ({ ...prev, [orderId]: e.message }));
    } finally {
      setClaimingId(null);
    }
  }

  async function handleFileReturn(orderId) {
    if (!returnReason.trim()) return;
    setReturnLoading(true);
    try {
      await api.fileReturn(orderId, returnReason.trim());
      setReturnModal(null);
      setReturnReason('');
      setReturnMsg(prev => ({ ...prev, [orderId]: { type: 'ok', text: 'Return request filed' } }));
      load();
    } catch (e) {
      setReturnMsg(prev => ({ ...prev, [orderId]: { type: 'err', text: e.message } }));
    } finally {
      setReturnLoading(false);
    }
  }

  const stats = {
    total:   allOrders.length,
    paid:    allOrders.filter(o => o.status === 'paid').length,
    pending: allOrders.filter(o => o.status === 'pending').length,
    failed:  allOrders.filter(o => o.status === 'failed').length,
    spent:   allOrders.filter(o => o.status === 'paid').reduce((sum, o) => sum + parseFloat(o.total_price || 0), 0),
  };

  const visible = activeTab === 'all' ? allOrders : allOrders.filter(o => o.status === activeTab);

  return (
    <div style={s.page}>
      <div style={s.title}>📦 My Orders</div>
      <div style={s.sub}>Track your purchases and verify transactions</div>

      {error && (
        <div style={{ background: '#fee', color: '#c0392b', border: '1px solid #f5a5a5', borderRadius: 8, padding: 16, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>⚠️ {error}</span>
          <button
            style={{ background: '#c0392b', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
            onClick={load}
          >
            Retry
          </button>
        </div>
      )}

      {loading && !error ? (
        <Spinner message="Loading orders..." />
      ) : (
        <>
          <div style={s.stats}>
            <div style={s.statCard}><div style={s.statNum}>{stats.total}</div><div style={s.statLabel}>Total Orders</div></div>
            <div style={s.statCard}><div style={{ ...s.statNum, color: '#2d6a4f' }}>{stats.paid}</div><div style={s.statLabel}>Paid</div></div>
            <div style={s.statCard}><div style={{ ...s.statNum, color: '#856404' }}>{stats.pending}</div><div style={s.statLabel}>Pending</div></div>
            <div style={s.statCard}><div style={{ ...s.statNum, color: '#c0392b' }}>{stats.failed}</div><div style={s.statLabel}>Failed</div></div>
            <div style={s.statCard}><div style={s.statNum}>{stats.spent.toFixed(2)}</div><div style={s.statLabel}>XLM Spent</div></div>
          </div>

          <div style={s.tabs}>
            {FILTER_TABS.map(status => {
              const count = status === 'all' ? allOrders.length : allOrders.filter(o => o.status === status).length;
              return (
                <button key={status} style={{ ...s.tab, ...(activeTab === status ? s.tabActive : {}) }} onClick={() => setActiveTab(status)}>
                  {status === 'all' ? '🗂 All' : `${STATUS_ICON[status]} ${status.charAt(0).toUpperCase() + status.slice(1)}`}
                  {' '}<span style={{ opacity: 0.75 }}>({count})</span>
                </button>
              );
            })}
          </div>

          <div style={s.card}>
            {visible.length === 0 ? (
              <div style={s.empty}>
                {activeTab === 'all' ? 'No orders yet. Head to the marketplace to make a purchase.' : `No ${activeTab} orders.`}
              </div>
            ) : (
              visible.map(o => {
            const st = STATUS_STYLE[o.status] || { bg: '#eee', color: '#333' };
            return (
              <div key={o.id} style={{ ...s.row, ...(hovered === o.id ? { background: '#fafafa' } : {}) }}
                onMouseEnter={() => setHovered(o.id)} onMouseLeave={() => setHovered(null)}>
                <div>
                  <div style={s.name}>{o.product_name}</div>
                  <div style={s.meta}>{o.quantity} {o.unit} &nbsp;·&nbsp; from {o.farmer_name}</div>
                  {o.address_label && (
                    <div style={s.address}>
                      📍 {o.address_label}: {o.address_street}, {o.address_city}, {o.address_country}
                      {o.address_postal_code ? ` ${o.address_postal_code}` : ''}
                    </div>
                  )}
                  <div style={s.meta}>
                    {new Date(o.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    {' '}<span style={{ color: '#bbb' }}>{new Date(o.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  {o.is_preorder ? (
                    <div style={{ fontSize: 12, color: '#856404', marginTop: 4 }}>
                      Pre-Order{ o.preorder_delivery_date ? ` · Expected delivery ${o.preorder_delivery_date}` : '' }
                    </div>
                  ) : null}
                  {o.stellar_tx_hash && (
                    <div style={s.hash}>
                      TX:{' '}
                      <a href={`https://stellar.expert/explorer/testnet/tx/${o.stellar_tx_hash}`} target="_blank" rel="noreferrer" style={{ color: '#2d6a4f' }}>
                        {o.stellar_tx_hash}
                      </a>
                    </div>
                  )}
                  <StatusTimeline status={o.status} />
                  {/* Return request status */}
                  {o.return_status && (
                    <div style={{ marginTop: 8, fontSize: 12 }}>
                      <span style={{
                        padding: '3px 10px', borderRadius: 20, fontWeight: 600,
                        background: o.return_status === 'approved' ? '#d8f3dc' : o.return_status === 'rejected' ? '#fee' : '#fff3cd',
                        color: o.return_status === 'approved' ? '#2d6a4f' : o.return_status === 'rejected' ? '#c0392b' : '#856404',
                      }}>
                        ↩️ Return: {o.return_status}
                      </span>
                      {o.return_status === 'approved' && o.refund_tx_hash && (
                        <span style={{ marginLeft: 8, color: '#aaa', fontFamily: 'monospace', fontSize: 11 }}>
                          Refund TX: <a href={`https://stellar.expert/explorer/testnet/tx/${o.refund_tx_hash}`} target="_blank" rel="noreferrer" style={{ color: '#2d6a4f' }}>{o.refund_tx_hash.slice(0, 12)}…</a>
                        </span>
                      )}
                      {o.return_status === 'rejected' && o.reject_reason && (
                        <span style={{ marginLeft: 8, color: '#888' }}>— {o.reject_reason}</span>
                      )}
                    </div>
                  )}
                  {/* File return button for delivered orders without a request */}
                  {user?.role === 'buyer' && o.status === 'delivered' && !o.return_status && (
                    <div style={{ marginTop: 8 }}>
                      {returnMsg[o.id] && (
                        <div style={{ fontSize: 12, color: returnMsg[o.id].type === 'ok' ? '#2d6a4f' : '#c0392b', marginBottom: 4 }}>{returnMsg[o.id].text}</div>
                      )}
                      <button
                        style={{ fontSize: 12, padding: '5px 14px', borderRadius: 8, border: '1px solid #c0392b', cursor: 'pointer', background: '#fff', color: '#c0392b', fontWeight: 600 }}
                        onClick={() => { setReturnModal(o.id); setReturnReason(''); }}
                      >↩️ Request Return</button>
                    </div>
                  )}
                  {o.escrow_status && o.escrow_status !== 'none' && (
                    <div style={{ marginTop: 8 }}>
                      <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 20, fontWeight: 600,
                        background: o.escrow_status === 'funded' ? '#fff3cd' : o.escrow_status === 'claimed' ? '#d8f3dc' : '#eee',
                        color: o.escrow_status === 'funded' ? '#856404' : o.escrow_status === 'claimed' ? '#2d6a4f' : '#555' }}>
                        🔒 Escrow: {o.escrow_status}
                      </span>
                      {o.escrow_balance_id && (
                        <div style={{ ...s.hash, marginTop: 4 }}>
                          Balance:{' '}
                          <a href={`https://stellar.expert/explorer/testnet/claimable-balance/${o.escrow_balance_id}`} target="_blank" rel="noreferrer" style={{ color: '#2d6a4f' }}>
                            {o.escrow_balance_id.slice(0, 20)}...
                          </a>
                        </div>
                      )}
                      {user?.role === 'farmer' && o.escrow_status === 'funded' && (
                        <div style={{ marginTop: 6 }}>
                          <button
                            style={{ fontSize: 12, padding: '5px 14px', borderRadius: 8, border: 'none', cursor: o.status === 'delivered' ? 'pointer' : 'not-allowed',
                              background: o.status === 'delivered' ? '#2d6a4f' : '#ccc', color: '#fff', fontWeight: 600 }}
                            disabled={o.status !== 'delivered' || claimingId === o.id}
                            onClick={() => handleClaim(o.id)}>
                            {claimingId === o.id ? 'Claiming...' : '💰 Claim Payment'}
                          </button>
                          {o.status !== 'delivered' && <span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>Mark as delivered first</span>}
                          {claimError[o.id] && <div style={{ fontSize: 12, color: '#c0392b', marginTop: 4 }}>{claimError[o.id]}</div>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div style={s.right}>
                  <span style={{ ...s.badge, background: st.bg, color: st.color }}>
                    {STATUS_ICON[o.status]} {o.status}
                  </span>
                  <span style={s.price}>{parseFloat(o.total_price).toFixed(2)} XLM</span>
                </div>
              </div>
            );
          })
            )}
          </div>
        </>
      )}

      {bundleOrders.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <div style={{ ...s.title, fontSize: 20, marginBottom: 16 }}>🎁 Bundle Orders</div>
          <div style={s.card}>
            {bundleOrders.map(o => (
              <div key={o.id} style={s.row}>
                <div>
                  <div style={s.name}>{o.bundle_name}</div>
                  {o.bundle_description && <div style={s.meta}>{o.bundle_description}</div>}
                  <div style={s.meta}>
                    {new Date(o.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                  </div>
                  {o.stellar_tx_hash && (
                    <div style={s.hash}>
                      TX:{' '}
                      <a href={`https://stellar.expert/explorer/testnet/tx/${o.stellar_tx_hash}`} target="_blank" rel="noreferrer" style={{ color: '#2d6a4f' }}>
                        {o.stellar_tx_hash}
                      </a>
                    </div>
                  )}
                </div>
                <div style={s.right}>
                  <span style={{ ...s.badge, background: STATUS_STYLE[o.status]?.bg || '#eee', color: STATUS_STYLE[o.status]?.color || '#333' }}>
                    {STATUS_ICON[o.status]} {o.status}
                  </span>
                  <span style={s.price}>{parseFloat(o.total_price).toFixed(2)} XLM</span>
                  <span style={{ ...s.badge, background: '#fff3cd', color: '#856404', fontSize: 11 }}>Bundle</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>

    {/* Return request modal */}
    {returnModal && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 420, boxShadow: '0 4px 24px #0003' }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>↩️ Request Return</div>
          <label style={{ fontSize: 13, color: '#555', display: 'block', marginBottom: 6 }}>Reason for return</label>
          <textarea
            style={{ width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, minHeight: 80, resize: 'vertical', boxSizing: 'border-box', marginBottom: 16 }}
            value={returnReason}
            onChange={e => setReturnReason(e.target.value)}
            placeholder="Describe the issue (damaged, incorrect item, etc.)"
          />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #ddd', cursor: 'pointer', background: '#f5f5f5', fontWeight: 600 }}
              onClick={() => setReturnModal(null)}>Cancel</button>
            <button style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: returnLoading ? 'not-allowed' : 'pointer', background: '#c0392b', color: '#fff', fontWeight: 600 }}
              disabled={returnLoading || !returnReason.trim()}
              onClick={() => handleFileReturn(returnModal)}>
              {returnLoading ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        </div>
      </div>
    )}
  );
}
