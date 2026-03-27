import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useFavorites } from '../context/FavoritesContext';
import { useXlmRate } from '../utils/useXlmRate';
import { useDebounce } from '../utils/useDebounce';
import StarRating from '../components/StarRating';
import Pagination from '../components/Pagination';
import Spinner from '../components/Spinner';

const CATEGORIES = ['all', 'vegetables', 'fruits', 'grains', 'dairy', 'herbs', 'other'];
const PAGE_SIZE = 20;
const MAX_PRICE = 500;

const s = {
  page:       { maxWidth: 1100, margin: '0 auto', padding: 24 },
  title:      { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 8 },
  sub:        { color: '#666', marginBottom: 20, fontSize: 15 },
  filters:    { display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 24, alignItems: 'center' },
  input:      { padding: '9px 14px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14 },
  select:     { padding: '9px 14px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, background: '#fff' },
  priceRow:   { display: 'flex', gap: 6, alignItems: 'center' },
  resetBtn:   { padding: '9px 14px', borderRadius: 8, border: '1px solid #ddd', background: '#f5f5f5', cursor: 'pointer', fontSize: 13 },
  grid:       { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 20 },
  card:       { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 8px #0001', cursor: 'pointer', transition: 'transform 0.1s', border: '2px solid transparent', position: 'relative' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  favoriteBtn: { background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28 },
  name:       { fontWeight: 700, fontSize: 16, marginBottom: 4 },
  farmer:     { fontSize: 12, color: '#888', marginBottom: 8 },
  desc:       { fontSize: 13, color: '#555', marginBottom: 12, minHeight: 36 },
  price:      { fontWeight: 700, color: '#2d6a4f', fontSize: 18 },
  qty:        { fontSize: 12, color: '#888', marginTop: 4 },
  badge:      { display: 'inline-block', fontSize: 11, background: '#d8f3dc', color: '#2d6a4f', borderRadius: 4, padding: '2px 7px', marginBottom: 8 },
  empty:      { textAlign: 'center', padding: 60, color: '#888' },
};

const EMPTY_FILTERS = { search: '', category: '', minPrice: '', maxPrice: '', seller: '', available: 'true' };

export default function Marketplace() {
  const [products, setProducts]     = useState([]);
  const [filters, setFilters]       = useState(EMPTY_FILTERS);
  const [loading, setLoading]       = useState(false);
  const [page, setPage]             = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isFavorited, toggleFavorite } = useFavorites();
  const { usd } = useXlmRate();

  // Debounce text inputs that fire on every keystroke
  const debouncedSearch = useDebounce(filters.search, 400);
  const debouncedSeller = useDebounce(filters.seller, 400);

  const load = useCallback(async (f, p = 1) => {
    setLoading(true);
    try {
      let data;
      let data, total = 0, totalPages = 1;

      if (f.search && f.search.trim()) {
        // Full-text search endpoint
        const res = await api.searchProducts(f.search.trim());
        data = res.data ?? res;
        total = data.length;
        totalPages = 1;
      } else {
        const params = { page: p, limit: PAGE_SIZE };
        if (f.category)  params.category = f.category;
        if (f.minPrice)  params.minPrice = f.minPrice;
        // Filtered browse endpoint
        const params = { page: p, limit: PAGE_SIZE };
        if (f.category)                          params.category  = f.category;
        if (f.minPrice)                          params.minPrice  = f.minPrice;
        if (f.maxPrice && f.maxPrice < MAX_PRICE) params.maxPrice = f.maxPrice;
        if (f.seller)                            params.seller    = f.seller;
        if (f.available)                         params.available = f.available;
        const res = await api.getProducts(params);
        data = res.data ?? res;
        setPagination({ total: res.total ?? 0, totalPages: res.totalPages ?? 1 });
        data       = res.data ?? [];
        total      = res.total ?? 0;
        totalPages = res.totalPages ?? 1;
      }

      setProducts(data);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
      setPagination({ total, totalPages });
    } catch {
      setProducts([]);
    }
    setLoading(false);
  }, []);

  // Re-run when debounced text values or non-text filters change
  useEffect(() => {
    setPage(1);
    load({ ...filters, search: debouncedSearch, seller: debouncedSeller }, 1);
  }, [debouncedSearch, debouncedSeller, filters.category, filters.minPrice, filters.maxPrice, filters.available]);

  function set(key, val) {
    setFilters(f => ({ ...f, [key]: val }));
  }

  function reset() {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }

  function handlePageChange(newPage) {
    setPage(newPage);
    load(filters, newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div style={s.page}>
      <div style={s.title}>🛒 Marketplace</div>
      <div style={s.sub}>Fresh produce directly from local farmers</div>

      <div style={s.filters}>
        <input
          style={s.input}
          placeholder="Search products..."
          value={filters.search}
          onChange={e => set('search', e.target.value)}
          aria-label="Search products"
        />

        <select style={s.select} value={filters.category} onChange={e => set('category', e.target.value === 'all' ? '' : e.target.value)}>
          {CATEGORIES.map(c => <option key={c} value={c === 'all' ? '' : c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
        </select>

        <input
          style={s.input}
          placeholder="Seller name..."
          value={filters.seller}
          onChange={e => set('seller', e.target.value)}
          aria-label="Filter by seller"
        />

        <div style={s.priceRow}>
          <span style={{ fontSize: 13, color: '#666' }}>Price:</span>
          <input
            type="range" min="0" max={MAX_PRICE} step="5"
            value={filters.minPrice || 0}
            onChange={e => set('minPrice', e.target.value === '0' ? '' : e.target.value)}
            aria-label="Minimum price"
          />
          <span style={{ fontSize: 13, color: '#444', minWidth: 80 }}>
            {filters.minPrice || 0} – {filters.maxPrice || MAX_PRICE}+ XLM
          </span>
          <input
            type="range" min="0" max={MAX_PRICE} step="5"
            value={filters.maxPrice || MAX_PRICE}
            onChange={e => set('maxPrice', e.target.value)}
            aria-label="Maximum price"
          />
        </div>

        <select style={s.select} value={filters.available} onChange={e => set('available', e.target.value)}>
          <option value="true">In Stock</option>
          <option value="false">All (incl. sold out)</option>
        </select>

        <button style={s.resetBtn} onClick={reset}>Reset</button>
      </div>

      {loading ? (
        <Spinner />
      ) : products.length === 0 ? (
        <div style={s.empty}>No products found.</div>
      ) : (
        <div style={s.grid}>
          {products.map(p => (
            <div key={p.id} style={s.card} onClick={() => navigate(`/product/${p.id}`)}
              onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseLeave={e => e.currentTarget.style.transform = ''}>
              <div style={s.cardHeader}>
                <div style={{ flex: 1 }}>
                  {p.image_url
                    ? <img src={p.image_url} alt={p.name} style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 8, marginBottom: 10 }} />
                    : <div style={{ fontSize: 32, marginBottom: 8 }}>🥬</div>
                  }
                </div>
                {user && user.role === 'buyer' && (
                  <button
                    style={s.favoriteBtn}
                    onClick={e => {
                      e.stopPropagation();
                      toggleFavorite(p.id).catch(() => {});
                    }}
                    title={isFavorited(p.id) ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    {isFavorited(p.id) ? '❤️' : '🤍'}
                  </button>
                )}
              </div>
              {p.category && p.category !== 'other' && <div style={s.badge}>{p.category}</div>}
              <div style={s.name}>{p.name}</div>
              <div
                style={{ ...s.farmer, cursor: 'pointer', textDecoration: 'underline' }}
                onClick={e => { e.stopPropagation(); navigate(`/farmer/${p.farmer_id}`); }}
              >
                by {p.farmer_name}
              </div>
              <div style={s.desc}>{p.description || 'Fresh from the farm'}</div>
              <div style={s.price}>{p.price} XLM <span style={{ fontSize: 13, fontWeight: 400 }}>/ {p.unit}</span></div>
              {usd(p.price) && <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{usd(p.price)} <span style={{ fontSize: 10, color: '#aaa' }}>(approx.)</span></div>}
              <div style={s.qty}>{p.quantity} {p.unit} available</div>
              {p.review_count > 0 && (
                <div style={{ marginTop: 6 }}>
                  <StarRating value={p.avg_rating} count={p.review_count} size={13} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Pagination
        page={page}
        totalPages={pagination.totalPages}
        total={pagination.total}
        limit={PAGE_SIZE}
        onChange={handlePageChange}
      />
    </div>
  );
}
