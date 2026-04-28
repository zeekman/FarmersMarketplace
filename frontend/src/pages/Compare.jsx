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
};

export default function Compare() {
  const navigate = useNavigate();
  const { products } = useCompare();

  const hasEnoughProducts = products.length >= 2;

  return (
    <div style={s.page}>
      <div style={s.header}>Compare Products</div>
      <div style={s.description}>
        Compare selected marketplace products side by side. Select up to three products on the marketplace to view them here.
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
        <div style={s.tableWrapper}>
          <table style={s.table}>
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
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
