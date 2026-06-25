import React, { useRef, useState, useEffect, useCallback } from 'react';

const HANDLE = 8;
const ASPECT_RATIO = 4 / 3;
const MIN_CROP_PX = 300;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

const HANDLE_ORDER = ['body', 'tl', 'tr', 'bl', 'br'];

export default function ImageCropModal({ src, onConfirm, onCancel, isGalleryImage = false }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [aspectLocked, setAspectLocked] = useState(true);
  const [validationError, setValidationError] = useState(null);
  const [activeHandle, setActiveHandle] = useState('body');
  const drag = useRef(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !loaded) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    const { x, y, w, h } = crop;
    ctx.fillRect(0, 0, canvas.width, y);
    ctx.fillRect(0, y + h, canvas.width, canvas.height - y - h);
    ctx.fillRect(0, y, x, h);
    ctx.fillRect(x + w, y, canvas.width - x - w, h);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(x + (w / 3) * i, y); ctx.lineTo(x + (w / 3) * i, y + h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y + (h / 3) * i); ctx.lineTo(x + w, y + (h / 3) * i); ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(([hx, hy]) => {
      ctx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
    });
  }, [crop, loaded]);

  useEffect(() => { draw(); }, [draw]);

  function initCrop(cw, ch) {
    const maxW = cw * 0.85;
    const maxH = ch * 0.85;
    let w, h;
    if (maxW / maxH > ASPECT_RATIO) {
      h = maxH;
      w = h * ASPECT_RATIO;
    } else {
      w = maxW;
      h = w / ASPECT_RATIO;
    }
    setCrop({ x: (cw - w) / 2, y: (ch - h) / 2, w, h });
  }

  function onImgLoad() {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    const maxW = 480, maxH = 480;
    const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    setLoaded(true);
    initCrop(canvas.width, canvas.height);
  }

  function hitTest(mx, my) {
    const { x, y, w, h } = crop;
    const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
    for (const [cx, cy] of corners) {
      if (Math.abs(mx - cx) <= HANDLE && Math.abs(my - cy) <= HANDLE) return 'resize';
    }
    if (mx >= x && mx <= x + w && my >= y && my <= y + h) return 'move';
    return null;
  }

  function getPos(e) {
    const r = canvasRef.current.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { mx: src.clientX - r.left, my: src.clientY - r.top };
  }

  function onDown(e) {
    e.preventDefault();
    const { mx, my } = getPos(e);
    const type = hitTest(mx, my);
    if (!type) return;
    drag.current = { type, sx: mx, sy: my, ox: crop.x, oy: crop.y, ow: crop.w, oh: crop.h };
  }

  function onMove(e) {
    if (!drag.current) return;
    e.preventDefault();
    const { mx, my } = getPos(e);
    const { type, sx, sy, ox, oy, ow, oh } = drag.current;
    const cw = canvasRef.current.width, ch = canvasRef.current.height;
    const dx = mx - sx, dy = my - sy;
    if (type === 'move') {
      setCrop(c => ({
        ...c,
        x: clamp(ox + dx, 0, cw - c.w),
        y: clamp(oy + dy, 0, ch - c.h),
      }));
    } else {
      const nw = clamp(ow + dx, 20, cw - ox);
      if (aspectLocked) {
        const nh = clamp(nw / ASPECT_RATIO, 20, ch - oy);
        setCrop(c => ({ ...c, w: nh * ASPECT_RATIO, h: nh }));
      } else {
        const nh = clamp(oh + dy, 20, ch - oy);
        setCrop(c => ({ ...c, w: nw, h: nh }));
      }
    }
  }

  function onUp() { drag.current = null; }

  function handleKeyDown(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      setActiveHandle(current => {
        const idx = HANDLE_ORDER.indexOf(current);
        const next = e.shiftKey
          ? (idx - 1 + HANDLE_ORDER.length) % HANDLE_ORDER.length
          : (idx + 1) % HANDLE_ORDER.length;
        return HANDLE_ORDER[next];
      });
      return;
    }

    const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (!canvasRef.current || !ARROWS.includes(e.key)) return;
    e.preventDefault();

    const STEP = 3;
    const dx = e.key === 'ArrowRight' ? STEP : e.key === 'ArrowLeft' ? -STEP : 0;
    const dy = e.key === 'ArrowDown' ? STEP : e.key === 'ArrowUp' ? -STEP : 0;
    const cw = canvasRef.current.width;
    const ch = canvasRef.current.height;

    setCrop(prev => {
      let { x, y, w, h } = prev;
      switch (activeHandle) {
        case 'body':
          x = clamp(x + dx, 0, cw - w);
          y = clamp(y + dy, 0, ch - h);
          break;
        case 'tl': {
          const nx = clamp(x + dx, 0, x + w - 20);
          w = w + (x - nx);
          x = nx;
          const ny = clamp(y + dy, 0, y + h - 20);
          h = h + (y - ny);
          y = ny;
          break;
        }
        case 'tr':
          w = clamp(w + dx, 20, cw - x);
          { const ny = clamp(y + dy, 0, y + h - 20); h = h + (y - ny); y = ny; }
          break;
        case 'bl': {
          const nx = clamp(x + dx, 0, x + w - 20);
          w = w + (x - nx);
          x = nx;
          h = clamp(h + dy, 20, ch - y);
          break;
        }
        case 'br':
          w = clamp(w + dx, 20, cw - x);
          h = clamp(h + dy, 20, ch - y);
          break;
        default:
          break;
      }
      if (aspectLocked) {
        h = w / ASPECT_RATIO;
        if (y + h > ch) { h = ch - y; w = h * ASPECT_RATIO; }
      }
      return { x, y, w, h };
    });
  }

  function handleConfirm() {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    const scaleX = img.naturalWidth / canvas.width;
    const scaleY = img.naturalHeight / canvas.height;

    const naturalW = Math.round(crop.w * scaleX);
    const naturalH = Math.round(crop.h * scaleY);

    if (naturalW < MIN_CROP_PX || naturalH < MIN_CROP_PX) {
      setValidationError(`Crop must be at least ${MIN_CROP_PX}×${MIN_CROP_PX} px. Current: ${naturalW}×${naturalH} px.`);
      return;
    }
    setValidationError(null);

    const out = document.createElement('canvas');
    out.width = naturalW;
    out.height = naturalH;
    out.getContext('2d').drawImage(
      img,
      crop.x * scaleX, crop.y * scaleY, crop.w * scaleX, crop.h * scaleY,
      0, 0, out.width, out.height,
    );
    out.toBlob(blob => {
      if (!blob) { setValidationError('Failed to generate image.'); return; }
      if (blob.size > MAX_SIZE_BYTES) { setValidationError('Image exceeds the 5 MB limit.'); return; }
      if (!ALLOWED_TYPES.includes(blob.type)) { setValidationError('Unsupported format. Use JPEG, PNG, or WebP.'); return; }
      onConfirm(blob);
    }, 'image/jpeg', 0.92);
  }

  const handleLabel = { body: 'Move crop', tl: 'Top-left handle', tr: 'Top-right handle', bl: 'Bottom-left handle', br: 'Bottom-right handle' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 24, maxWidth: 540, width: '95%', boxShadow: '0 8px 32px #0004' }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: '#2d6a4f', marginBottom: 12 }}>Crop Image</div>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>
          Drag the box to move · drag a corner to resize · Tab cycles handles · arrow keys nudge
        </div>

        {isGalleryImage && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12, cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={aspectLocked}
              onChange={e => setAspectLocked(e.target.checked)}
            />
            Lock 4:3 aspect ratio
          </label>
        )}

        <div style={{ fontSize: 12, color: '#2d6a4f', marginBottom: 8 }}>
          Active handle: <strong>{handleLabel[activeHandle]}</strong>
        </div>

        <div style={{ overflowX: 'auto', marginBottom: 16 }}>
          <canvas
            ref={canvasRef}
            tabIndex={0}
            role="application"
            aria-label="Image crop tool. Tab cycles between handles. Arrow keys move or resize the crop area."
            style={{ display: 'block', cursor: 'crosshair', touchAction: 'none', maxWidth: '100%', outline: 'none' }}
            onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
            onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
            onKeyDown={handleKeyDown}
          />
        </div>

        <img ref={imgRef} src={src} onLoad={onImgLoad} style={{ display: 'none' }} alt="" />

        {validationError && (
          <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12, padding: '8px 12px', background: '#fef2f2', borderRadius: 6, border: '1px solid #fecaca' }}>
            {validationError}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
          <button onClick={handleConfirm} disabled={!loaded} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: '#2d6a4f', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Use Crop</button>
        </div>
      </div>
    </div>
  );
}
