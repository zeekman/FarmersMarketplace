import React from 'react';

/**
 * WaitlistAnalyticsPanel — displays per-product waitlist queue stats.
 * Extracted from Dashboard.jsx (#1060).
 *
 * Props:
 *   rows  – array of waitlist analytics records from api.getWaitlistAnalytics()
 */
export default function WaitlistAnalyticsPanel({ rows = [] }) {
  if (rows.length === 0) return null;

  const cardStyle = {
    background: '#fff',
    borderRadius: 12,
    padding: 24,
    boxShadow: '0 1px 8px #0001',
    marginBottom: 24,
  };

  return (
    <div style={cardStyle}>
      <h3 style={{ marginBottom: 12, color: '#333' }}>📋 Waitlist Analytics</h3>
      {rows.some((r) => r.alert) && (
        <div
          style={{
            background: '#fff3cd',
            color: '#856404',
            borderRadius: 8,
            padding: '10px 14px',
            marginBottom: 12,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          ⚠️ Some products have more than 10 buyers waiting — consider restocking!
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #eee' }}>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>Product</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>Queue</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>
              Avg Wait (hrs)
            </th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>Conversion</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.product_id}
              style={{
                borderBottom: '1px solid #f0f0f0',
                background: r.alert ? '#fff8e1' : 'transparent',
              }}
            >
              <td style={{ padding: '6px 8px', fontWeight: 600 }}>
                {r.product_name}
                {r.alert && (
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: 11,
                      background: '#f9a825',
                      color: '#fff',
                      borderRadius: 4,
                      padding: '1px 6px',
                    }}
                  >
                    High demand
                  </span>
                )}
              </td>
              <td style={{ padding: '6px 8px' }}>{r.queue_length}</td>
              <td style={{ padding: '6px 8px' }}>
                {r.avg_wait_hours != null ? r.avg_wait_hours : '—'}
              </td>
              <td style={{ padding: '6px 8px' }}>
                {r.conversion_rate != null ? `${r.conversion_rate}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
