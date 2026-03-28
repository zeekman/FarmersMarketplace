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
import { useTranslation } from 'react-i18next';

const s = {
  page: { maxWidth: 640, margin: '40px auto', padding: 24 },
  card: { background: '#fff', borderRadius: 12, padding: 32, boxShadow: '0 1px 8px #0001', marginBottom: 24 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16 },
  headerContent: { flex: 1 },
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
  galleryMain:   { width: '100%', maxHeight: 320, objectFit: 'cover', borderRadius: 10, marginBottom: 10, display: 'block' },
  thumbRow:      { display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto' },
  thumb:         { width: 64, height: 64, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', border: '2px solid transparent', flexShrink: 0 },
  thumbActive:   { border: '2px solid #2d6a4f' },
  navBtn:        { background: 'rgba(0,0,0,0.35)', color: '#fff', border: 'none', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' },
};

export default function ProductDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { user } = useAuth();
  const { isFavorited, toggleFavorite } = useFavorites();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const { usd } = useXlmRate();
  const [addresses, setAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState(null);
  const [useEscrow, setUseEscrow] = useState(false);
  const [alertSet, setAlertSet] = useState(false);
  const [alertLoading, setAlertLoading] = useState(false);
  const [images, setImages] = useState([]);
  const [activeImg, setActiveImg] = useState(0);
  const [paidOrders, setPaidOrders] = useState([]);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewOrderId, setReviewOrderId] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [reviewSuccess, setReviewSuccess] = useState('');

  // Price tiers state
  const [tiers, setTiers] = useState([]);

  // Coupon state
  const [couponCode, setCouponCode] = useState('');
  const [couponResult, setCouponResult] = useState(null); // { discount, final_total, discount_type, discount_value }
  const [couponError, setCouponError] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);

  // Nutrition state
  const [nutritionExpanded, setNutritionExpanded] = useState(false);

  const loadReviews = useCallback(async () => {
    try { const res = await api.getProductReviews(id); setReviews(res.data ?? []); }
    catch { setReviews([]); }
  }, [id]);

  useEffect(() => {
    api.getProduct(id).then(res => setProduct(res.data ?? res)).catch(() => navigate('/marketplace'));
    loadReviews();
    api.getProductImages(id).then(res => {
      const imgs = res.data ?? [];
      setImages(imgs);
      if (imgs.length > 0) setActiveImg(0);
    }).catch(() => {});
    api.getProductTiers(id).then(res => setTiers(res.data ?? [])).catch(() => setTiers([]));
  }, [id, loadReviews, navigate]);

  useEffect(() => {
    if (user?.role !== 'buyer') return;
    api.getAddresses().then(res => {
      const addrs = res.data ?? [];
      setAddresses(addrs);
      const def = addrs.find(a => a.is_default);
      if (def) setSelectedAddressId(def.id);
      else if (addrs.length > 0) setSelectedAddressId(addrs[0].id);
    }).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (user?.role !== 'buyer') return;
    api.getMyAlert(id).then(res => setAlertSet(res.subscribed)).catch(() => {});
  }, [id, user]);

  useEffect(() => {
    if (user?.role !== 'buyer') return;
    api.getOrders({ limit: 100 }).then(res => {
      const orders = (res.data ?? []).filter(o => o.product_id === parseInt(id) && o.status === 'paid');
      setPaidOrders(orders);
      if (orders.length > 0) setReviewOrderId(String(orders[0].id));
    }).catch(() => {});
  }, [id, user]);

  if (!product) return <Spinner />;

  // Get the best matching tier price for the current quantity
  const getTierPrice = (quantity) => {
    if (!tiers.length) return product.price;
    // Find the highest min_quantity that is <= quantity
    for (let i = tiers.length - 1; i >= 0; i--) {
      if (quantity >= tiers[i].min_quantity) {
        return tiers[i].price_per_unit;
      }
    }
    return product.price;
  };

  const unitPrice = getTierPrice(qty);
  const subtotal = (unitPrice * qty).toFixed(2);
  const total = couponResult ? couponResult.final_total.toFixed(2) : subtotal;

  async function handleApplyCoupon() {
    if (!couponCode.trim()) return;
    setCouponLoading(true);
    setCouponError('');
    setCouponResult(null);
    try {
      const res = await api.validateCoupon({ code: couponCode.trim(), product_id: product.id, quantity: qty });
      setCouponResult(res);
    } catch (e) {
      setCouponError(getErrorMessage(e));
    } finally {
      setCouponLoading(false);
    }
  }

  async function handleBuy() {
    if (!user) return navigate('/login');
    if (user.role === 'farmer') return setError(t('productDetail.farmersCannotOrder'));
    if (addresses.length > 0 && !selectedAddressId) return setError(t('productDetail.selectAddress'));
    setLoading(true);
    setError('');
    try {
      const res = await api.placeOrder({
        product_id: product.id,
        quantity: qty,
        address_id: selectedAddressId || undefined,
        coupon_code: couponResult ? couponCode.trim() : undefined,
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
    setReviewError('');
    setReviewSuccess('');
    if (!reviewOrderId) return setReviewError(t('productDetail.noEligibleOrder'));
    setReviewLoading(true);
    try {
      await api.submitReview({ order_id: parseInt(reviewOrderId), rating: reviewRating, comment: reviewComment.trim() || undefined });
      setReviewSuccess(t('productDetail.reviewSubmitted'));
      setReviewComment('');
      setReviewRating(5);
      loadReviews();
      api.getProduct(id).then(res => setProduct(res.data ?? res)).catch(() => {});
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
          <div style={{ fontSize: 40, marginBottom: 12 }}>{result.escrow ? '🔒' : '✅'}</div>
          <div style={s.success}>
            {result.escrow ? (
              <>
                <strong>{t('productDetail.escrowSuccess')}</strong>
                <p style={{ marginTop: 8, fontSize: 14 }}>{t('productDetail.escrowOrderInfo', { id: result.orderId, price: result.totalPrice })}</p>
                <p style={{ marginTop: 4, fontSize: 12, color: '#555' }}>
                  Balance ID: <a href={`https://stellar.expert/explorer/testnet/claimable-balance/${result.balanceId}`}
                    target="_blank" rel="noreferrer" style={{ color: '#2d6a4f', wordBreak: 'break-all' }}>{result.balanceId}</a>
                </p>
                <p style={{ marginTop: 4, fontSize: 12, color: '#888' }}>{t('productDetail.escrowNote')}</p>
              </>
            ) : (
              <>
                <strong>{t('productDetail.paymentSuccess')}</strong>
                <p style={{ marginTop: 8, fontSize: 14 }}>{t('productDetail.orderInfo', { id: result.orderId, price: result.totalPrice })}</p>
                <p style={{ marginTop: 4, fontSize: 12, wordBreak: 'break-all', color: '#555' }}>TX: {result.txHash}</p>
              </>
            )}
          </div>
          <button style={{ ...s.btn, marginTop: 20, background: '#555' }} onClick={() => navigate('/marketplace')}>
            {t('productDetail.backToMarketplace')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        {images.length > 0 ? (
          <div style={{ marginBottom: 16 }}>
            <div style={{ position: 'relative' }}>
              <img src={images[activeImg].url} alt={`${product.name} photo ${activeImg + 1}`} style={s.galleryMain} />
              {images.length > 1 && (
                <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: '100%', display: 'flex', justifyContent: 'space-between', padding: '0 8px', boxSizing: 'border-box', pointerEvents: 'none' }}>
                  <button style={{ ...s.navBtn, pointerEvents: 'all' }} onClick={() => setActiveImg(i => (i - 1 + images.length) % images.length)} aria-label={t('productDetail.previousImage')}>‹</button>
                  <button style={{ ...s.navBtn, pointerEvents: 'all' }} onClick={() => setActiveImg(i => (i + 1) % images.length)} aria-label={t('productDetail.nextImage')}>›</button>
                </div>
              )}
            </div>
            {images.length > 1 && (
              <div style={s.thumbRow}>
                {images.map((img, i) => (
                  <img key={img.id} src={img.url} alt={t('productDetail.thumbnail', { n: i + 1 })}
                    style={{ ...s.thumb, ...(i === activeImg ? s.thumbActive : {}) }} onClick={() => setActiveImg(i)} />
                ))}
              </div>
            )}
          </div>
        ) : product.image_url ? (
          <img src={product.image_url} alt={product.name} style={{ width: '100%', maxHeight: 280, objectFit: 'cover', borderRadius: 10, marginBottom: 16 }} />
        ) : (
          <div style={{ fontSize: 48, marginBottom: 12 }}>🥬</div>
        )}

        <div style={s.header}>
          <div style={s.headerContent}>
            <div style={s.name}>{product.name}</div>
            <div style={s.farmer}>
              {t('productDetail.soldBy')}{' '}
              <span style={{ cursor: 'pointer', textDecoration: 'underline', color: '#2d6a4f' }}
                onClick={() => navigate(`/farmer/${product.farmer_id}`)}>
                {product.farmer_name}
              </span>
            </div>
          </div>
          {user?.role === 'buyer' && (
            <button style={s.favoriteBtn} onClick={() => toggleFavorite(product.id).catch(() => {})}
              title={isFavorited(product.id) ? 'Remove from favorites' : 'Add to favorites'}>
              {isFavorited(product.id) ? '❤️' : '🤍'}
            </button>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <StarRating value={product.avg_rating || 0} count={product.review_count || 0} size={18} />
        </div>

        <div style={s.desc}>
          {product.description || "Fresh from the farm."}
        </div>

        {product.nutrition && (
          <div style={{ marginBottom: 16 }}>
            <button
              onClick={() => setNutritionExpanded(!nutritionExpanded)}
              style={{
                background: 'none',
                border: 'none',
                color: '#2d6a4f',
                cursor: 'pointer',
                fontSize: 16,
                fontWeight: 600,
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}
            >
              Nutritional Information {nutritionExpanded ? '▼' : '▶'}
            </button>
            {nutritionExpanded && (
              <div style={{ marginTop: 8, padding: 12, background: '#f8fdf9', border: '1px solid #b7e4c7', borderRadius: 8 }}>
                {(() => {
                  try {
                    const nutrition = JSON.parse(product.nutrition);
                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
                        {nutrition.calories !== undefined && (
                          <div><strong>Calories:</strong> {nutrition.calories}</div>
                        )}
                        {nutrition.protein !== undefined && (
                          <div><strong>Protein:</strong> {nutrition.protein}g</div>
                        )}
                        {nutrition.carbs !== undefined && (
                          <div><strong>Carbs:</strong> {nutrition.carbs}g</div>
                        )}
                        {nutrition.fat !== undefined && (
                          <div><strong>Fat:</strong> {nutrition.fat}g</div>
                        )}
                        {nutrition.fiber !== undefined && (
                          <div><strong>Fiber:</strong> {nutrition.fiber}g</div>
                        )}
                        {nutrition.vitamins && Object.keys(nutrition.vitamins).length > 0 && (
                          <div style={{ gridColumn: '1 / -1' }}>
                            <strong>Vitamins:</strong>
                            <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                              {Object.entries(nutrition.vitamins).map(([vitamin, amount]) => (
                                <span key={vitamin} style={{ fontSize: 13, background: '#e8f5e8', padding: '2px 6px', borderRadius: 4 }}>
                                  {vitamin}: {amount}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  } catch {
                    return <div style={{ color: '#888', fontSize: 14 }}>Invalid nutritional data</div>;
                  }
                })()}
              </div>
            )}
          </div>
        )}

        {product.is_preorder ? (
          <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 600, color: '#856404', background: '#fff3cd', display: 'inline-block', padding: '4px 10px', borderRadius: 20 }}>
            Pre-Order{product.preorder_delivery_date ? ` · Expected delivery ${product.preorder_delivery_date}` : ''}
          </div>
        ) : null}
        <div style={s.price}>
          {unitPrice} XLM{" "}
          <span style={{ fontSize: 14, fontWeight: 400 }}>
            / {product.unit}
          </span>
          {tiers.length > 0 && (
            <span style={{ fontSize: 12, color: '#666', marginLeft: 8 }}>
              (bulk pricing available)
            </span>
          )}
        </div>
        {usd(unitPrice) && (
          <div style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>
            {usd(unitPrice)} {t('productDetail.perUnit', { unit: product.unit })} <span style={{ fontSize: 11, color: '#bbb' }}>{t('productDetail.approxRate')}</span>
          </div>
        )}

        {tiers.length > 0 && (
          <div style={{ marginBottom: 16, padding: 12, background: '#f8fdf9', border: '1px solid #b7e4c7', borderRadius: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#2d6a4f', marginBottom: 8 }}>Bulk Pricing Tiers</div>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #ddd' }}>
                  <th style={{ textAlign: 'left', padding: '4px 0', fontWeight: 600 }}>Min Quantity</th>
                  <th style={{ textAlign: 'left', padding: '4px 0', fontWeight: 600 }}>Price per Unit</th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((tier, index) => (
                  <tr key={tier.id} style={{ borderBottom: index < tiers.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                    <td style={{ padding: '4px 0' }}>{tier.min_quantity}+ {product.unit}</td>
                    <td style={{ padding: '4px 0' }}>{tier.price_per_unit} XLM</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ fontSize: 13, color: '#888', marginBottom: 20 }}>
          {t('productDetail.inStock', { qty: product.quantity, unit: product.unit })}
        </div>

        <div style={s.row}>
          <label style={{ fontSize: 14 }}>{t('productDetail.quantity')}</label>
          <input style={s.input} type="number" min={1} max={product.quantity} value={qty}
            onChange={e => {
              setQty(Math.max(1, Math.min(product.quantity, parseInt(e.target.value) || 1)));
              setCouponResult(null); // Clear coupon when quantity changes
              setCouponError('');
            }} />
          <span style={{ fontSize: 13, color: '#888' }}>{product.unit}</span>
        </div>

        {user?.role === 'buyer' && addresses.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <label style={s.label}>{t('productDetail.deliveryAddress')}</label>
            <select style={s.select} value={selectedAddressId || ''} onChange={e => setSelectedAddressId(e.target.value ? parseInt(e.target.value) : null)}>
              {addresses.map(addr => (
                <option key={addr.id} value={addr.id}>
                  {addr.label} — {addr.street}, {addr.city}{addr.is_default ? ` ${t('productDetail.default')}` : ''}
                </option>
              ))}
            </select>
            <button style={{ background: 'none', border: 'none', color: '#2d6a4f', cursor: 'pointer', fontSize: 13, padding: 0 }}
              onClick={() => navigate('/addresses')}>
              {t('productDetail.manageAddresses')}
            </button>
          </div>
        )}

        {user?.role === 'buyer' && product.quantity > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ ...s.input, flex: 1, marginBottom: 0 }}
                placeholder="Coupon code"
                value={couponCode}
                onChange={e => { setCouponCode(e.target.value); setCouponResult(null); setCouponError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleApplyCoupon()}
              />
              <button style={{ ...s.btnSm, whiteSpace: 'nowrap' }} onClick={handleApplyCoupon} disabled={couponLoading}>
                {couponLoading ? '...' : 'Apply'}
              </button>
            </div>
            {couponError && <div style={{ ...s.err, marginTop: 4 }}>{couponError}</div>}
            {couponResult && (
              <div style={{ color: '#2d6a4f', fontSize: 13, marginTop: 4 }}>
                ✅ Coupon applied — {couponResult.discount_type === 'percent' ? `${couponResult.discount_value}% off` : `${couponResult.discount_value} XLM off`} (−{couponResult.discount.toFixed(2)} XLM)
              </div>
            )}
          </div>
        )}

        <div style={s.total}>
          {couponResult ? (
            <>
              <span style={{ textDecoration: 'line-through', color: '#aaa', marginRight: 8 }}>{subtotal} XLM</span>
              Total: <strong>{total} XLM</strong>
            </>
          ) : (
            <>Total: <strong>{total} XLM</strong></>
          )}
        </div>
        {error && <div style={s.err}>{error}</div>}

        {product.quantity === 0 ? (
          <div>
            <div style={{ color: '#c0392b', fontWeight: 600, marginBottom: 12 }}>{t('productDetail.outOfStock')}</div>
            {user?.role === 'buyer' && (
              <button style={{ ...s.btn, background: alertSet ? '#888' : '#2d6a4f' }} onClick={handleAlert} disabled={alertLoading}>
                {alertLoading ? '...' : alertSet ? t('productDetail.alertSet') : t('productDetail.notifyMe')}
              </button>
            )}
          </div>
        ) : (
          <>
            {user?.role === 'buyer' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={useEscrow} onChange={e => setUseEscrow(e.target.checked)} />
                {t('productDetail.useEscrow')}
              </label>
            )}
            <button style={{ ...s.btn, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
              onClick={handleBuy} disabled={loading}>
              {loading && <div className="spinner-sm" style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />}
              {loading ? t('productDetail.processing') : `${useEscrow ? t('productDetail.payToEscrow') : t('productDetail.buyNow')} · ${total} XLM`}
            </button>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } } .spinner-sm { display: inline-block; }`}</style>
          </>
        )}
      </div>

      <div style={s.card}>
        <div style={s.sectionTitle}>{t('productDetail.reviews', { count: reviews.length })}</div>
        {reviews.length === 0 ? (
          <div style={s.empty}>{t('productDetail.noReviews')}</div>
        ) : (
          reviews.map(r => (
            <div key={r.id} style={s.reviewCard}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <span style={s.reviewName}>{r.reviewer_name}</span>
                <StarRating value={r.rating} size={14} />
                <span style={s.reviewDate}>{new Date(r.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
              </div>
              {r.comment && <div style={s.reviewText}>{r.comment}</div>}
            </div>
          ))
        )}

        {user?.role === 'buyer' && paidOrders.length > 0 && !reviewSuccess && (
          <form onSubmit={handleReviewSubmit} style={{ marginTop: 24, borderTop: '1px solid #f0f0f0', paddingTop: 20 }}>
            <div style={{ ...s.sectionTitle, fontSize: 15, marginBottom: 12 }}>{t('productDetail.leaveReview')}</div>
            {paidOrders.length > 1 && (
              <div style={{ marginBottom: 12 }}>
                <label style={s.label}>{t('productDetail.order')}</label>
                <select style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14 }}
                  value={reviewOrderId} onChange={e => setReviewOrderId(e.target.value)}>
                  {paidOrders.map(o => <option key={o.id} value={o.id}>Order #{o.id} — {o.quantity} {o.unit}</option>)}
                </select>
              </div>
            )}
            <div style={{ marginBottom: 12 }}>
              <label style={s.label}>{t('productDetail.rating')}</label>
              <StarRating value={reviewRating} size={28} onChange={setReviewRating} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={s.label}>{t('productDetail.comment')}</label>
              <textarea style={s.textarea} placeholder={t('productDetail.commentPlaceholder')}
                value={reviewComment} onChange={e => setReviewComment(e.target.value)} maxLength={1000} />
            </div>
            {reviewError && <div style={s.err}>{reviewError}</div>}
            <button type="submit" style={s.btnSm} disabled={reviewLoading}>
              {reviewLoading ? t('productDetail.submitting') : t('productDetail.submitReview')}
            </button>
          </form>
        )}
        {reviewSuccess && <div style={{ ...s.success, marginTop: 16 }}>{reviewSuccess}</div>}
      </div>
    </div>
  );
}
