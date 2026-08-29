import React from 'react';

/**
 * AdminOrdersPanel — paginated orders table for the admin view.
 * Extracted from AdminDashboard.jsx (#1060).
 *
 * Props:
 *   orders          – array of order objects
 *   orderPagination – { page, pages, total }
 *   onPageChange    – (page: number) => void
 */
export default function AdminOrdersPanel({
  orders = [],
  orderPagination = { page: 1, pages: 1, total: 0 },
  onPageChange,
}) {
  const s = {
    card: { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001', marginTop: 32 },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
    th: { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #eee', color: '#555', fontWeight: 600 },
    td: { padding: '10px 12px', borderBottom: '1px solid #f0f0f0' },
    pagination: { display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' },
    pgBtn: (disabled) => ({
      padding: '6px 14px', borderRadius: 6, border: '1px solid #ddd',
      cursor: disabled ? 'not-allowed' : 'pointer',
      background: disabled ? '#f5f5f5' : '#fff',
      color: disabled ? '#aaa' : '#333',
    }),
  };

  return (
    <div style={s.card}>
      <h3 style={{ marginBottom: 16, color: '#333' }}>Orders ({orderPagination.total})</h3>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>ID</th>
            <th style={s.th}>Buyer</th>
            <th style={s.th}>Product</th>
            <th style={s.th}>Qty</th>
            <th style={s.th}>Total (XLM)</th>
            <th style={s.th}>Status</th>
            <th style={s.th}>Date</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td style={s.td}>{o.id}</td>
              <td style={s.td}>{o.buyer_name || o.buyer_id}</td>
              <td style={s.td}>{o.product_name || o.product_id}</td>
              <td style={s.td}>{o.quantity}</td>
              <td style={s.td}>{Number(o.total_price).toFixed(2)}</td>
              <td style={s.td}>{o.status}</td>
              <td style={s.td}>{new Date(o.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={s.pagination}>
        <button
          style={s.pgBtn(orderPagination.page <= 1)}
          disabled={orderPagination.page <= 1}
          onClick={() => onPageChange?.(orderPagination.page - 1)}
        >← Prev</button>
        <span style={{ fontSize: 13, color: '#666' }}>
          Page {orderPagination.page} of {orderPagination.pages}
        </span>
        <button
          style={s.pgBtn(orderPagination.page >= orderPagination.pages)}
          disabled={orderPagination.page >= orderPagination.pages}
          onClick={() => onPageChange?.(orderPagination.page + 1)}
        >Next →</button>
      </div>
    </div>
  );
}
