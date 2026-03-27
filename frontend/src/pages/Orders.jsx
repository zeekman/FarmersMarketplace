import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';

const ALL_STATUSES = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'failed'];
const FILTER_TABS = ['all', ...ALL_STATUSES];

const STATUS_STYLE = {
  paid: { bg: '#d8f3dc', color: '#2d6a4f' },
  pending: { bg: '#fff3cd', color: '#856404' },
  processing: { bg: '#cce5ff', color: '#004085' },
  shipped: { bg: '#d1ecf1', color: '#0c5460' },
  delivered: { bg: '#d4edda', color: '#155724' },
  failed: { bg: '#fee', color: '#c0392b' },
};

const STATUS_ICON = {
  pending: '⏳',
  paid: '✅',
  processing: '⚙️',
  shipped: '🚚',
  delivered: '📦',
  failed: '❌',
};

// Timeline steps shown in order detail
const TIMELINE_STEPS = ['pending', 'paid', 'processing', 'shipped', 'delivered'];

const s = {
  page: { maxWidth: 900, margin: '0 auto', padding: 24 },
  title: { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 4 },
  sub: { color: '#888', fontSize: 14, marginBottom: 24 },
  stats: { display: 'flex', gap: 16, marginBottom: 28, flexWrap: 'wrap' },
  statCard: {
    flex: '1 1 140px',
    background: '#fff',
    borderRadius: 12,
    padding: '16px 20px',
    boxShadow: '0 1px 8px #0001',
    textAlign: 'center',
  },
  statNum: { fontSize: 28, fontWeight: 700, color: '#2d6a4f' },
  statLabel: { fontSize: 12, color: '#888', marginTop: 4 },
  tabs: { display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' },
  tab: {
    padding: '7px 18px',
    borderRadius: 20,
    border: '1px solid #ddd',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    background: '#f5f5f5',
    color: '#555',
    transition: 'all 0.15s',
  },
  tabActive: { background: '#2d6a4f', color: '#fff', border: '1px solid #2d6a4f' },
  card: { background: '#fff', borderRadius: 12, boxShadow: '0 1px 8px #0001', overflow: 'hidden' },
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 12,
    padding: '16px 20px',
    borderBottom: '1px solid #f0f0f0',
    alignItems: 'start',
  },
  name: { fontWeight: 600, fontSize: 15, marginBottom: 4, color: '#222' },
  meta: { fontSize: 13, color: '#666', marginBottom: 2 },
  hash: {
    fontSize: 11,
    color: '#aaa',
    fontFamily: 'monospace',
    marginTop: 6,
    wordBreak: 'break-all',
  },
  badge: {
    fontSize: 12,
    padding: '4px 12px',
    borderRadius: 20,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  empty: { padding: '48px 20px', textAlign: 'center', color: '#aaa', fontSize: 15 },
  right: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 },
  price: { fontWeight: 700, fontSize: 16, color: '#2d6a4f' },
  timeline: { display: 'flex', alignItems: 'center', gap: 0, marginTop: 10, flexWrap: 'wrap' },
  step: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    fontSize: 10,
    color: '#bbb',
    minWidth: 60,
  },
  stepDot: { width: 10, height: 10, borderRadius: '50%', background: '#ddd', marginBottom: 3 },
  stepLine: { flex: 1, height: 2, background: '#eee', minWidth: 20 },
};

function StatusTimeline({ status }) {
  if (status === 'failed')
    return <div style={{ fontSize: 12, color: '#c0392b', marginTop: 8 }}>❌ Order failed</div>;
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
  const [activeTab, setActiveTab] = useState('all');
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getOrders();
      setAllOrders(Array.isArray(data) ? data : (data?.data ?? []));
    } catch {
      setAllOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stats = {
    total: allOrders.length,
    paid: allOrders.filter((o) => o.status === 'paid').length,
    pending: allOrders.filter((o) => o.status === 'pending').length,
    failed: allOrders.filter((o) => o.status === 'failed').length,
    spent: allOrders
      .filter((o) => o.status === 'paid')
      .reduce((sum, o) => sum + parseFloat(o.total_price || 0), 0),
  };

  const visible = activeTab === 'all' ? allOrders : allOrders.filter((o) => o.status === activeTab);

  return (
    <div style={s.page}>
      <div style={s.title}>📦 My Orders</div>
      <div style={s.sub}>Track your purchases and verify transactions</div>

      <div style={s.stats}>
        <div style={s.statCard}>
          <div style={s.statNum}>{stats.total}</div>
          <div style={s.statLabel}>Total Orders</div>
        </div>
        <div style={s.statCard}>
          <div style={{ ...s.statNum, color: '#2d6a4f' }}>{stats.paid}</div>
          <div style={s.statLabel}>Paid</div>
        </div>
        <div style={s.statCard}>
          <div style={{ ...s.statNum, color: '#856404' }}>{stats.pending}</div>
          <div style={s.statLabel}>Pending</div>
        </div>
        <div style={s.statCard}>
          <div style={{ ...s.statNum, color: '#c0392b' }}>{stats.failed}</div>
          <div style={s.statLabel}>Failed</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statNum}>{stats.spent.toFixed(2)}</div>
          <div style={s.statLabel}>XLM Spent</div>
        </div>
      </div>

      <div style={s.tabs}>
        {FILTER_TABS.map((status) => {
          const count =
            status === 'all'
              ? allOrders.length
              : allOrders.filter((o) => o.status === status).length;
          return (
            <button
              key={status}
              style={{ ...s.tab, ...(activeTab === status ? s.tabActive : {}) }}
              onClick={() => setActiveTab(status)}
            >
              {status === 'all'
                ? '🗂 All'
                : `${STATUS_ICON[status]} ${status.charAt(0).toUpperCase() + status.slice(1)}`}{' '}
              <span style={{ opacity: 0.75 }}>({count})</span>
            </button>
          );
        })}
      </div>

      <div style={s.card}>
        {loading ? (
          <div style={s.empty}>Loading orders...</div>
        ) : visible.length === 0 ? (
          <div style={s.empty}>
            {activeTab === 'all'
              ? 'No orders yet. Head to the marketplace to make a purchase.'
              : `No ${activeTab} orders.`}
          </div>
        ) : (
          visible.map((o) => {
            const st = STATUS_STYLE[o.status] || { bg: '#eee', color: '#333' };
            return (
              <div
                key={o.id}
                style={{ ...s.row, ...(hovered === o.id ? { background: '#fafafa' } : {}) }}
                onMouseEnter={() => setHovered(o.id)}
                onMouseLeave={() => setHovered(null)}
              >
                <div>
                  <div style={s.name}>{o.product_name}</div>
                  <div style={s.meta}>
                    {o.quantity} {o.unit} &nbsp;·&nbsp; from {o.farmer_name}
                  </div>
                  <div style={s.meta}>
                    {new Date(o.created_at).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}{' '}
                    <span style={{ color: '#bbb' }}>
                      {new Date(o.created_at).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  {o.stellar_tx_hash && (
                    <div style={s.hash}>
                      TX:{' '}
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${o.stellar_tx_hash}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#2d6a4f' }}
                      >
                        {o.stellar_tx_hash}
                      </a>
                    </div>
                  )}
                  <StatusTimeline status={o.status} />
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
    </div>
  );
}
