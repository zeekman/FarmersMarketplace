import React, { useEffect, useState, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { api } from '../api/client';

const s = {
  page: { maxWidth: 900, margin: '0 auto', padding: 16 },
  title: { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 24 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 24 },
  card: { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001' },
  label: { display: 'block', fontSize: 13, marginBottom: 4, color: '#555' },
  input: { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 16, marginBottom: 4, boxSizing: 'border-box', minHeight: 44 },
  inputErr: { width: '100%', padding: '9px 12px', border: '1px solid #c0392b', borderRadius: 8, fontSize: 16, marginBottom: 4, boxSizing: 'border-box', minHeight: 44 },
  fieldErr: { color: '#c0392b', fontSize: 12, marginBottom: 8 },
  textarea: { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, marginBottom: 4, minHeight: 80, resize: 'vertical', boxSizing: 'border-box' },
  btn: { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, minHeight: 44 },
  product: { borderBottom: '1px solid #eee', padding: '12px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  del: { background: '#fee', color: '#c0392b', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
  msg: { padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 14 },
};

const EMPTY_FORM = {
  name: '',
  description: '',
  price: '',
  quantity: '',
  unit: 'kg',
  category: 'other',
  min_order_quantity: '',
  batch_id: '',
  pricing_type: 'unit',
  min_weight: '',
  max_weight: '',
  pricing_model: 'fixed',
  min_price: '',
  is_preorder: false,
  preorder_delivery_date: '',
  allergens: [],
  allowed_regions: [],
  nutrition: {
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
    fiber: '',
    vitamins: {},
  },
  harvest_date: '',
  best_before: '',
  available_from: '',
  available_until: '',
};

import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from '../utils/errorMessages';

export default function Dashboard() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [harvestBatches, setHarvestBatches] = useState([]);
  const [batchForm, setBatchForm] = useState({ batch_code: '', harvest_date: '', notes: '' });
  const [batchMsg, setBatchMsg] = useState(null);
  const [msg, setMsg] = useState(null);
  const [auctionForm, setAuctionForm] = useState({ product_id: '', start_price: '', ends_at: '' });
  const [auctionMsg, setAuctionMsg] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [sales, setSales] = useState([]);
  const [salesMsg, setSalesMsg] = useState({});
  const [forecastByProduct, setForecastByProduct] = useState({});
  const [waitlistAnalytics, setWaitlistAnalytics] = useState([]);
  const [videoUploadingByProduct, setVideoUploadingByProduct] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [flashSaleForm, setFlashSaleForm] = useState({ product_id: '', flash_sale_price: '', flash_sale_ends_at: '' });
  const [flashSaleMsg, setFlashSaleMsg] = useState(null);

  // bulk price update state
  const [bulkPriceSelections, setBulkPriceSelections] = useState({}); // { [productId]: newPrice }
  const [bulkAdjustPct, setBulkAdjustPct] = useState('');
  const [bulkPriceMsg, setBulkPriceMsg] = useState(null);

  // bundle state
  const [bundles, setBundles] = useState([]);
  const [bundleForm, setBundleForm] = useState({ name: '', description: '', price: '', items: [{ product_id: '', quantity: 1 }] });
  const [bundleMsg, setBundleMsg] = useState(null);

  // bundle discount state
  const [bundleDiscounts, setBundleDiscounts] = useState([]);
  const [bdForm, setBdForm] = useState({ min_products: '', discount_percent: '' });
  const [bdMsg, setBdMsg] = useState(null);

  // image state
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [imageErr, setImageErr] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // profile state
  const [profile, setProfile]       = useState({ bio: '', location: '', avatar_url: '', federation_name: '', latitude: '', longitude: '', farm_address: '' });
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
  const galleryInputRef = useRef(null);

  // QR code modal state
  const [qrProductId, setQrProductId] = useState(null);
  const [qrProductName, setQrProductName] = useState('');

  // Coupon state
  const [coupons, setCoupons] = useState([]);
  const [couponForm, setCouponForm] = useState({ code: '', discount_type: 'percent', discount_value: '', max_uses: '', expires_at: '' });
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
    setTiers([...tiers, { min_quantity: (tiers.length > 0 ? tiers[tiers.length - 1].min_quantity + 1 : 2), price_per_unit: 0 }]);
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
    } catch { setGalleryImages([]); }
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
      const [productsRes, salesRes, profileRes, bundlesRes, couponsRes, coopsRes, batchesRes, forecastRes] = await Promise.all([
      const [productsRes, salesRes, profileRes, bundlesRes, couponsRes, coopsRes, forecastRes] = await Promise.all([
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
      setBundles((bundlesRes.data ?? []).filter(b => b.farmer_id === user?.id));
      setHarvestBatches(batchesRes?.data ?? []);
      setCoupons(couponsRes.data ?? []);
      const coops = coopsRes.data ?? [];
      setCooperatives(coops);
      setCoupons(couponsRes.data ?? []);
      setCooperatives(coopsRes.data ?? []);

      const forecastMap = {};
      (forecastRes.data ?? []).forEach((item) => {
        forecastMap[item.product_id] = item;
      });
      setForecastByProduct(forecastMap);

      // Waitlist analytics
      const waitlistRes = await api.getWaitlistAnalytics().catch(() => ({ data: [] }));
      setWaitlistAnalytics(waitlistRes.data ?? []);

      const allPending = await Promise.all(
        coops.map(c => api.getPendingTxs(c.id).then(r => (r.data ?? []).map(t => ({ ...t, coopName: c.name }))).catch(() => []))
      );
      setPendingTxs(allPending.flat().filter(t => t.status === 'pending' && !t.alreadySigned));

      const bdRes = await api.getBundleDiscounts().catch(() => ({ data: [] }));
      setBundleDiscounts(bdRes.data ?? []);

      if (profileRes.data) {
        const d = profileRes.data;
        setProfile({ bio: d.bio || '', location: d.location || '', avatar_url: d.avatar_url || '', federation_name: d.federation_name || '', latitude: d.latitude ?? '', longitude: d.longitude ?? '', farm_address: d.farm_address || '' });
        if (d.avatar_url) setAvatarPreview(d.avatar_url);
      }
    } catch (err) {
      setError(err?.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Load current profile
    if (user?.id) {
      api.getFarmer(user.id)
        .then(res => {
          const d = res.data;
          setProfile({ bio: d.bio || '', location: d.location || '', avatar_url: d.avatar_url || '', federation_name: d.federation_name || '', latitude: d.latitude ?? '', longitude: d.longitude ?? '', farm_address: d.farm_address || '' });
          if (d.avatar_url) setAvatarPreview(d.avatar_url);
        })
        .catch(() => {});
    }
  }, [user?.id]);

  async function handleCreateBatch(e) {
    e?.preventDefault?.();
    setBatchMsg(null);
    const code = batchForm.batch_code.trim();
    const date = batchForm.harvest_date.trim();
    if (!code || !date) {
      setBatchMsg({ type: 'err', text: 'Batch code and harvest date are required.' });
      return;
    }
    try {
      await api.createHarvestBatch({
        batch_code: code,
        harvest_date: date,
        notes: batchForm.notes.trim() || undefined,
      });
      setBatchForm({ batch_code: '', harvest_date: '', notes: '' });
      setBatchMsg({ type: 'ok', text: 'Harvest batch created.' });
      await load();
    } catch (err) {
      setBatchMsg({ type: 'err', text: getErrorMessage(err) });
    }
  }

  function validateAndSetImage(file) {
    setImageErr('');
    if (!ALLOWED_TYPES.includes(file.type)) {
      setImageErr('Only JPEG, PNG, or WebP images are allowed.');
      return false;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setImageErr(`Image must be ${MAX_SIZE_MB} MB or smaller.`);
      return false;
    }
    setImageFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setImageUrl(null); // reset confirmed URL until uploaded
    return true;
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (file) validateAndSetImage(file);
    e.target.value = ''; // allow re-selecting same file
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) validateAndSetImage(file);
  }

  function removeImage() {
    setImageFile(null);
    setPreviewUrl(null);
    setImageUrl(null);
    setImageErr('');
  }

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
      setProfile({ bio: d.bio || '', location: d.location || '', avatar_url: d.avatar_url || '', federation_name: d.federation_name || '', latitude: d.latitude ?? '', longitude: d.longitude ?? '', farm_address: d.farm_address || '' });
      setProfileMsg({ type: 'ok', text: t('dashboard.profileUpdated') });
    } catch (err) {
      setProfileMsg({ type: 'err', text: getErrorMessage(err) });
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    setMsg(null);
    const nutritionData = {};
    if (form.nutrition.calories) nutritionData.calories = parseFloat(form.nutrition.calories);
    if (form.nutrition.protein) nutritionData.protein = parseFloat(form.nutrition.protein);
    if (form.nutrition.carbs) nutritionData.carbs = parseFloat(form.nutrition.carbs);
    if (form.nutrition.fat) nutritionData.fat = parseFloat(form.nutrition.fat);
    if (form.nutrition.fiber) nutritionData.fiber = parseFloat(form.nutrition.fiber);

    const batchId = form.batch_id ? parseInt(form.batch_id, 10) : undefined;
    const payload = {
      ...form,
      price: parseFloat(form.price),
      quantity: parseInt(form.quantity, 10),
      is_preorder: form.is_preorder ? 1 : 0,
      preorder_delivery_date: form.is_preorder ? form.preorder_delivery_date : null,
      image_url: imageUrl || undefined,
      nutrition: Object.keys(nutritionData).length > 0 ? nutritionData : undefined,
      pricing_type: form.pricing_type || 'unit',
      min_weight: form.pricing_type === 'weight' ? parseFloat(form.min_weight) : undefined,
      max_weight: form.pricing_type === 'weight' ? parseFloat(form.max_weight) : undefined,
      batch_id: Number.isFinite(batchId) ? batchId : undefined,
    };

    try {
      await api.createProduct(payload);
    setFormErrors({});
    let finalImageUrl = imageUrl;

    if (imageFile) {
      setUploading(true);
      try {
        const res = await api.uploadImage(imageFile);
        finalImageUrl = res.imageUrl;
      } catch (err) {
        setUploading(false);
        setMsg({ type: 'err', text: `Image upload failed: ${err.message}` });
        return;
      }
      setUploading(false);
    }

    try {
      // Prepare nutrition data
      const nutritionData = {};
      if (form.nutrition.calories) nutritionData.calories = parseFloat(form.nutrition.calories);
      if (form.nutrition.protein) nutritionData.protein = parseFloat(form.nutrition.protein);
      if (form.nutrition.carbs) nutritionData.carbs = parseFloat(form.nutrition.carbs);
      if (form.nutrition.fat) nutritionData.fat = parseFloat(form.nutrition.fat);
      if (form.nutrition.fiber) nutritionData.fiber = parseFloat(form.nutrition.fiber);

      await api.createProduct({
        ...form,
        price: parseFloat(form.price),
        quantity: parseInt(form.quantity),
        pricing_model: form.pricing_model,
        min_price: form.pricing_model === 'pwyw' ? parseFloat(form.min_price) : undefined,
        is_preorder: form.is_preorder ? 1 : 0,
        preorder_delivery_date: form.is_preorder ? form.preorder_delivery_date : null,
        image_url: finalImageUrl || undefined,
        nutrition: Object.keys(nutritionData).length > 0 ? nutritionData : undefined,
        pricing_type: form.pricing_type || 'unit',
        min_weight: form.pricing_type === 'weight' ? parseFloat(form.min_weight) : undefined,
        max_weight: form.pricing_type === 'weight' ? parseFloat(form.max_weight) : undefined,
        min_order_quantity: form.min_order_quantity ? parseInt(form.min_order_quantity) : undefined,
        allergens: form.allergens && form.allergens.length > 0 ? form.allergens : undefined,
        allowed_regions: form.allowed_regions && form.allowed_regions.length > 0 ? form.allowed_regions : undefined,
        available_from: form.available_from || undefined,
        available_until: form.available_until || undefined,
      });
      setMsg({ type: 'ok', text: t('dashboard.productListedOk') });
      setForm({ ...EMPTY_FORM });
      removeImage();
      load();
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    }
  }

  async function handleDelete(id) {
    if (!confirm('Remove this product?')) return;
    try { await api.deleteProduct(id); load(); } catch { /* ignore */ }
  }

  async function handleCreateAuction(e) {
    e.preventDefault();
    setAuctionMsg(null);
    try {
      await api.createAuction({
        product_id: parseInt(auctionForm.product_id),
        start_price: parseFloat(auctionForm.start_price),
        ends_at: new Date(auctionForm.ends_at).toISOString(),
      });
      setAuctionMsg({ type: 'ok', text: 'Auction created!' });
      setAuctionForm({ product_id: '', start_price: '', ends_at: '' });
    } catch (err) {
      setAuctionMsg({ type: 'err', text: err.message });
    }
  }

  async function handleSetFlashSale(e) {
    e.preventDefault();
    setFlashSaleMsg(null);
    try {
      const res = await api.setFlashSale(parseInt(flashSaleForm.product_id, 10), {
        flash_sale_price: parseFloat(flashSaleForm.flash_sale_price),
        flash_sale_ends_at: new Date(flashSaleForm.flash_sale_ends_at).toISOString(),
      });
      setFlashSaleMsg({ type: 'ok', text: `Flash sale set for product #${res.data.id}` });
      await load();
    } catch (e) {
      setFlashSaleMsg({ type: 'err', text: getErrorMessage(e) });
    }
  }

  async function handleCancelFlashSale(productId) {
    try {
      await api.cancelFlashSale(productId);
      setFlashSaleMsg({ type: 'ok', text: `Flash sale canceled for product #${productId}` });
      await load();
    } catch (e) {
      setFlashSaleMsg({ type: 'err', text: getErrorMessage(e) });
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
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        Object.assign(document.createElement('a'), { href: url, download: `products.${format}` }).click();
        URL.revokeObjectURL(url);
      });
  }

  function exportSales(format) {
    const token = localStorage.getItem('token');
    const qs = new URLSearchParams({ format, ...(salesExportFrom && { from: salesExportFrom }), ...(salesExportTo && { to: salesExportTo }) });
    fetch(`/api/orders/sales/export?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        Object.assign(document.createElement('a'), { href: url, download: `sales.${format}` }).click();
        URL.revokeObjectURL(url);
      });
  }

  async function handleBulkPriceUpdate() {
    setBulkPriceMsg(null);
    const updates = Object.entries(bulkPriceSelections)
      .filter(([, price]) => price !== '')
      .map(([id, price]) => ({ id: Number(id), price: parseFloat(price) }));

    if (updates.length === 0 && bulkAdjustPct === '') {
      setBulkPriceMsg({ type: 'err', text: 'Select products and enter prices, or enter a % adjustment.' });
      return;
    }

    const adjustmentPercent = bulkAdjustPct !== '' ? parseFloat(bulkAdjustPct) : undefined;
    const payload = adjustmentPercent != null
      ? { updates: products.map((p) => ({ id: p.id })), adjustment_percent: adjustmentPercent }
      : { updates };

    try {
      const res = await api.bulkUpdatePrices(payload.updates, payload.adjustment_percent);
      const { updated, failed } = res.data;
      setBulkPriceMsg({ type: 'ok', text: `Updated ${updated.length} product(s).${failed.length ? ` ${failed.length} failed.` : ''}` });
      setBulkPriceSelections({});
      setBulkAdjustPct('');
      load();
    } catch (e) {
      setBulkPriceMsg({ type: 'err', text: e.message || 'Bulk update failed' });
    }
  }

  return (
    <div style={s.page}>
      <Helmet>
        <title>Farmer Dashboard – Farmers Marketplace</title>
        <meta name="description" content="Manage your product listings, track sales, and grow your farm business on Farmers Marketplace." />
      </Helmet>
      <div style={s.title}>🌾 Farmer Dashboard</div>

      {/* Waitlist Analytics */}
      {waitlistAnalytics.length > 0 && (
        <div style={{ ...s.card, marginBottom: 24 }}>
          <h3 style={{ marginBottom: 12, color: '#333' }}>📋 Waitlist Analytics</h3>
          {waitlistAnalytics.some((r) => r.alert) && (
            <div style={{ background: '#fff3cd', color: '#856404', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 14, fontWeight: 600 }}>
              ⚠️ Some products have more than 10 buyers waiting — consider restocking!
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #eee' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>Product</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>Queue</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>Avg Wait (hrs)</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>Conversion</th>
              </tr>
            </thead>
            <tbody>
              {waitlistAnalytics.map((r) => (
                <tr key={r.product_id} style={{ borderBottom: '1px solid #f0f0f0', background: r.alert ? '#fff8e1' : 'transparent' }}>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>
                    {r.product_name}
                    {r.alert && <span style={{ marginLeft: 6, fontSize: 11, background: '#f9a825', color: '#fff', borderRadius: 4, padding: '1px 6px' }}>High demand</span>}
                  </td>
                  <td style={{ padding: '6px 8px' }}>{r.queue_length}</td>
                  <td style={{ padding: '6px 8px' }}>{r.avg_wait_hours != null ? r.avg_wait_hours : '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{r.conversion_rate != null ? `${r.conversion_rate}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ ...s.card, marginBottom: 24 }}>
        <h3 style={{ marginBottom: 12, color: '#333' }}>Flash Sales</h3>
        {flashSaleMsg && <div style={{ ...s.msg, background: flashSaleMsg.type === 'ok' ? '#d8f3dc' : '#fee', color: flashSaleMsg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>{flashSaleMsg.text}</div>}
        <form onSubmit={handleSetFlashSale} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={s.label}>Product</label>
            <select style={s.input} value={flashSaleForm.product_id} onChange={(e) => setFlashSaleForm((f) => ({ ...f, product_id: e.target.value }))} required>
              <option value="">Select product</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label style={s.label}>Flash Price (XLM)</label>
            <input style={s.input} type="number" min="0" step="any" required value={flashSaleForm.flash_sale_price} onChange={(e) => setFlashSaleForm((f) => ({ ...f, flash_sale_price: e.target.value }))} />
          </div>
          <div>
            <label style={s.label}>Ends At</label>
            <input style={s.input} type="datetime-local" required value={flashSaleForm.flash_sale_ends_at} onChange={(e) => setFlashSaleForm((f) => ({ ...f, flash_sale_ends_at: e.target.value }))} />
          </div>
          <button type="submit" style={s.btn}>Set Flash Sale</button>
        </form>

        <div style={{ marginTop: 14 }}>
          {products.filter((p) => p.flash_sale_price && p.flash_sale_ends_at).map((p) => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #eee', paddingTop: 10, marginTop: 10 }}>
              <div style={{ fontSize: 14 }}>
                <strong>{p.name}</strong> - {p.flash_sale_price} XLM until {new Date(p.flash_sale_ends_at).toLocaleString()}
              </div>
              <button type="button" style={{ ...s.btn, background: '#c0392b' }} onClick={() => handleCancelFlashSale(p.id)}>Cancel</button>
            </div>
          ))}
        </div>
      </div>

      {/* Bulk Price Update */}
      <div style={{ ...s.card, marginBottom: 24 }}>
        <h3 style={{ marginBottom: 12, color: '#333' }}>💰 Bulk Price Update</h3>
        {bulkPriceMsg && (
          <div style={{ ...s.msg, background: bulkPriceMsg.type === 'ok' ? '#d8f3dc' : '#fee', color: bulkPriceMsg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>
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
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 12 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #eee' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>Product</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>Current Price (XLM)</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555' }}>New Price (XLM)</th>
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
                    onChange={(e) => setBulkPriceSelections((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    disabled={bulkAdjustPct !== ''}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button style={s.btn} onClick={handleBulkPriceUpdate}>Apply Price Update</button>
      </div>

      <div style={s.grid}>
        <div style={s.card}>
          <h3 style={{ marginBottom: 16, color: '#333' }}>Add New Product</h3>
          {msg && <div style={{ ...s.msg, background: msg.type === 'ok' ? '#d8f3dc' : '#fee', color: msg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>{msg.text}</div>}
          <form onSubmit={handleAdd}>
            {[['name', 'Product Name', 'prod-name'], ['price', 'Price (XLM)', 'prod-price'], ['quantity', 'Quantity', 'prod-qty'], ['unit', 'Unit (kg, bunch, etc.)', 'prod-unit']].map(([key, label, id]) => (
              <div key={key}>
                <label style={s.label} htmlFor={id}>{label}</label>
                <input id={id} style={s.input} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} required={key !== 'unit'} />
              </div>
            ))}
            <label style={s.label}>Description</label>
            <textarea style={s.textarea} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            <label style={s.label}>Category</label>
            <select style={s.input} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {['vegetables', 'fruits', 'grains', 'dairy', 'herbs', 'other'].map(c => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
            <label style={s.label}>Harvest batch (optional)</label>
            <select style={s.input} value={form.batch_id} onChange={e => setForm({ ...form, batch_id: e.target.value })}>
              <option value="">No batch</option>
              {harvestBatches.map((b) => (
                <option key={b.id} value={b.id}>{b.batch_code} — {b.harvest_date}</option>
              ))}
            </select>
            {batchMsg && (
              <div style={{ ...s.msg, marginBottom: 12, background: batchMsg.type === 'ok' ? '#d8f3dc' : '#fee', color: batchMsg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>
                {batchMsg.text}
              </div>
            )}
            <div style={{ fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 8 }}>Create new batch</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              <div>
                <label style={s.label}>Batch code</label>
                <input style={s.input} value={batchForm.batch_code} onChange={e => setBatchForm(f => ({ ...f, batch_code: e.target.value }))} placeholder="e.g. H-2026-03-A" />
              </div>
              <div>
                <label style={s.label}>Harvest date</label>
                <input style={s.input} type="date" value={batchForm.harvest_date} onChange={e => setBatchForm(f => ({ ...f, harvest_date: e.target.value }))} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={s.label}>Notes (optional)</label>
                <input style={s.input} value={batchForm.notes} onChange={e => setBatchForm(f => ({ ...f, notes: e.target.value }))} placeholder="Field block, variety…" />
              </div>
              <button type="button" style={{ ...s.btn, gridColumn: '1 / -1', justifySelf: 'start' }} onClick={handleCreateBatch}>Save batch</button>
            </div>
            <label style={s.label}>Pricing Type</label>
            <select style={s.input} value={form.pricing_type || 'unit'} onChange={e => setForm({ ...form, pricing_type: e.target.value })}>
              <option value="unit">Per unit / fixed quantity</option>
              <option value="weight">By weight (price per kg/lb)</option>
            </select>
            {form.pricing_type === 'weight' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={s.label}>Min Weight ({form.unit || 'kg'})</label>
                  <input style={s.input} type="number" min="0.001" step="any" value={form.min_weight || ''} onChange={e => setForm({ ...form, min_weight: e.target.value })} placeholder="e.g. 0.1" required />
                </div>
                <div>
                  <label style={s.label}>Max Weight ({form.unit || 'kg'})</label>
                  <input style={s.input} type="number" min="0.001" step="any" value={form.max_weight || ''} onChange={e => setForm({ ...form, max_weight: e.target.value })} placeholder="e.g. 10" required />
                </div>
              </div>
            )}
            <label style={s.label}>Min Order Quantity (MOQ)</label>
            <input style={s.input} type="number" min="1" step="1" value={form.min_order_quantity || ''} onChange={e => setForm({ ...form, min_order_quantity: e.target.value })} placeholder="1 (default)" />
            <label style={s.label}>Pricing Model</label>
            <select style={s.input} value={form.pricing_model || 'fixed'} onChange={e => setForm({ ...form, pricing_model: e.target.value, min_price: e.target.value === 'pwyw' ? (form.min_price || '') : '' })}>
              <option value="fixed">Fixed Price</option>
              <option value="pwyw">Pay What You Want</option>
              <option value="donation">Donation</option>
            </select>
            {form.pricing_model === 'pwyw' && (
              <div style={{ marginBottom: 12 }}>
                <label style={s.label}>Minimum Price (XLM)</label>
                <input style={s.input} type="number" min="0" step="any" value={form.min_price} onChange={e => setForm({ ...form, min_price: e.target.value })} placeholder="e.g. 5" required />
              </div>
            )}
            <button style={{ ...s.btn, width: '100%', marginTop: 8 }} type="submit" disabled={uploading}>
              {uploading ? t('dashboard.uploading') : t('dashboard.listProduct')}
            </button>

            {/* Allergen selector */}
            <div style={{ marginBottom: 12 }}>
              <label style={s.label}>Allergens <span style={{ color: '#aaa', fontWeight: 400 }}>(select all that apply)</span></label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {['gluten', 'nuts', 'dairy', 'eggs', 'soy', 'shellfish'].map(a => {
                  const selected = (form.allergens || []).includes(a);
                  return (
                    <button
                      key={a}
                      type="button"
                      style={{
                        padding: '5px 10px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
                        border: selected ? '1px solid #c0392b' : '1px solid #ddd',
                        background: selected ? '#fee' : '#fff',
                        color: selected ? '#c0392b' : '#555',
                        fontWeight: selected ? 700 : 400,
                      }}
                      onClick={() => setForm(f => ({
                        ...f,
                        allergens: selected
                          ? (f.allergens || []).filter(x => x !== a)
                          : [...(f.allergens || []), a],
                      }))}
                      aria-pressed={selected}
                    >
                      {selected ? '✕ ' : ''}{a.charAt(0).toUpperCase() + a.slice(1)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Region restriction selector */}
            <div style={{ marginBottom: 12 }}>
              <label style={s.label}>Allowed Regions <span style={{ color: '#aaa', fontWeight: 400 }}>(leave empty for no restriction)</span></label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {[
                  { code: 'US', label: '🇺🇸 US' }, { code: 'GB', label: '🇬🇧 GB' },
                  { code: 'KE', label: '🇰🇪 KE' }, { code: 'NG', label: '🇳🇬 NG' },
                  { code: 'ZA', label: '🇿🇦 ZA' }, { code: 'GH', label: '🇬🇭 GH' },
                  { code: 'IN', label: '🇮🇳 IN' }, { code: 'AU', label: '🇦🇺 AU' },
                  { code: 'CA', label: '🇨🇦 CA' }, { code: 'DE', label: '🇩🇪 DE' },
                ].map(({ code, label }) => {
                  const selected = (form.allowed_regions || []).includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      style={{
                        padding: '5px 10px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
                        border: selected ? '1px solid #2d6a4f' : '1px solid #ddd',
                        background: selected ? '#d8f3dc' : '#fff',
                        color: selected ? '#2d6a4f' : '#555',
                        fontWeight: selected ? 700 : 400,
                      }}
                      onClick={() => setForm(f => ({
                        ...f,
                        allowed_regions: selected
                          ? (f.allowed_regions || []).filter(x => x !== code)
                          : [...(f.allowed_regions || []), code],
                      }))}
                      aria-pressed={selected}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <button style={s.btn} type="submit">List Product</button>

            <details style={{ marginTop: 16 }}>
              <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#2d6a4f', marginBottom: 8 }}>
                Nutritional Information (Optional)
              </summary>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginTop: 8 }}>
                <div>
                  <label style={s.label}>Calories</label>
                  <input
                    style={{ ...s.input, borderColor: formErrors.nutrition?.calories ? '#c0392b' : '#ddd' }}
                    type="number"
                    min="0"
                    step="any"
                    value={form.nutrition.calories}
                    onChange={e => {
                      setForm({
                        ...form,
                        nutrition: { ...form.nutrition, calories: e.target.value }
                      });
                      if (formErrors.nutrition?.calories) {
                        setFormErrors({
                          ...formErrors,
                          nutrition: { ...formErrors.nutrition, calories: undefined }
                        });
                      }
                    }}
                    placeholder="e.g. 50"
                  />
                  {formErrors.nutrition?.calories && <div style={s.fieldErr}>{formErrors.nutrition.calories}</div>}
                </div>
                <div>
                  <label style={s.label}>Protein (g)</label>
                  <input
                    style={{ ...s.input, borderColor: formErrors.nutrition?.protein ? '#c0392b' : '#ddd' }}
                    type="number"
                    min="0"
                    step="any"
                    value={form.nutrition.protein}
                    onChange={e => {
                      setForm({
                        ...form,
                        nutrition: { ...form.nutrition, protein: e.target.value }
                      });
                      if (formErrors.nutrition?.protein) {
                        setFormErrors({
                          ...formErrors,
                          nutrition: { ...formErrors.nutrition, protein: undefined }
                        });
                      }
                    }}
                    placeholder="e.g. 2.5"
                  />
                  {formErrors.nutrition?.protein && <div style={s.fieldErr}>{formErrors.nutrition.protein}</div>}
                </div>
                <div>
                  <label style={s.label}>Carbs (g)</label>
                  <input
                    style={{ ...s.input, borderColor: formErrors.nutrition?.carbs ? '#c0392b' : '#ddd' }}
                    type="number"
                    min="0"
                    step="any"
                    value={form.nutrition.carbs}
                    onChange={e => {
                      setForm({
                        ...form,
                        nutrition: { ...form.nutrition, carbs: e.target.value }
                      });
                      if (formErrors.nutrition?.carbs) {
                        setFormErrors({
                          ...formErrors,
                          nutrition: { ...formErrors.nutrition, carbs: undefined }
                        });
                      }
                    }}
                    placeholder="e.g. 10"
                  />
                  {formErrors.nutrition?.carbs && <div style={s.fieldErr}>{formErrors.nutrition.carbs}</div>}
                </div>
                <div>
                  <label style={s.label}>Fat (g)</label>
                  <input
                    style={{ ...s.input, borderColor: formErrors.nutrition?.fat ? '#c0392b' : '#ddd' }}
                    type="number"
                    min="0"
                    step="any"
                    value={form.nutrition.fat}
                    onChange={e => {
                      setForm({
                        ...form,
                        nutrition: { ...form.nutrition, fat: e.target.value }
                      });
                      if (formErrors.nutrition?.fat) {
                        setFormErrors({
                          ...formErrors,
                          nutrition: { ...formErrors.nutrition, fat: undefined }
                        });
                      }
                    }}
                    placeholder="e.g. 1.2"
                  />
                  {formErrors.nutrition?.fat && <div style={s.fieldErr}>{formErrors.nutrition.fat}</div>}
                </div>
                <div>
                  <label style={s.label}>Fiber (g)</label>
                  <input
                    style={{ ...s.input, borderColor: formErrors.nutrition?.fiber ? '#c0392b' : '#ddd' }}
                    type="number"
                    min="0"
                    step="any"
                    value={form.nutrition.fiber}
                    onChange={e => {
                      setForm({
                        ...form,
                        nutrition: { ...form.nutrition, fiber: e.target.value }
                      });
                      if (formErrors.nutrition?.fiber) {
                        setFormErrors({
                          ...formErrors,
                          nutrition: { ...formErrors.nutrition, fiber: undefined }
                        });
                      }
                    }}
                    placeholder="e.g. 3"
                  />
                  {formErrors.nutrition?.fiber && <div style={s.fieldErr}>{formErrors.nutrition.fiber}</div>}
                </div>
              </div>
            </details>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 10px', fontSize: 13, color: '#444' }}>
              <input
                type="checkbox"
                checked={!!form.is_preorder}
                onChange={e => setForm({
                  ...form,
                  is_preorder: e.target.checked,
                  preorder_delivery_date: e.target.checked ? form.preorder_delivery_date : '',
                })}
              />
              Mark as pre-order
            </label>

            {form.is_preorder && (
              <>
                <label style={s.label}>Expected Delivery Date</label>
                <input
                  style={formErrors.preorder_delivery_date ? s.inputErr : s.input}
                  type="date"
                  value={form.preorder_delivery_date}
                  onChange={e => {
                    setForm({ ...form, preorder_delivery_date: e.target.value });
                    if (formErrors.preorder_delivery_date) setFormErrors(fe => ({ ...fe, preorder_delivery_date: '' }));
                  }}
                />
                {formErrors.preorder_delivery_date && (
                  <div style={s.fieldErr} role="alert">{formErrors.preorder_delivery_date}</div>
                )}
              </>
            )}

            <label style={s.label}>Harvest Date (optional)</label>
            <input
              style={s.input}
              type="date"
              value={form.harvest_date}
              onChange={e => setForm({ ...form, harvest_date: e.target.value })}
            />

            <label style={s.label}>Best Before Date (optional)</label>
            <input
              style={s.input}
              type="date"
              value={form.best_before}
              onChange={e => setForm({ ...form, best_before: e.target.value })}
            />

            <label style={s.label}>Available From (optional)</label>
            <input
              style={s.input}
              type="datetime-local"
              value={form.available_from}
              onChange={e => setForm({ ...form, available_from: e.target.value })}
            />

            <label style={s.label}>Available Until (optional)</label>
            <input
              style={s.input}
              type="datetime-local"
              value={form.available_until}
              onChange={e => setForm({ ...form, available_until: e.target.value })}
            />

            {/* Image upload */}
            <label style={s.label}>{t('dashboard.productImage')} <span style={{ color: '#aaa', fontWeight: 400 }}>{t('dashboard.imageHint')}</span></label>

            {previewUrl ? (
              <>
                <img src={previewUrl} alt="Preview" style={s.preview} />
                {uploading && <div style={s.uploading}>{t('dashboard.uploading')}</div>}
                <button type="button" style={s.removeImg} onClick={removeImage}>{t('dashboard.removeImage')}</button>
              </>
            ) : (
              <div
                style={{ ...s.uploadZone, ...(dragOver ? s.uploadZoneActive : {}) }}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                role="button"
                aria-label={t('dashboard.productImage')}
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && fileInputRef.current?.click()}
              >
                📷 {t('dashboard.uploadImage')}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />

            {imageErr && <div style={s.imgErr}>{imageErr}</div>}

            <button style={s.btn} type="submit" disabled={uploading || Object.keys(formErrors).length > 0}>
              {uploading ? t('dashboard.uploading') : t('dashboard.listProduct')}
            </button>
          </form>
        </div>

        <div style={s.card}>
          <h3 style={{ marginBottom: 16, color: '#333' }}>My Listings ({products.length})</h3>
          <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
            <button style={{ ...s.btn, fontSize: 12, padding: '6px 12px', background: '#52b788' }} onClick={() => exportProducts('csv')}>⬇ CSV</button>
            <button style={{ ...s.btn, fontSize: 12, padding: '6px 12px', background: '#52b788' }} onClick={() => exportProducts('pdf')}>⬇ PDF</button>
          </div>
          {products.length === 0 && <p style={{ color: '#888', fontSize: 14 }}>No products yet. Add your first listing.</p>}
          {products.map(p => (
            <div key={p.id} style={s.product}>
              <div>
                <div style={{ fontWeight: 600 }}>{p.name}</div>
                <div style={{ fontSize: 13, color: '#666' }}>{p.price} XLM · {p.quantity} {p.unit}</div>
              </div>
              <button style={s.del} onClick={() => handleDelete(p.id)} aria-label={`Remove ${p.name}`}>Remove</button>
            <div key={p.id} style={{ ...s.product, flexDirection: 'column', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  {p.image_url
                    ? <img src={p.image_url} alt={p.name} style={s.productThumb} />
                    : <span style={{ fontSize: 28, marginRight: 10 }}>🥬</span>
                  }
                  <div>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: 13, color: '#666' }}>
                      {p.pricing_model === 'pwyw' ? `Min ${p.min_price} XLM (PWYW)` : p.pricing_model === 'donation' ? 'Donation' : `${p.price} XLM`} · {p.quantity} {p.unit}
                    </div>
                    {forecastByProduct[p.id]?.note ? (
                      <div style={{ fontSize: 12, color: '#888' }}>{forecastByProduct[p.id].note}</div>
                    ) : forecastByProduct[p.id] ? (
                      <div style={{ fontSize: 12, color: '#555' }}>
                        Demand hint: {forecastByProduct[p.id].avg_weekly_sales} units/week {' '}
                        {forecastByProduct[p.id].trend === 'up' ? '↑' : forecastByProduct[p.id].trend === 'down' ? '↓' : '→'}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    style={{ ...s.btn, padding: '4px 10px', fontSize: 12, background: '#555' }}
                    onClick={() => galleryProductId === p.id ? closeGallery() : openGallery(p.id)}
                  >
                    {t('dashboard.photos')}
                  </button>
                  <button
                    style={{ ...s.btn, padding: '4px 10px', fontSize: 12, background: '#17a2b8' }}
                    onClick={() => tiersProductId === p.id ? closeTiers() : openTiers(p.id)}
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
                  <label style={{ ...s.btn, padding: '4px 10px', fontSize: 12, background: '#1f6f8b', cursor: 'pointer' }}>
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
                    type="number" min="1" placeholder="+Qty"
                    style={{ ...s.input, width: 70, marginBottom: 0, padding: '4px 8px' }}
                    value={restockVals[p.id] || ''}
                    onChange={e => setRestockVals({ ...restockVals, [p.id]: e.target.value })}
                  />
                  <button style={{ ...s.btn, padding: '4px 10px', fontSize: 12, background: '#218c74' }} onClick={() => handleRestock(p.id)}>{t('dashboard.restock')}</button>
                  <button style={s.del} onClick={() => handleDelete(p.id)} aria-label={`Remove ${p.name}`}>{t('dashboard.remove')}</button>
                </div>
              </div>

              {/* Inline gallery manager */}
              {galleryProductId === p.id && (
                <div style={s.galleryPanel}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#2d6a4f' }}>
                    {t('dashboard.productPhotos', { count: galleryImages.length, max: MAX_IMAGES })}
                    <span style={{ fontWeight: 400, color: '#888', marginLeft: 8 }}>{t('dashboard.primaryImageHint')}</span>
                  </div>
                  {galleryErr && <div style={{ color: '#c0392b', fontSize: 12, marginBottom: 8 }}>{galleryErr}</div>}
                  <div style={s.galleryGrid}>
                    {galleryImages.map((img, i) => (
                      <div key={img.id} style={s.galleryItem}>
                        <img src={img.url} alt={`Photo ${i + 1}`} style={{ ...s.galleryThumb, ...(i === 0 ? s.galleryThumbFirst : {}) }} />
                        {i === 0 && <span style={{ fontSize: 10, color: '#2d6a4f', fontWeight: 600 }}>{t('dashboard.primary')}</span>}
                        <div style={{ display: 'flex', gap: 3 }}>
                          <button style={s.arrowBtn} onClick={() => handleGalleryMove(i, -1)} disabled={i === 0} aria-label="Move left">◀</button>
                          <button style={s.arrowBtn} onClick={() => handleGalleryMove(i, 1)} disabled={i === galleryImages.length - 1} aria-label="Move right">▶</button>
                          <button style={s.imgDelBtn} onClick={() => handleGalleryDelete(img.id)} aria-label="Delete image">✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {galleryImages.length < MAX_IMAGES && (
                    <>
                      <button
                        style={{ ...s.btn, fontSize: 12, padding: '6px 14px', background: '#218c74' }}
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
                    <span style={{ fontWeight: 400, color: '#888', marginLeft: 8 }}>{t('dashboard.tiersHint')}</span>
                  </div>
                  {tiersMsg && <div style={{ fontSize: 12, color: tiersMsg.type === 'ok' ? '#2d6a4f' : tiersMsg.type === 'error' ? '#c0392b' : '#856404', marginBottom: 8 }}>{tiersMsg.text}</div>}
                  <div style={{ marginBottom: 8 }}>
                    {tiers.length === 0 ? (
                      <div style={{ color: '#888', fontSize: 12 }}>{t('dashboard.noTiers')}</div>
                    ) : (
                      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid #ddd' }}>
                            <th style={{ textAlign: 'left', padding: '4px 0', fontWeight: 600 }}>{t('dashboard.minQuantity')}</th>
                            <th style={{ textAlign: 'left', padding: '4px 0', fontWeight: 600 }}>{t('dashboard.pricePerUnit')}</th>
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
                                  onChange={e => updateTier(index, 'min_quantity', e.target.value)}
                                  style={{ ...s.input, width: 80, marginBottom: 0, padding: '4px 6px', fontSize: 12 }}
                                />
                              </td>
                              <td style={{ padding: '4px 0' }}>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={tier.price_per_unit}
                                  onChange={e => updateTier(index, 'price_per_unit', e.target.value)}
                                  style={{ ...s.input, width: 80, marginBottom: 0, padding: '4px 6px', fontSize: 12 }}
                                /> XLM
                              </td>
                              <td style={{ padding: '4px 0' }}>
                                <button style={s.imgDelBtn} onClick={() => removeTier(index)}>✕</button>
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

      <div style={{ ...s.card, marginTop: 24, maxWidth: 440 }}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>🔨 Create Auction</h3>
        {auctionMsg && <div style={{ ...s.msg, background: auctionMsg.type === 'ok' ? '#d8f3dc' : '#fee', color: auctionMsg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>{auctionMsg.text}</div>}
        <form onSubmit={handleCreateAuction}>
          <label style={s.label}>Product</label>
          <select style={s.input} value={auctionForm.product_id} onChange={e => setAuctionForm({ ...auctionForm, product_id: e.target.value })} required>
            <option value="">Select a product</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label style={s.label}>Starting Price (XLM)</label>
          <input style={s.input} type="number" min="0.01" step="0.01" value={auctionForm.start_price} onChange={e => setAuctionForm({ ...auctionForm, start_price: e.target.value })} required />
          <label style={s.label}>Ends At</label>
          <input style={s.input} type="datetime-local" value={auctionForm.ends_at} onChange={e => setAuctionForm({ ...auctionForm, ends_at: e.target.value })} required />
          <button style={{ ...s.btn, background: '#e07b00' }} type="submit">Create Auction</button>
        </form>
      </div>

      {/* CSV Bulk Upload */}
      <div style={{ ...s.card, marginTop: 24 }}>        <h3 style={{ marginBottom: 16, color: '#333' }}>📤 Bulk Upload Products</h3>
        <p style={{ fontSize: 14, color: '#666', marginBottom: 16 }}>
          {t('dashboard.bulkUploadDesc')}
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <button style={s.csvBtn} onClick={() => csvInputRef.current?.click()} disabled={csvUploading}>
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
        {csvResult && (
          <div style={{ ...s.csvResult, background: csvResult.type === 'ok' ? '#d8f3dc' : '#fee', color: csvResult.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>
            {csvResult.text}
            {csvResult.details && csvResult.details.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <strong>{t('common.errors')}:</strong>
                <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                  {csvResult.details.slice(0, 10).map((err, i) => (
                    <li key={i}>{t('common.row', { n: err.row })}: {err.error}</li>
                  ))}
                  {csvResult.details.length > 10 && <li>{t('common.andMore', { n: csvResult.details.length - 10 })}</li>}
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
          <div style={{ ...s.msg, background: profileMsg.type === 'ok' ? '#d8f3dc' : '#fee', color: profileMsg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>
            {profileMsg.text}
          </div>
        )}
        <form onSubmit={handleProfileSave}>
          <label style={s.label}>{t('dashboard.avatar')}</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
            {avatarPreview
              ? <img src={avatarPreview} alt="Avatar" style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover' }} />
              : <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#d8f3dc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>🌾</div>
            }
            <div>
              <button type="button" style={{ ...s.btn, fontSize: 13, padding: '7px 14px' }} onClick={() => avatarInputRef.current?.click()}>
                {avatarUploading ? t('dashboard.uploading') : t('dashboard.changeAvatar')}
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) { setAvatarFile(file); setAvatarPreview(URL.createObjectURL(file)); }
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
            onChange={e => setProfile(p => ({ ...p, location: e.target.value }))}
            maxLength={100}
          />

          <label style={s.label}>Farm Address <span style={{ color: '#aaa', fontWeight: 400 }}>(optional · shown on map)</span></label>
          <input
            style={s.input}
            placeholder="e.g. 123 Farm Road, Nairobi, Kenya"
            value={profile.farm_address || ''}
            onChange={e => setProfile(p => ({ ...p, farm_address: e.target.value }))}
            maxLength={200}
          />

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={s.label}>Latitude <span style={{ color: '#aaa', fontWeight: 400 }}>(optional)</span></label>
              <input
                style={s.input}
                type="number"
                step="any"
                min="-90"
                max="90"
                placeholder="e.g. -1.2921"
                value={profile.latitude}
                onChange={e => setProfile(p => ({ ...p, latitude: e.target.value }))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={s.label}>Longitude <span style={{ color: '#aaa', fontWeight: 400 }}>(optional)</span></label>
              <input
                style={s.input}
                type="number"
                step="any"
                min="-180"
                max="180"
                placeholder="e.g. 36.8219"
                value={profile.longitude}
                onChange={e => setProfile(p => ({ ...p, longitude: e.target.value }))}
              />
            </div>
          </div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
            💡 Tip: Find your coordinates at{' '}
            <a href="https://www.latlong.net" target="_blank" rel="noopener noreferrer" style={{ color: '#2d6a4f' }}>latlong.net</a>
          </div>

          <label style={s.label}>{t('dashboard.bio')}</label>
          <textarea
            style={s.textarea}
            placeholder={t('dashboard.bioPlaceholder')}
            value={profile.bio}
            onChange={e => setProfile(p => ({ ...p, bio: e.target.value }))}
            maxLength={500}
          />

          <label style={s.label}>
            {t('dashboard.federationName')} <span style={{ color: '#aaa', fontWeight: 400 }}>(optional · e.g. yourname → yourname*{window.location.hostname})</span>
          </label>
          <input
            style={s.input}
            placeholder="e.g. johnfarm"
            value={profile.federation_name || ''}
            onChange={e => setProfile(p => ({ ...p, federation_name: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') }))}
            maxLength={64}
          />

          <button style={s.btn} type="submit" disabled={avatarUploading}>{t('dashboard.saveProfile')}</button>
        </form>
      </div>

      {/* Order management panel */}
      <div style={{ ...s.card, marginTop: 24 }}>
        <h3 style={{ padding: '16px 20px', borderBottom: '1px solid #eee', margin: 0, color: '#333' }}>
          📋 {t('dashboard.incomingOrders', { count: sales.length })}
        </h3>
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #eee', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <input type="date" value={salesExportFrom} onChange={e => setSalesExportFrom(e.target.value)} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }} placeholder="From" />
          <input type="date" value={salesExportTo} onChange={e => setSalesExportTo(e.target.value)} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }} placeholder="To" />
          <button style={{ ...s.btn, fontSize: 12, padding: '6px 12px', background: '#52b788' }} onClick={() => exportSales('csv')}>⬇ CSV</button>
          <button style={{ ...s.btn, fontSize: 12, padding: '6px 12px', background: '#52b788' }} onClick={() => exportSales('pdf')}>⬇ PDF</button>
        </div>
        {sales.length === 0 ? (
          <p style={{ padding: '20px', color: '#888', fontSize: 14 }}>{t('dashboard.noOrders')}</p>
        ) : (
          sales.map(o => {
            const m = salesMsg[o.id];
            return (
              <div key={o.id} style={{ padding: '14px 20px', borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{o.product_name}</div>
                    <div style={{ fontSize: 13, color: '#666' }}>
                      {o.quantity} units · {parseFloat(o.total_price).toFixed(2)} XLM · by {o.buyer_name}
                    </div>
                    {o.address_label && (
                      <div style={s.address}>
                        📍 {o.address_label}: {o.address_street}, {o.address_city}, {o.address_country}
                        {o.address_postal_code ? ` ${o.address_postal_code}` : ''}
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: '#aaa' }}>{new Date(o.created_at).toLocaleDateString()}</div>
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
                    {m && <div style={{ fontSize: 12, color: m.type === 'ok' ? '#2d6a4f' : '#c0392b', marginTop: 4 }}>{m.text}</div>}
                    {/* Return request section */}
                    {o.return_status === 'pending' && (
                      <div style={{ marginTop: 8, padding: '8px 12px', background: '#fff3cd', borderRadius: 8, fontSize: 13 }}>
                        <div style={{ fontWeight: 600, color: '#856404', marginBottom: 4 }}>↩️ Return requested</div>
                        <div style={{ color: '#555', marginBottom: 8 }}>{o.return_reason}</div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            style={{ padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#2d6a4f', color: '#fff', fontWeight: 600, fontSize: 12 }}
                            onClick={async () => {
                              try {
                                await api.approveReturn(o.id);
                                setSalesMsg(prev => ({ ...prev, [o.id]: { type: 'ok', text: 'Return approved — refund sent' } }));
                                load();
                              } catch (e) {
                                setSalesMsg(prev => ({ ...prev, [o.id]: { type: 'err', text: e.message } }));
                              }
                            }}
                          >✅ Approve & Refund</button>
                          <button
                            style={{ padding: '5px 14px', borderRadius: 6, border: '1px solid #c0392b', cursor: 'pointer', background: '#fff', color: '#c0392b', fontWeight: 600, fontSize: 12 }}
                            onClick={async () => {
                              const reason = window.prompt('Reason for rejection (optional):');
                              if (reason === null) return; // cancelled
                              try {
                                await api.rejectReturn(o.id, reason);
                                setSalesMsg(prev => ({ ...prev, [o.id]: { type: 'ok', text: 'Return rejected' } }));
                                load();
                              } catch (e) {
                                setSalesMsg(prev => ({ ...prev, [o.id]: { type: 'err', text: e.message } }));
                              }
                            }}
                          >❌ Reject</button>
                        </div>
                      </div>
                    )}
                    {o.return_status && o.return_status !== 'pending' && (
                      <div style={{ marginTop: 6, fontSize: 12 }}>
                        <span style={{
                          padding: '3px 10px', borderRadius: 20, fontWeight: 600,
                          background: o.return_status === 'approved' ? '#d8f3dc' : '#fee',
                          color: o.return_status === 'approved' ? '#2d6a4f' : '#c0392b',
                        }}>↩️ Return {o.return_status}</span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: STATUS_COLOR[o.status] || '#333' }}>
                      {STATUS_ICON[o.status]} {o.status}
                    </span>
                    {['paid', 'processing', 'shipped'].includes(o.status) && (
                      <select
                        style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13, cursor: 'pointer' }}
                        defaultValue=""
                        onChange={e => { if (e.target.value) handleStatusUpdate(o.id, e.target.value); e.target.value = ''; }}
                      >
                        <option value="" disabled>{t('dashboard.updateStatus')}</option>
                        {FARMER_STATUSES.filter(s => s !== o.status).map(s => (
                          <option key={s} value={s}>{STATUS_ICON[s]} {s}</option>
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
        <div style={{ fontSize: 16, fontWeight: 700, color: '#2d6a4f', marginBottom: 12 }}>🏷️ Bundle Discounts</div>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
          Buyers who order multiple different products from you get an automatic discount. Add tiers below (e.g. 3+ products = 10% off).
        </p>
        {bdMsg && (
          <div style={{ ...s.msg, background: bdMsg.type === 'ok' ? '#d8f3dc' : '#fee', color: bdMsg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>
            {bdMsg.text}
          </div>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBdMsg(null);
            try {
              await api.createBundleDiscount({ min_products: parseInt(bdForm.min_products, 10), discount_percent: parseFloat(bdForm.discount_percent) });
              setBdForm({ min_products: '', discount_percent: '' });
              const res = await api.getBundleDiscounts();
              setBundleDiscounts(res.data ?? []);
              setBdMsg({ type: 'ok', text: 'Discount tier added.' });
            } catch (err) { setBdMsg({ type: 'error', text: err.message }); }
          }}
          style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}
        >
          <div>
            <label style={s.label}>Min. distinct products</label>
            <input style={{ ...s.input, width: 120 }} type="number" min="2" placeholder="e.g. 3" value={bdForm.min_products} onChange={(e) => setBdForm((f) => ({ ...f, min_products: e.target.value }))} required />
          </div>
          <div>
            <label style={s.label}>Discount %</label>
            <input style={{ ...s.input, width: 120 }} type="number" min="0.01" max="100" step="0.01" placeholder="e.g. 10" value={bdForm.discount_percent} onChange={(e) => setBdForm((f) => ({ ...f, discount_percent: e.target.value }))} required />
          </div>
          <button type="submit" style={s.btn}>Add Tier</button>
        </form>
        {bundleDiscounts.length === 0 ? (
          <div style={{ color: '#888', fontSize: 13 }}>No discount tiers configured.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #eee', color: '#555' }}>Min. products</th>
                <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #eee', color: '#555' }}>Discount</th>
                <th style={{ padding: '8px 10px', borderBottom: '2px solid #eee' }}></th>
              </tr>
            </thead>
            <tbody>
              {bundleDiscounts.map((bd) => (
                <tr key={bd.id}>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid #f0f0f0' }}>{bd.min_products}+ products</td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid #f0f0f0', color: '#2d6a4f', fontWeight: 600 }}>{bd.discount_percent}% off</td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid #f0f0f0', textAlign: 'right' }}>
                    <button
                      style={{ background: '#fee', color: '#c0392b', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}
                      onClick={async () => {
                        if (!confirm('Delete this discount tier?')) return;
                        try {
                          await api.deleteBundleDiscount(bd.id);
                          const res = await api.getBundleDiscounts();
                          setBundleDiscounts(res.data ?? []);
                        } catch (err) { setBdMsg({ type: 'error', text: err.message }); }
                      }}
                    >Delete</button>
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
          {pendingTxs.map(tx => (
            <div key={tx.id} style={{ borderBottom: '1px solid #ffe082', padding: '10px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{tx.coopName} — {tx.amount} XLM</div>
                <div style={{ fontSize: 12, color: '#888' }}>To: {tx.destination?.slice(0, 12)}… · {tx.signatures.length} signature(s) collected</div>
                <div style={{ fontSize: 11, color: '#aaa' }}>Expires: {new Date(tx.expires_at).toLocaleString()}</div>
              </div>
              <button
                style={{ ...s.btn, fontSize: 13, padding: '6px 14px', background: signingTxId === tx.id ? '#888' : '#2d6a4f' }}
                disabled={signingTxId === tx.id}
                onClick={async () => {
                  setSigningTxId(tx.id);
                  try {
                    const res = await api.signPendingTx(tx.id);
                    if (res.submitted) alert(`✅ Transaction submitted! TX: ${res.txHash}`);
                    else alert(`Signature added (${res.signaturesCollected}/${res.required} required)`);
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
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setQrProductId(null)}
        >
          <div
            style={{ background: '#fff', borderRadius: 16, padding: 32, maxWidth: 340, width: '90%', textAlign: 'center', boxShadow: '0 8px 32px #0003' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 18, fontWeight: 700, color: '#2d6a4f', marginBottom: 4 }}>{t('dashboard.productQr')}</div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 20 }}>{qrProductName}</div>
            <img
              src={`/api/products/${qrProductId}/qr`}
              alt={`QR code for ${qrProductName}`}
              style={{ width: 220, height: 220, borderRadius: 8, border: '1px solid #eee', marginBottom: 20 }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <a
                href={`/api/products/${qrProductId}/qr`}
                download={`product-${qrProductId}-qr.png`}
                style={{ ...s.btn, textDecoration: 'none', fontSize: 13, padding: '8px 18px', background: '#218c74' }}
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setCalendarProductId(null)}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, maxWidth: 480, width: '95%', boxShadow: '0 8px 32px #0003' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#2d6a4f', marginBottom: 4 }}>📅 Availability Calendar</div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>{calendarProductName}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {calendarWeeks.map(w => (
                <button key={w.week_start}
                  onClick={async () => {
                    setCalendarSaving(true);
                    const newAvail = !w.available;
                    await api.setCalendarWeek(calendarProductId, { week_start: w.week_start, available: newAvail }).catch(() => {});
                    setCalendarWeeks(prev => prev.map(x => x.week_start === w.week_start ? { ...x, available: newAvail } : x));
                    setCalendarSaving(false);
                  }}
                  disabled={calendarSaving}
                  style={{
                    padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                    border: '1px solid ' + (w.available ? '#2d6a4f' : '#ddd'),
                    background: w.available ? '#d8f3dc' : '#f5f5f5',
                    color: w.available ? '#2d6a4f' : '#aaa', fontWeight: 600,
                  }}>
                  {w.available ? '✓' : '✗'} {new Date(w.week_start + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>Click a week to toggle availability.</div>
            <button style={{ ...s.btn, background: '#888', fontSize: 13, padding: '8px 18px' }} onClick={() => setCalendarProductId(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
