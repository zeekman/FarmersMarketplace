/**
 * OrderManagementPanel
 *
 * Displays incoming sales orders for a farmer, with date-range export
 * filters, CSV/PDF export buttons, per-order status update controls,
 * and return-request approval/rejection handling.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';

const STATUS_COLOR = {
  pending: '#e67e22',
  paid: '#2d6a4f',
  processing: '#1a6b8a',
  shipped: '#006d77',
  delivered: '#2d6a4f',
  cancelled: '#c0392b',
  refunded: '#888',
};
const STATUS_ICON = {
  pending: '⏳',
  paid: '✅',
  processing: '⚙️',
  shipped: '📦',
  delivered: '🎉',
  cancelled: '❌',
  refunded: '↩️',
};
const FARMER_STATUSES = ['processing', 'shipped', 'delivered', 'cancelled'];

const s = {
  card: { background: '#fff', borderRadius: 12, padding: 0, boxShadow: '0 1px 8px #0001' },
  btn: {
    background: '#2d6a4f',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '10px 20px',
    cursor: 'pointer',
    fontWeight: 600,
    minHeight: 44,
  },
  address: { fontSize: 12, color: '#888', marginTop: 4 },
};

/**
 * @param {object} props
 * @param {Array}  props.sales              - Array of sale/order objects
 * @param {Array}  props.products           - Farmer's product list (unused here but passed for context)
 * @param {object} props.salesMsg           - Map of orderId → { type, text } feedback messages
 * @param {string} props.salesExportFrom    - Export date range "from" value (YYYY-MM-DD)
 * @param {string} props.salesExportTo      - Export date range "to" value (YYYY-MM-DD)
 * @param {function} props.onExportFromChange - Handler for "from" date change
 * @param {function} props.onExportToChange   - Handler for "to" date change
 * @param {function} props.onExportSales    - (format: 'csv'|'pdf') => void
 * @param {function} props.onStatusUpdate   - (orderId, status) => void
 * @param {function} props.onApproveReturn  - (orderId) => void
 * @param {function} props.onRejectReturn   - (orderId) => void
 */
export default function OrderManagementPanel({
  sales = [],
  salesMsg = {},
  salesExportFrom = '',
  salesExportTo = '',
  onExportFromChange,
  onExportToChange,
  onExportSales,
  onStatusUpdate,
  onApproveReturn,
  onRejectReturn,
}) {
  const { t } = useTranslation();

  return (
    <div style={{ ...s.card, marginTop: 24 }}>
      <h3
        style={{ padding: '16px 20px', borderBottom: '1px solid #eee', margin: 0, color: '#333' }}
      >
        📋 {t('dashboard.incomingOrders', { count: sales.length })}
      </h3>

      {/* Export controls */}
      <div
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid #eee',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <input
          type="date"
          value={salesExportFrom}
          onChange={(e) => onExportFromChange?.(e.target.value)}
          style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}
          placeholder="From"
        />
        <input
          type="date"
          value={salesExportTo}
          onChange={(e) => onExportToChange?.(e.target.value)}
          style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}
          placeholder="To"
        />
        <button
          style={{ ...s.btn, fontSize: 12, padding: '6px 12px', background: '#52b788' }}
          onClick={() => onExportSales?.('csv')}
        >
          ⬇ CSV
        </button>
        <button
          style={{ ...s.btn, fontSize: 12, padding: '6px 12px', background: '#52b788' }}
          onClick={() => onExportSales?.('pdf')}
        >
          ⬇ PDF
        </button>
      </div>

      {/* Order list */}
      {sales.length === 0 ? (
        <p style={{ padding: '20px', color: '#888', fontSize: 14 }}>{t('dashboard.noOrders')}</p>
      ) : (
        sales.map((o) => {
          const m = salesMsg[o.id];
          return (
            <div key={o.id} style={{ padding: '14px 20px', borderBottom: '1px solid #f0f0f0' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{o.product_name}</div>
                  <div style={{ fontSize: 13, color: '#666' }}>
                    {o.quantity} units · {parseFloat(o.total_price).toFixed(2)} XLM · by{' '}
                    {o.buyer_name}
                  </div>
                  {o.address_label && (
                    <div style={s.address}>
                      📍 {o.address_label}: {o.address_street}, {o.address_city},{' '}
                      {o.address_country}
                      {o.address_postal_code ? ` ${o.address_postal_code}` : ''}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: '#aaa' }}>
                    {new Date(o.created_at).toLocaleDateString()}
                  </div>
                  {o.harvest_batch_code && (
                    <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>
                      Harvest batch: {o.harvest_batch_code}
                      {o.harvest_batch_date ? ` · ${o.harvest_batch_date}` : ''}
                    </div>
                  )}
                  {o.stellar_memo && (
                    <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>
                      📝 Memo: <span style={{ fontFamily: 'monospace' }}>{o.stellar_memo}</span>
                    </div>
                  )}
                  {m && (
                    <div
                      style={{
                        fontSize: 12,
                        color: m.type === 'ok' ? '#2d6a4f' : '#c0392b',
                        marginTop: 4,
                      }}
                    >
                      {m.text}
                    </div>
                  )}

                  {/* Return request section */}
                  {o.return_status === 'pending' && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: '8px 12px',
                        background: '#fff3cd',
                        borderRadius: 8,
                        fontSize: 13,
                      }}
                    >
                      <div style={{ fontWeight: 600, color: '#856404', marginBottom: 4 }}>
                        ↩️ Return requested
                      </div>
                      <div style={{ color: '#555', marginBottom: 8 }}>{o.return_reason}</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          style={{
                            padding: '5px 14px',
                            borderRadius: 6,
                            border: 'none',
                            cursor: 'pointer',
                            background: '#2d6a4f',
                            color: '#fff',
                            fontWeight: 600,
                            fontSize: 12,
                          }}
                          onClick={() => onApproveReturn?.(o.id)}
                        >
                          ✅ Approve &amp; Refund
                        </button>
                        <button
                          style={{
                            padding: '5px 14px',
                            borderRadius: 6,
                            border: '1px solid #c0392b',
                            cursor: 'pointer',
                            background: '#fff',
                            color: '#c0392b',
                            fontWeight: 600,
                            fontSize: 12,
                          }}
                          onClick={() => onRejectReturn?.(o.id)}
                        >
                          ❌ Reject
                        </button>
                      </div>
                    </div>
                  )}

                  {o.return_status && o.return_status !== 'pending' && (
                    <div style={{ marginTop: 6, fontSize: 12 }}>
                      <span
                        style={{
                          padding: '3px 10px',
                          borderRadius: 20,
                          fontWeight: 600,
                          background: o.return_status === 'approved' ? '#d8f3dc' : '#fee',
                          color: o.return_status === 'approved' ? '#2d6a4f' : '#c0392b',
                        }}
                      >
                        ↩️ Return {o.return_status}
                      </span>
                    </div>
                  )}
                </div>

                {/* Status badge + update select */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: STATUS_COLOR[o.status] || '#333',
                    }}
                  >
                    {STATUS_ICON[o.status]} {o.status}
                  </span>
                  {['paid', 'processing', 'shipped'].includes(o.status) && (
                    <select
                      style={{
                        padding: '5px 10px',
                        borderRadius: 6,
                        border: '1px solid #ddd',
                        fontSize: 13,
                        cursor: 'pointer',
                      }}
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) onStatusUpdate?.(o.id, e.target.value);
                        e.target.value = '';
                      }}
                    >
                      <option value="" disabled>
                        {t('dashboard.updateStatus')}
                      </option>
                      {FARMER_STATUSES.filter((st) => st !== o.status).map((st) => (
                        <option key={st} value={st}>
                          {STATUS_ICON[st]} {st}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
