import React, { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useIdempotencyKey } from '../hooks/useIdempotencyKey';
import { useFavorites } from '../context/FavoritesContext';
import { getStellarErrorMessage } from '../utils/stellarErrors';
import { getErrorMessage } from '../utils/errorMessages';
import { showToast } from '../utils/toast';
import { useXlmRate } from '../utils/useXlmRate';
import { calculateHaversineDistance, formatDistanceLabel } from '../utils/distance';
import { buildSrcSet } from '../utils/imageUtils';
import { useFreighter, signWithFreighter } from '../utils/freighter';
import { useReviewForm } from '../hooks/useReviewForm';
import { usePaymentLink } from '../hooks/usePaymentLink';
import { useNetwork } from '../context/NetworkContext';
import { useModalA11y } from '../hooks/useModalA11y';
import { addRecentlyViewed } from '../utils/recentlyViewed';
import StarRating from '../components/StarRating';
import Spinner from '../components/Spinner';
import FlashSaleCountdown from '../components/FlashSaleCountdown';
import ShareButtons from '../components/ShareButtons';
import PriceHistoryChart from '../components/PriceHistoryChart';
import CheckoutReviewModal from '../components/CheckoutReviewModal';
import NotFound from './NotFound';

const MapView = lazy(() => import('../components/MapView'));

function LazyMapView(props) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { rootMargin: '200px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ minHeight: 300 }}>
      {visible && (
        <Suspense fallback={<div style={{ height: 300, background: 'var(--color-surface-subtle)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>Loading map…</div>}>
          <MapView {...props} />
        </Suspense>
      )}
    </div>
  );
}

const s = {
  page: { maxWidth: 640, margin: "40px auto", padding: 16 },
  card: {
    background: "var(--color-bg-primary)",
    borderRadius: 12,
    padding: 24,
    boxShadow: "var(--shadow-md)",
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
  name:       { fontSize: 28, fontWeight: 700, color: 'var(--color-primary)', marginBottom: 4 },
  farmer:     { color: 'var(--color-text-muted)', marginBottom: 8 },
  desc:       { color: 'var(--color-text-secondary)', marginBottom: 24, lineHeight: 1.6 },
  price:      { fontSize: 24, fontWeight: 700, color: 'var(--color-primary)', marginBottom: 8 },
  row:        { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
  input:      { width: 80, padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 16, textAlign: 'center' },
  btn:        { background: 'var(--color-primary)', color: 'var(--color-text-inverse)', border: 'none', borderRadius: 8, padding: '12px 28px', cursor: 'pointer', fontWeight: 600, fontSize: 16, minHeight: 44 },
  btnSm:      { background: 'var(--color-primary)', color: 'var(--color-text-inverse)', border: 'none', borderRadius: 8, padding: '9px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 14, minHeight: 44 },
  total:      { background: 'var(--color-surface-subtle)', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 15 },
  err:        { color: 'var(--color-danger)', fontSize: 14, marginTop: 8 },
  success:    { background: 'var(--color-primary-lightest)', borderRadius: 8, padding: 16, color: 'var(--color-primary)' },
  sectionTitle: { fontSize: 18, fontWeight: 700, color: 'var(--color-primary)', marginBottom: 16 },
  reviewCard: { borderBottom: '1px solid var(--color-border-light)', paddingBottom: 14, marginBottom: 14 },
  reviewName: { fontWeight: 600, fontSize: 14, color: 'var(--color-text-primary)' },
  reviewDate: { fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 8 },
  reviewText: { fontSize: 14, color: 'var(--color-text-secondary)', marginTop: 6, lineHeight: 1.5 },
  textarea:   { width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 14, resize: 'vertical', minHeight: 80, boxSizing: 'border-box' },
  label:      { fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 6, display: 'block' },
  empty:      { color: 'var(--color-text-muted)', fontSize: 14, textAlign: 'center', padding: '24px 0' },
  badge:      { display: 'inline-block', fontSize: 11, borderRadius: 4, padding: '2px 7px' },
  select:     { width: '100%', padding: '9px 12px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 14, marginBottom: 12 },
  galleryMain:   { width: '100%', maxHeight: 320, objectFit: 'cover', borderRadius: 10, marginBottom: 10, display: 'block', transition: 'transform 0.3s ease' },
  galleryMainContainer: { overflow: 'hidden', borderRadius: 10, marginBottom: 10, cursor: 'zoom-in' },
  thumbRow:      { display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto' },
  thumb:         { width: 64, height: 64, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', border: '2px solid transparent', flexShrink: 0 },
  thumbActive:   { border: '2px solid var(--color-primary)' },
  navBtn:        { background: 'rgba(0,0,0,0.35)', color: 'var(--color-text-on-media)', border: 'none', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  dotRow:        { display: 'flex', justifyContent: 'center', gap: 6, marginTop: 8 },
  dot:           { width: 8, height: 8, borderRadius: '50%', background: 'var(--color-border)', border: 'none', padding: 0, cursor: 'pointer' },
  dotActive:     { background: 'var(--color-primary)' },
};

function CopyButton({ url }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      style={{ ...{ background: 'var(--color-primary)', color: 'var(--color-text-inverse)', border: 'none', borderRadius: 8, padding: '9px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 14, width: '100%' } }}
      onClick={handleCopy}
    >
      {copied ? 'Copied!' : 'Copy link'}
    </button>
  );
}

export default function ProductDetail() {
  const { explorerUrl, network } = useNetwork();
  const freighter = useFreighter(network);
  const { t } = useTranslation();
  const { id } = useParams();
  const { user } = useAuth();
  const buyAttempt = useIdempotencyKey();
  const walletAttempt = useIdempotencyKey();
  const { isFavorited, toggleFavorite } = useFavorites();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [qty, setQty] = useState(1);
  const [weight, setWeight] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [reviewBody, setReviewBody] = useState(null); // order body awaiting Confirm & Pay
  const submittingRef = useRef(false);
  const [confirming, setConfirming] = useState(null); // { orderId, startedAt }
   const [progress, setProgress] = useState(0);
   const [error, setError] = useState('');
   const { usd } = useXlmRate();
  const [addresses, setAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState(null);
  const [isOutOfDeliveryZone, setIsOutOfDeliveryZone] = useState(false);
  const [useEscrow, setUseEscrow] = useState(false);
  const [alertSet, setAlertSet] = useState(false);
  const [alertLoading, setAlertLoading] = useState(false);
  const [images, setImages] = useState([]);
   const [activeImg, setActiveImg] = useState(0);
   const [paidOrders, setPaidOrders] = useState([]);
   const [customPrice, setCustomPrice] = useState('');
  const [liveStock, setLiveStock] = useState(null); // Real-time stock from SSE
  const [isOnWaitlist, setIsOnWaitlist] = useState(false);
  const [waitlistPosition, setWaitlistPosition] = useState(null);
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [waitlistError, setWaitlistError] = useState('');
  const [buyerLocation, setBuyerLocation] = useState(null);
  const [distanceLabel, setDistanceLabel] = useState('');
  const [distanceLoading, setDistanceLoading] = useState(false);
  const [distanceError, setDistanceError] = useState('');

   const BUYER_LOCATION_KEY = 'buyer_location';

  const loadBuyerLocation = () => {
    try {
      const raw = sessionStorage.getItem(BUYER_LOCATION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.lat === 'number' && typeof parsed?.lng === 'number') {
        return parsed;
      }
    } catch {
      return null;
    }
    return null;
  };

  const cacheBuyerLocation = (loc) => {
    try {
      sessionStorage.setItem(BUYER_LOCATION_KEY, JSON.stringify(loc));
    } catch {
      // ignore
    }
  };

  const updateDistance = (location, productItem) => {
    if (!location || !productItem?.farm_lat || !productItem?.farm_lng) return;
    const distanceKm = calculateHaversineDistance(location.lat, location.lng, Number(productItem.farm_lat), Number(productItem.farm_lng));
    setDistanceLabel(formatDistanceLabel(distanceKm));
  };

  const requestDistance = () => {
    if (!navigator.geolocation) {
      setDistanceError('Geolocation is not available');
      return;
    }
    setDistanceLoading(true);
    setDistanceError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        cacheBuyerLocation(location);
        setBuyerLocation(location);
        updateDistance(location, product);
        setDistanceLoading(false);
      },
      (err) => {
        setDistanceLoading(false);
        setDistanceError(err.code === 1 ? 'Permission denied' : 'Unable to determine location');
      }
    );
  };

  // Price tiers state
  const [tiers, setTiers] = useState([]);
  // Price history state
  const [priceHistory, setPriceHistory] = useState([]);

  // Coupon state
  const [couponCode, setCouponCode] = useState('');
  const [couponResult, setCouponResult] = useState(null); // { discount, final_total, discount_type, discount_value }
  const [rewardInfo, setRewardInfo] = useState(null); // GET /rewards for this order total (#1504)
  const [useRewards, setUseRewards] = useState(false);
  const [rewardTokens, setRewardTokens] = useState(0);
  const [couponError, setCouponError] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);
  const [walletPaymentOpen, setWalletPaymentOpen] = useState(false);
  const [walletOrderId, setWalletOrderId] = useState(null);
  const [paymentLink, setPaymentLink] = useState('');
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletStatus, setWalletStatus] = useState('pending');
  const walletPollingIntervalRef = useRef(null);
  const walletPollingTimeoutRef = useRef(null);
  const mountedRef = useRef(true);

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
  // Auction state
  const [auctionData, setAuctionData] = useState(null); // { current_bid, auction_end, highest_bidder }
  const [bidAmount, setBidAmount] = useState('');
  const [bidError, setBidError] = useState('');
  const [bidLoading, setBidLoading] = useState(false);
  const [bidSuccess, setBidSuccess] = useState(false);
  const [auctionCountdown, setAuctionCountdown] = useState(null); // { days, hours, mins, secs, ended }

   // Helper to calculate distance between two coordinates in km
   const calculateDistance = (lat1, lng1, lat2, lng2) => {
     const R = 6371;
     const dLat = (lat2 - lat1) * Math.PI / 180;
     const dLng = (lng2 - lng1) * Math.PI / 180;
     const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
       Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
     const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
     return R * c;
   };

   // Check geo-fencing when selected address changes
   useEffect(() => {
     if (!product || !selectedAddressId || !addresses.length) {
       setIsOutOfDeliveryZone(false);
       return;
     }
     const addr = addresses.find(a => a.id === selectedAddressId);
     if (!addr || !product.delivery_radius || !product.origin_lat || !product.origin_lng) {
       setIsOutOfDeliveryZone(false);
       return;
     }
     // Address coordinates might be stored as lat/lng or latitude/longitude
     const addrLat = addr.latitude ?? addr.lat;
     const addrLng = addr.longitude ?? addr.lng;
     if (addrLat == null || addrLng == null) {
       setIsOutOfDeliveryZone(false);
       return;
     }
     const distance = calculateDistance(product.origin_lat, product.origin_lng, addrLat, addrLng);
     const radiusKm = product.delivery_radius > 1000 ? product.delivery_radius / 1000 : product.delivery_radius;
     setIsOutOfDeliveryZone(distance > radiusKm);
   }, [product, selectedAddressId, addresses]);

   const loadReviews = useCallback(async () => {
     try { const res = await api.getProductReviews(id); setReviews(res.data ?? []); }
     catch { setReviews([]); }
   }, [id]);

   const handleReviewSuccess = useCallback(() => {
     loadReviews();
     api.getProduct(id).then(res => setProduct(res.data ?? res)).catch(() => {});
   }, [loadReviews, id]);

   const review = useReviewForm(id, { onSuccess: handleReviewSuccess });
   const { setReviewOrderId } = review;

   const { paymentLinkData, paymentLinkLoading, paymentLinkError, generatePaymentLink, setPaymentLinkError, setPaymentLinkData } = usePaymentLink();
   const paymentLinkDialogRef = useModalA11y(!!paymentLinkData, () => setPaymentLinkData(null));

   useEffect(() => {
    setNotFound(false);
    api.getProduct(id).then(res => {
      const p = res.data ?? res;
      setProduct(p);
      setQty(p.min_order_quantity || 1);
      if (p.pricing_model === 'pwyw') setCustomPrice(String(p.min_price));
      else if (p.pricing_model === 'donation') setCustomPrice('1.00');
    }).catch(() => setNotFound(true));
    }).catch(err => {
      if (err.status === 404) setNotFound(true);
      else navigate('/marketplace');
    });
    api.getProductShareMeta(id).then(res => setShareMeta(res.data ?? null)).catch(() => setShareMeta(null));
    loadReviews();
    api.getProductImages(id).then(res => {
      const imgs = res.data ?? [];
      setImages(imgs);
      setActiveImg(0);
    }).catch(() => {});
    api.getProductTiers(id).then(res => setTiers(res.data ?? [])).catch(() => setTiers([]));
    api.getPriceHistory(id).then(res => setPriceHistory(res.data ?? [])).catch(() => setPriceHistory([]));
    api.getCalendar(id).then(res => {
      const weeks = res.data ?? [];
      setCalendar(weeks);
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
    if (!product) return;
    const cached = loadBuyerLocation();
    if (cached) {
      setBuyerLocation(cached);
      updateDistance(cached, product);
    }
  }, [product]);

  useEffect(() => {
    if (user?.role !== 'buyer') return;
    api.getMyAlert(id).then(res => setAlertSet(res.subscribed)).catch(() => {});
  }, [id, user]);

  useEffect(() => {
    if (product) {
      addRecentlyViewed(product);
    }
  }, [product?.id]);

  useEffect(() => {
    if (user?.role !== 'buyer') return;
    api.getWaitlistStatus(id).then(res => {
      setIsOnWaitlist(res.is_on_waitlist);
      setWaitlistPosition(res.position || null);
    }).catch(() => {});
  }, [id, user]);

   useEffect(() => {
     if (user?.role !== 'buyer') return;
     api.getOrders({ limit: 100 }).then(res => {
       const orders = (res.data ?? []).filter(o => o.product_id === parseInt(id) && o.status === 'paid');
       setPaidOrders(orders);
       if (orders.length > 0) setReviewOrderId(String(orders[0].id));
     }).catch(() => {});
   }, [id, user, setReviewOrderId]);

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
      setPathEstimateError(e.message?.includes('No payment path') ? `No path found from ${sourceAsset.asset_code} to XLM` : getErrorMessage(e));
    }).finally(() => setPathEstimateLoading(false));
  }, [sourceAsset, qty, couponResult, product]);

  const handleGeneratePaymentLink = useCallback(() => {
    if (!user) return navigate('/login');
    if (user.role === 'farmer') return setPaymentLinkError(t('productDetail.farmersCannotOrder'));
    if (addresses.length > 0 && !selectedAddressId) return setPaymentLinkError(t('productDetail.selectAddress'));
    if (!product) return;
    generatePaymentLink({
      productId: product.id,
      quantity: qty,
      addressId: selectedAddressId,
      couponCode: couponResult ? couponCode : undefined
    });
  }, [user, navigate, addresses.length, selectedAddressId, generatePaymentLink, product, qty, couponResult, couponCode, t]);

  // Compute total for fee preview (safe to call before product loads)
  const _previewTotal = product
    ? (() => {
        const tiers_ = tiers ?? [];
        const getTierPrice_ = (q) => {
          for (let i = tiers_.length - 1; i >= 0; i--) {
            if (q >= tiers_[i].min_quantity) return tiers_[i].price_per_unit;
          }
          return product.price;
        };
        const isFlash = Boolean(product.flash_sale_price && product.flash_sale_ends_at && new Date(product.flash_sale_ends_at).getTime() > Date.now());
        const uPrice = isFlash ? Number(product.flash_sale_price) : getTierPrice_(qty);
        const effPrice = (product.pricing_model === 'pwyw' || product.pricing_model === 'donation') ? (parseFloat(customPrice) || 0) : uPrice;
        const sub = product.pricing_type === 'weight' ? (product.price * (parseFloat(weight) || 0)).toFixed(2) : (effPrice * qty).toFixed(2);
        return couponResult ? couponResult.final_total.toFixed(2) : sub;
      })()
    : '0';
  useEffect(() => {
    const n = parseFloat(_previewTotal);
    if (!n) return;
    api.getFeePreview(n).then(r => setFeeInfo(r)).catch(() => setFeeInfo(null));
  }, [_previewTotal]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const n = parseFloat(_previewTotal);
    if (!n || user?.role !== 'buyer') return;
    Promise.resolve(api.getRewards?.(n)).then(r => {
      const d = r?.data;
      setRewardInfo(d?.configured ? d : null);
      setRewardTokens(t => Math.min(t, d?.maxRedeemable ?? 0));
    }).catch(() => setRewardInfo(null));
  }, [_previewTotal, user?.role]); // eslint-disable-line react-hooks/exhaustive-deps
  // SSE: connect to stock-stream for real-time stock updates
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (walletPollingIntervalRef.current) {
        clearInterval(walletPollingIntervalRef.current);
        walletPollingIntervalRef.current = null;
      }
      if (walletPollingTimeoutRef.current) {
        clearTimeout(walletPollingTimeoutRef.current);
        walletPollingTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!id || typeof EventSource === 'undefined' || typeof api.getStockStreamUrl !== 'function') return;
    let eventSource;
    let reconnectTimer;
    let reconnectDelay = 1000;
    let closed = false;

    const connect = () => {
      if (closed) return;
      eventSource = new EventSource(api.getStockStreamUrl(id));
      eventSource.onmessage = (event) => {
        try {
          const { quantity } = JSON.parse(event.data);
          setLiveStock(quantity);
        } catch { /* ignore malformed events */ }
      };
      eventSource.onopen = () => { reconnectDelay = 1000; };
      eventSource.onerror = () => {
        eventSource.close();
        if (closed || reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (eventSource) eventSource.close();
    };
  }, [id]);

  // Load auction details if product is auction
  useEffect(() => {
    if (!product || !product.type || product.type !== 'auction') return;
    api.getAuction(product.id).then(res => {
      setAuctionData(res.data ?? res);
    }).catch(() => setAuctionData(null));
  }, [product?.id, product?.type]);

  // Countdown timer for auction
  useEffect(() => {
    if (!auctionData || !auctionData.auction_end) return;
    const tick = () => {
      const now = Date.now();
      const end = new Date(auctionData.auction_end).getTime();
      const diff = Math.max(0, end - now);
      if (diff <= 0) {
        setAuctionCountdown({ days: 0, hours: 0, mins: 0, secs: 0, ended: true });
        return;
      }
      const secs = Math.floor(diff / 1000);
      const days = Math.floor(secs / 86400);
      const hours = Math.floor((secs % 86400) / 3600);
      const mins = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      setAuctionCountdown({ days, hours, mins, secs: s, ended: false });
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [auctionData?.auction_end]);

  if (notFound) return <NotFound />;
  if (!product) return <Spinner />;

  if (notFound) return <NotFound />;

  // Clamp activeImg to valid range
  const safeActiveImg = images.length > 0 ? Math.min(activeImg, images.length - 1) : 0;

  // Use live SSE stock if available, fall back to product.quantity
  const currentStock = liveStock !== null ? liveStock : product.quantity;

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
        await api.removeStockAlert(id);
        setAlertSet(false);
      } else {
        await api.setStockAlert(id);
        setAlertSet(true);
      }
    } catch { /* ignore */ }
    setAlertLoading(false);
  }

  async function handleJoinWaitlist() {
    if (!user) return navigate('/login');
    if (!selectedAddressId) return setWaitlistError('Please select a delivery address');
    setWaitlistLoading(true);
    setWaitlistError('');
    try {
      const res = await api.joinWaitlist(product.id, { address_id: selectedAddressId });
      setIsOnWaitlist(true);
      setWaitlistPosition(res.position || 1);
      showToast('Successfully joined waitlist', 'success');
    } catch (e) {
      setWaitlistError(getErrorMessage(e));
      showToast(getErrorMessage(e), 'error');
    } finally {
      setWaitlistLoading(false);
    }
  }

  async function handleLeaveWaitlist() {
    setWaitlistLoading(true);
    setWaitlistError('');
    try {
      await api.leaveWaitlist(product.id);
      setIsOnWaitlist(false);
      setWaitlistPosition(null);
      showToast('Removed from waitlist', 'success');
    } catch (e) {
      setWaitlistError(getErrorMessage(e));
      showToast(getErrorMessage(e), 'error');
    } finally {
      setWaitlistLoading(false);
    }
  }
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
    const orderBody = {
      product_id: product.id,
      quantity: qty,
      address_id: selectedAddressId || undefined,
      use_soroban_escrow: useEscrow,
      coupon_code: couponResult ? couponCode.trim() : undefined,
      source_asset: sourceAsset ? { code: sourceAsset.asset_code, issuer: sourceAsset.asset_issuer } : undefined,
      weight: product.pricing_type === 'weight' ? parseFloat(weight) : undefined,
      custom_price: (product.pricing_model === 'pwyw' || product.pricing_model === 'donation') ? parseFloat(customPrice) : undefined,
      reward_tokens: useRewards && rewardTokens > 0 && !sourceAsset ? rewardTokens : undefined,
    };
    // Nothing is submitted yet: the buyer reviews the full breakdown first (FE-16).
    setError('');
    setReviewBody(orderBody);
  }

  // Freighter pays only plain XLM orders; escrow and path payments stay custodial.
  const payWithFreighter = freighter.connected && !useEscrow && !sourceAsset;

  async function confirmBuy() {
    // The ref blocks a second click before React re-renders the disabled button.
    if (!reviewBody || submittingRef.current) return;
    submittingRef.current = true;
    const orderBody = payWithFreighter ? { ...reviewBody, payment_method: 'sep7' } : reviewBody;
    const idempotencyKey = buyAttempt.keyFor(orderBody);
    setLoading(true);
    setError('');
    let settled = false;
    try {
      let res = await api.placeOrder(orderBody, idempotencyKey);
      buyAttempt.settle();
      settled = true;
      if (payWithFreighter) {
        // Non-custodial: backend builds the unsigned XDR, Freighter signs it (FE-15).
        const prepared = await api.prepareOrderPayment(res.orderId, freighter.publicKey);
        const signed = await signWithFreighter(prepared.xdr, prepared.networkPassphrase);
        res = await api.submitOrderPayment(res.orderId, signed);
      }
      setReviewBody(null);
      setResult({ ...res, escrow: useEscrow });
    } catch (e) {
      if (!settled) buyAttempt.settle(e);
      const msg = getStellarErrorMessage(e) || getErrorMessage(e);
      setReviewBody(null);
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  async function handleWalletPay() {
    if (!user) return navigate('/login');
    if (walletPollingIntervalRef.current) {
      clearInterval(walletPollingIntervalRef.current);
      walletPollingIntervalRef.current = null;
    }
    if (walletPollingTimeoutRef.current) {
      clearTimeout(walletPollingTimeoutRef.current);
      walletPollingTimeoutRef.current = null;
    }

    const orderBody = {
      product_id: product.id,
      quantity: qty,
      address_id: selectedAddressId || undefined,
      coupon_code: couponResult ? couponCode.trim() : undefined,
    };
    const idempotencyKey = walletAttempt.keyFor(orderBody);
    setWalletLoading(true);
    try {
      let orderRes;
      try {
        orderRes = await api.placeOrder(orderBody, idempotencyKey);
        walletAttempt.settle();
      } catch (e) {
        walletAttempt.settle(e);
        throw e;
      }
      const idempotencyKey = globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
        const value = Math.floor(Math.random() * 16);
        return (character === 'x' ? value : (value & 0x3) | 0x8).toString(16);
      });
      const orderRes = await api.placeOrder({
        product_id: product.id,
        quantity: qty,
        address_id: selectedAddressId || undefined,
        coupon_code: couponResult ? couponCode.trim() : undefined,
        payment_method: 'sep7',
      }, idempotencyKey);
      const linkRes = await api.getOrderPaymentLink(orderRes.orderId);
      setWalletOrderId(orderRes.orderId);
      setPaymentLink(linkRes.paymentLink);
      setWalletStatus('pending');
      setWalletPaymentOpen(true);

      const interval = setInterval(async () => {
        try {
          const order = await api.getOrderStatus(orderRes.orderId);
          if (order.status === 'paid') {
            if (mountedRef.current) setWalletStatus('paid');
            if (walletPollingIntervalRef.current) {
              clearInterval(walletPollingIntervalRef.current);
              walletPollingIntervalRef.current = null;
            }
            if (walletPollingTimeoutRef.current) {
              clearTimeout(walletPollingTimeoutRef.current);
              walletPollingTimeoutRef.current = null;
            }
          } else if (order.status === 'failed') {
            if (mountedRef.current) setWalletStatus('failed');
            if (walletPollingIntervalRef.current) {
              clearInterval(walletPollingIntervalRef.current);
              walletPollingIntervalRef.current = null;
            }
            if (walletPollingTimeoutRef.current) {
              clearTimeout(walletPollingTimeoutRef.current);
              walletPollingTimeoutRef.current = null;
            }
          }
        } catch {}
      }, 5000);
      walletPollingIntervalRef.current = interval;
      walletPollingTimeoutRef.current = setTimeout(() => {
        if (walletPollingIntervalRef.current) {
          clearInterval(walletPollingIntervalRef.current);
          walletPollingIntervalRef.current = null;
        }
        walletPollingTimeoutRef.current = null;
      }, 5 * 60 * 1000); // 5 min
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setWalletLoading(false);
    }
  }

  async function handlePlaceBid() {
    setBidError('');
    setBidSuccess(false);
    const amount = parseFloat(bidAmount);
    if (!amount || isNaN(amount)) return setBidError('Enter a valid bid amount');
    if (auctionCountdown?.ended) return setBidError('Auction has ended');
    if (amount <= (auctionData?.current_bid || 0)) {
      return setBidError(`Bid must be higher than current bid (${(auctionData?.current_bid || 0).toFixed(2)} XLM)`);
    }
    setBidLoading(true);
    try {
      await api.placeBid(product.id, { amount });
      setBidSuccess(true);
      setBidAmount('');
      // Refresh auction data
      api.getAuction(product.id).then(res => setAuctionData(res.data ?? res)).catch(() => {});
      setTimeout(() => setBidSuccess(false), 3000);
    } catch (e) {
      setBidError(getErrorMessage(e));
    } finally {
      setBidLoading(false);
    }
  }

   const handleReviewSubmit = review.handleReviewSubmit;

  if (result) {
    return (
      <div className="product-detail-page" style={s.page}>
        <div className="product-detail-card" style={s.card}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>{result.escrow ? '🔒' : '✅'}</div>
          <div style={s.success}>
            {result.escrow ? (
              <>
                <strong>{t('productDetail.escrowSuccess')}</strong>
                <p style={{ marginTop: 8, fontSize: 14 }}>{t('productDetail.escrowOrderInfo', { id: result.orderId, price: result.totalPrice })}</p>
                {(result.claimableBalanceId || result.balanceId) && (
                  <p style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    {result.sorobanEscrow ? 'Escrow' : 'Balance'}:{' '}
                    <a
                      href={explorerUrl('claimable-balance', result.claimableBalanceId || result.balanceId)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--color-primary)', wordBreak: 'break-all' }}
                    >
                      {result.claimableBalanceId || result.balanceId}
                    </a>
                  </p>
                )}
                <p style={{ marginTop: 8, fontSize: 14 }}>
                  {t('productDetail.escrowOrderInfo', { id: result.orderId, price: result.totalPrice })}
                </p>
                {result.balanceId ? (
                  <p style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    Balance ID: <a href={explorerUrl('claimable-balance', result.balanceId)}
                      target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)', wordBreak: 'break-all' }}>{result.balanceId}</a>
                  </p>
                ) : null}
                <p style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>{t('productDetail.escrowNote')}</p>
              </>
            ) : (
              <>
                <strong>{t('productDetail.paymentSuccess')}</strong>
                <p style={{ marginTop: 8, fontSize: 14 }}>{t('productDetail.orderInfo', { id: result.orderId, price: result.totalPrice })}</p>
                {result.sourceAsset && result.sourceAsset !== 'XLM' && (
                  <p style={{ marginTop: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>Paid via path payment using <strong>{result.sourceAsset}</strong></p>
                )}
                <p style={{ marginTop: 4, fontSize: 12, wordBreak: 'break-all', color: 'var(--color-text-secondary)' }}>TX: {result.txHash}</p>
                {result.rewardRedemption && (
                  <p style={{ marginTop: 4, fontSize: 13, color: 'var(--color-primary)' }} data-testid="receipt-reward-discount">
                    🎁 Reward tokens redeemed: {result.rewardRedemption.tokens} (−{Number(result.rewardRedemption.discount).toFixed(2)} XLM)
                  </p>
                )}
                <p style={{ marginTop: 4, fontSize: 12, wordBreak: 'break-all', color: 'var(--color-text-secondary)' }}>
                  TX:{' '}
                  {result.txHash ? (
                    <a href={explorerUrl('tx', result.txHash)} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)' }}>
                      {result.txHash}
                    </a>
                  ) : '—'}
                </p>
                {result.bundleDiscount && (
                  <p style={{ marginTop: 4, fontSize: 13, color: 'var(--color-primary)' }}>
                    🏷️ Bundle discount applied: −{result.bundleDiscount.amount.toFixed(4)} XLM ({result.bundleDiscount.percent}% off for {result.bundleDiscount.minProducts}+ products)
                  </p>
                )}
              </>
            )}
          </div>
          <button style={{ ...s.btn, marginTop: 20, background: 'var(--color-text-secondary)' }} onClick={() => navigate('/marketplace')}>
            {t('productDetail.backToMarketplace')}
          </button>
        </div>
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="product-detail-page" style={s.page}>
        <div className="product-detail-card" style={s.card}>
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
    <div className="product-detail-page" style={s.page}>
      <Helmet>
        <title>{shareTitle}</title>
        <meta name="description" content={shareDescription} />
        <meta property="og:title" content={shareTitle} />
        <meta property="og:description" content={shareDescription} />
        <meta property="og:url" content={shareUrl} />
        <meta property="og:type" content="product" />
        {shareImage ? <meta property="og:image" content={shareImage} /> : null}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={shareTitle} />
        <meta name="twitter:description" content={shareDescription} />
        {shareImage ? <meta name="twitter:image" content={shareImage} /> : null}
      </Helmet>
      <div className="product-detail-card" style={s.card}>
        {product.video_url ? (
          <video
            controls
            src={product.video_url}
            style={{ width: '100%', maxHeight: 280, borderRadius: 10, marginBottom: 16, background: 'var(--color-media-bg)' }}
          />
        ) : null}

        {/* Image gallery */}

        {images.length > 0 ? (
          <div
            style={{ marginBottom: 16 }}
            role="region"
            aria-label={t('productDetail.imageGallery', 'Image gallery')}
            tabIndex={0}
            onKeyDown={images.length > 1 ? (e) => {
              if (e.key === 'ArrowLeft') { e.preventDefault(); setActiveImg(i => (i - 1 + images.length) % images.length); }
              else if (e.key === 'ArrowRight') { e.preventDefault(); setActiveImg(i => (i + 1) % images.length); }
            } : undefined}
          >
            <div style={{ position: 'relative' }}>
              <div style={s.galleryMainContainer}
                onMouseEnter={e => e.currentTarget.querySelector('img').style.transform = 'scale(1.35)'}
                onMouseLeave={e => e.currentTarget.querySelector('img').style.transform = ''}>
                <img
                  src={images[safeActiveImg].url}
                  srcSet={buildSrcSet(images[safeActiveImg].url)}
                  sizes="(max-width: 640px) 100vw, 640px"
                  alt={`${product.name} photo ${safeActiveImg + 1}`}
                  style={s.galleryMain}
                />
              </div>
              {images.length > 1 && (
                <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: '100%', display: 'flex', justifyContent: 'space-between', padding: '0 8px', boxSizing: 'border-box', pointerEvents: 'none' }}>
                  <button style={{ ...s.navBtn, pointerEvents: 'all' }} onClick={() => setActiveImg(i => (i - 1 + images.length) % images.length)} aria-label={t('productDetail.previousImage')}>‹</button>
                  <button style={{ ...s.navBtn, pointerEvents: 'all' }} onClick={() => setActiveImg(i => (i + 1) % images.length)} aria-label={t('productDetail.nextImage')}>›</button>
                </div>
              )}
            </div>
            {images.length > 1 && (
              <>
                <div style={s.thumbRow}>
                  {images.map((img, i) => (
                    <img
                      key={img.id}
                      src={img.url}
                      srcSet={buildSrcSet(img.url)}
                      sizes="(max-width: 600px) 25vw, 80px"
                      alt={t('productDetail.thumbnail', { n: i + 1 })}
                      loading="lazy"
                      style={{ ...s.thumb, ...(i === safeActiveImg ? s.thumbActive : {}) }}
                      onClick={() => setActiveImg(i)}
                    />
                  ))}
                </div>
                <div style={s.dotRow} aria-hidden="true">
                  {images.map((img, i) => (
                    <button
                      key={img.id}
                      style={{ ...s.dot, ...(i === safeActiveImg ? s.dotActive : {}) }}
                      onClick={() => setActiveImg(i)}
                      tabIndex={-1}
                      aria-label={t('productDetail.thumbnail', { n: i + 1 })}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        ) : product.image_url ? (
          <img src={product.image_url} srcSet={buildSrcSet(product.image_url)} sizes="(max-width: 640px) 100vw, 640px" alt={product.name} style={{ width: '100%', maxHeight: 280, objectFit: 'cover', borderRadius: 10, marginBottom: 16 }} />
        ) : (
          <div style={{ fontSize: 48, marginBottom: 12 }}>🥬</div>
        )}

        <div style={s.header}>
          <div style={s.headerContent}>
            <div style={s.name}>{product.name}</div>
            <div style={s.farmer}>
              {t('productDetail.soldBy')}{' '}
              <span style={{ cursor: 'pointer', textDecoration: 'underline', color: 'var(--color-primary)' }}
                onClick={() => navigate(`/farmer/${product.farmer_id}`)}>
                {product.farmer_name}
              </span>{' '}
              <button
                type="button"
                onClick={() => navigate(`/messages?to=${encodeURIComponent(product.farmer_id)}`)}
                style={{ marginLeft: 8, background: 'none', border: '1px solid var(--color-primary)', color: 'var(--color-primary)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}
              >
                {t('inbox.messageFarmer')}
              </button>
            </div>
            {product.farm_lat != null && product.farm_lng != null && (
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                {distanceLabel ? (
                  <span>{distanceLabel}</span>
                ) : (
                  <button
                    type="button"
                    onClick={requestDistance}
                    disabled={distanceLoading}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-primary)',
                      textDecoration: 'underline',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: 13,
                    }}
                  >
                    {distanceLoading ? 'Locating…' : 'Show distance'}
                  </button>
                )}
                {distanceError && (
                  <span style={{ color: 'var(--color-danger)', marginLeft: 10 }}>{distanceError}</span>
                )}
              </div>
            )}
            {product.harvest_batch_code && (
              <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginTop: 6 }}>
                <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>Harvest batch:</span>{' '}
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

        {product.farm_lat != null && product.farm_lng != null ? (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-primary)', marginBottom: 12 }}>Farm Location</div>
          <LazyMapView lat={product.farm_lat} lng={product.farm_lng} farmerName={product.farmer_name} />
          </div>
        ) : (
          <div style={{ marginBottom: 20, padding: '16px', borderRadius: 10, background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
            Location not provided
          </div>
        )}

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
                color: 'var(--color-primary)',
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
              <div style={{ marginTop: 8, padding: 12, background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-accent)', borderRadius: 8 }}>
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
                                <span key={vitamin} style={{ fontSize: 13, background: 'var(--color-primary-lightest)', padding: '2px 6px', borderRadius: 4 }}>
                                  {vitamin}: {amount}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  } catch {
                    return <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>Invalid nutritional data</div>;
                  }
                })()}
              </div>
            )}
          </div>
        )}

        {product.is_preorder ? (
          <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', background: 'var(--color-warning-lightest)', display: 'inline-block', padding: '4px 10px', borderRadius: 20 }}>
            Pre-Order{product.preorder_delivery_date ? ` · Expected delivery ${product.preorder_delivery_date}` : ''}
          </div>
        ) : null}
        {isFlashSaleActive ? (
          <>
            {/* Prominent flash sale banner — amber background meets WCAG AA at 4.5:1 contrast */}
            <div
              role="region"
              aria-label={t('productDetail.flashSaleBanner')}
              style={{
                background: 'var(--color-warning-lightest)',
                border: '2px solid var(--color-warning)',
                borderRadius: 10,
                padding: '14px 18px',
                marginBottom: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--color-text-primary)' }}>
                  ⚡ {t('productDetail.flashSaleTitle')}
                </span>
                <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-text-primary)' }}>
                  {unitPrice.toFixed(2)} XLM
                </span>
                <span style={{ fontSize: 14, textDecoration: 'line-through', color: 'var(--color-text-primary)', fontWeight: 500 }}>
                  {baseUnitPrice.toFixed(2)} XLM
                </span>
                <span style={{
                  background: 'var(--color-danger)',
                  color: 'var(--color-text-inverse)',
                  borderRadius: 20,
                  padding: '2px 10px',
                  fontSize: 13,
                  fontWeight: 700,
                }}>
                  {t('productDetail.flashSaleSavings', {
                    pct: Math.round((1 - unitPrice / baseUnitPrice) * 100),
                  })}
                </span>
              </div>
              <FlashSaleCountdown endsAt={product.flash_sale_ends_at} />
            </div>
            {/* Price line below banner (no extra countdown — already shown in banner) */}
            <div style={s.price}>
              {unitPrice.toFixed(2)} XLM{' '}
              <span style={{ fontSize: 14, fontWeight: 400 }}>/ {product.unit}</span>
            </div>
          </>
        ) : (
          <div style={s.price}>
            {unitPrice.toFixed(2)} XLM{' '}
            <span style={{ fontSize: 14, fontWeight: 400 }}>/ {product.unit}</span>
            {tiers.length > 0 && (
              <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginLeft: 8 }}>(bulk pricing available)</span>
            )}
          </div>
        )}
        {product.pricing_model !== 'fixed' && (
          <div style={{ marginBottom: 20 }}>
            <label style={s.label}>{product.pricing_model === 'pwyw' ? 'Pay What You Want' : 'Donation'}</label>
            <div className="detail-purchase-row" style={s.row}>
              <input
                style={{ ...s.input, width: 120 }}
                type="number"
                min={product.pricing_model === 'pwyw' ? product.min_price : 0.01}
                step="0.01"
                value={customPrice}
                onChange={e => { setCustomPrice(e.target.value); setCouponResult(null); setCouponError(''); }}
                placeholder={product.pricing_model === 'pwyw' ? `Min ${product.min_price}` : 'Amount'}
              />
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>XLM / {product.unit}</span>
            </div>
            {product.pricing_model === 'pwyw' && (
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
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
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 6 }}>Allergens</div>
              {allergens.length === 0 ? (
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)', background: 'var(--color-bg-tertiary)', borderRadius: 4, padding: '3px 8px' }}>No known allergens</span>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {allergens.map(a => (
                    <span key={a} style={{ fontSize: 12, fontWeight: 600, background: 'var(--color-warning-lightest)', color: 'var(--color-text-primary)', border: '1px solid var(--color-warning-light)', borderRadius: 4, padding: '3px 8px' }}>
                      ⚠️ {a.charAt(0).toUpperCase() + a.slice(1)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        <PriceHistoryChart data={priceHistory} />
        {usd(unitPrice) && (
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 4 }}>
            {usd(unitPrice)} {t('productDetail.perUnit', { unit: product.unit })} <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{t('productDetail.approxRate')}</span>
          </div>
        )}

        {tiers.length > 0 && (
          <div style={{ marginBottom: 16, padding: 12, background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-accent)', borderRadius: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-primary)', marginBottom: 8 }}>Bulk Pricing Tiers</div>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ textAlign: 'left', padding: '4px 0', fontWeight: 600 }}>Min Quantity</th>
                  <th style={{ textAlign: 'left', padding: '4px 0', fontWeight: 600 }}>Price per Unit</th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((tier, index) => (
                  <tr key={tier.id} style={{ borderBottom: index < tiers.length - 1 ? '1px solid var(--color-border-light)' : 'none' }}>
                    <td style={{ padding: '4px 0' }}>{tier.min_quantity}+ {product.unit}</td>
                    <td style={{ padding: '4px 0' }}>{tier.price_per_unit} XLM</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 20 }}>
          {t('productDetail.inStock', { qty: currentStock, unit: product.unit })}
          {currentStock > 0 && currentStock <= 5 && (
            <span style={{ marginLeft: 8, color: 'var(--color-danger)', fontWeight: 700 }}>
              ⚠️ Only {currentStock} left!
            </span>
          )}
          {product.min_order_quantity > 1 && (
            <span style={{ marginLeft: 10, color: 'var(--color-warning)', fontWeight: 600 }}>
              Min. order: {product.min_order_quantity} {product.unit}
            </span>
          )}
        </div>
        {product.harvest_date && (
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 4 }}>
            Harvested: {new Date(product.harvest_date).toLocaleDateString()}
          </div>
        )}
        {product.best_before && (
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 4 }}>
            Best before: {new Date(product.best_before).toLocaleDateString()}
          </div>
        )}
        {(product.available_from || product.available_until) && (
          <div style={{ fontSize: 13, color: 'var(--color-primary)', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-accent)', borderRadius: 6, padding: '6px 10px', marginBottom: 12, display: 'inline-block' }}>
            🗓 Availability window:
            {product.available_from ? ` from ${new Date(product.available_from).toLocaleString()}` : ''}
            {product.available_until ? ` until ${new Date(product.available_until).toLocaleString()}` : ''}
          </div>
        )}

        {product.pricing_type === 'weight' ? (
          <div style={{ marginBottom: 20 }}>
            <label style={s.label}>Weight ({product.unit})</label>
            <div className="detail-purchase-row" style={s.row}>
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
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{product.unit}</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              {product.price} XLM / {product.unit} · range: {product.min_weight}–{product.max_weight} {product.unit}
            </div>
          </div>
        ) : (
          <div className="detail-purchase-row" style={s.row}>
            <label style={{ fontSize: 14 }}>{t('productDetail.quantity')}</label>
            <input style={s.input} type="number" min={product.min_order_quantity || 1} max={currentStock} value={qty}
              onChange={e => {
                setQty(Math.max(product.min_order_quantity || 1, Math.min(currentStock, parseInt(e.target.value) || (product.min_order_quantity || 1))));
                setCouponResult(null);
                setCouponError('');
              }} />
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{product.unit}</span>
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
            <button style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 13, padding: 0 }}
              type="button"
              onClick={() => navigate('/addresses')}>
              {t('productDetail.manageAddresses')}
            </button>
            {isOutOfDeliveryZone && (
              <div style={{ background: 'var(--color-error-lightest)', border: '1px solid var(--color-error-light)', borderRadius: 8, padding: 12, marginTop: 12, fontSize: 14, color: 'var(--color-danger)' }}>
                ⚠️ This product does not deliver to your selected address location.
              </div>
            )}
          </div>
        )}

        {user?.role === 'buyer' && currentStock > 0 && (
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
              <div style={{ color: 'var(--color-primary)', fontSize: 13, marginTop: 4 }}>
                ✅ Coupon applied — {couponResult.discount_type === 'percent' ? `${couponResult.discount_value}% off` : `${couponResult.discount_value} XLM off`} (−{couponResult.discount.toFixed(2)} XLM)
              </div>
            )}
          </div>
        )}

        <div style={s.total}>
          {couponResult ? (
            <>
              <span style={{ textDecoration: 'line-through', color: 'var(--color-text-muted)', marginRight: 8 }}>{subtotal} XLM</span>
              Total: <strong>{total} XLM</strong>
            </>
          ) : (
            <>Total: <strong>{total} XLM</strong></>
          )}
          {rewardInfo && rewardInfo.maxRedeemable > 0 && !sourceAsset && (
            <div style={{ marginTop: 8, fontSize: 13 }} data-testid="reward-redeem">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={useRewards} onChange={e => { setUseRewards(e.target.checked); if (e.target.checked && !rewardTokens) setRewardTokens(rewardInfo.maxRedeemable); }} />
                Use reward tokens ({rewardInfo.vested} {rewardInfo.symbol} vested)
              </label>
              {useRewards && (
                <>
                  <label htmlFor="reward-slider" className="sr-only">Reward tokens to redeem</label>
                  <input id="reward-slider" type="range" min={0} max={rewardInfo.maxRedeemable} step={1} value={rewardTokens}
                    onChange={e => setRewardTokens(Number(e.target.value))} style={{ width: '100%' }}
                    aria-valuetext={`${rewardTokens} ${rewardInfo.symbol}, ${(rewardTokens * rewardInfo.xlmPerToken).toFixed(2)} XLM off`} />
                  <div style={{ color: 'var(--color-primary)' }}>
                    Reward discount: −{(rewardTokens * rewardInfo.xlmPerToken).toFixed(2)} XLM ({rewardTokens} {rewardInfo.symbol}, max {rewardInfo.maxRedeemable})
                  </div>
                </>
              )}
            </div>
          )}
          {feeInfo && feeInfo.feeAmount > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)', paddingTop: 6 }}>
              <div>Subtotal: {total} XLM</div>
              <div>Platform fee ({feeInfo.feePercent}%): −{feeInfo.feeAmount.toFixed(7)} XLM</div>
              <div style={{ fontWeight: 600, color: 'var(--color-primary)' }}>Farmer receives: {feeInfo.farmerAmount.toFixed(7)} XLM</div>
            </div>
          )}
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--color-primary)' }}>
            🏷️ Bundle discount may apply if you order multiple products from this farmer
          </div>
        </div>

        {/* Path payment asset selector */}
        {user?.role === 'buyer' && currentStock > 0 && (
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
                {pathEstimateLoading && <span style={{ color: 'var(--color-text-muted)' }}>Estimating path...</span>}
                {pathEstimateError && <span style={{ color: 'var(--color-danger)' }}>{pathEstimateError}</span>}
                {pathEstimate && !pathEstimateError && (
                  <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                    Estimated cost: ~{pathEstimate.sourceAmount.toFixed(4)} {pathEstimate.sourceCode}
                    <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}> (farmer receives {total} XLM)</span>
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        {error && <div style={s.err}>{error}</div>}

        {/* Region restriction notice */}
        {(() => {
          let regions = [];
          try { regions = product.allowed_regions ? JSON.parse(product.allowed_regions) : []; } catch {}
          if (!regions.length) return null;
          return (
            <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--color-warning-lightest)', border: '1px solid var(--color-warning-light)', borderRadius: 8, fontSize: 13, color: 'var(--color-text-primary)' }}>
              🌍 Available in: <strong>{regions.join(', ')}</strong>
            </div>
          );
        })()}

        {/* Availability Calendar */}
        {calendar.length > 0 && (() => {
          // Build a set of available week_start dates for quick lookup
          const availableWeeks = new Set(calendar.filter(w => w.available).map(w => w.week_start));
          // Determine the month to display: month of the first week in the calendar
          const firstDate = new Date(calendar[0].week_start + 'T00:00:00Z');
          const year = firstDate.getUTCFullYear();
          const month = firstDate.getUTCMonth();
          const monthLabel = firstDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
          // Days in month
          const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
          // Day of week for the 1st (0=Sun)
          const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
          // For each day, find which week_start (Monday) it belongs to
          function getMondayOf(y, m, d) {
            const date = new Date(Date.UTC(y, m, d));
            const dow = date.getUTCDay(); // 0=Sun
            const diff = dow === 0 ? -6 : 1 - dow;
            const mon = new Date(date);
            mon.setUTCDate(date.getUTCDate() + diff);
            return mon.toISOString().slice(0, 10);
          }
          const cells = [];
          for (let i = 0; i < firstDow; i++) cells.push(null); // leading blanks
          for (let d = 1; d <= daysInMonth; d++) cells.push(d);
          return (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 8 }}>📅 Availability — {monthLabel}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, maxWidth: 280 }}>
                {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
                  <div key={d} style={{ textAlign: 'center', fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, padding: '2px 0' }}>{d}</div>
                ))}
                {cells.map((day, i) => {
                  // Leading blank cells are static spacers for a fixed calendar grid.
                  // eslint-disable-next-line react/no-array-index-key
                  if (!day) return <div key={`blank-${i}`} />;
                  const weekKey = getMondayOf(year, month, day);
                  const isAvail = availableWeeks.has(weekKey);
                  const isSelected = selectedWeek === weekKey;
                  return (
                    <button
                      key={day}
                      disabled={!isAvail}
                      onClick={() => isAvail && setSelectedWeek(weekKey)}
                      title={isAvail ? `Week of ${weekKey}` : 'Unavailable'}
                      style={{
                        padding: '4px 0', borderRadius: 4, fontSize: 12, cursor: isAvail ? 'pointer' : 'default',
                        border: isSelected ? '2px solid var(--color-primary)' : '1px solid transparent',
                        background: !isAvail ? 'var(--color-bg-tertiary)' : isSelected ? 'var(--color-primary-lightest)' : 'var(--color-primary-lightest)',
                        color: !isAvail ? 'var(--color-text-muted)' : isSelected ? 'var(--color-primary)' : 'var(--color-primary)',
                        fontWeight: isSelected ? 700 : 400,
                      }}
                    >{day}</button>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: 'var(--color-text-muted)' }}>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--color-primary-lightest)', border: '1px solid var(--color-border-accent)', borderRadius: 2, marginRight: 4 }} />Available</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--color-bg-tertiary)', borderRadius: 2, marginRight: 4 }} />Unavailable</span>
              </div>
              {selectedWeek && <div style={{ fontSize: 12, color: 'var(--color-primary)', marginTop: 4 }}>Week of {selectedWeek} selected</div>}
            </div>
          );
        })()}

        {product?.type === 'auction' && auctionData ? (
          <div style={{ border: '2px solid var(--color-primary)', borderRadius: 12, padding: 20, marginBottom: 20, background: 'var(--color-bg-secondary)' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-primary)', marginBottom: 16 }}>🏆 Active Auction</div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Current Highest Bid</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-primary)' }}>{(auctionData.current_bid || 0).toFixed(2)} XLM</div>
              {auctionData.highest_bidder && <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>by {auctionData.highest_bidder}</div>}
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Time Remaining</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: auctionCountdown?.ended ? 'var(--color-danger)' : 'var(--color-primary)' }}>
                {auctionCountdown?.ended ? 'Auction Ended' : `${auctionCountdown?.days}d ${auctionCountdown?.hours}h ${auctionCountdown?.mins}m ${auctionCountdown?.secs}s`}
              </div>
            </div>
            {!auctionCountdown?.ended && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <input
                  type="number"
                  placeholder={`Higher than ${(auctionData.current_bid || 0).toFixed(2)} XLM`}
                  value={bidAmount}
                  onChange={e => { setBidAmount(e.target.value); setBidError(''); }}
                  step="0.01"
                  min={(auctionData.current_bid || 0) + 0.01}
                  style={{ flex: 1, ...s.input, marginBottom: 0 }}
                />
                <button
                  onClick={handlePlaceBid}
                  disabled={bidLoading}
                  style={{ ...s.btn, flex: '0 0 auto', whiteSpace: 'nowrap' }}
                >
                  {bidLoading ? 'Placing...' : 'Place Bid'}
                </button>
              </div>
            )}
            {bidError && <div style={{ ...s.err, marginBottom: 12 }}>{bidError}</div>}
            {bidSuccess && <div style={{ background: 'var(--color-primary-lightest)', color: 'var(--color-primary)', padding: 12, borderRadius: 8, marginBottom: 12 }}>✅ Bid placed successfully!</div>}
          </div>
        ) : currentStock === 0 ? (
          <div>
            <div style={{ color: 'var(--color-danger)', fontWeight: 600, marginBottom: 12 }}>{t('productDetail.outOfStock')}</div>
            {user?.role === 'buyer' && (
              <>
                {isOnWaitlist ? (
                  <>
                    {waitlistPosition && <div style={{ fontSize: 14, color: 'var(--color-primary)', marginBottom: 12 }}>You're #{waitlistPosition} on the waitlist</div>}
                    <button style={{ ...s.btn, background: 'var(--color-text-muted)', marginBottom: 8 }} onClick={handleLeaveWaitlist} disabled={waitlistLoading}>
                      {waitlistLoading ? '...' : 'Leave Waitlist'}
                    </button>
                  </>
                ) : (
                  <button style={{ ...s.btn, background: 'var(--color-primary)', marginBottom: 8 }} onClick={handleJoinWaitlist} disabled={waitlistLoading}>
                    {waitlistLoading ? '...' : 'Join Waitlist'}
                  </button>
                )}
                {waitlistError && <div style={s.err}>{waitlistError}</div>}
              </>
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
              onClick={handleBuy}
              disabled={loading || (calendar.length > 0 && selectedWeek && !calendar.find(w => w.week_start === selectedWeek)?.available)}
              aria-disabled={loading}
              aria-busy={loading}
              data-testid="buy-now-btn">
              {loading && <div className="spinner-sm" style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'var(--color-bg-primary)', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />}
              {loading ? t('productDetail.processing') : `${useEscrow ? t('productDetail.payToEscrow') : t('productDetail.buyNow')} · ${sourceAsset && pathEstimate ? `~${pathEstimate.sourceAmount.toFixed(4)} ${pathEstimate.sourceCode}` : `${total} XLM`}`}
            </button>
            {reviewBody && (
              <CheckoutReviewModal
                lines={{
                  unitPrice: Number(product.price),
                  tierPrice: Number(effectiveUnitPrice),
                  quantity: product.pricing_type === 'weight' ? `${parseFloat(weight) || 0} ${product.unit}` : qty,
                  unit: product.unit,
                  subtotal: Number(subtotal),
                  couponDiscount: couponResult ? Number(couponResult.discount) : 0,
                  couponCode: couponResult ? couponCode.trim() : '',
                  bundleDiscount: 0,
                  shipping: Number(product.shipping_fee || 0),
                  total: Number(total),
                }}
                escrow={useEscrow}
                payingWith={payWithFreighter ? `Freighter ${freighter.publicKey.slice(0, 6)}…${freighter.publicKey.slice(-4)}` : null}
                blockedReason={payWithFreighter && freighter.mismatch ? 'Freighter is on a different network than this app. Switch networks in Freighter to continue.' : ''}
                submitting={loading}
                onConfirm={confirmBuy}
                onCancel={() => setReviewBody(null)}
              />
            )}
            {user?.role === 'buyer' && (
              <button style={{ ...s.btn, background: 'var(--color-secondary)', marginBottom: 12 }} onClick={handleWalletPay} disabled={walletLoading || currentStock === 0}>
                {walletLoading ? '...' : `💳 Pay with Stellar Wallet · ${total} XLM`}
              </button>
            )}
            <button style={{ ...s.btn, marginTop: 12, background: 'var(--color-secondary-light)', fontSize: 14 }} onClick={handleGeneratePaymentLink} disabled={paymentLinkLoading || loading}>
              {paymentLinkLoading ? '...' : 'Pay with Stellar Wallet (SEP-0007)'}
            </button>
            {paymentLinkError && <div style={{ ...s.err, marginTop: 8 }}>{paymentLinkError}</div>}
            {paymentLinkData && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                <div ref={paymentLinkDialogRef} role="dialog" aria-modal="true" aria-labelledby="sep7-modal-title" tabIndex={-1} style={{ background: 'var(--color-bg-primary)', borderRadius: 12, padding: 24, maxWidth: 360, width: '90%', boxShadow: 'var(--shadow-lg)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h2 id="sep7-modal-title" style={{ fontWeight: 700, fontSize: 16, color: 'var(--color-primary)', margin: 0 }}>SEP-0007 Payment Link</h2>
                    <button onClick={() => setPaymentLinkData(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--color-text-secondary)' }} aria-label="Close">✕</button>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                    <QRCodeSVG 
                      value={paymentLinkData.paymentLink} 
                      size={200} 
                      level="M"
                      includeMargin
                      role="img"
                      aria-label={`Payment QR code for ${product.name}`}
                    />
                  </div>
                  <CopyButton url={paymentLinkData.paymentLink} />
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center' }}>
                    Expires: {new Date(paymentLinkData.expiresAt).toLocaleString()}
                  </div>
                </div>
              </div>
            )}
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

         {user?.role === 'buyer' && paidOrders.length > 0 && !review.reviewSuccess && (
           <form onSubmit={handleReviewSubmit} style={{ marginTop: 24, borderTop: '1px solid var(--color-border-light)', paddingTop: 20 }}>
             <div style={{ ...s.sectionTitle, fontSize: 15, marginBottom: 12 }}>{t('productDetail.leaveReview')}</div>
             {paidOrders.length > 1 && (
               <div style={{ marginBottom: 12 }}>
                 <label style={s.label}>{t('productDetail.order')}</label>
                 <select style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 14 }}
                   value={review.reviewOrderId} onChange={e => review.setReviewOrderId(e.target.value)}>
                   {paidOrders.map(o => <option key={o.id} value={o.id}>Order #{o.id} — {o.quantity} {o.unit}</option>)}
                 </select>
               </div>
             )}
             <div style={{ marginBottom: 12 }}>
               <label style={s.label}>{t('productDetail.rating')}</label>
               <StarRating value={review.reviewRating} size={28} onChange={review.setReviewRating} />
             </div>
             <div style={{ marginBottom: 14 }}>
               <label style={s.label}>{t('productDetail.comment')}</label>
               <textarea style={s.textarea} placeholder={t('productDetail.commentPlaceholder')}
                 value={review.reviewComment} onChange={e => review.setReviewComment(e.target.value)} maxLength={1000} />
             </div>
             {review.reviewError && <div style={s.err}>{review.reviewError}</div>}
             <button type="submit" style={s.btnSm} disabled={review.reviewLoading}>
               {review.reviewLoading ? t('productDetail.submitting') : t('productDetail.submitReview')}
             </button>
           </form>
         )}
         {review.reviewSuccess && <div style={{ ...s.success, marginTop: 16 }}>{review.reviewSuccess}</div>}
      </div>
    </div>
  );
}
