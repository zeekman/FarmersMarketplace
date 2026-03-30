import React, { useEffect, useState } from 'react';
import { api } from '../api/client';

const s = {
  page: { maxWidth: 900, margin: '0 auto', padding: 16 },
  title: { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 24 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 24 },
  card: { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001' },
  label: { display: 'block', fontSize: 13, marginBottom: 4, color: '#555' },
  input: { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, marginBottom: 12 },
  textarea: { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, marginBottom: 12, minHeight: 80, resize: 'vertical' },
  btn: { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600 },
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
  is_preorder: false,
  preorder_delivery_date: '',
  nutrition: {
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
    fiber: '',
    vitamins: {},
  },
};

import { useAuth } from '../context/AuthContext';

export default function Dashboard() {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ name: '', description: '', price: '', quantity: '', unit: 'kg', category: 'other' });
  const [msg, setMsg] = useState(null);
  const [auctionForm, setAuctionForm] = useState({ product_id: '', start_price: '', ends_at: '' });
  const [auctionMsg, setAuctionMsg] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [sales, setSales] = useState([]);
  const [salesMsg, setSalesMsg] = useState({});
  const [forecastByProduct, setForecastByProduct] = useState({});
  const [videoUploadingByProduct, setVideoUploadingByProduct] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [flashSaleForm, setFlashSaleForm] = useState({ product_id: '', flash_sale_price: '', flash_sale_ends_at: '' });
  const [flashSaleMsg, setFlashSaleMsg] = useState(null);

  // bundle state
  const [bundles, setBundles] = useState([]);
  const [bundleForm, setBundleForm] = useState({ name: '', description: '', price: '', items: [{ product_id: '', quantity: 1 }] });
  const [bundleMsg, setBundleMsg] = useState(null);

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

  async function handleGalleryUpload(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const invalid = files.find(f => !ALLOWED_TYPES.includes(f.type) || f.size > MAX_SIZE_BYTES);
    if (invalid) return setGalleryErr('Only JPEG/PNG/WebP up to 5 MB each.');
    if (galleryImages.length + files.length > MAX_IMAGES)
      return setGalleryErr(`Max ${MAX_IMAGES} images. You have ${galleryImages.length}.`);
    setGalleryUploading(true);
    setGalleryErr('');
    try {
      const res = await api.uploadProductImages(galleryProductId, files);
      setGalleryImages(res.data ?? []);
      load();
    } catch (e) { setGalleryErr(e.message); }
    setGalleryUploading(false);
  }

  async function handleGalleryDelete(imgId) {
    if (!confirm(t('dashboard.deleteImageConfirm'))) return;
    try {
      await api.deleteProductImage(galleryProductId, imgId);
      const res = await api.getProductImages(galleryProductId);
      setGalleryImages(res.data ?? []);
      load();
    } catch (e) { setGalleryErr(e.message); }
  }

  async function handleGalleryMove(index, dir) {
    const imgs = [...galleryImages];
    const swapIdx = index + dir;
    if (swapIdx < 0 || swapIdx >= imgs.length) return;
    [imgs[index], imgs[swapIdx]] = [imgs[swapIdx], imgs[index]];
    const order = imgs.map((img, i) => ({ id: img.id, sort_order: i }));
    try {
      const res = await api.reorderProductImages(galleryProductId, order);
      setGalleryImages(res.data ?? imgs);
      load();
    } catch (e) { setGalleryErr(e.message); }
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
    try { setProducts(await api.getMyProducts()); } catch { /* ignore */ }
  }

  useEffect(() => { load(); }, []);
  function closeGallery() {
    setGalleryProductId(null);
    setGalleryImages([]);
    setGalleryErr('');
  }

  async function handleGalleryUpload(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const invalid = files.find(f => !ALLOWED_TYPES.includes(f.type) || f.size > MAX_SIZE_BYTES);
    if (invalid) return setGalleryErr('Only JPEG/PNG/WebP up to 5 MB each.');
    if (galleryImages.length + files.length > MAX_IMAGES)
      return setGalleryErr(`Max ${MAX_IMAGES} images. You have ${galleryImages.length}.`);
    setGalleryUploading(true);
    setGalleryErr('');
    try {
      const res = await api.uploadProductImages(galleryProductId, files);
      setGalleryImages(res.data ?? []);
      load();
    } catch (e) { setGalleryErr(e.message); }
    setGalleryUploading(false);
  }

  async function handleGalleryDelete(imgId) {
    if (!confirm(t('dashboard.deleteImageConfirm'))) return;
    try {
      await api.deleteProductImage(galleryProductId, imgId);
      const res = await api.getProductImages(galleryProductId);
      setGalleryImages(res.data ?? []);
      load();
    } catch (e) { setGalleryErr(e.message); }
  }

  async function handleGalleryMove(index, dir) {
    const imgs = [...galleryImages];
    const swapIdx = index + dir;
    if (swapIdx < 0 || swapIdx >= imgs.length) return;
    [imgs[index], imgs[swapIdx]] = [imgs[swapIdx], imgs[index]];
    const order = imgs.map((img, i) => ({ id: img.id, sort_order: i }));
    try {
      const res = await api.reorderProductImages(galleryProductId, order);
      setGalleryImages(res.data ?? imgs);
      load();
    } catch (e) { setGalleryErr(e.message); }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [productsRes, salesRes, profileRes, bundlesRes, forecastRes] = await Promise.all([
      const [productsRes, salesRes, profileRes, bundlesRes, couponsRes] = await Promise.all([
      const [productsRes, salesRes, profileRes, bundlesRes, couponsRes, coopsRes] = await Promise.all([
        api.getMyProducts().catch(() => ({ data: [] })),
        api.getSales().catch(() => ({ data: [] })),
        user?.id ? api.getFarmer(user.id).catch(() => ({})) : Promise.resolve({}),
        api.getBundles().catch(() => ({ data: [] })),
        api.getForecast().catch(() => ({ data: [] })),
        api.getMyCoupons().catch(() => ({ data: [] })),
        api.getCooperatives().catch(() => ({ data: [] })),
      ]);

      setProducts(productsRes.data ?? productsRes);
      setSales(salesRes.data ?? salesRes);
      setBundles((bundlesRes.data ?? []).filter(b => b.farmer_id === user?.id));

      const forecastMap = {};
      (forecastRes.data ?? []).forEach((item) => {
        forecastMap[item.product_id] = item;
      });
      setForecastByProduct(forecastMap);
      setCoupons(couponsRes.data ?? []);
      const coops = coopsRes.data ?? [];
      setCooperatives(coops);

      // Load pending transactions for all cooperatives
      const allPending = await Promise.all(
        coops.map(c => api.getPendingTxs(c.id).then(r => (r.data ?? []).map(t => ({ ...t, coopName: c.name }))).catch(() => []))
      );
      setPendingTxs(allPending.flat().filter(t => t.status === 'pending' && !t.alreadySigned));

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
  }, []);

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
    try {
      await api.createProduct({ ...form, price: parseFloat(form.price), quantity: parseInt(form.quantity) });
      setMsg({ type: 'ok', text: 'Product listed successfully' });
      setForm({ name: '', description: '', price: '', quantity: '', unit: 'kg', category: 'other' });
      // Prepare nutrition data
      const nutritionData = {};
      if (form.nutrition.calories) nutritionData.calories = parseFloat(form.nutrition.calories);
      if (form.nutrition.protein) nutritionData.protein = parseFloat(form.nutrition.protein);
      if (form.nutrition.carbs) nutritionData.carbs = parseFloat(form.nutrition.carbs);
      if (form.nutrition.fat) nutritionData.fat = parseFloat(form.nutrition.fat);
      if (form.nutrition.fiber) nutritionData.fiber = parseFloat(form.nutrition.fiber);
      // Vitamins can be added later if needed

      await api.createProduct({
        ...form,
        price: parseFloat(form.price),
        quantity: parseInt(form.quantity),
        is_preorder: form.is_preorder ? 1 : 0,
        preorder_delivery_date: form.is_preorder ? form.preorder_delivery_date : null,
        image_url: finalImageUrl || undefined,
        nutrition: Object.keys(nutritionData).length > 0 ? nutritionData : undefined,
        pricing_type: form.pricing_type || 'unit',
        min_weight: form.pricing_type === 'weight' ? parseFloat(form.min_weight) : undefined,
        max_weight: form.pricing_type === 'weight' ? parseFloat(form.max_weight) : undefined,
      });
      setMsg({ type: 'ok', text: t('dashboard.productListedOk') });
      setForm(EMPTY_FORM);
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

  return (
    <div style={s.page}>
      <div style={s.title}>🌾 Farmer Dashboard</div>
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
      <div style={s.grid}>
        <div style={s.card}>
          <h3 style={{ marginBottom: 16, color: '#333' }}>Add New Product</h3>
          {msg && <div style={{ ...s.msg, background: msg.type === 'ok' ? '#d8f3dc' : '#fee', color: msg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>{msg.text}</div>}
          <form onSubmit={handleAdd}>
            {[['name', 'Product Name'], ['price', 'Price (XLM)'], ['quantity', 'Quantity'], ['unit', 'Unit (kg, bunch, etc.)']].map(([key, label]) => (
              <div key={key}>
                <label style={s.label}>{label}</label>
                <input style={s.input} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} required={key !== 'unit'} />
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
              <button style={s.del} onClick={() => handleDelete(p.id)}>Remove</button>
            <div key={p.id} style={{ ...s.product, flexDirection: 'column', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  {p.image_url
                    ? <img src={p.image_url} alt={p.name} style={s.productThumb} />
                    : <span style={{ fontSize: 28, marginRight: 10 }}>🥬</span>
                  }
                  <div>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: 13, color: '#666' }}>{p.price} XLM · {p.quantity} {p.unit}</div>
                    {forecastByProduct[p.id]?.note ? (
                      <div style={{ fontSize: 12, color: '#888' }}>{forecastByProduct[p.id].note}</div>
                    ) : forecastByProduct[p.id] ? (
                      <div style={{ fontSize: 12, color: '#555' }}>
                        Demand hint: {forecastByProduct[p.id].avg_weekly_sales} units/week {' '}
                        {forecastByProduct[p.id].trend === 'up' ? '↑' : forecastByProduct[p.id].trend === 'down' ? '↓' : '→'}
                      </div>
                    ) : null}
                    {p.video_url ? (
                      <a href={p.video_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#2d6a4f' }}>
                        View video
                      </a>
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
                  <button style={s.del} onClick={() => handleDelete(p.id)}>{t('dashboard.remove')}</button>
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
