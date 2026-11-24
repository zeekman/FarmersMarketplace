import React from 'react';

const DAY_MS = 24 * 60 * 60 * 1000;
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

// Colour pairs already audited for WCAG AA in BadgeContrast.test.jsx
const TONES = {
  urgent: { color: '#b42318', background: '#fee2e2' }, // 5.38:1
  soon: { color: '#7a3d00', background: '#ffe0b2' }, // 6.64:1
  fresh: { color: '#155724', background: '#d4edda' }, // 7.48:1
};

// Read a YYYY-MM-DD (or pg ISO timestamp) as the user's local calendar day.
// new Date('YYYY-MM-DD') parses as UTC and shifts a day for users west of UTC.
function toLocalDay(value) {
  if (!value) return null;
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// Math.round absorbs the 23h/25h days around DST changes.
function daysBetween(from, to) {
  return Math.round((to - from) / DAY_MS);
}

export function describeFreshness(harvestDate, bestBefore, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const expiry = toLocalDay(bestBefore);
  if (expiry) {
    const days = daysBetween(today, expiry);
    if (days < 0) return null; // expired; the backend already hides these
    if (days === 0) return { icon: '⚠️', text: 'Expires today', ...TONES.urgent };
    if (days < 7) {
      const weekday = expiry.toLocaleDateString(undefined, { weekday: 'short' });
      return { icon: '🗓', text: `Best before ${weekday}`, ...TONES.soon };
    }
    const date = expiry.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return { icon: '🗓', text: `Best before ${date}`, ...TONES.fresh };
  }

  const harvest = toLocalDay(harvestDate);
  if (harvest) {
    const days = daysBetween(harvest, today);
    if (days < 0) return null;
    return { icon: '🌱', text: `Harvested ${relative.format(-days, 'day')}`, ...TONES.fresh };
  }

  return null;
}

export default function FreshnessBadge({ harvestDate, bestBefore }) {
  const info = describeFreshness(harvestDate, bestBefore);
  if (!info) return null;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        borderRadius: 4,
        padding: '2px 7px',
        marginBottom: 8,
        color: info.color,
        background: info.background,
      }}
    >
      <span aria-hidden="true">{info.icon}</span>
      <span>{info.text}</span>
    </div>
  );
}
