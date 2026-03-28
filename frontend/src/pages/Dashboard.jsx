import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { validateProduct } from '../utils/validation';
import { getErrorMessage } from '../utils/errorMessages';
import { useTranslation } from 'react-i18next';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_MB = 5;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
const FARMER_STATUSES = ['processing', 'shipped', 'delivered'];
const MAX_IMAGES = 5;

const STATUS_ICON = { pending: '⏳', paid: '✅', processing: '⚙️', shipped: '🚚', delivered: '📦', failed: '❌' };
const STATUS_COLOR = { paid: '#2d6a4f', pending: '#856404', processing: '#004085', shipped: '#0c5460', delivered: '#155724', failed: '#c0392b' };

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
  address: { fontSize: 12, color: '#888', marginTop: 4, fontStyle: 'italic' },
  // image upload
  uploadZone: {
    border: '2px dashed #b7e4c7', borderRadius: 10, padding: '18px 12px',
    textAlign: 'center', cursor: 'pointer', marginBottom: 12,
    background: '#f8fdf9', color: '#555', fontSize: 13, transition: 'border-color 0.2s',
  },
  uploadZoneActive: { borderColor: '#2d6a4f', background: '#edf7f0' },
  preview: { width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 8, marginBottom: 8, display: 'block' },
  removeImg: { background: 'none', border: 'none', color: '#c0392b', cursor: 'pointer', fontSize: 12, marginBottom: 12 },
  imgErr: { color: '#c0392b', fontSize: 12, marginBottom: 8 },
  fieldErr: { color: '#c0392b', fontSize: 12, marginBottom: 8 },
  uploading: { color: '#888', fontSize: 12, marginBottom: 8 },
  csvBtn: { background: '#218c74', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, marginRight: 8 },
  csvInput: { display: 'none' },
  csvResult: { padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 14 },
  productThumb: { width: 36, height: 36, objectFit: 'cover', borderRadius: 6, marginRight: 10, verticalAlign: 'middle' },
  // gallery manager
  galleryPanel: { background: '#f8fdf9', border: '1px solid #b7e4c7', borderRadius: 10, padding: 14, marginTop: 10 },
  galleryThumb: { width: 72, height: 72, objectFit: 'cover', borderRadius: 6, border: '2px solid #ddd', display: 'block' },
  galleryThumbFirst: { border: '2px solid #2d6a4f' },
  galleryItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, position: 'relative' },
  galleryGrid: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 },
  imgDelBtn: { background: '#fee', color: '#c0392b', border: 'none', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', fontSize: 11 },
  arrowBtn: { background: 'none', border: '1px solid #ddd', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', fontSize: 12 },
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
  const { t } = useTranslation();
  const { user } = useAuth();
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [restockVals, setRestockVals] = useState({});
  const [msg, setMsg] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [sales, setSales] = useState([]);
  const [salesMsg, setSalesMsg] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  async function load() {
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

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [productsRes, salesRes, profileRes, bundlesRes, couponsRes, coopsRes] = await Promise.all([
        api.getMyProducts().catch(() => ({ data: [] })),
        api.getSales().catch(() => ({ data: [] })),
        user?.id ? api.getFarmer(user.id).catch(() => ({})) : Promise.resolve({}),
        api.getBundles().catch(() => ({ data: [] })),
        api.getMyCoupons().catch(() => ({ data: [] })),
        api.getCooperatives().catch(() => ({ data: [] })),
      ]);

      setProducts(productsRes.data ?? productsRes);
      setSales(salesRes.data ?? salesRes);
      setBundles((bundlesRes.data ?? []).filter(b => b.farmer_id === user?.id));
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
    setFormErrors({});

    // Validate price and quantity
    const errors = {};
    const price = parseFloat(form.price);
    const quantity = parseInt(form.quantity, 10);

    if (!form.name || !form.name.trim()) {
      errors.name = 'Product name is required';
    }
    if (!form.price || isNaN(price) || price <= 0) {
      errors.price = 'Price must be a positive number';
    }
    if (!form.quantity || isNaN(quantity) || quantity <= 0) {
      errors.quantity = 'Quantity must be a positive integer';
    }
    if (form.is_preorder && !form.preorder_delivery_date) {
      errors.preorder_delivery_date = 'Delivery date is required for pre-order products';
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    // Client-side validation
    const errs = validateProduct(form);
    if (Object.keys(errs).length > 0) { setFormErrors(errs); return; }
    setFormErrors({});

    // Upload image first if one is selected but not yet uploaded
    let finalImageUrl = imageUrl;
    if (imageFile && !imageUrl) {
      setUploading(true);
      try {
        const res = await api.uploadProductImage(imageFile);
        finalImageUrl = res.imageUrl;
        setImageUrl(res.imageUrl);
      } catch (err) {
        setUploading(false);
        setMsg({ type: 'err', text: `Image upload failed: ${getErrorMessage(err)}` });
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
      // Vitamins can be added later if needed

      await api.createProduct({
        ...form,
        price: parseFloat(form.price),
        quantity: parseInt(form.quantity),
        is_preorder: form.is_preorder ? 1 : 0,
        preorder_delivery_date: form.is_preorder ? form.preorder_delivery_date : null,
        image_url: finalImageUrl || undefined,
        nutrition: Object.keys(nutritionData).length > 0 ? nutritionData : undefined,
      });
      setMsg({ type: 'ok', text: t('dashboard.productListedOk') });
      setForm(EMPTY_FORM);
      removeImage();
      load();
    } catch (err) {
      setMsg({ type: 'err', text: getErrorMessage(err) });
    }
  }

  async function handleDelete(id) {
    if (!confirm(t('dashboard.removeProductConfirm'))) return;
    try { await api.deleteProduct(id); load(); } catch {}
  }

  async function handleRestock(id) {
    const qty = parseInt(restockVals[id], 10);
    if (isNaN(qty) || qty <= 0) return alert(t('dashboard.restockInvalid'));
    try {
      await api.restockProduct(id, qty);
      setRestockVals({ ...restockVals, [id]: '' });
      load();
    } catch (err) {
      alert(err.message);
    }
  }

      alert(getErrorMessage(err));
  async function handleStatusUpdate(orderId, status) {
    try {
      await api.updateOrderStatus(orderId, status);
      setSalesMsg(prev => ({ ...prev, [orderId]: { type: 'ok', text: `Updated to ${status}` } }));
      load();
    } catch (e) {
      setSalesMsg(prev => ({ ...prev, [orderId]: { type: 'err', text: e.message } }));
    }
  }

  if (loading) return <Spinner />;
  
  if (error) {
    return (
      <div style={s.page}>
        <div style={{ ...s.msg, background: '#fee', color: '#c0392b', marginBottom: 16 }}>
          <strong>{t('dashboard.errorLoading')}</strong> {error}
        </div>
      </div>
    );
  async function handleCsvUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.csv')) {
      setCsvResult({ type: 'err', text: 'Please upload a .csv file' });
      return;
    }
    setCsvFile(file);
    setCsvUploading(true);
    setCsvResult(null);
    try {
      const res = await api.bulkUploadProducts(file);
      setCsvResult({
        type: 'ok',
        text: `Upload complete: ${res.created} created, ${res.skipped} skipped, ${res.errors?.length || 0} errors`,
        details: res.errors,
      });
      load();
    } catch (err) {
      setCsvResult({ type: 'err', text: err.message });
    } finally {
      setCsvUploading(false);
      setCsvFile(null);
      if (csvInputRef.current) csvInputRef.current.value = '';
    }
  }

  function downloadCsvTemplate() {
    const csv = 'name,description,price,quantity,unit,category\nOrganic Tomatoes,Fresh organic tomatoes,2.50,100,kg,vegetables\nFree Range Eggs,Farm fresh eggs,5.00,50,dozen,dairy\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'product-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
<div style={s.page}>
      <div style={s.title}>{user?.role === 'admin' ? t('dashboard.adminTitle') : t('dashboard.title')}</div>
      {user.role === 'admin' && (
        <div style={{ ...s.card, marginBottom: 24 }}> 
          <h3 style={{ marginBottom: 16, color: '#333' }}>{t('dashboard.contractStateViewer')}</h3>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
            <div style={{ flex: 1, minWidth: 300 }}>
              <label style={s.label}>{t('dashboard.contractId')}</label>
              <input
                style={s.input}
                value={contractId}
                onChange={(e) => setContractId(e.target.value)}
                placeholder="e.g. CB64..."
              />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={s.label}>{t('dashboard.keyPrefix')}</label>
              <input
                style={s.input}
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="e.g. ADMIN_ or hex"
              />
            </div>
            <button style={s.btn} onClick={loadContractState} disabled={loadingState}>
              {loadingState ? t('dashboard.loading') : t('dashboard.loadState')}
            </button>
          </div>
          {stateErr && <div style={{ ...s.msg, background: '#fee', color: '#c0392b', marginTop: 12 }}>{stateErr}</div>}
          {stateEntries.length > 0 && (
            <div style={{ marginTop: 16, maxHeight: 400, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f8f9fa' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #eee' }}>{t('dashboard.key')}</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #eee' }}>{t('dashboard.value')}</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #eee' }}>{t('dashboard.durability')}</th>
                  </tr>
                </thead>
                <tbody>
                  {stateEntries.map((entry, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{entry.key}</td>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', maxWidth: 300, wordBreak: 'break-all' }}>{entry.val}</td>
                      <td style={{ padding: '8px 12px' }}>{entry.durability}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <div style={s.grid}>
        {user.role === 'farmer' && (
          <div style={s.card}>
            <h3 style={{ marginBottom: 16, color: '#333' }}>{t('dashboard.addProduct')}</h3>
          {msg && (
            <div style={{ ...s.msg, background: msg.type === 'ok' ? '#d8f3dc' : '#fee', color: msg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>
              {msg.text}
            </div>
          )}
          <form onSubmit={handleAdd}>
            {[['name', t('dashboard.productName')], ['price', t('dashboard.price')], ['quantity', t('dashboard.quantity')], ['unit', t('dashboard.unit')]].map(([key, label]) => (
              <div key={key}>
                <label style={s.label}>{label}</label>
                <input
                  style={{ ...s.input, borderColor: formErrors[key] ? '#c0392b' : '#ddd' }}
                  value={form[key]}
                  onChange={e => {
                    setForm({ ...form, [key]: e.target.value });
                    if (formErrors[key]) setFormErrors({ ...formErrors, [key]: undefined });
                  style={formErrors[key] ? s.inputErr : s.input}
                  value={form[key]}
                  type={key === 'price' || key === 'quantity' ? 'number' : 'text'}
                  min={key === 'price' || key === 'quantity' ? '0' : undefined}
                  step={key === 'price' ? 'any' : undefined}
                  onChange={e => {
                    setForm({ ...form, [key]: e.target.value });
                    if (formErrors[key]) setFormErrors(fe => ({ ...fe, [key]: '' }));
                  }}
                  required={key !== 'unit'}
                  type={key === 'price' || key === 'quantity' ? 'number' : 'text'}
                  step={key === 'price' ? 'any' : undefined}
                  type={key === 'price' || key === 'quantity' ? 'number' : undefined}
                  step={key === 'price' ? '0.01' : key === 'quantity' ? '1' : undefined}
                  min={key === 'price' || key === 'quantity' ? '0' : undefined}
                />
                {formErrors[key] && <div style={{ ...s.imgErr, marginTop: -8, marginBottom: 4 }}>{formErrors[key]}</div>}
                {formErrors[key] && <div style={s.fieldErr} role="alert">{formErrors[key]}</div>}
              </div>
            ))}

            <label style={s.label}>{t('dashboard.description')}</label>
            <textarea style={s.textarea} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />

            <label style={s.label}>{t('dashboard.category')}</label>
            <select style={s.input} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {['vegetables', 'fruits', 'grains', 'dairy', 'herbs', 'other'].map(c => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>

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
          <h3 style={{ marginBottom: 16, color: '#333' }}>{t('dashboard.myListings', { count: products.length })}</h3>
          {products.length === 0 && <p style={{ color: '#888', fontSize: 14 }}>{t('dashboard.noProducts')}</p>}
          {products.map(p => (
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

      {/* Bundle Listings */}
      {user.role === 'farmer' && (
        <div style={{ ...s.card, marginTop: 24 }}>
          <h3 style={{ marginBottom: 16, color: '#333' }}>🎁 Bundle Deals</h3>
          {bundleMsg && (
            <div style={{ ...s.msg, background: bundleMsg.type === 'ok' ? '#d8f3dc' : '#fee', color: bundleMsg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>
              {bundleMsg.text}
            </div>
          )}
          <form onSubmit={async e => {
            e.preventDefault();
            setBundleMsg(null);
            const items = bundleForm.items.filter(i => i.product_id && i.quantity > 0).map(i => ({ product_id: parseInt(i.product_id), quantity: parseInt(i.quantity) }));
            if (!bundleForm.name.trim()) return setBundleMsg({ type: 'err', text: 'Bundle name is required' });
            if (items.length === 0) return setBundleMsg({ type: 'err', text: 'Add at least one product item' });
            try {
              await api.createBundle({ name: bundleForm.name, description: bundleForm.description, price: parseFloat(bundleForm.price), items });
              setBundleMsg({ type: 'ok', text: 'Bundle created!' });
              setBundleForm({ name: '', description: '', price: '', items: [{ product_id: '', quantity: 1 }] });
              load();
            } catch (err) { setBundleMsg({ type: 'err', text: err.message }); }
          }}>
            <label style={s.label}>Bundle Name</label>
            <input style={s.input} value={bundleForm.name} onChange={e => setBundleForm(f => ({ ...f, name: e.target.value }))} required />
            <label style={s.label}>Description (optional)</label>
            <textarea style={s.textarea} value={bundleForm.description} onChange={e => setBundleForm(f => ({ ...f, description: e.target.value }))} />
            <label style={s.label}>Bundle Price (XLM)</label>
            <input style={s.input} type="number" min="0" step="any" value={bundleForm.price} onChange={e => setBundleForm(f => ({ ...f, price: e.target.value }))} required />
            <label style={{ ...s.label, marginTop: 8 }}>Items</label>
            {bundleForm.items.map((item, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                <select
                  style={{ ...s.input, flex: 2, marginBottom: 0 }}
                  value={item.product_id}
                  onChange={e => setBundleForm(f => { const items = [...f.items]; items[idx] = { ...items[idx], product_id: e.target.value }; return { ...f, items }; })}
                >
                  <option value="">Select product…</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.quantity} {p.unit})</option>)}
                </select>
                <input
                  type="number" min="1" placeholder="Qty"
                  style={{ ...s.input, width: 70, marginBottom: 0 }}
                  value={item.quantity}
                  onChange={e => setBundleForm(f => { const items = [...f.items]; items[idx] = { ...items[idx], quantity: parseInt(e.target.value) || 1 }; return { ...f, items }; })}
                />
                {bundleForm.items.length > 1 && (
                  <button type="button" style={s.del} onClick={() => setBundleForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))}>✕</button>
                )}
              </div>
            ))}
            <button type="button" style={{ ...s.btn, background: '#555', fontSize: 12, padding: '5px 12px', marginBottom: 12 }}
              onClick={() => setBundleForm(f => ({ ...f, items: [...f.items, { product_id: '', quantity: 1 }] }))}>
              + Add Item
            </button>
            <br />
            <button style={s.btn} type="submit">Create Bundle</button>
          </form>

          {bundles.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: '#555' }}>My Bundles ({bundles.length})</div>
              {bundles.map(b => (
                <div key={b.id} style={{ ...s.product, flexDirection: 'column', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{b.name}</div>
                      <div style={{ fontSize: 13, color: '#666' }}>{b.price} XLM · {b.items?.length} item(s)</div>
                    </div>
                    <button style={s.del} onClick={async () => {
                      if (!confirm('Remove this bundle?')) return;
                      try { await api.deleteBundle(b.id); load(); } catch {}
                    }}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      )}

      {/* Coupon Management */}
      <div style={{ ...s.card, marginTop: 24 }}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>🏷️ Coupon Codes</h3>
        {couponMsg && (
          <div style={{ ...s.msg, background: couponMsg.type === 'ok' ? '#d8f3dc' : '#fee', color: couponMsg.type === 'ok' ? '#2d6a4f' : '#c0392b', marginBottom: 12 }}>
            {couponMsg.text}
          </div>
        )}
        <form style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }} onSubmit={async e => {
          e.preventDefault();
          setCouponMsg(null);
          try {
            await api.createCoupon({
              code: couponForm.code.trim(),
              discount_type: couponForm.discount_type,
              discount_value: parseFloat(couponForm.discount_value),
              max_uses: couponForm.max_uses ? parseInt(couponForm.max_uses) : undefined,
              expires_at: couponForm.expires_at || undefined,
            });
            setCouponMsg({ type: 'ok', text: 'Coupon created!' });
            setCouponForm({ code: '', discount_type: 'percent', discount_value: '', max_uses: '', expires_at: '' });
            const res = await api.getMyCoupons();
            setCoupons(res.data ?? []);
          } catch (err) { setCouponMsg({ type: 'err', text: err.message }); }
        }}>
          <div>
            <label style={s.label}>Code</label>
            <input style={s.input} placeholder="e.g. SUMMER10" value={couponForm.code} onChange={e => setCouponForm(f => ({ ...f, code: e.target.value }))} required />
          </div>
          <div>
            <label style={s.label}>Type</label>
            <select style={s.input} value={couponForm.discount_type} onChange={e => setCouponForm(f => ({ ...f, discount_type: e.target.value }))}>
              <option value="percent">Percent (%)</option>
              <option value="fixed">Fixed (XLM)</option>
            </select>
          </div>
          <div>
            <label style={s.label}>Value</label>
            <input style={s.input} type="number" min="0.01" step="any" placeholder={couponForm.discount_type === 'percent' ? '10' : '1.5'} value={couponForm.discount_value} onChange={e => setCouponForm(f => ({ ...f, discount_value: e.target.value }))} required />
          </div>
          <div>
            <label style={s.label}>Max Uses (optional)</label>
            <input style={s.input} type="number" min="1" placeholder="Unlimited" value={couponForm.max_uses} onChange={e => setCouponForm(f => ({ ...f, max_uses: e.target.value }))} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={s.label}>Expires At (optional)</label>
            <input style={s.input} type="datetime-local" value={couponForm.expires_at} onChange={e => setCouponForm(f => ({ ...f, expires_at: e.target.value }))} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <button style={s.btn} type="submit">Create Coupon</button>
          </div>
        </form>
        {coupons.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #eee', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Code</th>
                <th style={{ padding: '6px 8px' }}>Discount</th>
                <th style={{ padding: '6px 8px' }}>Uses</th>
                <th style={{ padding: '6px 8px' }}>Expires</th>
                <th style={{ padding: '6px 8px' }}></th>
              </tr>
            </thead>
            <tbody>
              {coupons.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{c.code}</td>
                  <td style={{ padding: '6px 8px' }}>{c.discount_type === 'percent' ? `${c.discount_value}%` : `${c.discount_value} XLM`}</td>
                  <td style={{ padding: '6px 8px' }}>{c.used_count}{c.max_uses ? ` / ${c.max_uses}` : ''}</td>
                  <td style={{ padding: '6px 8px' }}>{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '—'}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <button style={s.del} onClick={async () => {
                      if (!confirm('Delete this coupon?')) return;
                      try { await api.deleteCoupon(c.id); setCoupons(cs => cs.filter(x => x.id !== c.id)); } catch {}
                    }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {coupons.length === 0 && <div style={{ color: '#aaa', fontSize: 13 }}>No coupons yet.</div>}
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
