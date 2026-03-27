import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useFavorites } from "../context/FavoritesContext";
import { getStellarErrorMessage } from "../utils/stellarErrors";
import { getErrorMessage } from "../utils/errorMessages";
import { useXlmRate } from "../utils/useXlmRate";
import StarRating from "../components/StarRating";
import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useFavorites } from '../context/FavoritesContext';
import { getStellarErrorMessage } from '../utils/stellarErrors';
import { getErrorMessage } from '../utils/errorMessages';
import { useXlmRate } from '../utils/useXlmRate';
import StarRating from '../components/StarRating';
import Spinner from '../components/Spinner';

const s = {
  page: { maxWidth: 640, margin: "40px auto", padding: 24 },
  card: {
    background: "#fff",
    borderRadius: 12,
    padding: 32,
    boxShadow: "0 1px 8px #0001",
    marginBottom: 24,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 16,
  },
  headerContent: { flex: 1 },
  favoriteBtn: {
    background: "none",
    border: "none",
    fontSize: 32,
    cursor: "pointer",
    padding: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 48,
    height: 48,
    flexShrink: 0,
  },
  name: { fontSize: 28, fontWeight: 700, color: "#2d6a4f", marginBottom: 4 },
  farmer: { color: "#888", marginBottom: 8 },
  desc: { color: "#555", marginBottom: 24, lineHeight: 1.6 },
  price: { fontSize: 24, fontWeight: 700, color: "#2d6a4f", marginBottom: 8 },
  row: { display: "flex", alignItems: "center", gap: 12, marginBottom: 20 },
  input: {
    width: 80,
    padding: "8px 12px",
    border: "1px solid #ddd",
    borderRadius: 8,
    fontSize: 16,
    textAlign: "center",
  },
  btn: {
    background: "#2d6a4f",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "12px 28px",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 16,
  },
  btnSm: {
    background: "#2d6a4f",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "9px 20px",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 14,
  },
  total: {
    background: "#f0faf4",
    borderRadius: 8,
    padding: "12px 16px",
    marginBottom: 20,
    fontSize: 15,
  },
  err: { color: "#c0392b", fontSize: 14, marginTop: 8 },
  success: {
    background: "#d8f3dc",
    borderRadius: 8,
    padding: 16,
    color: "#2d6a4f",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: "#2d6a4f",
    marginBottom: 16,
  },
  reviewCard: {
    borderBottom: "1px solid #f0f0f0",
    paddingBottom: 14,
    marginBottom: 14,
  },
  reviewName: { fontWeight: 600, fontSize: 14, color: "#333" },
  reviewDate: { fontSize: 12, color: "#aaa", marginLeft: 8 },
  reviewText: { fontSize: 14, color: "#555", marginTop: 6, lineHeight: 1.5 },
  textarea: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #ddd",
    borderRadius: 8,
    fontSize: 14,
    resize: "vertical",
    minHeight: 80,
    boxSizing: "border-box",
  },
  label: { fontSize: 13, color: "#555", marginBottom: 6, display: "block" },
  empty: {
    color: "#aaa",
    fontSize: 14,
    textAlign: "center",
    padding: "24px 0",
  },
  select: {
    width: "100%",
    padding: "9px 12px",
    border: "1px solid #ddd",
    borderRadius: 8,
    fontSize: 14,
    marginBottom: 12,
  },
  // gallery
  galleryMain: {
    width: "100%",
    maxHeight: 320,
    objectFit: "cover",
    borderRadius: 10,
    marginBottom: 10,
    display: "block",
  },
  thumbRow: { display: "flex", gap: 8, marginBottom: 16, overflowX: "auto" },
  thumb: {
    width: 64,
    height: 64,
    objectFit: "cover",
    borderRadius: 6,
    cursor: "pointer",
    border: "2px solid transparent",
    flexShrink: 0,
  },
  thumbActive: { border: "2px solid #2d6a4f" },
  navBtn: {
    background: "rgba(0,0,0,0.35)",
    color: "#fff",
    border: "none",
    borderRadius: "50%",
    width: 32,
    height: 32,
    cursor: "pointer",
    fontSize: 16,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  favoriteBtn: { background: 'none', border: 'none', fontSize: 32, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 48, height: 48, flexShrink: 0 },
  name:       { fontSize: 28, fontWeight: 700, color: '#2d6a4f', marginBottom: 4 },
  farmer:     { color: '#888', marginBottom: 8 },
  desc:       { color: '#555', marginBottom: 24, lineHeight: 1.6 },
  price:      { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 8 },
  row:        { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
  input:      { width: 80, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 16, textAlign: 'center' },
  btn:        { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 28px', cursor: 'pointer', fontWeight: 600, fontSize: 16 },
  btnSm:      { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 14 },
  total:      { background: '#f0faf4', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 15 },
  err:        { color: '#c0392b', fontSize: 14, marginTop: 8 },
  success:    { background: '#d8f3dc', borderRadius: 8, padding: 16, color: '#2d6a4f' },
  sectionTitle: { fontSize: 18, fontWeight: 700, color: '#2d6a4f', marginBottom: 16 },
  reviewCard: { borderBottom: '1px solid #f0f0f0', paddingBottom: 14, marginBottom: 14 },
  reviewName: { fontWeight: 600, fontSize: 14, color: '#333' },
  reviewDate: { fontSize: 12, color: '#aaa', marginLeft: 8 },
  reviewText: { fontSize: 14, color: '#555', marginTop: 6, lineHeight: 1.5 },
  textarea:   { width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, resize: 'vertical', minHeight: 80, boxSizing: 'border-box' },
  label:      { fontSize: 13, color: '#555', marginBottom: 6, display: 'block' },
  empty:      { color: '#aaa', fontSize: 14, textAlign: 'center', padding: '24px 0' },
  select:     { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, marginBottom: 12 },
  // gallery
  galleryMain:   { width: '100%', maxHeight: 320, objectFit: 'cover', borderRadius: 10, marginBottom: 10, display: 'block' },
  thumbRow:      { display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto' },
  thumb:         { width: 64, height: 64, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', border: '2px solid transparent', flexShrink: 0 },
  thumbActive:   { border: '2px solid #2d6a4f' },
  galleryNav:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  navBtn:        { background: 'rgba(0,0,0,0.35)', color: '#fff', border: 'none', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' },
};

export default function ProductDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { isFavorited, toggleFavorite } = useFavorites();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const { usd } = useXlmRate();
  const [addresses, setAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState(null);
  const [useEscrow, setUseEscrow] = useState(false);
  const [alertSet, setAlertSet] = useState(false);
  const [alertLoading, setAlertLoading] = useState(false);
  const [images, setImages] = useState([]);
  const [activeImg, setActiveImg] = useState(0);

  // Review form state
  const [paidOrders, setPaidOrders] = useState([]);
  const [images, setImages] = useState([]);
  const [activeImg, setActiveImg] = useState(0);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewOrderId, setReviewOrderId] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [reviewSuccess, setReviewSuccess] = useState("");

  const loadReviews = useCallback(async () => {
    try {
      const res = await api.getProductReviews(id);
      setReviews(res.data ?? []);
    } catch {
      setReviews([]);
    }
  }, [id]);

  useEffect(() => {
    api
      .getProduct(id)
      .then((res) => setProduct(res.data ?? res))
      .catch(() => navigate("/marketplace"));
    loadReviews();
    api
      .getProductImages(id)
      .then((res) => {
        const imgs = res.data ?? [];
        setImages(imgs);
        if (imgs.length > 0) setActiveImg(0);
      })
      .catch(() => {});
    api.getProductImages(id).then(res => {
      const imgs = res.data ?? [];
      setImages(imgs);
      if (imgs.length > 0) setActiveImg(0);
    }).catch(() => {});
  }, [id, loadReviews, navigate]);

  useEffect(() => {
    if (user?.role !== "buyer") return;
    api
      .getAddresses()
      .then((res) => {
        const addrs = res.data ?? [];
        setAddresses(addrs);
        const defaultAddr = addrs.find((a) => a.is_default);
        if (defaultAddr) setSelectedAddressId(defaultAddr.id);
        else if (addrs.length > 0) setSelectedAddressId(addrs[0].id);
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    if (user?.role !== "buyer") return;
    api
      .getMyAlert(id)
      .then((res) => setAlertSet(res.subscribed))
      .catch(() => {});
  }, [id, user]);

  useEffect(() => {
    if (user?.role !== "buyer") return;
    api
      .getOrders({ limit: 100 })
      .then((res) => {
        const orders = (res.data ?? []).filter(
          (o) => o.product_id === parseInt(id) && o.status === "paid",
        );
        setPaidOrders(orders);
        if (orders.length > 0) setReviewOrderId(String(orders[0].id));
      })
      .catch(() => {});
  }, [id, user]);

  if (!product)
    return <div style={{ padding: 40, textAlign: "center" }}>Loading...</div>;
  if (!product) return <Spinner />;

  const total = (product.price * qty).toFixed(2);

  async function handleAlert() {
    setAlertLoading(true);
    try {
      if (alertSet) {
        await api.removeStockAlert(id);
        setAlertSet(false);
      } else {
        await api.setStockAlert(id);
        setAlertSet(true);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setAlertLoading(false);
    }
  }

  async function handleBuy() {
    if (!user) return navigate("/login");
    if (user.role === "farmer") return setError("Farmers cannot place orders");
    if (addresses.length > 0 && !selectedAddressId)
      return setError("Please select a delivery address");
    setLoading(true);
    setError("");
    try {
      const res = await api.placeOrder({
        product_id: product.id,
        quantity: qty,
        address_id: selectedAddressId || undefined,
      });
      if (useEscrow) {
        const escrowRes = await api.fundEscrow(res.orderId);
        setResult({ ...res, escrow: true, balanceId: escrowRes.balanceId });
      } else {
        setResult(res);
      }
    } catch (e) {
      setError(getStellarErrorMessage(e) || getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleReviewSubmit(e) {
    e.preventDefault();
    setReviewError("");
    setReviewSuccess("");
    if (!reviewOrderId)
      return setReviewError("No eligible paid order found for this product");
    setReviewLoading(true);
    try {
      await api.submitReview({
        order_id: parseInt(reviewOrderId),
        rating: reviewRating,
        comment: reviewComment.trim() || undefined,
      });
      setReviewSuccess("Review submitted!");
      setReviewComment("");
      setReviewRating(5);
      loadReviews();
      api
        .getProduct(id)
        .then((res) => setProduct(res.data ?? res))
        .catch(() => {});
    } catch (e) {
      setReviewError(getErrorMessage(e));
    } finally {
      setReviewLoading(false);
    }
  }

  if (result) {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>
            {result.escrow ? "🔒" : "✅"}
          </div>
          <div style={s.success}>
            {result.escrow ? (
              <>
                <strong>Payment held in escrow!</strong>
                <p style={{ marginTop: 8, fontSize: 14 }}>
                  Order #{result.orderId} · {result.totalPrice} XLM locked in
                  Stellar Claimable Balance
                </p>
                <p style={{ marginTop: 4, fontSize: 12, color: "#555" }}>
                  Balance ID:{" "}
                  <a
                    href={`https://stellar.expert/explorer/testnet/claimable-balance/${result.balanceId}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "#2d6a4f", wordBreak: "break-all" }}
                  >
                    {result.balanceId}
                  </a>
                </p>
                <p style={{ marginTop: 4, fontSize: 12, color: "#888" }}>
                  The farmer can claim once delivery is confirmed. You can
                  reclaim after 14 days if undelivered.
                </p>
              </>
            ) : (
              <>
                <strong>Payment successful!</strong>
                <p style={{ marginTop: 8, fontSize: 14 }}>
                  Order #{result.orderId} · {result.totalPrice} XLM paid
                </p>
                <p
                  style={{
                    marginTop: 4,
                    fontSize: 12,
                    wordBreak: "break-all",
                    color: "#555",
                  }}
                >
                  TX: {result.txHash}
                </p>
              </>
            )}
          </div>
          <button
            style={{ ...s.btn, marginTop: 20, background: "#555" }}
            onClick={() => navigate("/marketplace")}
          >
            Back to Marketplace
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        {/* Image gallery */}
        {images.length > 0 ? (
          <div style={{ marginBottom: 16 }}>
            <div style={{ position: "relative" }}>
            <div style={{ position: 'relative' }}>
              <img
                src={images[activeImg].url}
                alt={`${product.name} photo ${activeImg + 1}`}
                style={s.galleryMain}
              />
              {images.length > 1 && (
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: "100%",
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "0 8px",
                    boxSizing: "border-box",
                    pointerEvents: "none",
                  }}
                >
                  <button
                    style={{ ...s.navBtn, pointerEvents: "all" }}
                    onClick={() =>
                      setActiveImg(
                        (i) => (i - 1 + images.length) % images.length,
                      )
                    }
                    aria-label="Previous image"
                  >
                    ‹
                  </button>
                  <button
                    style={{ ...s.navBtn, pointerEvents: "all" }}
                    onClick={() => setActiveImg((i) => (i + 1) % images.length)}
                    aria-label="Next image"
                  >
                    ›
                  </button>
                <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: '100%', display: 'flex', justifyContent: 'space-between', padding: '0 8px', boxSizing: 'border-box', pointerEvents: 'none' }}>
                  <button style={{ ...s.navBtn, pointerEvents: 'all' }} onClick={() => setActiveImg(i => (i - 1 + images.length) % images.length)} aria-label="Previous image">‹</button>
                  <button style={{ ...s.navBtn, pointerEvents: 'all' }} onClick={() => setActiveImg(i => (i + 1) % images.length)} aria-label="Next image">›</button>
                </div>
              )}
            </div>
            {images.length > 1 && (
              <div style={s.thumbRow}>
                {images.map((img, i) => (
                  <img
                    key={img.id}
                    src={img.url}
                    alt={`Thumbnail ${i + 1}`}
                    style={{
                      ...s.thumb,
                      ...(i === activeImg ? s.thumbActive : {}),
                    }}
                    style={{ ...s.thumb, ...(i === activeImg ? s.thumbActive : {}) }}
                    onClick={() => setActiveImg(i)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            style={{
              width: "100%",
              maxHeight: 280,
              objectFit: "cover",
              borderRadius: 10,
              marginBottom: 16,
            }}
          />
        ) : (
          <div style={{ fontSize: 48, marginBottom: 12 }}>🥬</div>
        )}

        {/* Name + favorite button */}
          <img src={product.image_url} alt={product.name} style={{ width: '100%', maxHeight: 280, objectFit: 'cover', borderRadius: 10, marginBottom: 16 }} />
        ) : (
          <div style={{ fontSize: 48, marginBottom: 12 }}>🥬</div>
        )}
        <div style={s.name}>{product.name}</div>
        <div style={s.farmer}>
          Sold by{' '}
          <span
            style={{ cursor: 'pointer', textDecoration: 'underline', color: '#2d6a4f' }}
            onClick={() => navigate(`/farmer/${product.farmer_id}`)}
          >
            {product.farmer_name}
          </span>
        {product.image_url
          ? <img src={product.image_url} alt={product.name} style={{ width: '100%', maxHeight: 280, objectFit: 'cover', borderRadius: 10, marginBottom: 16 }} />
          : <div style={{ fontSize: 48, marginBottom: 12 }}>🥬</div>
        }
        <div style={s.header}>
          <div style={s.headerContent}>
            <div style={s.name}>{product.name}</div>
            <div style={s.farmer}>
              Sold by{" "}
              <span
                style={{
                  cursor: "pointer",
                  textDecoration: "underline",
                  color: "#2d6a4f",
                }}
                onClick={() => navigate(`/farmer/${product.farmer_id}`)}
              >
                {product.farmer_name}
              </span>
            </div>
          </div>
          {user?.role === "buyer" && (
            <button
              style={s.favoriteBtn}
              onClick={() => toggleFavorite(product.id).catch(() => {})}
              title={
                isFavorited(product.id)
                  ? "Remove from favorites"
                  : "Add to favorites"
              }
            >
              {isFavorited(product.id) ? "❤️" : "🤍"}
            </button>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <StarRating
            value={product.avg_rating || 0}
            count={product.review_count || 0}
            size={18}
          />
        </div>

        <div style={s.desc}>
          {product.description || "Fresh from the farm."}
        </div>
        <div style={s.price}>
          {product.price} XLM{" "}
          <span style={{ fontSize: 14, fontWeight: 400 }}>
            / {product.unit}
          </span>
        </div>
        {usd(product.price) && (
          <div style={{ fontSize: 13, color: "#888", marginBottom: 4 }}>
            {usd(product.price)} per {product.unit}{" "}
            <span style={{ fontSize: 11, color: "#bbb" }}>(approx. rate)</span>
          </div>
        )}
        <div style={{ fontSize: 13, color: "#888", marginBottom: 20 }}>
          {product.quantity} {product.unit} in stock
        </div>

        <div style={s.row}>
          <label style={{ fontSize: 14 }}>Quantity:</label>
          <input
            style={s.input}
            type="number"
            min={1}
            max={product.quantity}
            value={qty}
            onChange={(e) =>
              setQty(
                Math.max(
                  1,
                  Math.min(product.quantity, parseInt(e.target.value) || 1),
                ),
              )
            }
          />
          <span style={{ fontSize: 13, color: "#888" }}>{product.unit}</span>
        </div>

        {user?.role === "buyer" && addresses.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <label style={s.label}>Delivery Address</label>
            <select
              style={s.select}
              value={selectedAddressId || ""}
              onChange={(e) =>
                setSelectedAddressId(
                  e.target.value ? parseInt(e.target.value) : null,
                )
              }
            >
              {addresses.map((addr) => (
                <option key={addr.id} value={addr.id}>
                  {addr.label} — {addr.street}, {addr.city}
                  {addr.is_default ? " (Default)" : ""}
                </option>
              ))}
            </select>
            <button
              style={{
                background: "none",
                border: "none",
                color: "#2d6a4f",
                cursor: "pointer",
                fontSize: 13,
                padding: 0,
              }}
              onClick={() => navigate("/addresses")}
            >
              Manage addresses
            </button>
          </div>
        )}

        <div style={s.total}>
          Total: <strong>{total} XLM</strong>
        </div>
        {error && <div style={s.err}>{error}</div>}
        <div style={s.total}>Total: <strong>{total} XLM</strong></div>
        {error && <div style={s.err} dangerouslySetInnerHTML={{ __html: error }} />}

        {product.quantity === 0 ? (
          <div>
            <div
              style={{ color: "#c0392b", fontWeight: 600, marginBottom: 12 }}
            >
              ⚠️ Out of stock
            </div>
            {user?.role === "buyer" && (
              <button
                style={{ ...s.btn, background: alertSet ? "#888" : "#2d6a4f" }}
                onClick={handleAlert}
                disabled={alertLoading}
              >
                {alertLoading
                  ? "..."
                  : alertSet
                    ? "🔔 Alert Set — Click to Unsubscribe"
                    : "🔔 Notify Me When Back in Stock"}
              </button>
            )}
          </div>
        ) : (
          <>
            {user?.role === "buyer" && (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 16,
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={useEscrow}
                  onChange={(e) => setUseEscrow(e.target.checked)}
                />
                🔒 Use Escrow Payment (funds held until delivery, claimable by
                farmer after delivery)
              </label>
            )}
            <button
              style={{
                ...s.btn,
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
              }}
              onClick={handleBuy}
              disabled={loading}
            >
              {loading && (
                <div
                  className="spinner-sm"
                  style={{
                    width: 16,
                    height: 16,
                    border: "2px solid rgba(255,255,255,0.3)",
                    borderTopColor: "#fff",
                    borderRadius: "50%",
                    animation: "spin 0.6s linear infinite",
                  }}
                />
              )}
              {loading
                ? "Processing..."
                : `${useEscrow ? "🔒 Pay to Escrow" : "Buy Now"} · ${total} XLM`}
            </button>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } } .spinner-sm { display: inline-block; }`}</style>
          </>
        )}
      </div>

      {/* Reviews section */}
      <div style={s.card}>
        <div style={s.sectionTitle}>⭐ Reviews ({reviews.length})</div>

        {reviews.length === 0 ? (
          <div style={s.empty}>
            No reviews yet. Be the first to review this product.
          </div>
        ) : (
          reviews.map((r) => (
            <div key={r.id} style={s.reviewCard}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <span style={s.reviewName}>{r.reviewer_name}</span>
                <StarRating value={r.rating} size={14} />
                <span style={s.reviewDate}>
                  {new Date(r.created_at).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
              {r.comment && <div style={s.reviewText}>{r.comment}</div>}
            </div>
          ))
        )}

        {user?.role === "buyer" && paidOrders.length > 0 && !reviewSuccess && (
          <form
            onSubmit={handleReviewSubmit}
            style={{
              marginTop: 24,
              borderTop: "1px solid #f0f0f0",
              paddingTop: 20,
            }}
          >
            <div style={{ ...s.sectionTitle, fontSize: 15, marginBottom: 12 }}>
              Leave a Review
            </div>

            {paidOrders.length > 1 && (
              <div style={{ marginBottom: 12 }}>
                <label style={s.label}>Order</label>
                <select
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid #ddd",
                    fontSize: 14,
                  }}
                  value={reviewOrderId}
                  onChange={(e) => setReviewOrderId(e.target.value)}
                >
                  {paidOrders.map((o) => (
                    <option key={o.id} value={o.id}>
                      Order #{o.id} — {o.quantity} {o.unit}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <label style={s.label}>Rating</label>
              <StarRating
                value={reviewRating}
                size={28}
                onChange={setReviewRating}
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={s.label}>Comment (optional)</label>
              <textarea
                style={s.textarea}
                placeholder="Share your experience..."
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                maxLength={1000}
              />
            </div>

            {reviewError && <div style={s.err}>{reviewError}</div>}

            <button type="submit" style={s.btnSm} disabled={reviewLoading}>
              {reviewLoading ? "Submitting..." : "Submit Review"}
            </button>
          </form>
        )}

        {reviewSuccess && (
          <div style={{ ...s.success, marginTop: 16 }}>{reviewSuccess}</div>
        )}
      </div>
    </div>
  );
}
