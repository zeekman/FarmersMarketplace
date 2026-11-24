import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Displays a star rating (read-only or interactive).
 * Props:
 *   value      - current rating (0–5, supports decimals for display)
 *   max        - max stars (default 5)
 *   size       - font size (default 16)
 *   onChange   - if provided, renders an interactive radio group
 *   count      - optional review count to show alongside
 *   label      - accessible name of the interactive group (default "Rating")
 *
 * Interactive mode is a WAI-ARIA radio group (#1502): one tab stop, arrow keys
 * / Home / End move and select, each star is labelled "4 out of 5 stars".
 */
export default function StarRating({ value = 0, max = 5, size = 16, onChange, count, label = 'Rating' }) {
  const { t } = useTranslation();
  const stars = Array.from({ length: max }, (_, i) => i + 1);
  const refs = useRef([]);
  const interactive = typeof onChange === 'function';
  const selected = Math.round(Number(value) || 0);

  function select(star) {
    const next = Math.min(max, Math.max(1, star));
    onChange(next);
    refs.current[next - 1]?.focus();
  }

  function onKeyDown(e, star) {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        e.preventDefault();
        select(star + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        e.preventDefault();
        select(star - 1);
        break;
      case 'Home':
        e.preventDefault();
        select(1);
        break;
      case 'End':
        e.preventDefault();
        select(max);
        break;
      case ' ':
      case 'Enter':
        e.preventDefault();
        select(star);
        break;
      default:
    }
  }

  const numeric = Number(value) || 0;
  const shown = Number.isInteger(numeric) ? numeric : numeric.toFixed(1);
  const summary = t('starRating.ratedOutOf', { value: shown, max });
  const countText = count === undefined ? '' : count > 0 ? `, ${count} review${count === 1 ? '' : 's'}` : ', no reviews';

  const groupProps = interactive
    ? { role: 'radiogroup', 'aria-label': label }
    : { role: 'img', 'aria-label': `${summary}${countText}` };

  return (
    <span {...groupProps} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      {stars.map((star) => {
        const filled = value >= star;
        const half = !filled && value >= star - 0.5;
        const checked = interactive && selected === star;
        const focusable = checked || (interactive && selected < 1 && star === 1);
        const a11y = interactive
          ? {
              role: 'radio',
              'aria-checked': checked,
              'aria-label': `${star} out of ${max} stars`,
              tabIndex: focusable ? 0 : -1,
              onKeyDown: (e) => onKeyDown(e, star),
              ref: (el) => { refs.current[star - 1] = el; },
            }
          : { 'aria-hidden': true };
        return (
          <span
            key={star}
            {...a11y}
            onClick={interactive ? () => onChange(star) : undefined}
            style={{
              fontSize: size,
              cursor: interactive ? 'pointer' : 'default',
              color: half ? 'transparent' : filled ? '#f5a623' : '#ddd',
              // Half star: gold left half, grey right half, clipped to the glyph.
              ...(half && {
                backgroundImage: 'linear-gradient(90deg, #f5a623 50%, #ddd 50%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
              }),
              lineHeight: 1,
              userSelect: 'none',
            }}
          >
            ★
          </span>
        );
      })}
      {count !== undefined && (
        <span aria-hidden={!interactive} style={{ fontSize: size * 0.8, color: '#595959', marginLeft: 4 }}>
          {value > 0 ? `${Number(value).toFixed(1)}` : ''}
          {count > 0 ? ` (${count})` : ' No reviews'}
        </span>
      )}
    </span>
  );
}
