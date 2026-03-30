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
import FlashSaleCountdown from '../components/FlashSaleCountdown';
import ShareButtons from '../components/ShareButtons';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';

const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 60000;

const s = {
  page: { maxWidth: 640, margin: "40px auto", padding: 16 },
  card: {
    background: "#fff",
    borderRadius: 12,
    padding: 24,
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
  favoriteBtn: { background: 'none', border: 'none', fontSize: 32, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 48, height: 48, flexShrink: 0 },
  name:       { fontSize: 28, fontWeight: 700, color: '#2d6a4f', marginBottom: 4 },
  farmer:     { color: '#888', marginBottom: 8 },
  desc:       { color: '#555', marginBottom: 24, lineHeight: 1.6 },
  price:      { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 8 },
  row:        { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
  input:      { width: 80, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 16, textAlign: 'center' },
  btn:        { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 28px', cursor: 'pointer', fontWeight: 600, fontSize: 16, minHeight: 44 },
  btnSm:      { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 14, minHeight: 44 },
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
  badge:      { display: 'inline-block', fontSize: 11, borderRadius: 4, padding: '2px 7px' },
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
  const [weight, setWeight] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [confirming, setConfirming] = useState(null); // { orderId, startedAt }
  const [progress, setProgress] = useState(0);
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
  const [customPrice, setCustomPrice] = useState('');

  // Price tiers state
  const [tiers, setTiers] = useState([]);

  // Coupon state
  const [couponCode, setCouponCode] = useState('');
  const [couponResult, setCouponResult] = useState(null); // { discount, final_total, discount_type, discount_value }
  const [couponError, setCouponError] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);

  // Nutrition state
  const [nutritionExpanded, setNutritionExpanded] = useState(false);
  // Path payment state
  const [buyerAssets, setBuyerAssets] = useState([]);
  const [sourceAsset, setSourceAsset] = useState(null); // null = XLM (default)
  const [pathEstimate, setPathEstimate] = useState(null); // { sourceAmount, sourceCode }
  const [pathEstimateLoading, setPathEstimateLoading] = useState(false);
  const [pathEstimateError, setPathEstimateError] = useState('');
  // Availability calendar
  const [calendar, setCalendar] = useState([]);
  const [selectedWeek, setSelectedWeek] = useState(null); // YYYY-MM-DD of chosen week
  // Platform fee state
  const [feeInfo, setFeeInfo] = useState(null); // { feePercent, feeAmount, farmerAmount }
  const [shareMeta, setShareMeta] = useState(null);

  const loadReviews = useCallback(async () => {
    try { const res = await api.getProductReviews(id); setReviews(res.data ?? []); }
    catch { setReviews([]); }
  }, [id]);

  useEffect(() => {
    api.getProductImages(id).then(res => {
      const imgs = res.data ?? [];
      setImages(imgs);
      if (imgs.length > 0) setActiveImg(0);
    }).catch(() => {});
    api.getProductTiers(id).then(res => setTiers(res.data ?? [])).catch(() => setTiers([]));
    api.getProductShareMeta(id).then(res => setShareMeta(res.data ?? null)).catch(() => setShareMeta(null));
    loadReviews();
    api.getProduct(id).then(res => {
      const p = res.data ?? res;
      setProduct(p);
      if (p.pricing_model === 'pwyw') setCustomPrice(String(p.min_price));
      else if (p.pricing_model === 'donation') setCustomPrice('1.00');
    }).catch(() => navigate('/marketplace'));
    api.getCalendar(id).then(res => {
      const weeks = res.data ?? [];
      setCalendar(weeks);
      // Default to first available week
      const first = weeks.find(w => w.available);
      if (first) setSelectedWeek(first.week_start);
    }).catch(() => {});
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

  // Load buyer's non-XLM assets for path payment selector
  useEffect(() => {
    if (user?.role !== 'buyer') return;
    api.getWalletAssets().then(res => setBuyerAssets(res.data ?? [])).catch(() => {});
  }, [user]);

  // Fetch path estimate whenever source asset or total changes
  useEffect(() => {
    if (!sourceAsset || !product) return;
    setPathEstimate(null);
    setPathEstimateError('');
    const destAmount = couponResult ? couponResult.final_total : product.price * qty;
    if (!destAmount || destAmount <= 0) return;
    setPathEstimateLoading(true);
    api.getPathEstimate({
      source_code: sourceAsset.asset_code,
      source_issuer: sourceAsset.asset_issuer,
      dest_amount: parseFloat(destAmount).toFixed(7),
    }).then(res => {
      setPathEstimate({ sourceAmount: res.sourceAmount, sourceCode: res.sourceCode });
      setPathEstimateError('');
    }).catch(e => {
      setPathEstimateError(e.message?.includes('No payment path') ? `No path found from ${sourceAsset.asset_code} to XLM` : e.message);
    }).finally(() => setPathEstimateLoading(false));
  }, [sourceAsset, qty, couponResult, product]);

  if (!product) return <Spinner />;

  const shareUrl = shareMeta?.url || `${window.location.origin}/product/${id}`;
  const shareTitle = shareMeta?.title || `${product.name} on Farmers Marketplace`;
  const shareDescription = shareMeta?.description || product.description || 'Fresh produce from local farmers';
  const shareImage = shareMeta?.image || product.image_url || '';

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

  const isFlashSaleActive = Boolean(product.flash_sale_price && product.flash_sale_ends_at && new Date(product.flash_sale_ends_at).getTime() > Date.now());
  const baseUnitPrice = getTierPrice(qty);
  const unitPrice = isFlashSaleActive ? Number(product.flash_sale_price) : baseUnitPrice;
  const subtotal = product?.pricing_type === 'weight'
    ? (product.price * (parseFloat(weight) || 0)).toFixed(2)
    : (unitPrice * qty).toFixed(2);
  const total = couponResult ? couponResult.final_total.toFixed(2) : subtotal;
    const isFlashSaleActive = Boolean(product.flash_sale_price && product.flash_sale_ends_at && new Date(product.flash_sale_ends_at).getTime() > Date.now());
    const baseUnitPrice = getTierPrice(qty);
    const unitPrice = isFlashSaleActive ? Number(product.flash_sale_price) : baseUnitPrice;
    
    const effectiveUnitPrice = (product.pricing_model === 'pwyw' || product.pricing_model === 'donation')
      ? (parseFloat(customPrice) || 0)
      : unitPrice;

    const subtotal = product?.pricing_type === 'weight'
      ? (product.price * (parseFloat(weight) || 0)).toFixed(2)
      : (effectiveUnitPrice * qty).toFixed(2);
    const total = couponResult ? couponResult.final_total.toFixed(2) : subtotal;

  async function handleAlert() {
    setAlertLoading(true);
    try {
      if (alertSet) {
        await api.deleteAlert(id);
        setAlertSet(false);
      } else {
        await api.createAlert(id);
        setAlertSet(true);
      }
    } catch { /* ignore */ }
    setAlertLoading(false);
  }
  // Fetch fee info whenever total changes
  const totalNum = parseFloat(total);
  React.useEffect(() => {
    if (!totalNum) return;
    api.getFeePreview(totalNum).then(r => setFeeInfo(r)).catch(() => setFeeInfo(null));
  }, [total]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (product.pricing_type === 'weight') {
      const w = parseFloat(weight);
      if (!weight || isNaN(w) || w <= 0) return setError('Please enter a valid weight');
      if (w < product.min_weight) return setError(`Minimum weight is ${product.min_weight} ${product.unit}`);
      if (w > product.max_weight) return setError(`Maximum weight is ${product.max_weight} ${product.unit}`);
    }
    if (product.pricing_model === 'pwyw') {
      const p = parseFloat(customPrice);
      if (!customPrice || isNaN(p) || p < product.min_price) return setError(`Minimum price is ${product.min_price} XLM`);
    }
    if (product.pricing_model === 'donation') {
      const p = parseFloat(customPrice);
      if (!customPrice || isNaN(p) || p <= 0) return setError('Donation amount must be positive');
    }
    if (sourceAsset && pathEstimateError) return setError(pathEstimateError);
    if (sourceAsset && !pathEstimate) return setError('Waiting for path estimate...');
    setLoading(true);
    setError('');
    try {
      const res = await api.placeOrder({
        product_id: product.id,
        quantity: qty,
        address_id: selectedAddressId || undefined,
        use_soroban_escrow: useEscrow,
        coupon_code: couponResult ? couponCode.trim() : undefined,
        source_asset: sourceAsset ? { code: sourceAsset.asset_code, issuer: sourceAsset.asset_issuer } : undefined,
        weight: product.pricing_type === 'weight' ? parseFloat(weight) : undefined,
        custom_price: (product.pricing_model === 'pwyw' || product.pricing_model === 'donation') ? parseFloat(customPrice) : undefined,
      });
      setResult({ ...res, escrow: useEscrow });
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
                {(result.claimableBalanceId || result.balanceId) && (
                  <p style={{ marginTop: 4, fontSize: 12, color: '#555' }}>
                    {result.sorobanEscrow ? 'Escrow' : 'Balance'}:{' '}
                    <a
                      href={`https://stellar.expert/explorer/testnet/claimable-balance/${result.claimableBalanceId || result.balanceId}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#2d6a4f', wordBreak: 'break-all' }}
                    >
                      {result.claimableBalanceId || result.balanceId}
                    </a>
                  </p>
                )}
                <p style={{ marginTop: 8, fontSize: 14 }}>
                  {t('productDetail.escrowOrderInfo', { id: result.orderId, price: result.totalPrice })}
                </p>
                {result.balanceId ? (
                  <p style={{ marginTop: 4, fontSize: 12, color: '#555' }}>
                    Balance ID: <a href={`https://stellar.expert/explorer/testnet/claimable-balance/${result.balanceId}`}
                      target="_blank" rel="noreferrer" style={{ color: '#2d6a4f', wordBreak: 'break-all' }}>{result.balanceId}</a>
                  </p>
                ) : null}
                <p style={{ marginTop: 4, fontSize: 12, color: '#888' }}>{t('productDetail.escrowNote')}</p>
              </>
            ) : (
              <>
                <strong>{t('productDetail.paymentSuccess')}</strong>
                <p style={{ marginTop: 8, fontSize: 14 }}>{t('productDetail.orderInfo', { id: result.orderId, price: result.totalPrice })}</p>
                {result.sourceAsset && result.sourceAsset !== 'XLM' && (
                  <p style={{ marginTop: 4, fontSize: 13, color: '#555' }}>Paid via path payment using <strong>{result.sourceAsset}</strong></p>
                )}
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

  if (confirming) {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
          <div style={s.confirming}>
            <strong>Confirming payment...</strong>
            <p style={{ marginTop: 8, fontSize: 14 }}>Waiting for Stellar network confirmation. This usually takes a few seconds.</p>
            <div style={s.bar}><div style={{ ...s.barFill, width: `${progress}%` }} /></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <Helmet>
        <title>{shareTitle}</title>
        <meta property="og:title" content={shareTitle} />
        <meta property="og:description" content={shareDescription} />
        <meta property="og:url" content={shareUrl} />
        <meta property="og:type" content="product" />
        {shareImage ? <meta property="og:image" content={shareImage} /> : null}
      </Helmet>
      <div style={s.card}>
        {product.video_url ? (
          <video
            controls
            src={product.video_url}
            style={{ width: '100%', maxHeight: 280, borderRadius: 10, marginBottom: 16, background: '#000' }}
          />
        ) : null}

        {/* Image gallery */}

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
            {product.harvest_batch_code && (
              <div style={{ fontSize: 14, color: '#555', marginTop: 6 }}>
                <span style={{ fontWeight: 600, color: '#2d6a4f' }}>Harvest batch:</span>{' '}
                {product.harvest_batch_code}
                {product.harvest_batch_date ? ` · ${product.harvest_batch_date}` : ''}
              </div>
            )}
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

        <ShareButtons
          title={shareTitle}
          url={shareUrl}
          onShare={(platform) => {
            api.trackShareEvent(product.id, platform).catch(() => {});
          }}
        />

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
        {isFlashSaleActive ? (
          <>
            <div style={s.price}>
              {unitPrice.toFixed(2)} XLM{' '}
              <span style={{ fontSize: 14, fontWeight: 400 }}>/ {product.unit}</span>
              <span style={{ marginLeft: 8, fontSize: 13, textDecoration: 'line-through', color: '#888' }}>
                {baseUnitPrice.toFixed(2)} XLM
              </span>
            </div>
            <div style={{ ...s.badge, background: '#fee2e2', color: '#b42318', fontWeight: 700, marginBottom: 8 }}>Flash Sale</div>
            <FlashSaleCountdown endsAt={product.flash_sale_ends_at} />
          </>
        ) : (
          <div style={s.price}>
            {unitPrice.toFixed(2)} XLM{' '}
            <span style={{ fontSize: 14, fontWeight: 400 }}>/ {product.unit}</span>
            {tiers.length > 0 && (
              <span style={{ fontSize: 12, color: '#666', marginLeft: 8 }}>(bulk pricing available)</span>
            )}
          </div>
        )}
        {product.pricing_model === 'fixed' ? (
          <>
            <div style={s.price}>
              {unitPrice.toFixed(2)} XLM{" "}
              <span style={{ fontSize: 14, fontWeight: 400 }}>
                / {product.unit}
              </span>
              {tiers.length > 0 && (
                <span style={{ fontSize: 12, color: '#666', marginLeft: 8 }}>
                  (bulk pricing available)
                </span>
              )}
            </div>
            {isFlashSaleActive && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ ...s.badge, background: '#fee2e2', color: '#b42318', fontWeight: 700, marginBottom: 4 }}>Flash Sale</div>
                <FlashSaleCountdown endsAt={product.flash_sale_ends_at} />
              </div>
            )}
          </>
        ) : (
          <div style={{ marginBottom: 20 }}>
            <label style={s.label}>{product.pricing_model === 'pwyw' ? 'Pay What You Want' : 'Donation'}</label>
            <div style={s.row}>
              <input
                style={{ ...s.input, width: 120 }}
                type="number"
                min={product.pricing_model === 'pwyw' ? product.min_price : 0.01}
                step="0.01"
                value={customPrice}
                onChange={e => { setCustomPrice(e.target.value); setCouponResult(null); setCouponError(''); }}
                placeholder={product.pricing_model === 'pwyw' ? `Min ${product.min_price}` : 'Amount'}
              />
              <span style={{ fontSize: 13, color: '#888' }}>XLM / {product.unit}</span>
            </div>
            {product.pricing_model === 'pwyw' && (
              <div style={{ fontSize: 13, color: '#888' }}>
                Suggested price: {product.price} XLM · Minimum: {product.min_price} XLM
              </div>
            )}
          </div>
        )}

        {/* Allergen badges */}
        {(() => {
          let allergens = [];
          try { allergens = product.allergens ? JSON.parse(product.allergens) : []; } catch {}
          return (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 6 }}>Allergens</div>
              {allergens.length === 0 ? (
                <span style={{ fontSize: 12, color: '#888', background: '#f5f5f5', borderRadius: 4, padding: '3px 8px' }}>No known allergens</span>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {allergens.map(a => (
                    <span key={a} style={{ fontSize: 12, fontWeight: 600, background: '#fff3cd', color: '#856404', border: '1px solid #f0c040', borderRadius: 4, padding: '3px 8px' }}>
                      ⚠️ {a.charAt(0).toUpperCase() + a.slice(1)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
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

        {product.pricing_type === 'weight' ? (
          <div style={{ marginBottom: 20 }}>
            <label style={s.label}>Weight ({product.unit})</label>
            <div style={s.row}>
              <input
                style={{ ...s.input, width: 120 }}
                type="number"
                min={product.min_weight}
                max={product.max_weight}
                step="0.001"
                value={weight}
                onChange={e => { setWeight(e.target.value); setCouponResult(null); setCouponError(''); }}
                placeholder={`${product.min_weight}–${product.max_weight}`}
              />
              <span style={{ fontSize: 13, color: '#888' }}>{product.unit}</span>
            </div>
            <div style={{ fontSize: 13, color: '#888' }}>
              {product.price} XLM / {product.unit} · range: {product.min_weight}–{product.max_weight} {product.unit}
            </div>
          </div>
        ) : (
          <div style={s.row}>
            <label style={{ fontSize: 14 }}>{t('productDetail.quantity')}</label>
            <input style={s.input} type="number" min={1} max={product.quantity} value={qty}
              onChange={e => {
                setQty(Math.max(1, Math.min(product.quantity, parseInt(e.target.value) || 1)));
                setCouponResult(null);
                setCouponError('');
              }} />
            <span style={{ fontSize: 13, color: '#888' }}>{product.unit}</span>
          </div>
        )}

        {user?.role === 'buyer' && (
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
              type="button"
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
          {feeInfo && feeInfo.feeAmount > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#888', borderTop: '1px solid #e0e0e0', paddingTop: 6 }}>
              <div>Subtotal: {total} XLM</div>
              <div>Platform fee ({feeInfo.feePercent}%): −{feeInfo.feeAmount.toFixed(7)} XLM</div>
              <div style={{ fontWeight: 600, color: '#2d6a4f' }}>Farmer receives: {feeInfo.farmerAmount.toFixed(7)} XLM</div>
            </div>
          )}
        </div>

        {/* Path payment asset selector */}
        {user?.role === 'buyer' && product.quantity > 0 && (
          <div style={{ marginBottom: 16 }}>
            <label style={s.label}>Pay with</label>
            <select
              style={s.select}
              value={sourceAsset ? `${sourceAsset.asset_code}:${sourceAsset.asset_issuer}` : 'XLM'}
              onChange={e => {
                setPathEstimate(null);
                setPathEstimateError('');
                if (e.target.value === 'XLM') {
                  setSourceAsset(null);
                } else {
                  const found = buyerAssets.find(a => `${a.asset_code}:${a.asset_issuer}` === e.target.value);
                  setSourceAsset(found || null);
                }
              }}
            >
              <option value="XLM">XLM (default)</option>
              {buyerAssets.map(a => (
                <option key={`${a.asset_code}:${a.asset_issuer}`} value={`${a.asset_code}:${a.asset_issuer}`}>
                  {a.asset_code} (balance: {a.balance.toFixed(2)})
                </option>
              ))}
            </select>
            {sourceAsset && (
              <div style={{ fontSize: 13, marginTop: 6 }}>
                {pathEstimateLoading && <span style={{ color: '#888' }}>Estimating path...</span>}
                {pathEstimateError && <span style={{ color: '#c0392b' }}>{pathEstimateError}</span>}
                {pathEstimate && !pathEstimateError && (
                  <span style={{ color: '#2d6a4f', fontWeight: 600 }}>
                    Estimated cost: ~{pathEstimate.sourceAmount.toFixed(4)} {pathEstimate.sourceCode}
                    <span style={{ color: '#888', fontWeight: 400 }}> (farmer receives {total} XLM)</span>
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        {error && <div style={s.err}>{error}</div>}

        {/* Availability Calendar */}
        {calendar.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#333', marginBottom: 8 }}>📅 Weekly Availability</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {calendar.map(w => (
                <button
                  key={w.week_start}
                  disabled={!w.available}
                  onClick={() => w.available && setSelectedWeek(w.week_start)}
                  style={{
                    padding: '5px 10px', borderRadius: 6, fontSize: 12, cursor: w.available ? 'pointer' : 'not-allowed',
                    border: selectedWeek === w.week_start ? '2px solid #2d6a4f' : '1px solid #ddd',
                    background: !w.available ? '#f5f5f5' : selectedWeek === w.week_start ? '#d8f3dc' : '#fff',
                    color: !w.available ? '#bbb' : '#333',
                    fontWeight: selectedWeek === w.week_start ? 700 : 400,
                  }}
                >
                  {w.available ? '' : '✗ '}{new Date(w.week_start + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </button>
              ))}
            </div>
            {selectedWeek && <div style={{ fontSize: 12, color: '#2d6a4f', marginTop: 4 }}>Week of {selectedWeek} selected</div>}
          </div>
        )}

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
              onClick={handleBuy} disabled={loading || (calendar.length > 0 && selectedWeek && !calendar.find(w => w.week_start === selectedWeek)?.available)}>
              {loading && <div className="spinner-sm" style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />}
              {loading ? t('productDetail.processing') : `${useEscrow ? t('productDetail.payToEscrow') : t('productDetail.buyNow')} · ${sourceAsset && pathEstimate ? `~${pathEstimate.sourceAmount.toFixed(4)} ${pathEstimate.sourceCode}` : `${total} XLM`}`}
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
