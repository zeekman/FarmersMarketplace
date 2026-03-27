import React from 'react';

const s = {
  wrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 24,
    flexWrap: 'wrap',
  },
  btn: {
    padding: '7px 13px',
    borderRadius: 8,
    border: '1px solid #ddd',
    background: '#fff',
    cursor: 'pointer',
    fontSize: 13,
    color: '#444',
    transition: 'all 0.15s',
  },
  active: { background: '#2d6a4f', color: '#fff', border: '1px solid #2d6a4f', fontWeight: 700 },
  disabled: { opacity: 0.4, cursor: 'default' },
  info: { fontSize: 13, color: '#888', marginLeft: 8 },
};

/**
 * Offset-based pagination controls.
 * Props: page, totalPages, total, limit, onChange(newPage)
 */
export default function Pagination({ page, totalPages, total, limit, onChange }) {
  if (!totalPages || totalPages <= 1) return null;

  const pages = buildPageList(page, totalPages);

  return (
    <div style={s.wrap}>
      <button
        style={{ ...s.btn, ...(page <= 1 ? s.disabled : {}) }}
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        ‹ Prev
      </button>

      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`ellipsis-${i}`} style={{ ...s.btn, cursor: 'default', border: 'none' }}>
            …
          </span>
        ) : (
          <button
            key={p}
            style={{ ...s.btn, ...(p === page ? s.active : {}) }}
            onClick={() => p !== page && onChange(p)}
          >
            {p}
          </button>
        )
      )}

      <button
        style={{ ...s.btn, ...(page >= totalPages ? s.disabled : {}) }}
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Next ›
      </button>

      <span style={s.info}>
        {total} result{total !== 1 ? 's' : ''}
      </span>
    </div>
  );
}

/** Returns a compact page list with ellipsis for large ranges. */
function buildPageList(current, total) {
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
