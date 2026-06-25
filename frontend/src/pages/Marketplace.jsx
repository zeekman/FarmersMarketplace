import React, { useEffect, useState, useCallback, useRef, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useFavorites } from "../context/FavoritesContext";
import { useCompare } from "../context/CompareContext";
import { useXlmRate } from "../utils/useXlmRate";
import { useDebounce } from "../utils/useDebounce";
import { getRecentlyViewed } from "../utils/recentlyViewed";
import StarRating from "../components/StarRating";
import SkeletonProductCard from "../components/SkeletonProductCard";
import Spinner from "../components/Spinner";
import AuctionCard from "../components/AuctionCard";
import FlashSaleCountdown from "../components/FlashSaleCountdown";
import RecentlyCompared from "../components/RecentlyCompared";
import { useTranslation } from "react-i18next";

const MapView = lazy(() => import("../components/MapView"));

const CATEGORIES = [
  "all",
  "vegetables",
  "fruits",
  "grains",
  "dairy",
  "herbs",
  "other",
];
const PAGE_SIZE = 20;
const MAX_PRICE = 500;
const ALL_ALLERGENS = ["gluten", "nuts", "dairy", "eggs", "soy", "shellfish"];
const GRADES = ["A", "B", "C", "Ungraded"];
const GRADE_COLORS = {
  A: { background: "#d8f3dc", color: "#2d6a4f" },
  B: { background: "#fff3cd", color: "#856404" },
  C: { background: "#ffe0b2", color: "#a85d00" },
  Ungraded: { background: "#e0e0e0", color: "#555" },
};

const s = {
  page: { maxWidth: 1100, margin: "0 auto", padding: 24, paddingBottom: 140 },
  title: { fontSize: 24, fontWeight: 700, color: "#2d6a4f", marginBottom: 8 },
  sub: { color: "#666", marginBottom: 20, fontSize: 15 },
  filters: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 24,
    alignItems: "center",
  },
  input: {
    padding: "9px 14px",
    borderRadius: 8,
    border: "1px solid #ddd",
    fontSize: 16,
    minHeight: 44,
  },
  select: {
    padding: "9px 14px",
    borderRadius: 8,
    border: "1px solid #ddd",
    fontSize: 16,
    background: "#fff",
    minHeight: 44,
  },
  priceRow: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" },
  resetBtn: {
    padding: "9px 14px",
    borderRadius: 8,
    border: "1px solid #ddd",
    background: "#f5f5f5",
    cursor: "pointer",
    fontSize: 13,
    minHeight: 44,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: 16,
  },
  card: {
    background: "#fff",
    borderRadius: 12,
    padding: 20,
    boxShadow: "0 1px 8px #0001",
    cursor: "pointer",
    transition: "transform 0.1s",
    border: "2px solid transparent",
    position: "relative",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  favoriteBtn: {
    background: "none",
    border: "none",
    fontSize: 20,
    cursor: "pointer",
    padding: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
  },
  name: { fontWeight: 700, fontSize: 16, marginBottom: 4 },
  farmer: { fontSize: 12, color: "#888", marginBottom: 8 },
  desc: { fontSize: 13, color: "#555", marginBottom: 12, minHeight: 36 },
  price: { fontWeight: 700, color: "#2d6a4f", fontSize: 18 },
  qty: { fontSize: 12, color: "#888", marginTop: 4 },
  badge: {
    display: "inline-block",
    fontSize: 11,
    background: "#d8f3dc",
    color: "#2d6a4f",
    borderRadius: 4,
    padding: "2px 7px",
    marginBottom: 8,
  },
  preorderBadge: {
    display: "inline-block",
    fontSize: 11,
    background: "#fff3cd",
    color: "#856404",
    borderRadius: 4,
    padding: "2px 7px",
    marginBottom: 8,
    marginLeft: 6,
  },
  bundleBadge: {
    display: "inline-block",
    fontSize: 11,
    background: "#fff3cd",
    color: "#856404",
    borderRadius: 4,
    padding: "2px 7px",
    marginBottom: 8,
    fontWeight: 700,
  },
  gradeBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    fontSize: 11,
    fontWeight: 700,
    borderRadius: 999,
    padding: "2px 8px",
    boxShadow: "0 1px 4px #0002",
  },
  cardImageWrap: { position: "relative" },
  empty: { textAlign: "center", padding: 60, color: "#888" },
  sellerSection: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    marginTop: 12,
    paddingTop: 12,
    borderTop: "1px solid #eee",
  },
  sellerAvatar: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    objectFit: "cover",
    background: "#d8f3dc",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 18,
    flexShrink: 0,
  },
  sellerInfo: { flex: 1, minWidth: 0 },
  sellerName: {
    fontWeight: 600,
    fontSize: 13,
    color: "#2d6a4f",
    cursor: "pointer",
    textDecoration: "underline",
    marginBottom: 2,
  },
  sellerLocation: { fontSize: 11, color: "#999" },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: "#2d6a4f",
    margin: "32px 0 16px",
  },
  bundleCard: {
    background: "#fff",
    borderRadius: 12,
    padding: 20,
    boxShadow: "0 1px 8px #0001",
    border: "2px solid #fff3cd",
  },
  bundleItems: {
    fontSize: 13,
    color: "#555",
    margin: "8px 0 12px",
    paddingLeft: 16,
  },
  compareBtn: {
    background: "none",
    border: "1px solid #2d6a4f",
    borderRadius: 999,
    color: "#2d6a4f",
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  compareBtnActive: { background: "#2d6a4f", color: "#fff" },
  compareBar: {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    background: "#fff",
    borderTop: "1px solid #ddd",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "12px 24px",
    boxShadow: "0 -4px 14px #00000010",
  },
  compareBarItems: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "center",
    minHeight: 36,
    color: "#333",
  },
  compareItem: {
    background: "#f1f7f1",
    color: "#2d6a4f",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 13,
    fontWeight: 600,
    maxWidth: 220,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  compareActionBtn: {
    background: "#2d6a4f",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px 16px",
    cursor: "pointer",
    fontWeight: 700,
    minWidth: 140,
  },
  buyBtn: {
    background: "#2d6a4f",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "9px 18px",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 14,
  },
  outOfStockBadge: {
    display: "inline-block",
    fontSize: 11,
    background: "#fee2e2",
    color: "#b42318",
    borderRadius: 4,
    padding: "2px 7px",
    marginBottom: 8,
    fontWeight: 700,
  },
  viewBtn: {
    marginTop: 10,
    padding: "9px 18px",
    borderRadius: 8,
    border: "1px solid #2d6a4f",
    background: "#fff",
    color: "#2d6a4f",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
  },
  viewBtnDisabled: {
    marginTop: 10,
    padding: "9px 18px",
    borderRadius: 8,
    border: "1px solid #ccc",
    background: "#f5f5f5",
    color: "#aaa",
    fontWeight: 600,
    fontSize: 14,
    cursor: "not-allowed",
  },
};

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
  { value: "popular", label: "Most Popular" },
];

const EMPTY_FILTERS = {
  search: "",
  category: "",
  minPrice: "",
  maxPrice: "",
  seller: "",
  available: "true",
  lat: "",
  lng: "",
  radius: "",
  excludeAllergens: [],
  sort: "newest",
  grade: "",
};

function GradeBadge({ grade }) {
  if (!grade) return null;
  const colors = GRADE_COLORS[grade] || GRADE_COLORS.Ungraded;
  return (
    <div
      style={{ ...s.gradeBadge, ...colors }}
      aria-label={`Grade: ${grade}`}
    >
      {grade}
    </div>
  );
}

function getFreshnessBadge(bestBefore) {
  if (!bestBefore) return null;
  const today = new Date();
  const expiry = new Date(bestBefore);
  const diffTime = expiry - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return null; // expired, but shouldn't be shown
  if (diffDays === 0) return { text: 'Expires today', color: '#ff6b6b' };
  if (diffDays === 1) return { text: 'Expires tomorrow', color: '#ffa726' };
  if (diffDays <= 3) return { text: `${diffDays} days left`, color: '#ffb74d' };
  if (diffDays <= 7) return { text: `${diffDays} days left`, color: '#81c784' };
  return { text: 'Fresh', color: '#4caf50' };
}

const SCROLL_KEY = 'marketplace_scroll';

export default function Marketplace() {
  const { t, i18n } = useTranslation();
  const [products, setProducts] = useState([]);
  const [auctions, setAuctions] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [bundles, setBundles] = useState([]);
  const [bundleMsg, setBundleMsg] = useState({});
  const [expandedBundles, setExpandedBundles] = useState({});
  const [recommendations, setRecommendations] = useState([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const [viewMode, setViewMode] = useState("grid"); // 'grid' | 'map'
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [recentlyViewed, setRecentlyViewed] = useState([]);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isFavorited, toggleFavorite } = useFavorites();
  const { products: compareProducts, toggleProduct, isCompared, clearProducts } = useCompare();
  const { usd } = useXlmRate();

  const formatPreorderDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const debouncedSearch = useDebounce(filters.search, 300);
  const debouncedSeller = useDebounce(filters.seller, 300);
  const debouncedRadius = useDebounce(filters.radius, 400);
  const debouncedSearch = useDebounce(filters.search, 400);
  const debouncedSeller = useDebounce(filters.seller, 400);

  const abortRef = useRef(null);
  const sentinelRef = useRef(null);
  const observerRef = useRef(null);
  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);
  const filtersRef = useRef(filters);

  // Keep filtersRef in sync
  useEffect(() => { filtersRef.current = filters; }, [filters]);

  async function fetchPage(f, p) {
    let data, totalPages = 1;
    if (f.search && f.search.trim()) {
      const res = await api.searchProducts(f.search.trim());
      data = res.data ?? res;
      totalPages = 1;
    } else {
      const params = { page: p, limit: PAGE_SIZE };
      if (f.category) params.category = f.category;
      if (f.minPrice) params.minPrice = f.minPrice;
      if (f.maxPrice && f.maxPrice < MAX_PRICE) params.maxPrice = f.maxPrice;
      if (f.seller) params.seller = f.seller;
      if (f.available) params.available = f.available;
      if (f.grade) params.grade = f.grade;
      if (f.sort && f.sort !== "newest") params.sort = f.sort;
      if (f.lat && f.lng && f.radius) { params.lat = f.lat; params.lng = f.lng; params.radius = f.radius; }
      const res = await api.getProducts(params);
      data = res.data ?? [];
      totalPages = res.totalPages ?? 1;
    }
    if (f.excludeAllergens && f.excludeAllergens.length > 0) {
      data = data.filter(p => {
        let allergens = [];
        try { allergens = p.allergens ? JSON.parse(p.allergens) : []; } catch {}
        return !f.excludeAllergens.some(a => allergens.includes(a));
      });
    }
    if (f.grade && f.search && f.search.trim()) {
      // searchProducts doesn't support a grade param, so filter client-side
      // when both a search term and a grade filter are active.
      data = data.filter((p) => (p.grade || "Ungraded") === f.grade);
    }
    return { data, totalPages };
  }

  // Initial load (resets list)
  const load = useCallback(async (f) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setHasMore(true);
    pageRef.current = 1;
    hasMoreRef.current = true;
    try {
      const { data, totalPages } = await fetchPage(f, 1);
      if (controller.signal.aborted) return;
      setProducts(data);
      pageRef.current = 1;
      const more = totalPages > 1;
      setHasMore(more);
      hasMoreRef.current = more;
      const aucs = await api.getAuctions().catch(() => ({ data: [] }));
      setAuctions(aucs.data || []);
      // Save to sessionStorage for back-navigation restore
      sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ products: data, page: 1, hasMore: more, filters: f }));
    } catch (err) {
      if (err?.name !== 'AbortError') setProducts([]);
    }
    if (!controller.signal?.aborted) setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load next page (append)
  const loadMore = useCallback(async () => {
    if (!hasMoreRef.current || loadingMore) return;
    setLoadingMore(true);
    const nextPage = pageRef.current + 1;
    try {
      const { data, totalPages } = await fetchPage(filtersRef.current, nextPage);
      setProducts(prev => {
        const merged = [...prev, ...data];
        sessionStorage.setItem(SCROLL_KEY, JSON.stringify({
          products: merged, page: nextPage, hasMore: nextPage < totalPages, filters: filtersRef.current,
        }));
        return merged;
      });
      pageRef.current = nextPage;
      const more = nextPage < totalPages;
      setHasMore(more);
      hasMoreRef.current = more;
    } catch { /* ignore */ }
    setLoadingMore(false);
  }, [loadingMore]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore scroll position on back-navigation
  useEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) {
      try {
        const { products: savedProducts, page: savedPage, hasMore: savedHasMore, filters: savedFilters } = JSON.parse(saved);
        setProducts(savedProducts);
        setFilters(savedFilters);
        pageRef.current = savedPage;
        hasMoreRef.current = savedHasMore;
        setHasMore(savedHasMore);
        setLoading(false);
        // Restore scroll after render
        requestAnimationFrame(() => {
          const scrollY = sessionStorage.getItem(SCROLL_KEY + '_y');
          if (scrollY) window.scrollTo(0, parseInt(scrollY, 10));
        });
        return;
      } catch { /* fall through to normal load */ }
    }
    load(EMPTY_FILTERS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save scroll position continuously for SPA back-navigation
  useEffect(() => {
    const saveScroll = () => sessionStorage.setItem(SCROLL_KEY + '_y', String(window.scrollY));
    window.addEventListener('scroll', saveScroll, { passive: true });
    return () => window.removeEventListener('scroll', saveScroll);
  }, []);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore(); },
      { rootMargin: '200px' }
    );
    if (sentinelRef.current) observerRef.current.observe(sentinelRef.current);
    return () => observerRef.current?.disconnect();
  }, [loadMore]);

  // Re-observe sentinel when hasMore changes
  useEffect(() => {
    if (!hasMore && observerRef.current) observerRef.current.disconnect();
    else if (hasMore && sentinelRef.current && observerRef.current) {
      observerRef.current.observe(sentinelRef.current);
    }
  }, [hasMore]);

  // Filter changes → reset and reload
  useEffect(() => {
    sessionStorage.removeItem(SCROLL_KEY);
    sessionStorage.removeItem(SCROLL_KEY + '_y');
    const f = { ...filters, search: debouncedSearch, seller: debouncedSeller, radius: debouncedRadius };
    load(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    debouncedSearch,
    debouncedSeller,
    filters.category,
    filters.minPrice,
    filters.maxPrice,
    filters.available,
    filters.excludeAllergens,
    filters.sort,
    filters.grade,
    filters.lat,
    filters.lng,
    debouncedRadius,
  ]);

  useEffect(() => {
    api
      .getBundles()
      .then((res) => setBundles(res.data ?? []))
      .catch(() => {});
  }, []);

  // Load recommendations if logged in
  useEffect(() => {
    if (user) {
      setRecsLoading(true);
      api.getRecommendations()
        .then(res => setRecommendations(res.data ?? []))
        .catch(() => {})
        .finally(() => setRecsLoading(false));
    } else {
      setRecommendations([]);
    }
  }, [user]);

  // Load recently viewed products
  useEffect(() => {
    setRecentlyViewed(getRecentlyViewed());
  }, []);

  async function handleBuyBundle(bundleId) {
    if (!user) return navigate("/auth");
    setBundleMsg((m) => ({
      ...m,
      [bundleId]: { type: "loading", text: "Processing..." },
    }));
    try {
      const res = await api.purchaseBundle(bundleId);
      setBundleMsg((m) => ({
        ...m,
        [bundleId]: {
          type: "ok",
          text: `Paid! TX: ${res.txHash?.slice(0, 12)}…`,
        },
      }));
      api
        .getBundles()
        .then((r) => setBundles(r.data ?? []))
        .catch(() => {});
    } catch (e) {
      setBundleMsg((m) => ({
        ...m,
        [bundleId]: { type: "err", text: e.message },
      }));
    }
  }

  function set(key, val) {
    setFilters((f) => ({ ...f, [key]: val }));
  }

  function reset() {
    setFilters(EMPTY_FILTERS);
    setGeoError('');
    sessionStorage.removeItem(SCROLL_KEY);
    sessionStorage.removeItem(SCROLL_KEY + '_y');
    load(EMPTY_FILTERS);
  }

  function toggleNearMe() {
    // If already active, turn it off
    if (filters.lat && filters.lng) {
      setFilters(f => ({ ...f, lat: '', lng: '', radius: '' }));
      setGeoError('');
      return;
    }

    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by your browser.');
      return;
    }

    setGeoLoading(true);
    setGeoError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFilters(f => ({
          ...f,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          radius: f.radius || 50,
        }));
        setGeoLoading(false);
      },
      (err) => {
        const msg = err.code === 1
          ? 'Location access denied. Please allow location in your browser and try again.'
          : 'Unable to retrieve your location. Please try again.';
        setGeoError(msg);
        setGeoLoading(false);
      },
      { timeout: 8000 }
    );
  }

  return (
    <div style={s.page}>
      <Helmet>
        <title>Marketplace – Farmers Marketplace</title>
        <meta name="description" content="Browse fresh produce from local farmers. Buy vegetables, fruits, grains, dairy and more directly from the source." />
      </Helmet>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div style={s.title}>{t("marketplace.title")}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={{
              ...s.resetBtn,
              background: viewMode === "grid" ? "#2d6a4f" : "#f5f5f5",
              color: viewMode === "grid" ? "#fff" : "#333",
              fontWeight: 600,
            }}
            onClick={() => setViewMode("grid")}
          >
            ⊞ Grid
          </button>
          <button
            style={{
              ...s.resetBtn,
              background: viewMode === "map" ? "#2d6a4f" : "#f5f5f5",
              color: viewMode === "map" ? "#fff" : "#333",
              fontWeight: 600,
            }}
            onClick={() => setViewMode("map")}
          >
            🗺 Map
          </button>
        </div>
      </div>
      <div style={s.sub}>{t("marketplace.subtitle")}</div>

      {recommendations.length > 0 && (
        <div style={{ marginBottom: 36 }}>
          <div style={{ ...s.title, fontSize: 20, marginBottom: 12 }}>⭐ Recommended For You</div>
          {recsLoading ? (
            <div>Loading…</div>
          ) : (
            <div style={s.grid}>
              {recommendations.slice(0, 6).map((p) => (
                <div key={p.id} style={s.card} onClick={() => navigate(`/product/${p.id}`)}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-2px)")}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = "")}>
                  <div style={s.cardHeader}>
                    <div style={{ flex: 1 }}>
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.name} style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 8, marginBottom: 10 }} />
                      ) : (
                        <div style={{ fontSize: 32, marginBottom: 8 }}>🥬</div>
                      )}
                    </div>
                    {user && user.role === "buyer" && (
                      <button style={s.favoriteBtn} onClick={(e) => { e.stopPropagation(); toggleFavorite(p.id); }}
                        title={isFavorited(p.id) ? "Remove from favorites" : "Add to favorites"}>
                        {isFavorited(p.id) ? "❤️" : "🤍"}
                      </button>
                    )}
                  </div>
                  {p.category && p.category !== "other" && <div style={s.badge}>{p.category}</div>}
                  <div style={s.name}>{p.name}</div>
                  <div style={s.desc}>{p.description || "Fresh from the farm"}</div>
                  <div style={s.price}>{p.price} XLM <span style={{ fontSize: 13 }}>/{p.unit || "unit"}</span></div>
                  <div style={s.qty}>{t("marketplace.available", { qty: p.quantity, unit: p.unit })}</div>
                  <div style={s.sellerSection}>
                    <div style={s.sellerAvatar}>👨‍🌾</div>
                    <div style={s.sellerInfo}><div style={s.sellerName}>{p.farmer_name}</div></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {auctions.length > 0 && (
        <div style={{ marginBottom: 36 }}>
          <div style={{ ...s.title, fontSize: 20, marginBottom: 12 }}>
            🔨 Live Auctions
          </div>
          <div style={s.grid}>
            {auctions.map((a) => (
              <AuctionCard key={a.id} auction={a} onBid={() => load(filters)} />
            ))}
          </div>
        </div>
      )}

      {/* Recently Compared Section */}
      {compareProducts.length > 0 && (
        <div style={{ marginBottom: 36 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ ...s.title, fontSize: 20, marginBottom: 0 }}>
              📊 Currently Comparing
            </div>
            <button
              style={{ ...s.resetBtn, fontSize: 12 }}
              onClick={clearProducts}
            >
              Clear
            </button>
          </div>
          <div style={s.grid}>
            {compareProducts.map((p) => (
              <div
                key={p.id}
                style={{ ...s.card, opacity: 0.9 }}
                onClick={() => navigate(`/product/${p.id}`)}
              >
                {p.image_url ? (
                  <img
                    src={p.image_url}
                    alt={p.name}
                    style={{
                      width: "100%",
                      height: 140,
                      objectFit: "cover",
                      borderRadius: 8,
                      marginBottom: 10,
                    }}
                  />
                ) : (
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🥬</div>
                )}
                <div style={s.name}>{p.name}</div>
                <div style={s.price}>{p.price} XLM</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={s.filters}>
        <input
          style={s.input}
          placeholder={t("marketplace.searchPlaceholder")}
          value={filters.search}
          onChange={(e) => set("search", e.target.value)}
          aria-label={t("marketplace.searchPlaceholder")}
        />

        <select
          style={s.select}
          value={filters.category}
          onChange={(e) =>
            set("category", e.target.value === "all" ? "" : e.target.value)
          }
          aria-label="Filter by category"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c === "all" ? "" : c}>
              {c.charAt(0).toUpperCase() + c.slice(1)}
            </option>
          ))}
        </select>

        <select
          style={s.select}
          value={filters.sort}
          onChange={(e) => set("sort", e.target.value)}
          aria-label="Sort products"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          style={s.select}
          value={filters.grade}
          onChange={(e) => set("grade", e.target.value)}
          aria-label="Filter by grade"
        >
          <option value="">All Grades</option>
          {GRADES.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>

        <input
          style={s.input}
          placeholder={t("marketplace.sellerPlaceholder")}
          value={filters.seller}
          onChange={(e) => set("seller", e.target.value)}
          aria-label={t("marketplace.sellerPlaceholder")}
        />

        <div style={s.priceRow}>
          <span style={{ fontSize: 13, color: "#666" }}>
            {t("marketplace.price")}
          </span>
          <input
            type="range"
            min="0"
            max={MAX_PRICE}
            step="5"
            value={filters.minPrice || 0}
            onChange={(e) =>
              set("minPrice", e.target.value === "0" ? "" : e.target.value)
            }
            aria-label="Minimum price"
          />
          <span style={{ fontSize: 13, color: "#444", minWidth: 80 }}>
            {filters.minPrice || 0} – {filters.maxPrice || MAX_PRICE}+ XLM
          </span>
          <input
            type="range"
            min="0"
            max={MAX_PRICE}
            step="5"
            value={filters.maxPrice || MAX_PRICE}
            onChange={(e) => set("maxPrice", e.target.value)}
            aria-label="Maximum price"
          />
        </div>

        <select
          style={s.select}
          value={filters.available}
          onChange={(e) => set("available", e.target.value)}
          aria-label="Filter by availability"
        >
          <option value="true">{t("marketplace.inStock")}</option>
          <option value="false">{t("marketplace.allProducts")}</option>
        </select>

        {/* Distance filter */}
        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <button
            style={{
              ...s.resetBtn,
              background: filters.lat && filters.lng ? "#2d6a4f" : "#e8f5e9",
              color: filters.lat && filters.lng ? "#fff" : "#2d6a4f",
              fontWeight: 600,
              border: filters.lat && filters.lng ? "1px solid #2d6a4f" : "1px solid #ddd",
            }}
            onClick={toggleNearMe}
            disabled={geoLoading}
            aria-pressed={!!(filters.lat && filters.lng)}
          >
            {geoLoading ? "⌛ Locating…" : filters.lat && filters.lng ? "📍 Near Me ✓" : "📍 Near Me"}
          </button>
          {filters.lat && filters.lng && (
            <>
              <input
                type="range"
                min="5"
                max="200"
                step="5"
                value={filters.radius || 50}
                onChange={(e) => set("radius", Number(e.target.value))}
                aria-label="Search radius in km"
                style={{ width: 120, accentColor: "#2d6a4f" }}
              />
              <span style={{ fontSize: 13, color: "#444", minWidth: 60 }}>
                {filters.radius || 50} km
              </span>
              <button
                style={s.resetBtn}
                onClick={() => {
                  setFilters(f => ({ ...f, lat: "", lng: "", radius: "" }));
                  setGeoError("");
                }}
                aria-label="Clear location filter"
              >
                ✕
              </button>
            </>
          )}
          {geoError && (
            <span
              style={{ fontSize: 12, color: "#c0392b", display: "flex", alignItems: "center", gap: 4 }}
              role="alert"
            >
              ⚠️ {geoError}
            </span>
          )}
        </div>

        <button style={s.resetBtn} onClick={reset}>
          {t("marketplace.reset")}
        </button>

        {/* Allergen exclusion filter */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "#666" }}>Exclude allergens:</span>
          {ALL_ALLERGENS.map((a) => {
            const active = filters.excludeAllergens.includes(a);
            return (
              <button
                key={a}
                style={{
                  padding: "5px 10px",
                  borderRadius: 6,
                  border: active ? "1px solid #c0392b" : "1px solid #ddd",
                  background: active ? "#fee" : "#fff",
                  color: active ? "#c0392b" : "#555",
                  fontSize: 12,
                  cursor: "pointer",
                  fontWeight: active ? 700 : 400,
                }}
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    excludeAllergens: active
                      ? f.excludeAllergens.filter((x) => x !== a)
                      : [...f.excludeAllergens, a],
                  }))
                }
                aria-pressed={active}
              >
                {active ? "✕ " : ""}{a.charAt(0).toUpperCase() + a.slice(1)}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div style={s.grid}>
          {Array.from({ length: PAGE_SIZE }).map((_, i) => (
            <SkeletonProductCard key={i} />
          ))}
        </div>
      ) : viewMode === "map" ? (
        <Suspense fallback={<Spinner />}>
          <MapView
            products={products}
            onFarmerClick={(name) => {
              if (name) {
                setFilters(f => ({ ...f, seller: name }));
              }
              setViewMode("grid");
            }}
            userLat={filters.lat || undefined}
            userLng={filters.lng || undefined}
            radius={filters.radius || undefined}
          />
        </Suspense>
      ) : products.length === 0 ? (
        <div style={s.empty} role="status">
          <div>{t("marketplace.noProducts")}</div>
          <button style={{ ...s.resetBtn, marginTop: 16 }} onClick={reset}>
            {t("marketplace.clearFilters", "Clear filters")}
          </button>
        </div>
      ) : (
        <div style={s.grid}>
          {products.map((p) => (
            <div
              key={p.id}
              style={s.card}
              onClick={() => navigate(`/product/${p.id}`)}
              onMouseEnter={(e) =>
                (e.currentTarget.style.transform = "translateY(-2px)")
              }
              onMouseLeave={(e) => (e.currentTarget.style.transform = "")}
              role="button"
              tabIndex={0}
              aria-label={`View ${p.name}`}
              onKeyDown={(e) => e.key === 'Enter' && navigate(`/product/${p.id}`)}
            >
              <div style={s.cardHeader}>
                <div style={{ flex: 1 }}>
                  <div style={s.cardImageWrap}>
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        alt={p.name}
                        style={{
                          width: "100%",
                          height: 140,
                          objectFit: "cover",
                          borderRadius: 8,
                          marginBottom: 10,
                        }}
                      />
                    ) : (
                      <div style={{ fontSize: 32, marginBottom: 8 }}>🥬</div>
                    )}
                    <GradeBadge grade={p.grade || "Ungraded"} />
                  </div>
                </div>
                {user && user.role === "buyer" && (
                  <button
                    style={s.favoriteBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(p.id).catch(() => {});
                    }}
                    aria-label={isFavorited(p.id) ? "Remove from favorites" : "Add to favorites"}
                    aria-pressed={isFavorited(p.id)}
                  >
                    {isFavorited(p.id) ? "❤️" : "🤍"}
                  </button>
                )}
              </div>
              {p.category && p.category !== "other" && (
                <div style={s.badge}>{p.category}</div>
              )}
              {p.flash_sale_price &&
              p.flash_sale_ends_at &&
              new Date(p.flash_sale_ends_at).getTime() > Date.now() ? (
                <div
                  style={{
                    ...s.badge,
                    background: "#fee2e2",
                    color: "#b42318",
                    fontWeight: 700,
                  }}
                >
                  Flash Sale
                </div>
              ) : null}
              {p.is_preorder ? (
                <div
                  style={s.preorderBadge}
                  title="This is a pre-order. Payment is held in escrow until dispatch."
                  aria-label="Pre-order product"
                >
                  Pre-order
                  {p.preorder_delivery_date
                    ? ` · Ships by ${formatPreorderDate(p.preorder_delivery_date)}`
                    : ""}
                </div>
              ) : null}
              {(p.available_from || p.available_until) && (
                <div style={{ fontSize: 11, color: '#555', background: '#f0faf4', border: '1px solid #b7e4c7', borderRadius: 4, padding: '2px 7px', marginBottom: 6, display: 'inline-block' }}>
                  🗓{p.available_from ? ` From ${new Date(p.available_from).toLocaleDateString()}` : ''}
                  {p.available_until ? ` Until ${new Date(p.available_until).toLocaleDateString()}` : ''}
                </div>
              )}
              <div style={s.name}>{p.name}</div>
              <div style={s.desc}>{p.description || "Fresh from the farm"}</div>
              {p.flash_sale_price &&
              p.flash_sale_ends_at &&
              new Date(p.flash_sale_ends_at).getTime() > Date.now() ? (
                <div style={s.price}>
                  {p.flash_sale_price} XLM{" "}
                  <span style={{ fontSize: 13, fontWeight: 400 }}>
                    / {p.unit}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: "#888",
                      marginLeft: 8,
                      textDecoration: "line-through",
                    }}
                  >
                    {p.price} XLM
                  </span>
                </div>
              ) : (
                <div style={s.price}>
                  {p.price} XLM{" "}
                  <span style={{ fontSize: 13, fontWeight: 400 }}>
                    / {p.unit}
                  </span>
                </div>
              )}
              {p.flash_sale_price &&
              p.flash_sale_ends_at &&
              new Date(p.flash_sale_ends_at).getTime() > Date.now() ? (
                <FlashSaleCountdown endsAt={p.flash_sale_ends_at} />
              ) : null}
              {usd(p.price) && (
                <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                  {usd(p.price)}{" "}
                  <span style={{ fontSize: 10, color: "#aaa" }}>
                    {t("marketplace.approx")}
                  </span>
                </div>
              )}
              <div style={s.qty}>
                {t("marketplace.available", { qty: p.quantity, unit: p.unit })}
              </div>
              {p.min_order_quantity > 1 && (
                <div style={{ fontSize: 11, color: '#e67e22', fontWeight: 600, marginTop: 2 }}>
                  Min. order: {p.min_order_quantity} {p.unit}
                </div>
              )}
              {p.review_count > 0 && (
                <div style={{ marginTop: 6 }}>
                  <StarRating
                    value={p.avg_rating}
                    count={p.review_count}
                    size={13}
                  />
                </div>
              )}
              <button
                style={{
                  ...s.compareBtn,
                  ...(isCompared(p.id) ? s.compareBtnActive : {}),
                  marginTop: 10,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleProduct(p);
                }}
                aria-pressed={isCompared(p.id)}
              >
                {isCompared(p.id) ? "Selected for compare" : "Compare"}
              </button>

              {p.quantity === 0 && (
                <div style={s.outOfStockBadge} aria-label="Out of stock">
                  Out of Stock
                </div>
              )}
              <button
                style={p.quantity === 0 ? s.viewBtnDisabled : s.viewBtn}
                disabled={p.quantity === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  if (p.quantity > 0) navigate(`/product/${p.id}`);
                }}
                aria-disabled={p.quantity === 0}
              >
                {p.quantity === 0 ? "Out of Stock" : "View"}
              </button>

              {/* Seller Information Section */}
              <div style={s.sellerSection}>
                {p.farmer_avatar ? (
                  <img
                    src={p.farmer_avatar}
                    alt={p.farmer_name}
                    style={s.sellerAvatar}
                  />
                ) : (
                  <div style={{ ...s.sellerAvatar, fontSize: 18 }}>👨‍🌾</div>
                )}
                <div style={s.sellerInfo}>
                  <div
                    style={s.sellerName}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/farmer/${p.farmer_id}`);
                    }}
                  >
                    {p.farmer_name}
                  </div>
                  {p.farmer_location && (
                    <div style={s.sellerLocation}>📍 {p.farmer_location}</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      {!loading && (
        <>
          <div ref={sentinelRef} style={{ height: 1 }} aria-hidden="true" />
          {loadingMore && (
            <div style={{ ...s.grid, marginTop: 16 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonProductCard key={i} />
              ))}
            </div>
          )}
        </>
      )}

      {compareProducts.length > 0 && (
        <div style={s.compareBar}>
          <div style={s.compareBarItems}>
            <strong>Products to compare:</strong>
            {compareProducts.map((product) => (
              <span key={product.id} style={s.compareItem}>
                {product.name}
              </span>
            ))}
          </div>
          <button
            style={s.compareActionBtn}
            disabled={compareProducts.length < 2}
            onClick={() => navigate("/compare")}
          >
            {compareProducts.length < 2
              ? `Select ${2 - compareProducts.length} more`
              : "Compare"}
          </button>
        </div>
      )}

      {bundles.length > 0 && (
        <div>
          <div style={s.sectionTitle}>🎁 Bundle Deals</div>
          <div style={s.grid}>
            {bundles.map((b) => {
              const msg = bundleMsg[b.id];
              const outOfStock = b.items?.some((i) => i.stock < i.quantity);
              return (
                <div key={b.id} style={s.bundleCard}>
                  <div style={s.bundleBadge}>Bundle</div>
                  <div style={s.name}>{b.name}</div>
                  <div style={s.farmer}>by {b.farmer_name}</div>
                  {b.description && <div style={s.desc}>{b.description}</div>}
                  <button
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#2d6a4f',
                      cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: 600,
                      padding: 0,
                      marginBottom: 8,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                    onClick={() => setExpandedBundles(prev => ({ ...prev, [b.id]: !prev[b.id] }))}
                  >
                    {expandedBundles[b.id] ? '▼' : '▶'} Included Items ({b.items?.length || 0})
                  </button>
                  {expandedBundles[b.id] && (
                    <ul style={s.bundleItems}>
                      {b.items?.map((i) => (
                        <li key={i.product_id}>
                          {i.quantity} × {i.product_name} ({i.unit})
                        </li>
                      ))}
                    </ul>
                  )}
                  <div style={s.price}>{b.price} XLM</div>
                  {usd(b.price) && (
                    <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                      {usd(b.price)}{" "}
                      <span style={{ fontSize: 10, color: "#aaa" }}>
                        (approx.)
                      </span>
                    </div>
                  )}
                  {outOfStock && (
                    <div
                      style={{ fontSize: 12, color: "#c0392b", marginTop: 6 }}
                    >
                      Some items out of stock
                    </div>
                  )}
                  {msg && (
                    <div
                      style={{
                        fontSize: 12,
                        marginTop: 6,
                        color:
                          msg.type === "ok"
                            ? "#2d6a4f"
                            : msg.type === "err"
                            ? "#c0392b"
                            : "#888",
                      }}
                    >
                      {msg.text}
                    </div>
                  )}
                  {user?.role === "buyer" && !outOfStock && (
                    <button
                      style={{
                        ...s.buyBtn,
                        marginTop: 12,
                        opacity: msg?.type === "loading" ? 0.6 : 1,
                      }}
                      disabled={msg?.type === "loading"}
                      onClick={() => handleBuyBundle(b.id)}
                    >
                      Buy Bundle
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {recentlyViewed.length > 0 && (
        <div>
          <div style={s.sectionTitle}>Recently Viewed</div>
          <div style={{ display: 'flex', overflowX: 'auto', gap: 16, paddingBottom: 16 }}>
            {recentlyViewed.map((p) => (
              <div
                key={p.id}
                onClick={() => navigate(`/product/${p.id}`)}
                style={{ ...s.card, minWidth: 200, cursor: 'pointer', flexShrink: 0 }}
              >
                {p.image_url && (
                  <img
                    src={p.image_url}
                    alt={p.name}
                    style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 8, marginBottom: 12 }}
                  />
                )}
                <div style={s.name}>{p.name}</div>
                <div style={s.price}>{p.price} XLM</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
      <RecentlyCompared />
  );
}
