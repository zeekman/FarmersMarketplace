import React from 'react';

/**
 * AdminAnalyticsSummary — renders the platform-level stat cards (users, products,
 * orders, revenue, fee-bumps) at the top of the admin dashboard.
 * Extracted from AdminDashboard.jsx (#1060).
 *
 * Props:
 *   stats – object returned by api.adminGetStats():
 *           { users, products, orders, total_revenue_xlm, fee_bump_enabled?, fee_bump_count? }
 */
export default function AdminAnalyticsSummary({ stats }) {
  if (!stats) return null;

  const s = {
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
      gap: 16,
      marginBottom: 32,
    },
    stat: {
      background: '#fff',
      borderRadius: 12,
      padding: 20,
      boxShadow: '0 1px 8px #0001',
      textAlign: 'center',
    },
    statVal: { fontSize: 28, fontWeight: 700, color: '#2d6a4f' },
    statLabel: { fontSize: 13, color: '#666', marginTop: 4 },
  };

  return (
    <div style={s.grid}>
      <div style={s.stat}>
        <div style={s.statVal}>{stats.users}</div>
        <div style={s.statLabel}>Total Users</div>
      </div>
      <div style={s.stat}>
        <div style={s.statVal}>{stats.products}</div>
        <div style={s.statLabel}>Products Listed</div>
      </div>
      <div style={s.stat}>
        <div style={s.statVal}>{stats.orders}</div>
        <div style={s.statLabel}>Total Orders</div>
      </div>
      <div style={s.stat}>
        <div style={s.statVal}>{Number(stats.total_revenue_xlm).toFixed(2)}</div>
        <div style={s.statLabel}>Revenue (XLM)</div>
      </div>
      {stats.fee_bump_enabled && (
        <div style={s.stat}>
          <div style={s.statVal}>{stats.fee_bump_count ?? 0}</div>
          <div style={s.statLabel}>Fee Bumps Used</div>
        </div>
      )}
    </div>
  );
}
