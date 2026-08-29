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
  defaultBadge: { position: 'absolute', top: 12, right: 12, background: '#2d6a4f', color: '#fff', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, letterSpacing: 0.3 },
  empty: { color: '#888', fontSize: 14, textAlign: 'center', padding: 24 },
  overlay: { position: 'fixed', inset: 0, background: '#0005', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#fff', borderRadius: 12, padding: 28, maxWidth: 480, width: '90%', boxShadow: '0 4px 24px #0003', maxHeight: '90vh', overflowY: 'auto' },
  modalTitle: { fontWeight: 700, fontSize: 17, marginBottom: 16, color: '#2d6a4f' },
};

const EMPTY_FORM = { label: '', street: '', city: '', country: '', postal_code: '', is_default: false };

function AddressFormModal({ initial, onSave, onCancel, loading }) {
  const [form, setForm] = useState(initial || EMPTY_FORM);
  const isEdit = Boolean(initial);

  React.useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  function handleSubmit(e) {
    e.preventDefault();
    onSave(form);
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="addr-modal-title" style={s.overlay}>
      <div style={s.modal}>
        <div id="addr-modal-title" style={s.modalTitle}>{isEdit ? 'Edit Address' : 'Add New Address'}</div>
        <form onSubmit={handleSubmit}>
          <label style={s.label}>Label (e.g., Home, Work)</label>
          <input
            style={s.input}
            value={form.label}
            onChange={e => setForm({ ...form, label: e.target.value })}
            required
            maxLength={50}
            autoFocus
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

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.is_default}
              onChange={e => setForm({ ...form, is_default: e.target.checked })}
            />
            <span style={{ fontSize: 14, color: '#555' }}>Set as default address</span>
          </label>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" style={s.btnSecondary} onClick={onCancel}>Cancel</button>
            <button type="submit" style={s.btn} disabled={loading}>
              {loading ? 'Saving...' : (isEdit ? 'Update Address' : 'Add Address')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteConfirmDialog({ onConfirm, onCancel }) {
  const cancelRef = React.useRef(null);

  React.useEffect(() => {
    cancelRef.current?.focus();
    function onKey(e) { if (e.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="del-dialog-title"
      style={s.overlay}
    >
      <div style={{ background: '#fff', borderRadius: 12, padding: 28, maxWidth: 380, width: '90%', boxShadow: '0 4px 24px #0003' }}>
        <div id="del-dialog-title" style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>Delete Address</div>
        <p style={{ fontSize: 14, color: '#555', marginBottom: 20 }}>
          Are you sure you want to delete this address? This cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button ref={cancelRef} style={s.btnSecondary} onClick={onCancel}>Cancel</button>
          <button style={s.btnDanger} onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}

export default function AddressBook() {
  const { user } = useAuth();
  const [addresses, setAddresses] = useState([]);
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState(null); // null = adding new

  async function load() {
    try {
      const res = await api.getAddresses();
      setAddresses(res.data ?? []);
    } catch { /* ignore */ }
  }

  useEffect(() => { load(); }, []);

  function openAdd() {
    setEditingAddress(null);
    setModalOpen(true);
  }

  function openEdit(address) {
    setEditingAddress(address);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingAddress(null);
  }

  async function handleSave(form) {
    setMsg(null);
    setLoading(true);
    try {
      if (editingAddress) {
        await api.updateAddress(editingAddress.id, form);
        setMsg({ type: 'ok', text: 'Address updated' });
      } else {
        await api.createAddress(form);
        setMsg({ type: 'ok', text: 'Address added' });
      }
      closeModal();
      load();
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function confirmDelete() {
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    try {
      await api.deleteAddress(id);
      setMsg({ type: 'ok', text: 'Address deleted' });
      load();
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    }
  }

  async function handleSetDefault(id) {
    // optimistic update
    setAddresses(prev => prev.map(a => ({ ...a, is_default: a.id === id ? 1 : 0 })));
    try {
      await api.setDefaultAddress(id);
      setMsg({ type: 'ok', text: 'Default address updated' });
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
      load(); // revert on error
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={s.title}>📍 Address Book</div>
        <button style={s.btn} onClick={openAdd}>+ Add Address</button>
      </div>

      {msg && (
        <div style={{ ...s.msg, background: msg.type === 'ok' ? '#d8f3dc' : '#fee', color: msg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>
          {msg.text}
        </div>
      )}

      <div style={s.card}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>My Addresses ({addresses.length})</h3>
        {addresses.length === 0 ? (
          <div style={s.empty}>No addresses yet. Add your first delivery address.</div>
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
                <button style={s.btnSm} onClick={() => openEdit(addr)}>Edit</button>
                {!addr.is_default && (
                  <button style={s.btnSecondary} onClick={() => handleSetDefault(addr.id)}>Set Default</button>
                )}
                <button style={s.btnDanger} onClick={() => setConfirmDeleteId(addr.id)}>Delete</button>
              </div>
            </div>
          ))
        )}
      </div>

      {modalOpen && (
        <AddressFormModal
          initial={editingAddress ? {
            label: editingAddress.label,
            street: editingAddress.street,
            city: editingAddress.city,
            country: editingAddress.country,
            postal_code: editingAddress.postal_code || '',
            is_default: !!editingAddress.is_default,
          } : null}
          onSave={handleSave}
          onCancel={closeModal}
          loading={loading}
        />
      )}

      {confirmDeleteId && (
        <DeleteConfirmDialog
          onConfirm={confirmDelete}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </div>
  );
}
