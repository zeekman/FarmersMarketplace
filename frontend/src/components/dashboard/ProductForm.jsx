import React, { useState, useRef } from 'react';
import ImageCropModal from '../ImageCropModal';
import { api } from '../../api/client';
import { useXlmRate } from '../../utils/useXlmRate';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from '../../utils/errorMessages';

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
  nutrition: { calories: '', protein: '', carbs: '', fat: '', fiber: '', vitamins: {} },
  harvest_date: '',
  best_before: '',
  available_from: '',
  available_until: '',
};

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_MB = 5;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

const s = {
  label: { display: 'block', fontSize: 13, marginBottom: 4, color: '#555' },
  input: { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 16, marginBottom: 4, boxSizing: 'border-box', minHeight: 44 },
  inputErr: { width: '100%', padding: '9px 12px', border: '1px solid #c0392b', borderRadius: 8, fontSize: 16, marginBottom: 4, boxSizing: 'border-box', minHeight: 44 },
  fieldErr: { color: '#c0392b', fontSize: 12, marginBottom: 8 },
  textarea: { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, marginBottom: 4, minHeight: 80, resize: 'vertical', boxSizing: 'border-box' },
  btn: { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, minHeight: 44 },
  msg: { padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 14 },
  preview: { width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 8, marginBottom: 8, display: 'block' },
  uploading: { fontSize: 13, color: '#666', marginBottom: 4 },
  removeImg: { background: 'none', border: '1px solid #ddd', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, color: '#c0392b', marginBottom: 8 },
  uploadZone: { border: '2px dashed #ddd', borderRadius: 8, padding: '24px 16px', textAlign: 'center', cursor: 'pointer', color: '#888', fontSize: 14, marginBottom: 8 },
  uploadZoneActive: { borderColor: '#2d6a4f', background: '#f0faf4' },
  imgErr: { color: '#c0392b', fontSize: 12, marginBottom: 8 },
};

export default function ProductForm({ harvestBatches, onProductAdded }) {
  const { t } = useTranslation();
  const { usd } = useXlmRate();

  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [msg, setMsg] = useState(null);
  const [formErrors, setFormErrors] = useState({});

  const [batchForm, setBatchForm] = useState({ batch_code: '', harvest_date: '', notes: '' });
  const [batchMsg, setBatchMsg] = useState(null);

  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [imageErr, setImageErr] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [cropSrc, setCropSrc] = useState(null);
  const fileInputRef = useRef(null);

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
    setCropSrc(URL.createObjectURL(file));
    setImageUrl(null);
    return true;
  }

  function handleCropConfirm(blob) {
    const croppedFile = new File([blob], 'product-image.jpg', { type: 'image/jpeg' });
    setImageFile(croppedFile);
    setPreviewUrl(URL.createObjectURL(croppedFile));
    setCropSrc(null);
  }

  function handleCropCancel() {
    setCropSrc(null);
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (file) validateAndSetImage(file);
    e.target.value = '';
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
      await api.createHarvestBatch({ batch_code: code, harvest_date: date, notes: batchForm.notes.trim() || undefined });
      setBatchForm({ batch_code: '', harvest_date: '', notes: '' });
      setBatchMsg({ type: 'ok', text: 'Harvest batch created.' });
      onProductAdded?.();
    } catch (err) {
      setBatchMsg({ type: 'err', text: getErrorMessage(err) });
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    setMsg(null);
    const newErrors = {};
    if (form.is_preorder) {
      if (!form.preorder_delivery_date) {
        newErrors.preorder_delivery_date = 'Date must be in YYYY-MM-DD format';
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(form.preorder_delivery_date)) {
        newErrors.preorder_delivery_date = 'Date must be in YYYY-MM-DD format';
      }
    }
    if (Object.keys(newErrors).length > 0) { setFormErrors(newErrors); return; }
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
      const nutritionData = {};
      if (form.nutrition.calories) nutritionData.calories = parseFloat(form.nutrition.calories);
      if (form.nutrition.protein) nutritionData.protein = parseFloat(form.nutrition.protein);
      if (form.nutrition.carbs) nutritionData.carbs = parseFloat(form.nutrition.carbs);
      if (form.nutrition.fat) nutritionData.fat = parseFloat(form.nutrition.fat);
      if (form.nutrition.fiber) nutritionData.fiber = parseFloat(form.nutrition.fiber);

      const batchId = form.batch_id ? parseInt(form.batch_id, 10) : undefined;

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
        batch_id: Number.isFinite(batchId) ? batchId : undefined,
      });
      setMsg({ type: 'ok', text: t('dashboard.productListedOk') });
      setForm({ ...EMPTY_FORM });
      removeImage();
      onProductAdded?.();
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    }
  }

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001' }}>
      <h3 style={{ marginBottom: 16, color: '#333' }}>Add New Product</h3>
      {msg && <div style={{ ...s.msg, background: msg.type === 'ok' ? '#d8f3dc' : '#fee', color: msg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>{msg.text}</div>}
      <form onSubmit={handleAdd}>
        {[['name', 'Product Name', 'prod-name'], ['price', 'Price (XLM)', 'prod-price'], ['quantity', 'Quantity', 'prod-qty'], ['unit', 'Unit (kg, bunch, etc.)', 'prod-unit']].map(([key, label, id]) => (
          <div key={key}>
            <label style={s.label} htmlFor={id}>{label}</label>
            <input id={id} style={s.input} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} required={key !== 'unit'} />
            {key === 'price' && usd(parseFloat(form.price)) && (
              <div style={{ fontSize: 12, color: '#2d6a4f', marginBottom: 4 }}>{usd(parseFloat(form.price))} USD</div>
            )}
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
          {harvestBatches.map(b => (
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
                  style={{ padding: '5px 10px', borderRadius: 6, fontSize: 13, cursor: 'pointer', border: selected ? '1px solid #c0392b' : '1px solid #ddd', background: selected ? '#fee' : '#fff', color: selected ? '#c0392b' : '#555', fontWeight: selected ? 700 : 400 }}
                  onClick={() => setForm(f => ({ ...f, allergens: selected ? (f.allergens || []).filter(x => x !== a) : [...(f.allergens || []), a] }))}
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
                  style={{ padding: '5px 10px', borderRadius: 6, fontSize: 13, cursor: 'pointer', border: selected ? '1px solid #2d6a4f' : '1px solid #ddd', background: selected ? '#d8f3dc' : '#fff', color: selected ? '#2d6a4f' : '#555', fontWeight: selected ? 700 : 400 }}
                  onClick={() => setForm(f => ({ ...f, allowed_regions: selected ? (f.allowed_regions || []).filter(x => x !== code) : [...(f.allowed_regions || []), code] }))}
                  aria-pressed={selected}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#2d6a4f', marginBottom: 8 }}>
            Nutritional Information (Optional)
          </summary>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginTop: 8 }}>
            {[['calories', 'Calories', 'e.g. 50'], ['protein', 'Protein (g)', 'e.g. 2.5'], ['carbs', 'Carbs (g)', 'e.g. 10'], ['fat', 'Fat (g)', 'e.g. 1.2'], ['fiber', 'Fiber (g)', 'e.g. 3']].map(([field, label, placeholder]) => (
              <div key={field}>
                <label style={s.label}>{label}</label>
                <input
                  style={{ ...s.input, borderColor: formErrors.nutrition?.[field] ? '#c0392b' : '#ddd' }}
                  type="number"
                  min="0"
                  step="any"
                  value={form.nutrition[field]}
                  onChange={e => {
                    setForm({ ...form, nutrition: { ...form.nutrition, [field]: e.target.value } });
                    if (formErrors.nutrition?.[field]) setFormErrors({ ...formErrors, nutrition: { ...formErrors.nutrition, [field]: undefined } });
                  }}
                  placeholder={placeholder}
                />
                {formErrors.nutrition?.[field] && <div style={s.fieldErr}>{formErrors.nutrition[field]}</div>}
              </div>
            ))}
          </div>
        </details>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 10px', fontSize: 13, color: '#444' }}>
          <input
            type="checkbox"
            checked={!!form.is_preorder}
            onChange={e => setForm({ ...form, is_preorder: e.target.checked, preorder_delivery_date: e.target.checked ? form.preorder_delivery_date : '' })}
          />
          Mark as pre-order
        </label>

        {form.is_preorder && (
          <>
            <label style={s.label}>Expected Delivery Date</label>
            <input
              id="prod-preorder-date"
              style={formErrors.preorder_delivery_date ? s.inputErr : s.input}
              type="date"
              value={form.preorder_delivery_date}
              onChange={e => { setForm({ ...form, preorder_delivery_date: e.target.value }); if (formErrors.preorder_delivery_date) setFormErrors(fe => ({ ...fe, preorder_delivery_date: '' })); }}
              aria-invalid={!!formErrors.preorder_delivery_date}
              aria-describedby={formErrors.preorder_delivery_date ? 'prod-preorder-date-err' : undefined}
            />
            {formErrors.preorder_delivery_date && <div id="prod-preorder-date-err" style={s.fieldErr} role="alert">{formErrors.preorder_delivery_date}</div>}
          </>
        )}

        <label style={s.label}>Harvest Date (optional)</label>
        <input style={s.input} type="date" value={form.harvest_date} onChange={e => setForm({ ...form, harvest_date: e.target.value })} />

        <label style={s.label}>Best Before Date (optional)</label>
        <input style={s.input} type="date" value={form.best_before} onChange={e => setForm({ ...form, best_before: e.target.value })} />

        <label style={s.label}>Available From (optional)</label>
        <input style={s.input} type="datetime-local" value={form.available_from} onChange={e => setForm({ ...form, available_from: e.target.value })} />

        <label style={s.label}>Available Until (optional)</label>
        <input style={s.input} type="datetime-local" value={form.available_until} onChange={e => setForm({ ...form, available_until: e.target.value })} />

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
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={handleFileChange} />
        {imageErr && <div style={s.imgErr}>{imageErr}</div>}

        <button style={{ ...s.btn, width: '100%', marginTop: 8 }} type="submit" disabled={uploading || Object.keys(formErrors).length > 0}>
          {uploading ? t('dashboard.uploading') : t('dashboard.listProduct')}
        </button>
      </form>

      {cropSrc && (
        <ImageCropModal src={cropSrc} onConfirm={handleCropConfirm} onCancel={handleCropCancel} />
      )}
    </div>
  );
}
