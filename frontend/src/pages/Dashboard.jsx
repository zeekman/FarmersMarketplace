import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { validateProduct } from '../utils/validation';
import { getErrorMessage } from '../utils/errorMessages';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_MB = 5;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
const FARMER_STATUSES = ['processing', 'shipped', 'delivered'];
const MAX_IMAGES = 5;

const STATUS_ICON = { pending: '⏳', paid: '✅', processing: '⚙️', shipped: '🚚', delivered: '📦', failed: '❌' };
const STATUS_COLOR = { paid: '#2d6a4f', pending: '#856404', processing: '#004085', shipped: '#0c5460', delivered: '#155724', failed: '#c0392b' };

const s = {
  page: { maxWidth: 900, margin: '0 auto', padding: 24 },
  title: { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 24 },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 },
  card: { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001' },
  label: { display: 'block', fontSize: 13, marginBottom: 4, color: '#555' },
  input: { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, marginBottom: 4, boxSizing: 'border-box' },
  inputErr: { width: '100%', padding: '9px 12px', border: '1px solid #c0392b', borderRadius: 8, fontSize: 14, marginBottom: 4, boxSizing: 'border-box' },
  fieldErr: { color: '#c0392b', fontSize: 12, marginBottom: 8 },
  textarea: { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, marginBottom: 4, minHeight: 80, resize: 'vertical', boxSizing: 'border-box' },
  btn: { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600 },
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

const EMPTY_FORM = { name: '', description: '', price: '', quantity: '', unit: 'kg', category: 'other' };

import { useAuth } from '../context/AuthContext';

export default function Dashboard() {
  const { user } = useAuth();
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [restockVals, setRestockVals] = useState({});
  const [msg, setMsg] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [sales, setSales] = useState([]);
  const [salesMsg, setSalesMsg] = useState({});

  // image state
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [imageErr, setImageErr] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // profile state
  const [profile, setProfile]       = useState({ bio: '', location: '', avatar_url: '' });
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
    if (!confirm('Delete this image?')) return;
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
    try {
      const res = await api.getMyProducts();
      setProducts(res.data ?? res);
    } catch {}
    try {
      const res = await api.getSales();
      setSales(res.data ?? res);
    } catch {}
  }

  useEffect(() => {
    load();
    // Load current profile
    if (user?.id) {
      api.getFarmer(user.id)
        .then(res => {
          const d = res.data;
          setProfile({ bio: d.bio || '', location: d.location || '', avatar_url: d.avatar_url || '' });
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
      });
      setProfile({ bio: res.data.bio || '', location: res.data.location || '', avatar_url: res.data.avatar_url || '' });
      setProfileMsg({ type: 'ok', text: 'Profile updated' });
    } catch (err) {
      setProfileMsg({ type: 'err', text: getErrorMessage(err) });
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    setMsg(null);

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
      await api.createProduct({
        ...form,
        price: parseFloat(form.price),
        quantity: parseInt(form.quantity),
        image_url: finalImageUrl || undefined,
      });
      setMsg({ type: 'ok', text: 'Product listed successfully' });
      setForm(EMPTY_FORM);
      removeImage();
      load();
    } catch (err) {
      setMsg({ type: 'err', text: getErrorMessage(err) });
    }
  }

  async function handleDelete(id) {
    if (!confirm('Remove this product?')) return;
    try { await api.deleteProduct(id); load(); } catch {}
  }

  async function handleRestock(id) {
    const qty = parseInt(restockVals[id], 10);
    if (isNaN(qty) || qty <= 0) return alert('Enter a valid positive number to restock.');
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
      <div style={s.title}>{user?.role === 'admin' ? '🔧 Admin Dashboard' : '🌾 Farmer Dashboard'}</div>
      {user.role === 'admin' && (
        <div style={{ ...s.card, marginBottom: 24 }}> 
          <h3 style={{ marginBottom: 16, color: '#333' }}>📋 Contract State Viewer</h3>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
            <div style={{ flex: 1, minWidth: 300 }}>
              <label style={s.label}>Contract ID</label>
              <input
                style={s.input}
                value={contractId}
                onChange={(e) => setContractId(e.target.value)}
                placeholder="e.g. CB64..."
              />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={s.label}>Key Prefix (optional)</label>
              <input
                style={s.input}
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="e.g. ADMIN_ or hex"
              />
            </div>
            <button style={s.btn} onClick={loadContractState} disabled={loadingState}>
              {loadingState ? 'Loading...' : 'Load State'}
            </button>
          </div>
          {stateErr && <div style={{ ...s.msg, background: '#fee', color: '#c0392b', marginTop: 12 }}>{stateErr}</div>}
          {stateEntries.length > 0 && (
            <div style={{ marginTop: 16, maxHeight: 400, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f8f9fa' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #eee' }}>Key</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #eee' }}>Value</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #eee' }}>Durability</th>
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
            <h3 style={{ marginBottom: 16, color: '#333' }}>Add New Product</h3>
          {msg && (
            <div style={{ ...s.msg, background: msg.type === 'ok' ? '#d8f3dc' : '#fee', color: msg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>
              {msg.text}
            </div>
          )}
          <form onSubmit={handleAdd}>
            {[['name', 'Product Name'], ['price', 'Price (XLM)'], ['quantity', 'Quantity'], ['unit', 'Unit (kg, bunch, etc.)']].map(([key, label]) => (
              <div key={key}>
                <label style={s.label}>{label}</label>
                <input
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
                />
                {formErrors[key] && <div style={s.fieldErr} role="alert">{formErrors[key]}</div>}
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

            {/* Image upload */}
            <label style={s.label}>Product Image <span style={{ color: '#aaa', fontWeight: 400 }}>(optional · JPEG/PNG/WebP · max 5 MB)</span></label>

            {previewUrl ? (
              <>
                <img src={previewUrl} alt="Preview" style={s.preview} />
                {uploading && <div style={s.uploading}>Uploading image...</div>}
                <button type="button" style={s.removeImg} onClick={removeImage}>✕ Remove image</button>
              </>
            ) : (
              <div
                style={{ ...s.uploadZone, ...(dragOver ? s.uploadZoneActive : {}) }}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                role="button"
                aria-label="Upload product image"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && fileInputRef.current?.click()}
              >
                📷 Click or drag &amp; drop an image here
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

            <button style={s.btn} type="submit" disabled={uploading}>
              {uploading ? 'Uploading...' : 'List Product'}
            </button>
          </form>
        </div>

        <div style={s.card}>
          <h3 style={{ marginBottom: 16, color: '#333' }}>My Listings ({products.length})</h3>
          {products.length === 0 && <p style={{ color: '#888', fontSize: 14 }}>No products yet. Add your first listing.</p>}
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
                    📷 Photos
                  </button>
                  <input
                    type="number" min="1" placeholder="+Qty"
                    style={{ ...s.input, width: 70, marginBottom: 0, padding: '4px 8px' }}
                    value={restockVals[p.id] || ''}
                    onChange={e => setRestockVals({ ...restockVals, [p.id]: e.target.value })}
                  />
                  <button style={{ ...s.btn, padding: '4px 10px', fontSize: 12, background: '#218c74' }} onClick={() => handleRestock(p.id)}>Restock</button>
                  <button style={s.del} onClick={() => handleDelete(p.id)}>Remove</button>
                </div>
              </div>

              {/* Inline gallery manager */}
              {galleryProductId === p.id && (
                <div style={s.galleryPanel}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#2d6a4f' }}>
                    Product Photos ({galleryImages.length}/{MAX_IMAGES})
                    <span style={{ fontWeight: 400, color: '#888', marginLeft: 8 }}>First image is shown on marketplace cards</span>
                  </div>
                  {galleryErr && <div style={{ color: '#c0392b', fontSize: 12, marginBottom: 8 }}>{galleryErr}</div>}
                  <div style={s.galleryGrid}>
                    {galleryImages.map((img, i) => (
                      <div key={img.id} style={s.galleryItem}>
                        <img src={img.url} alt={`Photo ${i + 1}`} style={{ ...s.galleryThumb, ...(i === 0 ? s.galleryThumbFirst : {}) }} />
                        {i === 0 && <span style={{ fontSize: 10, color: '#2d6a4f', fontWeight: 600 }}>Primary</span>}
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
                        {galleryUploading ? 'Uploading...' : '+ Add Photos'}
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
            </div>
          ))}
        </div>
      </div>

      {/* CSV Bulk Upload */}
      <div style={{ ...s.card, marginTop: 24 }}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>📤 Bulk Upload Products</h3>
        <p style={{ fontSize: 14, color: '#666', marginBottom: 16 }}>
          Upload multiple products at once using a CSV file. Maximum 500 rows per upload.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <button style={s.csvBtn} onClick={() => csvInputRef.current?.click()} disabled={csvUploading}>
            {csvUploading ? 'Uploading...' : '📁 Upload CSV'}
          </button>
          <button style={{ ...s.csvBtn, background: '#555' }} onClick={downloadCsvTemplate}>
            📥 Download Template
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
                <strong>Errors:</strong>
                <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                  {csvResult.details.slice(0, 10).map((err, i) => (
                    <li key={i}>Row {err.row}: {err.error}</li>
                  ))}
                  {csvResult.details.length > 10 && <li>...and {csvResult.details.length - 10} more errors</li>}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Profile edit */}
      <div style={{ ...s.card, marginTop: 24 }}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>My Farmer Profile</h3>
        {profileMsg && (
          <div style={{ ...s.msg, background: profileMsg.type === 'ok' ? '#d8f3dc' : '#fee', color: profileMsg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>
            {profileMsg.text}
          </div>
        )}
        <form onSubmit={handleProfileSave}>
          <label style={s.label}>Avatar</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
            {avatarPreview
              ? <img src={avatarPreview} alt="Avatar" style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover' }} />
              : <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#d8f3dc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>🌾</div>
            }
            <div>
              <button type="button" style={{ ...s.btn, fontSize: 13, padding: '7px 14px' }} onClick={() => avatarInputRef.current?.click()}>
                {avatarUploading ? 'Uploading...' : 'Change Avatar'}
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

          <label style={s.label}>Location</label>
          <input
            style={s.input}
            placeholder="e.g. Nairobi, Kenya"
            value={profile.location}
            onChange={e => setProfile(p => ({ ...p, location: e.target.value }))}
            maxLength={100}
          />

          <label style={s.label}>Bio</label>
          <textarea
            style={s.textarea}
            placeholder="Tell buyers about your farm..."
            value={profile.bio}
            onChange={e => setProfile(p => ({ ...p, bio: e.target.value }))}
            maxLength={500}
          />

          <button style={s.btn} type="submit" disabled={avatarUploading}>Save Profile</button>
        </form>

      {/* Order management panel */}
      <div style={{ ...s.card, marginTop: 24 }}>
        <h3 style={{ padding: '16px 20px', borderBottom: '1px solid #eee', margin: 0, color: '#333' }}>
          📋 Incoming Orders ({sales.length})
        </h3>
        {sales.length === 0 ? (
          <p style={{ padding: '20px', color: '#888', fontSize: 14 }}>No orders yet.</p>
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
                        <option value="" disabled>Update status…</option>
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
    </div>
  );
}
