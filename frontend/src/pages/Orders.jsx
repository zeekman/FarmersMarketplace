import React, { useEffect, useState } from 'react';
import { api } from '../api/client';

const s = {
  page: { maxWidth: 800, margin: '0 auto', padding: 24 },
  title: { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 24 },
  card: { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001' },
  row: { borderBottom: '1px solid #eee', padding: '14px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  name: { fontWeight: 600, marginBottom: 4 },
  meta: { fontSize: 13, color: '#888' },
  hash: { fontSize: 11, color: '#aaa', fontFamily: 'monospace', marginTop: 4, wordBreak: 'break-all' },
  badge: { fontSize: 12, padding: '3px 10px', borderRadius: 20, fontWeight: 600 },
  empty: { color: '#888', fontSize: 14 },
};

const statusColor = { paid: '#d8f3dc', pending: '#fff3cd', failed: '#fee' };
const statusText  = { paid: '#2d6a4f', pending: '#856404', failed: '#c0392b' };

export default function Orders() {
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    api.getOrders().then(setOrders).catch(() => {});
  }, []);

  return (
    <div style={s.page}>
      <div style={s.title}>📦 My Orders</div>
      <div style={s.card}>
        {orders.length === 0 ? (
          <p style={s.empty}>No orders yet. Head to the marketplace to make a purchase.</p>
        ) : (
          orders.map(o => (
            <div key={o.id} style={s.row}>
              <div>
                <div style={s.name}>{o.product_name}</div>
                <div style={s.meta}>
                  {o.quantity} {o.unit} · {parseFloat(o.total_price).toFixed(2)} XLM · from {o.farmer_name}
                </div>
                <div style={s.meta}>{new Date(o.created_at).toLocaleString()}</div>
                {o.stellar_tx_hash && (
                  <div style={s.hash}>
                    TX: <a href={`https://stellar.expert/explorer/testnet/tx/${o.stellar_tx_hash}`}
                      target="_blank" rel="noreferrer" style={{ color: '#2d6a4f' }}>{o.stellar_tx_hash}</a>
                  </div>
                )}
              </div>
              <span style={{ ...s.badge, background: statusColor[o.status] || '#eee', color: statusText[o.status] || '#333' }}>
                {o.status}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
