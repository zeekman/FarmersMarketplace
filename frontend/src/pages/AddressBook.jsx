import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const s = {
  page: { maxWidth: 800, margin: '40px auto', padding: 24 },
  title: { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 24 },
  card: { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001', marginBottom: 24 },
  label: { display: 'block', fontSize: 13, marginBottom: 4, color: '#555' },
  input: { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, marginBottom: 12, boxSizing: 'border-box' },
  btn: { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600 },
  btnSm: { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  btnDanger: { background: '#fee', color: '#c0392b', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  btnSecondary: { background: '#f0f0f0', color: '#333', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  msg: { padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 14 },
  addressCard: { border: '1px solid #e0e0e0', borderRadius: 10, padding: 16, marginBottom: 12, position: 'relative' },
  defaultBadge: { position: 'absolute', top: 12, right: 12, background: '#2d6a4f', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 },
  empty: { color: '#888', fontSize: 14, textAlign: 'center', padding: 24 },
};

const EMPTY_FORM = { label: '', street: '', city: '', country: '', postal_code: '', is_default: false };

export default function AddressBook() {
  const { user } = useAuth();
  const [addresses, setAddresses] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    try {
      const res = await api.getAddresses();
      setAddresses(res.data ?? []);
    } catch {}
  }

  useEffect(() => { load(); }, []);

  function startEdit(address) {
    setEditingId(address.id);
    setForm({
      label: address.label,
      street: address.street,
      city: address.city,
      country: address.country,
      postal_code: address.postal_code || '',
      is_default: !!address.is_default,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      if (editingId) {
        await api.updateAddress(editingId, form);
        setMsg({ type: 'ok', text: 'Address updated' });
      } else {
        await api.createAddress(form);
        setMsg({ type: 'ok', text: 'Address added' });
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      load();
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this address?')) return;
    try {
      await api.deleteAddress(id);
      setMsg({ type: 'ok', text: 'Address deleted' });
      load();
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    }
  }

  async function handleSetDefault(id) {
    try {
      await api.setDefaultAddress(id);
      setMsg({ type: 'ok', text: 'Default address updated' });
      load();
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    }
  }

  if (user?.role !== 'buyer') {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <div style={s.empty}>Only buyers can manage delivery addresses.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.title}>📍 Address Book</div>

      {msg && (
        <div style={{ ...s.msg, background: msg.type === 'ok' ? '#d8f3dc' : '#fee', color: msg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>
          {msg.text}
        </div>
      )}

      {/* Add/Edit Form */}
      <div style={s.card}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>{editingId ? 'Edit Address' : 'Add New Address'}</h3>
        <form onSubmit={handleSubmit}>
          <label style={s.label}>Label (e.g., Home, Work)</label>
          <input
            style={s.input}
            value={form.label}
            onChange={e => setForm({ ...form, label: e.target.value })}
            required
            maxLength={50}
          />

          <label style={s.label}>Street Address</label>
          <input
            style={s.input}
            value={form.street}
            onChange={e => setForm({ ...form, street: e.target.value })}
            required
            maxLength={200}
          />

          <label style={s.label}>City</label>
          <input
            style={s.input}
            value={form.city}
            onChange={e => setForm({ ...form, city: e.target.value })}
            required
            maxLength={100}
          />

          <label style={s.label}>Country</label>
          <input
            style={s.input}
            value={form.country}
            onChange={e => setForm({ ...form, country: e.target.value })}
            required
            maxLength={100}
          />

          <label style={s.label}>Postal Code (optional)</label>
          <input
            style={s.input}
            value={form.postal_code}
            onChange={e => setForm({ ...form, postal_code: e.target.value })}
            maxLength={20}
          />

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.is_default}
              onChange={e => setForm({ ...form, is_default: e.target.checked })}
            />
            <span style={{ fontSize: 14, color: '#555' }}>Set as default address</span>
          </label>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" style={s.btn} disabled={loading}>
              {loading ? 'Saving...' : (editingId ? 'Update Address' : 'Add Address')}
            </button>
            {editingId && (
              <button type="button" style={s.btnSecondary} onClick={cancelEdit}>Cancel</button>
            )}
          </div>
        </form>
      </div>

      {/* Address List */}
      <div style={s.card}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>My Addresses ({addresses.length})</h3>
        {addresses.length === 0 ? (
          <div style={s.empty}>No addresses yet. Add your first delivery address above.</div>
        ) : (
          addresses.map(addr => (
            <div key={addr.id} style={s.addressCard}>
              {addr.is_default ? <div style={s.defaultBadge}>Default</div> : null}
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{addr.label}</div>
              <div style={{ fontSize: 14, color: '#555', marginBottom: 4 }}>
                {addr.street}, {addr.city}, {addr.country}
                {addr.postal_code ? ` ${addr.postal_code}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button style={s.btnSm} onClick={() => startEdit(addr)}>Edit</button>
                {!addr.is_default && (
                  <button style={s.btnSecondary} onClick={() => handleSetDefault(addr.id)}>Set Default</button>
                )}
                <button style={s.btnDanger} onClick={() => handleDelete(addr.id)}>Delete</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
