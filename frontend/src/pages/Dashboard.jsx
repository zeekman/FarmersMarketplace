import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { api } from '../api/client';
import { useXlmRate } from '../utils/useXlmRate';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from '../utils/errorMessages';
import { showToast } from '../utils/toast';
import ProductForm from '../components/dashboard/ProductForm';
import InlineEditField from '../components/dashboard/InlineEditField';
import { showToast } from '../utils/toast';
import FlashSaleManager from '../components/dashboard/FlashSaleManager';
import AuctionManager from '../components/dashboard/AuctionManager';

const s = {
  page: { maxWidth: 900, margin: '0 auto', padding: 16 },
  title: { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 24 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 24 },
  card: { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001' },
  label: { display: 'block', fontSize: 13, marginBottom: 4, color: '#555' },
  input: {
    width: '100%',
    padding: '9px 12px',
    border: '1px solid #ddd',
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 4,
    boxSizing: 'border-box',
    minHeight: 44,
  },
  inputErr: {
    width: '100%',
    padding: '9px 12px',
    border: '1px solid #c0392b',
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 4,
    boxSizing: 'border-box',
    minHeight: 44,
  },
  fieldErr: { color: '#c0392b', fontSize: 12, marginBottom: 8 },
  textarea: {
    width: '100%',
    padding: '9px 12px',
    border: '1px solid #ddd',
    borderRadius: 8,
    fontSize: 14,
    marginBottom: 4,
    minHeight: 80,
    resize: 'vertical',
    boxSizing: 'border-box',
  },
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
  product: {
    borderBottom: '1px solid #eee',
    padding: '12px 0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  del: {
    background: '#fee',
    color: '#c0392b',
    border: 'none',
    borderRadius: 6,
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: 12,
  },
  msg: { padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 14 },
  preview: {
    width: '100%',
    maxHeight: 240,
    objectFit: 'cover',
    borderRadius: 8,
    marginBottom: 8,
    display: 'block',
  },
  uploading: { fontSize: 13, color: '#666', marginBottom: 4 },
  removeImg: {
    background: 'none',
    border: '1px solid #ddd',
    borderRadius: 6,
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: 12,
    color: '#c0392b',
    marginBottom: 8,
  },
  uploadZone: {
    border: '2px dashed #ddd',
    borderRadius: 8,
    padding: '24px 16px',
    textAlign: 'center',
    cursor: 'pointer',
    color: '#888',
    fontSize: 14,
    marginBottom: 8,
  },
  uploadZoneActive: { borderColor: '#2d6a4f', background: '#f0faf4' },
  imgErr: { color: '#c0392b', fontSize: 12, marginBottom: 8 },
  csvBtn: {
    background: '#2d6a4f',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '10px 20px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 14,
  },
  csvInput: { display: 'none' },
  csvResult: { padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 14 },
  csvProgressTrack: { width: '100%', height: 8, borderRadius: 4, background: '#e9ecef', overflow: 'hidden', marginBottom: 12 },
  csvProgressBar: { width: '40%', height: '100%', borderRadius: 4, background: '#2d6a4f', animation: 'csv-indeterminate 1.2s ease-in-out infinite' },
  csvResultsWrap: { marginTop: 12 },
  csvResultsScroll: { maxHeight: 320, overflowY: 'auto', border: '1px solid #eee', borderRadius: 8 },
  csvTable: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  csvTableHeadCell: { textAlign: 'left', padding: '8px 10px', background: '#f8fdf9', position: 'sticky', top: 0, borderBottom: '1px solid #ddd', color: '#333' },
  csvTableCell: { padding: '8px 10px', borderBottom: '1px solid #f1f1f1' },
  csvRowOk: { color: '#2d6a4f' },
  csvRowErr: { color: '#c0392b' },
  csvDownloadErrBtn: { background: '#c0392b', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13, marginTop: 10 },
  productThumb: { width: 48, height: 48, objectFit: 'cover', borderRadius: 6, marginRight: 10 },
  galleryPanel: {
    marginTop: 12,
    padding: 16,
    background: '#f8fdf9',
    borderRadius: 8,
    border: '1px solid #b7e4c7',
  },
  galleryGrid: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  galleryItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 },
  galleryThumb: {
    width: 72,
    height: 72,
    objectFit: 'cover',
    borderRadius: 6,
    border: '2px solid transparent',
  },
  galleryThumbFirst: { border: '2px solid #2d6a4f' },
  arrowBtn: {
    background: '#f0f0f0',
    border: 'none',
    borderRadius: 4,
    padding: '3px 7px',
    cursor: 'pointer',
    fontSize: 12,
  },
  imgDelBtn: {
    background: '#fee',
    border: 'none',
    borderRadius: 4,
    padding: '3px 7px',
    cursor: 'pointer',
    fontSize: 12,
    color: '#c0392b',
  },
  address: { fontSize: 12, color: '#888', marginTop: 4 },
};

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_MB = 5;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
const MAX_IMAGES = 6;

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
const LOW_STOCK_THRESHOLD = Number(import.meta.env.VITE_LOW_STOCK_THRESHOLD || 5);

export default function Dashboard() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { rate } = useXlmRate();
  const [products, setProducts] = useState([]);
  const [inlineEditing, setInlineEditing] = useState({}); // { [productId_field]: true }
  const [restockVals, setRestockVals] = useState({});
  const [harvestBatches, setHarvestBatches] = useState([]);
  const productsRef = useRef([]);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [sales, setSales] = useState([]);
  const [salesMsg, setSalesMsg] = useState({});
  const [forecastByProduct, setForecastByProduct] = useState({});
  const [waitlistAnalytics, setWaitlistAnalytics] = useState([]);
  const [videoUploadingByProduct, setVideoUploadingByProduct] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // bulk price update state
  const [bulkPriceSelections, setBulkPriceSelections] = useState({}); // { [productId]: newPrice }
  const [bulkAdjustPct, setBulkAdjustPct] = useState('');
  const [bulkPriceMsg, setBulkPriceMsg] = useState(null);

  // bundle state
  const [bundles, setBundles] = useState([]);
  const [bundleForm, setBundleForm] = useState({
    name: '',
    description: '',
    price: '',
    items: [{ product_id: '', quantity: 1 }],
  });
  const [bundleMsg, setBundleMsg] = useState(null);

  // bundle discount state
  const [bundleDiscounts, setBundleDiscounts] = useState([]);
  const [bdForm, setBdForm] = useState({ min_products: '', discount_percent: '' });
  const [bdMsg, setBdMsg] = useState(null);

  // profile state
  const [profile, setProfile] = useState({
    bio: '',
    location: '',
    avatar_url: '',
    federation_name: '',
    latitude: '',
    longitude: '',
    farm_address: '',
  });
  const [profileMsg, setProfileMsg] = useState(null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef(null);

  // CSV upload state
  const [csvFile, setCsvFile] = useState(null);
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvResult, setCsvResult] = useState(null);
  const csvInputRef = useRef(null);

  // per-product image gallery state
  const [galleryProductId, setGalleryProductId] = useState(null);
  const [galleryImages, setGalleryImages] = useState([]);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [galleryErr, setGalleryErr] = useState('');
  const [draggedGalleryIdx, setDraggedGalleryIdx] = useState(null);
  const galleryInputRef = useRef(null);

  // QR code modal state
  const [qrProductId, setQrProductId] = useState(null);
  const [qrProductName, setQrProductName] = useState('');

  // Coupon state
  const [coupons, setCoupons] = useState([]);
  const [couponForm, setCouponForm] = useState({
    code: '',
    discount_type: 'percent',
    discount_value: '',
    max_uses: '',
    expires_at: '',
  });
  const [couponMsg, setCouponMsg] = useState(null);

  // Price tiers state
  const [tiersProductId, setTiersProductId] = useState(null);
  const [tiers, setTiers] = useState([]);
  const [tiersMsg, setTiersMsg] = useState(null);

  async function openTiers(productId) {
    setTiersProductId(productId);
    setTiersMsg(null);
    try {
      const res = await api.getProductTiers(productId);
      setTiers(res.data ?? []);
    } catch {
      setTiers([]);
    }
  }

  function closeTiers() {
    setTiersProductId(null);
    setTiers([]);
    setTiersMsg(null);
  }

  async function handleSaveTiers() {
    if (!tiersProductId) return;
    setTiersMsg({ type: 'info', text: 'Saving...' });
    try {
      await api.updateProductTiers(tiersProductId, tiers);
      setTiersMsg({ type: 'ok', text: 'Tiers updated successfully' });
    } catch (e) {
      setTiersMsg({ type: 'error', text: e.message || 'Failed to update tiers' });
    }
  }

  function addTier() {
    setTiers([
      ...tiers,
      {
        min_quantity: tiers.length > 0 ? tiers[tiers.length - 1].min_quantity + 1 : 2,
        price_per_unit: 0,
      },
    ]);
  }

  function updateTier(index, field, value) {
    const newTiers = [...tiers];
    newTiers[index] = { ...newTiers[index], [field]: parseFloat(value) || 0 };
    setTiers(newTiers);
  }

  function removeTier(index) {
    setTiers(tiers.filter((_, i) => i !== index));
  }
  // Calendar editor state
  const [calendarProductId, setCalendarProductId] = useState(null);
  const [calendarProductName, setCalendarProductName] = useState('');
  const [calendarWeeks, setCalendarWeeks] = useState([]);
  const [calendarSaving, setCalendarSaving] = useState(false);
  // Cooperative / multisig state
  const [cooperatives, setCooperatives] = useState([]);
  const [pendingTxs, setPendingTxs] = useState([]);
  const [signingTxId, setSigningTxId] = useState(null);

  async function openGallery(productId) {
    setGalleryProductId(productId);
    setGalleryErr('');
    try {
      const res = await api.getProductImages(productId);
      setGalleryImages(res.data ?? []);
    } catch {
      setGalleryImages([]);
    }
  }

  function closeGallery() {
    setGalleryProductId(null);
    setGalleryImages([]);
    setGalleryErr('');
  }

  async function handleVideoUpload(productId, file) {
    if (!file) return;
    if (file.type !== 'video/mp4') {
      alert('Only MP4 videos are allowed.');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      alert('Video must be 50 MB or smaller.');
      return;
    }

    setVideoUploadingByProduct((prev) => ({ ...prev, [productId]: true }));
    try {
      await api.uploadProductVideo(productId, file);
      await load();
    } catch (e) {
      alert(getErrorMessage(e));
    } finally {
      setVideoUploadingByProduct((prev) => ({ ...prev, [productId]: false }));
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [
        productsRes,
        salesRes,
        profileRes,
        bundlesRes,
        couponsRes,
        coopsRes,
        batchesRes,
        forecastRes,
      ] = await Promise.all([
        api.getMyProducts().catch(() => ({ data: [] })),
        api.getSales().catch(() => ({ data: [] })),
        user?.id ? api.getFarmer(user.id).catch(() => ({})) : Promise.resolve({}),
        api.getBundles().catch(() => ({ data: [] })),
        api.getMyCoupons().catch(() => ({ data: [] })),
        api.getCooperatives().catch(() => ({ data: [] })),
        api.getHarvestBatches().catch(() => ({ data: [] })),
        api.getForecast().catch(() => ({ data: [] })),
      ]);

      setProducts(productsRes.data ?? productsRes);
      setSales(salesRes.data ?? salesRes);
      setBundles((bundlesRes.data ?? []).filter((b) => b.farmer_id === user?.id));
      setHarvestBatches(batchesRes?.data ?? []);
      setCoupons(couponsRes.data ?? []);
      const coops = coopsRes.data ?? [];
      setCooperatives(coopsRes.data ?? []);

      const forecastMap = {};
      (forecastRes.data ?? []).forEach((item) => {
        forecastMap[item.product_id] = item;
      });
      setForecastByProduct(forecastMap);
      productsRef.current = productsRes.data ?? productsRes;

      // Waitlist analytics
      const waitlistRes = await api.getWaitlistAnalytics().catch(() => ({ data: [] }));
      setWaitlistAnalytics(waitlistRes.data ?? []);

      const allPending = await Promise.all(
        coops.map((c) =>
          api
            .getPendingTxs(c.id)
            .then((r) => (r.data ?? []).map((t) => ({ ...t, coopName: c.name })))
            .catch(() => [])
        )
      );
      setPendingTxs(allPending.flat().filter((t) => t.status === 'pending' && !t.alreadySigned));

      const bdRes = await api.getBundleDiscounts().catch(() => ({ data: [] }));
      setBundleDiscounts(bdRes.data ?? []);

      if (profileRes.data) {
        const d = profileRes.data;
        setProfile({
          bio: d.bio || '',
          location: d.location || '',
          avatar_url: d.avatar_url || '',
          federation_name: d.federation_name || '',
          latitude: d.latitude ?? '',
          longitude: d.longitude ?? '',
          farm_address: d.farm_address || '',
        });
        if (d.avatar_url) setAvatarPreview(d.avatar_url);
      }
    } catch (err) {
      setError(err?.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  useEffect(() => {
    load();
  }, [user?.id]);

  useEffect(() => {
    if (user?.role !== 'farmer') return;
    const interval = setInterval(async () => {
      try {
        const res = await api.getMyProducts();
        const latestProducts = res.data ?? res;
        const previousProducts = productsRef.current;
        latestProducts.forEach((latest) => {
          const prev = previousProducts.find((p) => p.id === latest.id);
          const latestQty = Number(latest.quantity ?? 0);
          const prevQty = prev ? Number(prev.quantity ?? 0) : LOW_STOCK_THRESHOLD + 1;
          if (prev && latestQty <= LOW_STOCK_THRESHOLD && prevQty > LOW_STOCK_THRESHOLD) {
            showToast(`Low stock: ${latest.name} has only ${latestQty} left.`, 'warning', 8000);
          }
        });
        setProducts(latestProducts);
      } catch {
        // ignore polling failures
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [user]);

  async function handleProfileSave(e) {
    e.preventDefault();
    setProfileMsg(null);
    let finalAvatarUrl = profile.avatar_url;

    if (avatarFile) {
      setAvatarUploading(true);
      try {
        const res = await api.uploadAvatar(avatarFile);
        finalAvatarUrl = res.imageUrl;
        setAvatarFile(null);
      } catch (err) {
        setAvatarUploading(false);
        setProfileMsg({ type: 'err', text: `Avatar upload failed: ${getErrorMessage(err)}` });
        return;
      }
      setAvatarUploading(false);
    }

    try {
      const res = await api.updateFarmerProfile({
        bio: profile.bio || undefined,
        location: profile.location || undefined,
        avatar_url: finalAvatarUrl || undefined,
        federation_name: profile.federation_name || undefined,
        latitude: profile.latitude !== '' ? parseFloat(profile.latitude) : null,
        longitude: profile.longitude !== '' ? parseFloat(profile.longitude) : null,
        farm_address: profile.farm_address || undefined,
      });
      const d = res.data;
      setProfile({
        bio: d.bio || '',
        location: d.location || '',
        avatar_url: d.avatar_url || '',
        federation_name: d.federation_name || '',
        latitude: d.latitude ?? '',
        longitude: d.longitude ?? '',
        farm_address: d.farm_address || '',
      });
      setProfileMsg({ type: 'ok', text: t('dashboard.profileUpdated') });
    } catch (err) {
      setProfileMsg({ type: 'err', text: getErrorMessage(err) });
    }
  }

  async function handleDelete(id) {
    const product = products.find((p) => p.id === id);
    if (!product) return;
    const openOrders = sales.filter(
      (o) => o.product_id === id && ['pending', 'paid', 'processing', 'shipped'].includes(o.status)
    ).length;
    setDeleteConfirm({ id, name: product.name, openOrders });
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    try {
      await api.deleteProduct(deleteConfirm.id);
      setDeleteConfirm(null);
      load();
    } catch {
      /* ignore */
    }
  }

  const [salesExportFrom, setSalesExportFrom] = React.useState('');
  const [salesExportTo, setSalesExportTo] = React.useState('');

  function triggerExport(path) {
    const token = localStorage.getItem('token');
    window.location.href = `/api${path}&_token=${encodeURIComponent(token || '')}`;
  }

  function exportProducts(format) {
    const token = localStorage.getItem('token');
    const a = document.createElement('a');
    a.href = `/api/products/export?format=${format}`;
    // Use fetch to pass auth header, then trigger download
    fetch(a.href, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        Object.assign(document.createElement('a'), {
          href: url,
          download: `products.${format}`,
        }).click();
        URL.revokeObjectURL(url);
      });
  }

  function exportSales(format) {
    const token = localStorage.getItem('token');
    const qs = new URLSearchParams({
      format,
      ...(salesExportFrom && { from: salesExportFrom }),
      ...(salesExportTo && { to: salesExportTo }),
    });
    fetch(`/api/orders/sales/export?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        Object.assign(document.createElement('a'), {
          href: url,
          download: `sales.${format}`,
        }).click();
        URL.revokeObjectURL(url);
      });
  }

  async function handleBulkPriceUpdate() {
    setBulkPriceMsg(null);
    const updates = Object.entries(bulkPriceSelections)
      .filter(([, price]) => price !== '')
      .map(([id, price]) => ({ id: Number(id), price: parseFloat(price) }));

    if (updates.length === 0 && bulkAdjustPct === '') {
      setBulkPriceMsg({
        type: 'err',
        text: 'Select products and enter prices, or enter a % adjustment.',
      });
      return;
    }

    const adjustmentPercent = bulkAdjustPct !== '' ? parseFloat(bulkAdjustPct) : undefined;
    const payload =
      adjustmentPercent != null
        ? { updates: products.map((p) => ({ id: p.id })), adjustment_percent: adjustmentPercent }
        : { updates };

    try {
      const res = await api.bulkUpdatePrices(payload.updates, payload.adjustment_percent);
      const { updated, failed } = res.data;
      setBulkPriceMsg({
        type: 'ok',
        text: `Updated ${updated.length} product(s).${failed.length ? ` ${failed.length} failed.` : ''}`,
      });
      setBulkPriceSelections({});
      setBulkAdjustPct('');
      load();
    } catch (e) {
      setBulkPriceMsg({ type: 'err', text: e.message || 'Bulk update failed' });
    }
  }

  async function handleInlineSave(productId, field, newValue) {
    // Optimistic update
    setProducts(prev => prev.map(p => p.id === productId ? { ...p, [field]: newValue } : p));
    try {
      await api.updateProduct(productId, { [field]: newValue });
    } catch (e) {
      // Revert on error
      setProducts(prev => prev.map(p =>
        p.id === productId ? { ...p, [field]: products.find(x => x.id === productId)?.[field] } : p
      ));
      throw e; // let InlineEditField trigger onError
    }
  }

  async function handleRestock(productId) {
    const qty = parseInt(restockVals[productId]);
    if (!qty || qty <= 0) return;
    try {
      await api.restockProduct(productId, qty);
      setRestockVals((prev) => ({ ...prev, [productId]: '' }));
      load();
    } catch (e) {
      alert(getErrorMessage(e));
    }
  }

  async function handleStatusUpdate(orderId, status) {
    try {
      await api.updateOrderStatus(orderId, status);
      setSalesMsg((prev) => ({
        ...prev,
        [orderId]: { type: 'ok', text: `Status updated to ${status}` },
      }));
      load();
    } catch (e) {
      setSalesMsg((prev) => ({ ...prev, [orderId]: { type: 'err', text: e.message } }));
    }
  }

  async function handleGalleryMove(index, direction) {
    const newImages = [...galleryImages];
    const target = index + direction;
    if (target < 0 || target >= newImages.length) return;
    [newImages[index], newImages[target]] = [newImages[target], newImages[index]];
    setGalleryImages(newImages);
    try {
      await api.reorderProductImages(
        galleryProductId,
        newImages.map((img) => img.id)
      );
    } catch (e) {
      setGalleryErr(getErrorMessage(e));
    }
  }

  async function handleGalleryDelete(imageId) {
    try {
      await api.deleteProductImage(galleryProductId, imageId);
      setGalleryImages((prev) => prev.filter((img) => img.id !== imageId));
    } catch (e) {
      setGalleryErr(getErrorMessage(e));
    }
  }

  function handleGalleryDragStart(idx) {
    setDraggedGalleryIdx(idx);
  }

  function handleGalleryDragOver(e) {
    e.preventDefault();
  }

  function handleGalleryDropItem(idx) {
    if (draggedGalleryIdx === null || draggedGalleryIdx === idx) return;
    const newImages = [...galleryImages];
    const [moved] = newImages.splice(draggedGalleryIdx, 1);
    newImages.splice(idx, 0, moved);
    setGalleryImages(newImages);
    setDraggedGalleryIdx(null);
    api
      .reorderProductImages(
        galleryProductId,
        newImages.map((img) => img.id)
      )
      .catch((e) => setGalleryErr(getErrorMessage(e)));
  }

  async function handleGalleryUpload(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setGalleryUploading(true);
    setGalleryErr('');
    for (const file of files) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        setGalleryErr('Only JPEG, PNG, or WebP allowed.');
        continue;
      }
      if (file.size > MAX_SIZE_BYTES) {
        setGalleryErr(`Image must be ${MAX_SIZE_MB} MB or smaller.`);
        continue;
      }
      try {
        const res = await api.uploadProductImage(galleryProductId, file);
        setGalleryImages((prev) => [...prev, res.data]);
      } catch (err) {
        setGalleryErr(getErrorMessage(err));
      }
    }
    setGalleryUploading(false);
    e.target.value = '';
  }

  function downloadCsvTemplate() {
    const headers = ['name', 'description', 'price', 'quantity', 'unit', 'category'];
    const example = ['Tomatoes', 'Fresh vine tomatoes', '2.5', '100', 'kg', 'vegetables'];
    const csv = [headers.join(','), example.join(',')].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), {
      href: url,
      download: 'products-template.csv',
    }).click();
    URL.revokeObjectURL(url);
  }

  // Best-effort client-side parse of the CSV so successful rows can be shown
  // with the product name they created (the backend only returns a count).
  async function readCsvRowNames(file) {
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
      if (lines.length < 2) return {};
      const headers = lines[0].split(',').map((h) => h.trim());
      const nameIdx = headers.indexOf('name');
      if (nameIdx === -1) return {};
      const map = {};
      for (let i = 1; i < lines.length; i++) {
        const rowNum = i + 1; // header is row 1, data starts at row 2
        const cols = lines[i].split(',');
        map[rowNum] = (cols[nameIdx] || '').trim();
      }
      return map;
    } catch {
      return {};
    }
  }

  async function handleCsvUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvUploading(true);
    setCsvResult(null);
    try {
      const [rowNames, res] = await Promise.all([readCsvRowNames(file), api.uploadProductsCsv(file)]);
      const { created, errors } = res ?? {};
      const errorRows = new Set((errors || []).map((e) => e.row));
      const successRows = Object.entries(rowNames)
        .filter(([row]) => !errorRows.has(Number(row)))
        .map(([row, name]) => ({ row: Number(row), name }));
      setCsvResult({
        type: errors?.length ? 'warn' : 'ok',
        text: `Imported ${created ?? 0} product(s)${errors?.length ? ` with ${errors.length} error(s).` : ' successfully.'}`,
        created: created ?? 0,
        errors: errors || [],
        successRows,
      });
      if (created > 0) load();
    } catch (err) {
      setCsvResult({ type: 'err', text: getErrorMessage(err), created: 0, errors: [], successRows: [] });
    } finally {
      setCsvUploading(false);
      e.target.value = '';
    }
  }

  function downloadCsvErrorReport() {
    const errors = csvResult?.errors || [];
    if (!errors.length) return;
    const headers = ['row', 'message'];
    const lines = [headers.join(',')];
    for (const e of errors) {
      const row = e.row ?? '';
      const message = (e.error ?? e.message ?? '').replace(/"/g, '""');
      lines.push(`${row},"${message}"`);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: 'bulk-upload-errors.csv' }).click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={s.page}>
      {deleteConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: 28,
              maxWidth: 400,
              width: '90%',
              boxShadow: '0 4px 24px #0003',
            }}
          >
            <div
              id="delete-modal-title"
              style={{ fontWeight: 700, fontSize: 17, marginBottom: 10, color: '#333' }}
            >
              Delete {deleteConfirm.name}? This cannot be undone.
            </div>
            {deleteConfirm.openOrders > 0 && (
              <p style={{ fontSize: 14, color: '#c0392b', marginBottom: 20 }}>
                This product has {deleteConfirm.openOrders} open order
                {deleteConfirm.openOrders > 1 ? 's' : ''}. Deleting it may affect buyers.
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteConfirm(null)}
                style={{
                  padding: '8px 18px',
                  borderRadius: 8,
                  border: '1px solid #ddd',
                  background: '#fff',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                style={{
                  padding: '8px 18px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#c0392b',
                  color: '#fff',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
      <Helmet>
        <title>Farmer Dashboard – Farmers Marketplace</title>
        <meta
          name="description"
          content="Manage your product listings, track sales, and grow your farm business on Farmers Marketplace."
        />
      </Helmet>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <div style={s.title}>🌾 Farmer Dashboard</div>
        <div
          style={{
            fontSize: 13,
            color: rate ? '#2d6a4f' : '#999',
            background: '#f0faf4',
            borderRadius: 8,
            padding: '6px 12px',
            fontWeight: 600,
          }}
        >
          {rate ? `1 XLM ≈ $${rate.toFixed(4)} USDC` : 'Rate unavailable'}
        </div>
      </div>

      {/* Waitlist Analytics */}
      {waitlistAnalytics.length > 0 && (
        <div style={{ ...s.card, marginBottom: 24 }}>
          <h3 style={{ marginBottom: 12, color: '#333' }}>📋 Waitlist Analytics</h3>
          {waitlistAnalytics.some((r) => r.alert) && (
            <div
              style={{
                background: '#fff3cd',
                color: '#856404',
                borderRadius: 8,
                padding: '10px 14px',
                marginBottom: 12,
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              ⚠️ Some products have more than 10 buyers waiting — consider restocking!
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #eee' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>Product</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>Queue</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>
                  Avg Wait (hrs)
                </th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>Conversion</th>
              </tr>
            </thead>
            <tbody>
              {waitlistAnalytics.map((r) => (
                <tr
                  key={r.product_id}
                  style={{
                    borderBottom: '1px solid #f0f0f0',
                    background: r.alert ? '#fff8e1' : 'transparent',
                  }}
                >
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>
                    {r.product_name}
                    {r.alert && (
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 11,
                          background: '#f9a825',
                          color: '#fff',
                          borderRadius: 4,
                          padding: '1px 6px',
                        }}
                      >
                        High demand
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '6px 8px' }}>{r.queue_length}</td>
                  <td style={{ padding: '6px 8px' }}>
                    {r.avg_wait_hours != null ? r.avg_wait_hours : '—'}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {r.conversion_rate != null ? `${r.conversion_rate}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <FlashSaleManager products={products} onChanged={load} />

      {/* Bulk Price Update */}
      <div style={{ ...s.card, marginBottom: 24 }}>
        <h3 style={{ marginBottom: 12, color: '#333' }}>💰 Bulk Price Update</h3>
        {bulkPriceMsg && (
          <div
            style={{
              ...s.msg,
              background: bulkPriceMsg.type === 'ok' ? '#d8f3dc' : '#fee',
              color: bulkPriceMsg.type === 'ok' ? '#2d6a4f' : '#c0392b',
            }}
          >
            {bulkPriceMsg.text}
          </div>
        )}
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ ...s.label, marginBottom: 0 }}>% Adjustment (all products):</label>
          <input
            style={{ ...s.input, width: 100, marginBottom: 0 }}
            type="number"
            step="any"
            placeholder="e.g. +10"
            value={bulkAdjustPct}
            onChange={(e) => setBulkAdjustPct(e.target.value)}
          />
          <span style={{ fontSize: 13, color: '#888' }}>or set individual prices below</span>
        </div>
        <table
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 12 }}
        >
          <thead>
            <tr style={{ borderBottom: '2px solid #eee' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>Product</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>
                Current Price (XLM)
              </th>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>
                New Price (XLM)
              </th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '6px 8px' }}>{p.name}</td>
                <td style={{ padding: '6px 8px', color: '#666' }}>{p.price}</td>
                <td style={{ padding: '6px 8px' }}>
                  <input
                    style={{ ...s.input, width: 100, marginBottom: 0, padding: '5px 8px' }}
                    type="number"
                    min="0.0000001"
                    step="any"
                    placeholder="—"
                    value={bulkPriceSelections[p.id] || ''}
                    onChange={(e) =>
                      setBulkPriceSelections((prev) => ({ ...prev, [p.id]: e.target.value }))
                    }
                    disabled={bulkAdjustPct !== ''}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button style={s.btn} onClick={handleBulkPriceUpdate}>
          Apply Price Update
        </button>
      </div>

      <div style={s.grid}>
        <ProductForm harvestBatches={harvestBatches} onProductAdded={load} />

        <div style={s.card}>
          <h3 style={{ marginBottom: 16, color: '#333' }}>My Listings ({products.length})</h3>
          <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
            <button
              style={{ ...s.btn, fontSize: 12, padding: '6px 12px', background: '#52b788' }}
              onClick={() => exportProducts('csv')}
            >
              ⬇ CSV
            </button>
            <button
              style={{ ...s.btn, fontSize: 12, padding: '6px 12px', background: '#52b788' }}
              onClick={() => exportProducts('pdf')}
            >
              ⬇ PDF
            </button>
          </div>
          {products.length === 0 && (
            <p style={{ color: '#888', fontSize: 14 }}>No products yet. Add your first listing.</p>
          )}
          {products.map((p) => (
            <div
              key={p.id}
              style={{ ...s.product, flexDirection: 'column', alignItems: 'stretch' }}
            >
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} style={s.productThumb} />
                  ) : (
                    <span style={{ fontSize: 28, marginRight: 10 }}>🥬</span>
                  )}
                  <div>
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {p.name}
                      {(p.is_preorder || p.is_preorder === 1) && (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            background: '#e07b00',
                            color: '#fff',
                            borderRadius: 4,
                            padding: '2px 7px',
                            letterSpacing: 0.3,
                          }}
                        >
                          Pre-order
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: '#666' }}>
                      {p.pricing_model === 'pwyw'
                        ? `Min ${p.min_price} XLM (PWYW)`
                        : p.pricing_model === 'donation'
                          ? 'Donation'
                          : `${p.price} XLM`}{' '}
                      · {p.quantity} {p.unit}
                    <div style={{ fontSize: 13, color: '#666', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {p.pricing_model === 'pwyw' ? `Min ${p.min_price} XLM (PWYW)` : p.pricing_model === 'donation' ? 'Donation' : (
                        <>
                          <InlineEditField
                            value={p.price}
                            type="number"
                            min={0.0000001}
                            step="any"
                            format={(v) => `${v} XLM`}
                            onSave={(v) => handleInlineSave(p.id, 'price', v)}
                            onError={(msg) => showToast(msg, 'error')}
                          />
                        </>
                      )}
                      ·
                      <InlineEditField
                        value={p.quantity}
                        type="number"
                        min={0}
                        step={1}
                        format={(v) => `${v} ${p.unit}`}
                        onSave={(v) => handleInlineSave(p.id, 'quantity', Math.floor(v))}
                        onError={(msg) => showToast(msg, 'error')}
                      />
                    </div>
                    {Number(p.quantity) <= 0 && (
                      <div style={s.outOfStockBadge}>Out of stock</div>
                    )}
                    {(p.is_preorder || p.is_preorder === 1) && p.preorder_delivery_date && (
                      <div style={{ fontSize: 12, color: '#e07b00', marginTop: 2 }}>
                        📅 Delivery: {p.preorder_delivery_date}
                      </div>
                    )}
                    {forecastByProduct[p.id]?.note ? (
                      <div style={{ fontSize: 12, color: '#888' }}>
                        {forecastByProduct[p.id].note}
                      </div>
                    ) : forecastByProduct[p.id] ? (
                      <div style={{ fontSize: 12, color: '#555' }}>
                        Demand hint: {forecastByProduct[p.id].avg_weekly_sales} units/week{' '}
                        {forecastByProduct[p.id].trend === 'up'
                          ? '↑'
                          : forecastByProduct[p.id].trend === 'down'
                            ? '↓'
                            : '→'}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div
                  style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <button
                    style={{ ...s.btn, padding: '4px 10px', fontSize: 12, background: '#555' }}
                    onClick={() => (galleryProductId === p.id ? closeGallery() : openGallery(p.id))}
                  >
                    {t('dashboard.photos')}
                  </button>
                  <button
                    style={{ ...s.btn, padding: '4px 10px', fontSize: 12, background: '#17a2b8' }}
                    onClick={() => (tiersProductId === p.id ? closeTiers() : openTiers(p.id))}
                  >
                    {t('dashboard.tiers')}
                  </button>
                  <button
                    style={{ ...s.btn, padding: '4px 10px', fontSize: 12, background: '#1a6b8a' }}
                    onClick={async () => {
                      const res = await api.getCalendar(p.id).catch(() => ({ data: [] }));
                      setCalendarWeeks(res.data ?? []);
                      setCalendarProductId(p.id);
                      setCalendarProductName(p.name);
                    }}
                  >
                    📅 Calendar
                  </button>
                  <label
                    style={{
                      ...s.btn,
                      padding: '4px 10px',
                      fontSize: 12,
                      background: '#1f6f8b',
                      cursor: 'pointer',
                    }}
                  >
                    {videoUploadingByProduct[p.id] ? 'Uploading...' : '🎬 Video'}
                    <input
                      type="file"
                      accept="video/mp4"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        handleVideoUpload(p.id, file);
                      }}
                    />
                  </label>
                  <input
                    type="number"
                    min="1"
                    placeholder="+Qty"
                    style={{ ...s.input, width: 70, marginBottom: 0, padding: '4px 8px' }}
                    value={restockVals[p.id] || ''}
                    onChange={(e) => setRestockVals({ ...restockVals, [p.id]: e.target.value })}
                  />
                  <button
                    style={{ ...s.btn, padding: '4px 10px', fontSize: 12, background: '#218c74' }}
                    onClick={() => handleRestock(p.id)}
                  >
                    {t('dashboard.restock')}
                  </button>
                  <button
                    style={s.del}
                    onClick={() => handleDelete(p.id)}
                    aria-label={`Remove ${p.name}`}
                  >
                    {t('dashboard.remove')}
                  </button>
                </div>
              </div>

              {/* Inline gallery manager */}
              {galleryProductId === p.id && (
                <div style={s.galleryPanel}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#2d6a4f' }}>
                    {t('dashboard.productPhotos', { count: galleryImages.length, max: MAX_IMAGES })}
                    <span style={{ fontWeight: 400, color: '#888', marginLeft: 8 }}>
                      {t('dashboard.primaryImageHint')}
                    </span>
                  </div>
                  {galleryErr && (
                    <div style={{ color: '#c0392b', fontSize: 12, marginBottom: 8 }}>
                      {galleryErr}
                    </div>
                  )}
                  <div style={s.galleryGrid}>
                    {galleryImages.map((img, i) => (
                      <div
                        key={img.id}
                        style={{
                          ...s.galleryItem,
                          ...(draggedGalleryIdx === i ? { opacity: 0.5 } : {}),
                        }}
                        draggable
                        onDragStart={() => handleGalleryDragStart(i)}
                        onDragOver={handleGalleryDragOver}
                        onDrop={() => handleGalleryDropItem(i)}
                      >
                        <img
                          src={img.url}
                          alt={`Photo ${i + 1}`}
                          style={{
                            ...s.galleryThumb,
                            ...(i === 0 ? s.galleryThumbFirst : {}),
                            cursor: 'grab',
                          }}
                        />
                        {i === 0 && (
                          <span style={{ fontSize: 10, color: '#2d6a4f', fontWeight: 600 }}>
                            {t('dashboard.primary')}
                          </span>
                        )}
                        <div style={{ display: 'flex', gap: 3 }}>
                          <button
                            style={s.arrowBtn}
                            onClick={() => handleGalleryMove(i, -1)}
                            disabled={i === 0}
                            aria-label="Move left"
                          >
                            ◀
                          </button>
                          <button
                            style={s.arrowBtn}
                            onClick={() => handleGalleryMove(i, 1)}
                            disabled={i === galleryImages.length - 1}
                            aria-label="Move right"
                          >
                            ▶
                          </button>
                          <button
                            style={s.imgDelBtn}
                            onClick={() => handleGalleryDelete(img.id)}
                            aria-label="Delete image"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {galleryImages.length < MAX_IMAGES && (
                    <>
                      <button
                        style={{
                          ...s.btn,
                          fontSize: 12,
                          padding: '6px 14px',
                          background: '#218c74',
                        }}
                        onClick={() => galleryInputRef.current?.click()}
                        disabled={galleryUploading}
                      >
                        {galleryUploading ? t('dashboard.uploading') : t('dashboard.addPhotos')}
                      </button>
                      <input
                        ref={galleryInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        style={{ display: 'none' }}
                        onChange={handleGalleryUpload}
                      />
                    </>
                  )}
                </div>
              )}

              {/* Inline tiers manager */}
              {tiersProductId === p.id && (
                <div style={s.galleryPanel}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#2d6a4f' }}>
                    {t('dashboard.priceTiers')}
                    <span style={{ fontWeight: 400, color: '#888', marginLeft: 8 }}>
                      {t('dashboard.tiersHint')}
                    </span>
                  </div>
                  {tiersMsg && (
                    <div
                      style={{
                        fontSize: 12,
                        color:
                          tiersMsg.type === 'ok'
                            ? '#2d6a4f'
                            : tiersMsg.type === 'error'
                              ? '#c0392b'
                              : '#856404',
                        marginBottom: 8,
                      }}
                    >
                      {tiersMsg.text}
                    </div>
                  )}
                  <div style={{ marginBottom: 8 }}>
                    {tiers.length === 0 ? (
                      <div style={{ color: '#888', fontSize: 12 }}>{t('dashboard.noTiers')}</div>
                    ) : (
                      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid #ddd' }}>
                            <th style={{ textAlign: 'left', padding: '4px 0', fontWeight: 600 }}>
                              {t('dashboard.minQuantity')}
                            </th>
                            <th style={{ textAlign: 'left', padding: '4px 0', fontWeight: 600 }}>
                              {t('dashboard.pricePerUnit')}
                            </th>
                            <th style={{ width: 60 }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {tiers.map((tier, index) => (
                            <tr key={index} style={{ borderBottom: '1px solid #f0f0f0' }}>
                              <td style={{ padding: '4px 0' }}>
                                <input
                                  type="number"
                                  min="1"
                                  value={tier.min_quantity}
                                  onChange={(e) =>
                                    updateTier(index, 'min_quantity', e.target.value)
                                  }
                                  style={{
                                    ...s.input,
                                    width: 80,
                                    marginBottom: 0,
                                    padding: '4px 6px',
                                    fontSize: 12,
                                  }}
                                />
                              </td>
                              <td style={{ padding: '4px 0' }}>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={tier.price_per_unit}
                                  onChange={(e) =>
                                    updateTier(index, 'price_per_unit', e.target.value)
                                  }
                                  style={{
                                    ...s.input,
                                    width: 80,
                                    marginBottom: 0,
                                    padding: '4px 6px',
                                    fontSize: 12,
                                  }}
                                />{' '}
                                XLM
                              </td>
                              <td style={{ padding: '4px 0' }}>
                                <button style={s.imgDelBtn} onClick={() => removeTier(index)}>
                                  ✕
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      style={{ ...s.btn, fontSize: 12, padding: '6px 14px', background: '#28a745' }}
                      onClick={addTier}
                    >
                      {t('dashboard.addTier')}
                    </button>
                    <button
                      style={{ ...s.btn, fontSize: 12, padding: '6px 14px', background: '#007bff' }}
                      onClick={handleSaveTiers}
                    >
                      {t('dashboard.saveTiers')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <AuctionManager products={products} />

      {/* CSV Bulk Upload */}
      <div style={{ ...s.card, marginTop: 24 }}>
        {' '}
        <h3 style={{ marginBottom: 16, color: '#333' }}>📤 Bulk Upload Products</h3>
        <p style={{ fontSize: 14, color: '#666', marginBottom: 16 }}>
          {t('dashboard.bulkUploadDesc')}
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <button
            style={s.csvBtn}
            onClick={() => csvInputRef.current?.click()}
            disabled={csvUploading}
          >
            {csvUploading ? t('dashboard.uploading') : t('dashboard.uploadCsv')}
          </button>
          <button style={{ ...s.csvBtn, background: '#555' }} onClick={downloadCsvTemplate}>
            {t('dashboard.downloadTemplate')}
          </button>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv"
            style={s.csvInput}
            onChange={handleCsvUpload}
          />
        </div>
        {csvUploading && (
          <div role="progressbar" aria-label={t('dashboard.uploading')} style={s.csvProgressTrack}>
            <div style={s.csvProgressBar} />
            <style>{`
              @keyframes csv-indeterminate {
                0% { margin-left: -40%; }
                100% { margin-left: 100%; }
              }
            `}</style>
          </div>
        )}
        {csvResult && (
          <div
            style={{
              ...s.csvResult,
              background: csvResult.type === 'ok' ? '#d8f3dc' : '#fee',
              color: csvResult.type === 'ok' ? '#2d6a4f' : '#c0392b',
            }}
          >
            {csvResult.text}
          </div>
        )}
        {csvResult && (csvResult.successRows?.length > 0 || csvResult.errors?.length > 0) && (
          <div style={s.csvResultsWrap}>
            <div style={(csvResult.successRows.length + csvResult.errors.length) > 10 ? s.csvResultsScroll : undefined}>
              <table style={s.csvTable}>
                <thead>
                  <tr>
                    <th style={s.csvTableHeadCell}>{t('dashboard.csvRow')}</th>
                    <th style={s.csvTableHeadCell}>{t('dashboard.csvStatus')}</th>
                    <th style={s.csvTableHeadCell}>{t('dashboard.csvDetail')}</th>
                  </tr>
                </thead>
                <tbody>
                  {csvResult.successRows.map((r) => (
                    <tr key={`ok-${r.row}`}>
                      <td style={s.csvTableCell}>{r.row}</td>
                      <td style={{ ...s.csvTableCell, ...s.csvRowOk }}>{t('dashboard.csvCreated')}</td>
                      <td style={s.csvTableCell}>{r.name}</td>
                    </tr>
                  ))}
                  {csvResult.errors.map((err, i) => (
                    <tr key={`err-${i}`}>
                      <td style={s.csvTableCell}>{err.row}</td>
                      <td style={{ ...s.csvTableCell, ...s.csvRowErr }}>{t('dashboard.csvError')}</td>
                      <td style={s.csvTableCell}>{err.error || err.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {csvResult.errors.length > 0 && (
              <button style={s.csvDownloadErrBtn} onClick={downloadCsvErrorReport}>
                {t('dashboard.downloadErrorReport')}
              </button>
            {csvResult.details && csvResult.details.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <strong>{t('common.errors')}:</strong>
                <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                  {csvResult.details.slice(0, 10).map((err, i) => (
                    <li key={i}>
                      {t('common.row', { n: err.row })}: {err.error}
                    </li>
                  ))}
                  {csvResult.details.length > 10 && (
                    <li>{t('common.andMore', { n: csvResult.details.length - 10 })}</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Profile edit */}
      <div style={{ ...s.card, marginTop: 24 }}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>{t('dashboard.myProfile')}</h3>
        {profileMsg && (
          <div
            style={{
              ...s.msg,
              background: profileMsg.type === 'ok' ? '#d8f3dc' : '#fee',
              color: profileMsg.type === 'ok' ? '#2d6a4f' : '#c0392b',
            }}
          >
            {profileMsg.text}
          </div>
        )}
        <form onSubmit={handleProfileSave}>
          <label style={s.label}>{t('dashboard.avatar')}</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
            {avatarPreview ? (
              <img
                src={avatarPreview}
                alt="Avatar"
                style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover' }}
              />
            ) : (
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  background: '#d8f3dc',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 28,
                }}
              >
                🌾
              </div>
            )}
            <div>
              <button
                type="button"
                style={{ ...s.btn, fontSize: 13, padding: '7px 14px' }}
                onClick={() => avatarInputRef.current?.click()}
              >
                {avatarUploading ? t('dashboard.uploading') : t('dashboard.changeAvatar')}
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setAvatarFile(file);
                    setAvatarPreview(URL.createObjectURL(file));
                  }
                  e.target.value = '';
                }}
              />
            </div>
          </div>

          <label style={s.label}>{t('dashboard.location')}</label>
          <input
            style={s.input}
            placeholder={t('dashboard.locationPlaceholder')}
            value={profile.location}
            onChange={(e) => setProfile((p) => ({ ...p, location: e.target.value }))}
            maxLength={100}
          />

          <label style={s.label}>
            Farm Address{' '}
            <span style={{ color: '#aaa', fontWeight: 400 }}>(optional · shown on map)</span>
          </label>
          <input
            style={s.input}
            placeholder="e.g. 123 Farm Road, Nairobi, Kenya"
            value={profile.farm_address || ''}
            onChange={(e) => setProfile((p) => ({ ...p, farm_address: e.target.value }))}
            maxLength={200}
          />

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={s.label}>
                Latitude <span style={{ color: '#aaa', fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                style={s.input}
                type="number"
                step="any"
                min="-90"
                max="90"
                placeholder="e.g. -1.2921"
                value={profile.latitude}
                onChange={(e) => setProfile((p) => ({ ...p, latitude: e.target.value }))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={s.label}>
                Longitude <span style={{ color: '#aaa', fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                style={s.input}
                type="number"
                step="any"
                min="-180"
                max="180"
                placeholder="e.g. 36.8219"
                value={profile.longitude}
                onChange={(e) => setProfile((p) => ({ ...p, longitude: e.target.value }))}
              />
            </div>
          </div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
            💡 Tip: Find your coordinates at{' '}
            <a
              href="https://www.latlong.net"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#2d6a4f' }}
            >
              latlong.net
            </a>
          </div>

          <label style={s.label}>{t('dashboard.bio')}</label>
          <textarea
            style={s.textarea}
            placeholder={t('dashboard.bioPlaceholder')}
            value={profile.bio}
            onChange={(e) => setProfile((p) => ({ ...p, bio: e.target.value }))}
            maxLength={500}
          />

          <label style={s.label}>
            {t('dashboard.federationName')}{' '}
            <span style={{ color: '#aaa', fontWeight: 400 }}>
              (optional · e.g. yourname → yourname*{window.location.hostname})
            </span>
          </label>
          <input
            style={s.input}
            placeholder="e.g. johnfarm"
            value={profile.federation_name || ''}
            onChange={(e) =>
              setProfile((p) => ({
                ...p,
                federation_name: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''),
              }))
            }
            maxLength={64}
          />

          <button style={s.btn} type="submit" disabled={avatarUploading}>
            {t('dashboard.saveProfile')}
          </button>
        </form>
      </div>

      {/* Order management panel */}
      <div style={{ ...s.card, marginTop: 24 }}>
        <h3
          style={{ padding: '16px 20px', borderBottom: '1px solid #eee', margin: 0, color: '#333' }}
        >
          📋 {t('dashboard.incomingOrders', { count: sales.length })}
        </h3>
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
            onChange={(e) => setSalesExportFrom(e.target.value)}
            style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}
            placeholder="From"
          />
          <input
            type="date"
            value={salesExportTo}
            onChange={(e) => setSalesExportTo(e.target.value)}
            style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}
            placeholder="To"
          />
          <button
            style={{ ...s.btn, fontSize: 12, padding: '6px 12px', background: '#52b788' }}
            onClick={() => exportSales('csv')}
          >
            ⬇ CSV
          </button>
          <button
            style={{ ...s.btn, fontSize: 12, padding: '6px 12px', background: '#52b788' }}
            onClick={() => exportSales('pdf')}
          >
            ⬇ PDF
          </button>
        </div>
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
                            onClick={async () => {
                              try {
                                await api.approveReturn(o.id);
                                setSalesMsg((prev) => ({
                                  ...prev,
                                  [o.id]: { type: 'ok', text: 'Return approved — refund sent' },
                                }));
                                load();
                              } catch (e) {
                                setSalesMsg((prev) => ({
                                  ...prev,
                                  [o.id]: { type: 'err', text: e.message },
                                }));
                              }
                            }}
                          >
                            ✅ Approve & Refund
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
                            onClick={async () => {
                              const reason = window.prompt('Reason for rejection (optional):');
                              if (reason === null) return; // cancelled
                              try {
                                await api.rejectReturn(o.id, reason);
                                setSalesMsg((prev) => ({
                                  ...prev,
                                  [o.id]: { type: 'ok', text: 'Return rejected' },
                                }));
                                load();
                              } catch (e) {
                                setSalesMsg((prev) => ({
                                  ...prev,
                                  [o.id]: { type: 'err', text: e.message },
                                }));
                              }
                            }}
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
                          if (e.target.value) handleStatusUpdate(o.id, e.target.value);
                          e.target.value = '';
                        }}
                      >
                        <option value="" disabled>
                          {t('dashboard.updateStatus')}
                        </option>
                        {FARMER_STATUSES.filter((s) => s !== o.status).map((s) => (
                          <option key={s} value={s}>
                            {STATUS_ICON[s]} {s}
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

      {/* Bundle Discount Tiers */}
      <div style={{ ...s.card, marginTop: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#2d6a4f', marginBottom: 12 }}>
          🏷️ Bundle Discounts
        </div>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
          Buyers who order multiple different products from you get an automatic discount. Add tiers
          below (e.g. 3+ products = 10% off).
        </p>
        {bdMsg && (
          <div
            style={{
              ...s.msg,
              background: bdMsg.type === 'ok' ? '#d8f3dc' : '#fee',
              color: bdMsg.type === 'ok' ? '#2d6a4f' : '#c0392b',
            }}
          >
            {bdMsg.text}
          </div>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBdMsg(null);
            try {
              await api.createBundleDiscount({
                min_products: parseInt(bdForm.min_products, 10),
                discount_percent: parseFloat(bdForm.discount_percent),
              });
              setBdForm({ min_products: '', discount_percent: '' });
              const res = await api.getBundleDiscounts();
              setBundleDiscounts(res.data ?? []);
              setBdMsg({ type: 'ok', text: 'Discount tier added.' });
            } catch (err) {
              setBdMsg({ type: 'error', text: err.message });
            }
          }}
          style={{
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
            marginBottom: 16,
            alignItems: 'flex-end',
          }}
        >
          <div>
            <label style={s.label}>Min. distinct products</label>
            <input
              style={{ ...s.input, width: 120 }}
              type="number"
              min="2"
              placeholder="e.g. 3"
              value={bdForm.min_products}
              onChange={(e) => setBdForm((f) => ({ ...f, min_products: e.target.value }))}
              required
            />
          </div>
          <div>
            <label style={s.label}>Discount %</label>
            <input
              style={{ ...s.input, width: 120 }}
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              placeholder="e.g. 10"
              value={bdForm.discount_percent}
              onChange={(e) => setBdForm((f) => ({ ...f, discount_percent: e.target.value }))}
              required
            />
          </div>
          <button type="submit" style={s.btn}>
            Add Tier
          </button>
        </form>
        {bundleDiscounts.length === 0 ? (
          <div style={{ color: '#888', fontSize: 13 }}>No discount tiers configured.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderBottom: '2px solid #eee',
                    color: '#555',
                  }}
                >
                  Min. products
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderBottom: '2px solid #eee',
                    color: '#555',
                  }}
                >
                  Discount
                </th>
                <th style={{ padding: '8px 10px', borderBottom: '2px solid #eee' }}></th>
              </tr>
            </thead>
            <tbody>
              {bundleDiscounts.map((bd) => (
                <tr key={bd.id}>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid #f0f0f0' }}>
                    {bd.min_products}+ products
                  </td>
                  <td
                    style={{
                      padding: '8px 10px',
                      borderBottom: '1px solid #f0f0f0',
                      color: '#2d6a4f',
                      fontWeight: 600,
                    }}
                  >
                    {bd.discount_percent}% off
                  </td>
                  <td
                    style={{
                      padding: '8px 10px',
                      borderBottom: '1px solid #f0f0f0',
                      textAlign: 'right',
                    }}
                  >
                    <button
                      style={{
                        background: '#fee',
                        color: '#c0392b',
                        border: 'none',
                        borderRadius: 6,
                        padding: '4px 10px',
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                      onClick={async () => {
                        if (!confirm('Delete this discount tier?')) return;
                        try {
                          await api.deleteBundleDiscount(bd.id);
                          const res = await api.getBundleDiscounts();
                          setBundleDiscounts(res.data ?? []);
                        } catch (err) {
                          setBdMsg({ type: 'error', text: err.message });
                        }
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pending Multi-sig Signature Requests */}
      {pendingTxs.length > 0 && (
        <div style={{ ...s.card, border: '1px solid #f9a825', background: '#fffde7' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e65100', marginBottom: 12 }}>
            🔏 Pending Signature Requests ({pendingTxs.length})
          </div>
          {pendingTxs.map((tx) => (
            <div
              key={tx.id}
              style={{
                borderBottom: '1px solid #ffe082',
                padding: '10px 0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {tx.coopName} — {tx.amount} XLM
                </div>
                <div style={{ fontSize: 12, color: '#888' }}>
                  To: {tx.destination?.slice(0, 12)}… · {tx.signatures.length} signature(s)
                  collected
                </div>
                <div style={{ fontSize: 11, color: '#aaa' }}>
                  Expires: {new Date(tx.expires_at).toLocaleString()}
                </div>
              </div>
              <button
                style={{
                  ...s.btn,
                  fontSize: 13,
                  padding: '6px 14px',
                  background: signingTxId === tx.id ? '#888' : '#2d6a4f',
                }}
                disabled={signingTxId === tx.id}
                onClick={async () => {
                  setSigningTxId(tx.id);
                  try {
                    const res = await api.signPendingTx(tx.id);
                    if (res.submitted) alert(`✅ Transaction submitted! TX: ${res.txHash}`);
                    else
                      alert(
                        `Signature added (${res.signaturesCollected}/${res.required} required)`
                      );
                    load();
                  } catch (e) {
                    alert(`Error: ${e.message}`);
                  } finally {
                    setSigningTxId(null);
                  }
                }}
              >
                {signingTxId === tx.id ? 'Signing…' : '✍️ Sign'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* QR Code Modal */}
      {qrProductId && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setQrProductId(null)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              padding: 32,
              maxWidth: 340,
              width: '90%',
              textAlign: 'center',
              boxShadow: '0 8px 32px #0003',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 18, fontWeight: 700, color: '#2d6a4f', marginBottom: 4 }}>
              {t('dashboard.productQr')}
            </div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 20 }}>{qrProductName}</div>
            <img
              src={`/api/products/${qrProductId}/qr`}
              alt={`QR code for ${qrProductName}`}
              style={{
                width: 220,
                height: 220,
                borderRadius: 8,
                border: '1px solid #eee',
                marginBottom: 20,
              }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <a
                href={`/api/products/${qrProductId}/qr`}
                download={`product-${qrProductId}-qr.png`}
                style={{
                  ...s.btn,
                  textDecoration: 'none',
                  fontSize: 13,
                  padding: '8px 18px',
                  background: '#218c74',
                }}
              >
                {t('dashboard.download')}
              </a>
              <button
                style={{ ...s.btn, fontSize: 13, padding: '8px 18px', background: '#888' }}
                onClick={() => setQrProductId(null)}
              >
                {t('dashboard.close')}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Availability Calendar Modal */}
      {calendarProductId && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setCalendarProductId(null)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              padding: 28,
              maxWidth: 480,
              width: '95%',
              boxShadow: '0 8px 32px #0003',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 17, fontWeight: 700, color: '#2d6a4f', marginBottom: 4 }}>
              📅 Availability Calendar
            </div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
              {calendarProductName}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {calendarWeeks.map((w) => (
                <button
                  key={w.week_start}
                  onClick={async () => {
                    setCalendarSaving(true);
                    const newAvail = !w.available;
                    await api
                      .setCalendarWeek(calendarProductId, {
                        week_start: w.week_start,
                        available: newAvail,
                      })
                      .catch(() => {});
                    setCalendarWeeks((prev) =>
                      prev.map((x) =>
                        x.week_start === w.week_start ? { ...x, available: newAvail } : x
                      )
                    );
                    setCalendarSaving(false);
                  }}
                  disabled={calendarSaving}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    fontSize: 12,
                    cursor: 'pointer',
                    border: '1px solid ' + (w.available ? '#2d6a4f' : '#ddd'),
                    background: w.available ? '#d8f3dc' : '#f5f5f5',
                    color: w.available ? '#2d6a4f' : '#aaa',
                    fontWeight: 600,
                  }}
                >
                  {w.available ? '✓' : '✗'}{' '}
                  {new Date(w.week_start + 'T00:00:00Z').toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
              Click a week to toggle availability.
            </div>
            <button
              style={{ ...s.btn, background: '#888', fontSize: 13, padding: '8px 18px' }}
              onClick={() => setCalendarProductId(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
