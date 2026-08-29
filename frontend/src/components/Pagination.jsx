import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const s = {
  wrap:    { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 24, flexWrap: 'wrap' },
  btn:     { padding: '7px 13px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 13, color: '#444', transition: 'all 0.15s' },
  active:  { background: '#2d6a4f', color: '#fff', border: '1px solid #2d6a4f', fontWeight: 700 },
  disabled:{ opacity: 0.4, cursor: 'default' },
  info:    { fontSize: 13, color: '#888', marginLeft: 8 },
  srOnly:  { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 },
};

/**
 * Offset-based pagination controls.
 * Props: page, totalPages, total, limit, onChange(newPage)
 */
export default function Pagination({ page, totalPages, total, limit, onChange }) {
  const containerRef = useRef(null);
  const { t } = useTranslation();

  if (!totalPages || totalPages <= 1) return null;

  // Clamp page to a valid range so stale props don't render out-of-range buttons
  const safePage = Math.max(1, Math.min(page, totalPages));
  const pages = buildPageList(safePage, totalPages);

  const goPrev = useCallback(() => {
    if (safePage > 1) onChange(safePage - 1);
  }, [safePage, onChange]);

  const goNext = useCallback(() => {
    if (safePage < totalPages) onChange(safePage + 1);
  }, [safePage, totalPages, onChange]);

  // Keyboard navigation: left/right arrow keys
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goPrev();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      goNext();
    }
  }, [goPrev, goNext]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <nav aria-label="Pagination" ref={containerRef}>
      <div style={s.wrap}>
        <button
          style={{ ...s.btn, ...(safePage <= 1 ? s.disabled : {}) }}
          disabled={safePage <= 1}
          onClick={goPrev}
          aria-label="Previous page"
        >
          ‹ Prev
        </button>

        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`ellipsis-${i}`} style={{ ...s.btn, cursor: 'default', border: 'none' }} aria-hidden="true">…</span>
          ) : (
            <button
              key={p}
              style={{ ...s.btn, ...(p === safePage ? s.active : {}) }}
              onClick={() => p !== safePage && onChange(p)}
              aria-label={`Page ${p}`}
              aria-current={p === safePage ? 'page' : undefined}
            >
              {p}
            </button>
          )
        )}

        <button
          style={{ ...s.btn, ...(safePage >= totalPages ? s.disabled : {}) }}
          disabled={safePage >= totalPages}
          onClick={goNext}
          aria-label="Next page"
        >
          Next ›
        </button>

        <span style={s.info} className="pagination-info" aria-hidden="true">
          {t('pagination.resultCount', { count: total })}
        </span>
      </div>
    </nav>
  );
}

/** Returns a compact page list with ellipsis for large ranges. */
function buildPageList(current, total) {
  // Clamp current to a valid range so stale callers don't produce out-of-range buttons
  if (current < 1) current = 1;
  if (current > total) current = total;

  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = new Set([1, total, current]);
  for (let d = -2; d <= 2; d++) {
    const p = current + d;
    if (p >= 1 && p <= total) pages.add(p);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const result = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('…');
    result.push(sorted[i]);
  }
  return result;
}
