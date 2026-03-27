import React from 'react';

/**
 * Displays a star rating (read-only or interactive).
 * Props:
 *   value      - current rating (0–5, supports decimals for display)
 *   max        - max stars (default 5)
 *   size       - font size (default 16)
 *   onChange   - if provided, renders interactive stars
 *   count      - optional review count to show alongside
 */
export default function StarRating({ value = 0, max = 5, size = 16, onChange, count }) {
  const stars = Array.from({ length: max }, (_, i) => i + 1);

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      {stars.map((star) => {
        const filled = value >= star;
        const half = !filled && value >= star - 0.5;
        return (
          <span
            key={star}
            onClick={onChange ? () => onChange(star) : undefined}
            style={{
              fontSize: size,
              cursor: onChange ? 'pointer' : 'default',
              color: filled || half ? '#f5a623' : '#ddd',
              lineHeight: 1,
              userSelect: 'none',
            }}
          >
            {half ? '½' : '★'}
          </span>
        );
      })}
      {count !== undefined && (
        <span style={{ fontSize: size * 0.8, color: '#888', marginLeft: 4 }}>
          {value > 0 ? `${Number(value).toFixed(1)}` : ''}
          {count > 0 ? ` (${count})` : ' No reviews'}
        </span>
      )}
    </span>
  );
}
