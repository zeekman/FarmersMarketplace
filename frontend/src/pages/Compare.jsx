import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useCompare } from '../context/CompareContext';
import StarRating from '../components/StarRating';

const s = {
  page: { maxWidth: 1100, margin: '0 auto', padding: 24 },
  header: { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 12 },
  description: { fontSize: 14, color: '#555', marginBottom: 20, maxWidth: 760 },
  tableWrapper: { overflowX: 'auto', background: '#fff', borderRadius: 12, boxShadow: '0 1px 12px #00000012', padding: 16 },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 680 },
  th: { textAlign: 'left', padding: 12, borderBottom: '1px solid #eee', background: '#f7fcf7', color: '#2d6a4f' },
  td: { padding: 12, borderBottom: '1px solid #eee', verticalAlign: 'top', color: '#333' },
  rowLabel: { width: 170, fontWeight: 700, color: '#444', background: '#fbfcfb' },
  empty: { textAlign: 'center', padding: 80, color: '#666' },
  backBtn: { marginTop: 20, background: '#2d6a4f', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 8, cursor: 'pointer' },
  productName: { fontWeight: 700, color: '#2d6a4f' },
  actions: { display: 'flex', gap: 10, marginBottom: 16 },
  exportBtn: { background: '#2d6a4f', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  exportBtnDisabled: { background: '#a8a8a8', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 8, cursor: 'not-allowed', fontSize: 14, fontWeight: 600 },
};

function buildComparisonCsv(products) {
  const rows = [
    ['Attribute', ...products.map(p => p?.name ?? '—')],
    ['Price (XLM)', ...products.map(p => (p?.price != null ? `${p.price} XLM` : '—'))],
    ['Category', ...products.map(p => p?.category ?? '—')],
    ['Allergens', ...products.map(p => {
      let allergens = [];
      try { allergens = p?.allergens ? JSON.parse(p.allergens) : []; } catch {}
      return allergens.length === 0 ? 'None' : allergens.map(a => a.charAt(0).toUpperCase() + a.slice(1)).join(', ');
    })],
    ['Grade', ...products.map(p => p?.grade ?? '—')],
    ['Rating', ...products.map(p => ((p?.review_count ?? 0) > 0 ? `${p.avg_rating} (${p.review_count})` : 'No reviews'))],
  ];

  return rows
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

export default function Compare() {
  const navigate = useNavigate();
  const { products } = useCompare();

  const hasEnoughProducts = products.length >= 2;
  const isEmpty = products.length === 0;

  const handleExportCsv = () => {
    if (isEmpty) return;
    const csv = buildComparisonCsv(products);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'product-comparison.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    if (isEmpty) return;
    window.print();
  };

  return (
    <div style={s.page}>
      <div style={s.header}>Compare Products</div>
      <div style={s.description}>
        Compare selected marketplace products side by side. Select up to four products on the marketplace to view them here.
      </div>

      <div className="compare-actions" style={s.actions}>
        <button
          style={isEmpty ? s.exportBtnDisabled : s.exportBtn}
          onClick={handleExportCsv}
          disabled={isEmpty}
        >
          Export CSV
        </button>
        <button
          style={isEmpty ? s.exportBtnDisabled : s.exportBtn}
          onClick={handlePrint}
          disabled={isEmpty}
        >
          Print / Save as PDF
        </button>
      </div>

      {!hasEnoughProducts ? (
        <div style={s.empty}>
          {products.length === 0
            ? 'No products selected for comparison yet.'
            : 'Select at least two products to compare them side by side.'}
          <div>
            <button style={s.backBtn} onClick={() => navigate('/marketplace')}>Back to Marketplace</button>
          </div>
        </div>
      ) : (
        <div className="compare-table-wrapper" style={s.tableWrapper}>
          <table className="compare-table" style={s.table}>
            <thead>
              <tr>
                <th style={{ ...s.th, ...s.rowLabel }}>Attribute</th>
                {products.map(product => (
                  <th key={product.id} style={s.th}>{product.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ ...s.td, ...s.rowLabel }}>Farmer</td>
                {products.map(product => (
                  <td key={`${product.id}-farmer`} style={s.td}>{product?.farmer_name ?? '—'}</td>
                ))}
              </tr>
              <tr>
                <td style={{ ...s.td, ...s.rowLabel }}>Price</td>
                {products.map(product => (
                  <td key={`${product.id}-price`} style={s.td}>{product?.price != null ? `${product.price} XLM` : '—'}</td>
                ))}
              </tr>
              <tr>
                <td style={{ ...s.td, ...s.rowLabel }}>Quantity</td>
                {products.map(product => (
                  <td key={`${product.id}-quantity`} style={s.td}>{product?.quantity != null ? `${product.quantity} ${product?.unit ?? ''}`.trim() : '—'}</td>
                ))}
              </tr>
              <tr>
                <td style={{ ...s.td, ...s.rowLabel }}>Unit</td>
                {products.map(product => (
                  <td key={`${product.id}-unit`} style={s.td}>{product?.unit ?? '—'}</td>
                ))}
              </tr>
              <tr>
                <td style={{ ...s.td, ...s.rowLabel }}>Rating</td>
                {products.map(product => (
                  <td key={`${product.id}-rating`} style={s.td}>
                    {(product?.review_count ?? 0) > 0 ? (
                      <StarRating value={product.avg_rating} count={product.review_count} size={14} />
                    ) : 'No reviews'}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={{ ...s.td, ...s.rowLabel }}>Category</td>
                {products.map(product => (
                  <td key={`${product.id}-category`} style={s.td}>{product?.category ?? '—'}</td>
                ))}
              </tr>
              <tr>
                <td style={{ ...s.td, ...s.rowLabel }}>Grade</td>
                {products.map(product => (
                  <td key={`${product.id}-grade`} style={s.td}>{product?.grade ?? '—'}</td>
                ))}
              </tr>
              <tr>
                <td style={{ ...s.td, ...s.rowLabel }}>Weight</td>
                {products.map(product => {
                  let weight = '—';
                  if (product?.pricing_type === 'weight' && product.min_weight != null && product.max_weight != null) {
                    weight = `${product.min_weight}–${product.max_weight} ${product.unit ?? ''}`.trim();
                  } else if (product?.unit) {
                    weight = product.unit;
                  }
                  return <td key={`${product.id}-weight`} style={s.td}>{weight}</td>;
                })}
              </tr>
              <tr>
                <td style={{ ...s.td, ...s.rowLabel }}>Allergens</td>
                {products.map(product => {
                  let allergens = [];
                  try { allergens = product?.allergens ? JSON.parse(product.allergens) : []; } catch {}
                  return (
                    <td key={`${product.id}-allergens`} style={s.td}>
                      {allergens.length === 0 ? 'None' : allergens.map(a => a.charAt(0).toUpperCase() + a.slice(1)).join(', ')}
                    </td>
                  );
                })}
              </tr>
              <tr>
                <td style={{ ...s.td, ...s.rowLabel }}>Freshness</td>
                {products.map(product => {
                  const bestBefore = product?.best_before;
                  if (!bestBefore) return <td key={`${product.id}-freshness`} style={s.td}>—</td>;
                  const diffDays = Math.ceil((new Date(bestBefore) - new Date()) / (1000 * 60 * 60 * 24));
                  const label = diffDays < 0 ? 'Expired' : diffDays === 0 ? 'Expires today' : `${diffDays}d left`;
                  return <td key={`${product.id}-freshness`} style={s.td}>{new Date(bestBefore).toLocaleDateString()} ({label})</td>;
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
