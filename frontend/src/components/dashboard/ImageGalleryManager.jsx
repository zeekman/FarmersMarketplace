import React, { useState, useRef } from 'react';
import { api } from '../../api/client';

const s = {
  container: { marginTop: 16, marginBottom: 16 },
  title: { fontSize: 14, fontWeight: 600, color: '#333', marginBottom: 8 },
  gallery: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  thumb: {
    position: 'relative',
    width: 80,
    height: 80,
    borderRadius: 8,
    overflow: 'hidden',
    cursor: 'grab',
    border: '2px solid #ddd',
    flexShrink: 0,
  },
  thumbDrag: { border: '2px solid #2d6a4f', opacity: 0.7 },
  img: { width: '100%', height: '100%', objectFit: 'cover' },
  coverBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    background: '#2d6a4f',
    color: '#fff',
    fontSize: 11,
    padding: '2px 6px',
    borderRadius: 4,
    fontWeight: 600,
  },
  deleteBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    background: '#c0392b',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    padding: '2px 6px',
    fontSize: 11,
    cursor: 'pointer',
    fontWeight: 600,
  },
  msg: { fontSize: 12, padding: '8px 12px', borderRadius: 6, marginBottom: 8 },
  ok: { background: '#d8f3dc', color: '#2d6a4f' },
  err: { background: '#fee', color: '#c0392b' },
};

// Stable identity for a gallery entry: prefer the server id, fall back to the
// URL (entries may be plain URL strings). Never the array index, since the list
// is reordered and items are deleted.
function imageKey(img) {
  if (typeof img === 'string') return img;
  return img.id ?? img.url;
}

export default function ImageGalleryManager({ productId, images = [], onUpdate }) {
  const [galleries, setGalleries] = useState(images);
  const [draggedIdx, setDraggedIdx] = useState(null);
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const committedRef = useRef(images);

  function handleDragStart(idx) {
    setDraggedIdx(idx);
  }

  function handleDragOver(e) {
    e.preventDefault();
  }

  function handleDrop(idx) {
    if (draggedIdx === null || draggedIdx === idx) return;
    const newGalleries = [...galleries];
    const [moved] = newGalleries.splice(draggedIdx, 1);
    newGalleries.splice(idx, 0, moved);
    setGalleries(newGalleries);
    setDraggedIdx(null);
  }

  function handleDelete(key) {
    const newGalleries = galleries.filter((img) => imageKey(img) !== key);
    setGalleries(newGalleries);
  }

  async function handleSave() {
    if (!productId) return;
    setSaving(true);
    setMsg(null);
    const prevGalleries = committedRef.current;
    try {
      const order = galleries.map((img) => (typeof img === 'string' ? img : img.url));
      await api.reorderProductImages(productId, order);
      committedRef.current = galleries;
      setMsg({ type: 'ok', text: 'Gallery order saved!' });
      if (onUpdate) onUpdate(galleries);
      setTimeout(() => setMsg(null), 2500);
    } catch (e) {
      setGalleries(prevGalleries);
      setMsg({ type: 'err', text: e.message || 'Failed to save gallery order' });
    } finally {
      setSaving(false);
    }
  }

  if (!galleries || galleries.length === 0) return null;

  return (
    <div style={s.container}>
      <div style={s.title}>Product Gallery (Drag to reorder)</div>
      {msg && <div style={{ ...s.msg, ...(msg.type === 'ok' ? s.ok : s.err) }}>{msg.text}</div>}
      <div style={s.gallery}>
        {galleries.map((img, idx) => {
          const imgUrl = typeof img === 'string' ? img : img.url;
          return (
            <div
              key={imageKey(img)}
              style={{ ...s.thumb, ...(draggedIdx === idx ? s.thumbDrag : {}) }}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(idx)}
            >
              <img src={imgUrl} alt={`Gallery ${idx}`} style={s.img} />
              {idx === 0 && <div style={s.coverBadge}>Cover</div>}
              <button
                type="button"
                style={s.deleteBtn}
                aria-label={`Remove gallery image ${idx + 1}`}
                onClick={() => handleDelete(imageKey(img))}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
      {galleries.length > 1 && (
        <button
          style={{
            ...s.deleteBtn,
            background: '#2d6a4f',
            marginTop: 8,
            padding: '6px 12px',
            fontSize: 12,
          }}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save Gallery Order'}
        </button>
      )}
    </div>
  );
}
