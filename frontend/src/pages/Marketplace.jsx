import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

const CATEGORIES = ['all', 'vegetables', 'fruits', 'grains', 'dairy', 'herbs', 'other'];

const s = {
  page: { maxWidth: 1100, margin: '0 auto', padding: 24 },
  title: { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 8 },
  sub: { color: '#666', marginBottom: 20, fontSize: 15 },
  filters: { display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 24, alignItems: 'center' },
  input: { padding: '9px 14px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14 },
  select: { padding: '9px 14px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, background: '#fff' },
  priceRow: { display: 'flex', gap: 6, alignItems: 'center' },
  priceInput: { padding: '9px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, width: 90 },
  resetBtn: { padding: '9px 14px', borderRadius: 8, border: '1px solid #ddd', background: '#f5f5f5', cursor: 'pointer', fontSize: 13 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 20 },
  card: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 8px #0001', cursor: 'pointer', transition: 'transform 0.1s', border: '2px solid transparent' },
  name: { fontWeight: 700, fontSize: 16, marginBottom: 4 },
  farmer: { fontSize: 12, color: '#888', marginBottom: 8 },
  desc: { fontSize: 13, color: '#555', marginBottom: 12, minHeight: 36 },
  price: { fontWeight: 700, color: '#2d6a4f', fontSize: 18 },
  qty: { fontSize: 12, color: '#888', marginTop: 4 },
  badge: { display: 'inline-block', fontSize: 11, background: '#d8f3dc', color: '#2d6a4f', borderRadius: 4, padding: '2px 7px', marginBottom: 8 },
  empty: { textAlign: 'center', padding: 60, color: '#888' },
};

const EMPTY_FILTERS = { search: '', category: '', minPrice: '', maxPrice: '', available: 'true' };

export default function Marketplace() {
  const [products, setProducts] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async (f) => {
    setLoading(true);
    try {
      const params = {};
      if (f.category)  params.category = f.category;
      if (f.minPrice)  params.minPrice = f.minPrice;
      if (f.maxPrice)  params.maxPrice = f.maxPrice;
      if (f.available) params.available = f.available;
      setProducts(await api.getProducts(params));
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(filters); }, []); // initial load

  function set(key, val) {
    setFilters(prev => ({ ...prev, [key]: val }));
  }

  function applyFilters() { load(filters); }

  function reset() {
    setFilters(EMPTY_FILTERS);
    load(EMPTY_FILTERS);
  }

  // client-side text search on top of server results
  const visible = filters.search
    ? products.filter(p =>
        p.name.toLowerCase().includes(filters.search.toLowerCase()) ||
        p.farmer_name.toLowerCase().includes(filters.search.toLowerCase())
      )
    : products;

  return (
    <div style={s.page}>
      <div style={s.title}>🛒 Marketplace</div>
      <div style={s.sub}>Fresh produce directly from local farmers</div>

      <div style={s.filters}>
        <input
          style={s.input}
          placeholder="Search products or farmers..."
          value={filters.search}
          onChange={e => set('search', e.target.value)}
        />

        <select style={s.select} value={filters.category} onChange={e => set('category', e.target.value === 'all' ? '' : e.target.value)}>
          {CATEGORIES.map(c => <option key={c} value={c === 'all' ? '' : c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
        </select>

        <div style={s.priceRow}>
          <input style={s.priceInput} placeholder="Min XLM" type="number" min="0" value={filters.minPrice} onChange={e => set('minPrice', e.target.value)} />
          <span style={{ color: '#aaa' }}>–</span>
          <input style={s.priceInput} placeholder="Max XLM" type="number" min="0" value={filters.maxPrice} onChange={e => set('maxPrice', e.target.value)} />
        </div>

        <select style={s.select} value={filters.available} onChange={e => set('available', e.target.value)}>
          <option value="true">In Stock</option>
          <option value="false">All (incl. sold out)</option>
        </select>

        <button style={{ ...s.input, background: '#2d6a4f', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }} onClick={applyFilters}>
          Apply
        </button>
        <button style={s.resetBtn} onClick={reset}>Reset</button>
      </div>

      {loading ? (
        <div style={s.empty}>Loading...</div>
      ) : visible.length === 0 ? (
        <div style={s.empty}>No products found.</div>
      ) : (
        <div style={s.grid}>
          {visible.map(p => (
            <div key={p.id} style={s.card} onClick={() => navigate(`/product/${p.id}`)}
              onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseLeave={e => e.currentTarget.style.transform = ''}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🥬</div>
              {p.category && p.category !== 'other' && <div style={s.badge}>{p.category}</div>}
              <div style={s.name}>{p.name}</div>
              <div style={s.farmer}>by {p.farmer_name}</div>
              <div style={s.desc}>{p.description || 'Fresh from the farm'}</div>
              <div style={s.price}>{p.price} XLM <span style={{ fontSize: 13, fontWeight: 400 }}>/ {p.unit}</span></div>
              <div style={s.qty}>{p.quantity} {p.unit} available</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
