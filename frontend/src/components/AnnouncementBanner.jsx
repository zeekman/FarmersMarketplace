import React, { useEffect, useState } from 'react';
import { api } from '../api/client';

const COLORS = {
  info:    { bg: '#dbeafe', border: '#93c5fd', color: '#1e40af' },
  warning: { bg: '#fef9c3', border: '#fde047', color: '#854d0e' },
  error:   { bg: '#fee2e2', border: '#fca5a5', color: '#991b1b' },
};

const STORAGE_KEY = 'dismissed_announcements';

function getDismissed() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}

function dismiss(id) {
  const list = getDismissed();
  if (!list.includes(id)) localStorage.setItem(STORAGE_KEY, JSON.stringify([...list, id]));
}

// Minimal markdown: bold (**text**), italic (*text*), links ([text](url))
function renderMarkdown(text) {
  const parts = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|\[(.+?)\]\((.+?)\)/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(<strong key={m.index}>{m[1]}</strong>);
    else if (m[2]) parts.push(<em key={m.index}>{m[2]}</em>);
    else parts.push(<a key={m.index} href={m[4]} target="_blank" rel="noopener noreferrer">{m[3]}</a>);
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function AnnouncementBanner() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    api.getAnnouncements()
      .then(res => {
        const dismissed = getDismissed();
        setItems((res.data || []).filter(a => !dismissed.includes(a.id)));
      })
      .catch(() => {});
  }, []);

  if (!items.length) return null;

  return (
    <div role="region" aria-label="Announcements">
      {items.map(a => {
        const c = COLORS[a.type] || COLORS.info;
        return (
          <div key={a.id} style={{ background: c.bg, borderBottom: `2px solid ${c.border}`, color: c.color, padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
            <span>{renderMarkdown(a.message)}</span>
            <button
              aria-label="Dismiss"
              onClick={() => { dismiss(a.id); setItems(prev => prev.filter(x => x.id !== a.id)); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: c.color, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}
            >×</button>
          </div>
        );
      })}
    </div>
  );
}
