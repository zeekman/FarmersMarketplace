import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useMarkNotificationsRead, useNotificationCount } from '../hooks/queries';
import { notificationLink, isUnread } from '../utils/notifications';

const DROPDOWN_LIMIT = 10;

const s = {
  wrap: { position: 'relative', display: 'flex', alignItems: 'center' },
  bell: { background: 'none', border: '1px solid #95d5b2', borderRadius: 6, padding: 10, cursor: 'pointer', fontSize: 16, color: '#d8f3dc', minHeight: 44, minWidth: 44, position: 'relative' },
  badge: { position: 'absolute', top: 2, right: 2, background: '#e63946', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 700 },
  panel: { position: 'absolute', right: 0, top: '100%', marginTop: 6, width: 320, maxWidth: '90vw', background: 'var(--color-surface, #fff)', color: 'var(--color-text, #222)', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.2)', zIndex: 1000, overflow: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid #eee', fontWeight: 600, fontSize: 14 },
  linkBtn: { background: 'none', border: 'none', color: '#2d6a4f', cursor: 'pointer', fontSize: 13, padding: 4 },
  item: { display: 'block', padding: '10px 12px', borderBottom: '1px solid #f2f2f2', textDecoration: 'none', color: 'inherit', fontSize: 13 },
  footer: { display: 'block', textAlign: 'center', padding: 10, color: '#2d6a4f', fontWeight: 600, fontSize: 13 },
};

export default function NotificationBell() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const unread = useNotificationCount({ enabled: Boolean(user) && typeof api.getUnreadNotificationCount === 'function' }).data ?? 0;
  const { mutate: markReadRemote } = useMarkNotificationsRead();

  useEffect(() => {
    if (!open || typeof api.getNotifications !== 'function') return undefined;
    let cancelled = false;
    setLoading(true);
    api.getNotifications({ limit: DROPDOWN_LIMIT })
      .then(res => { if (!cancelled) setItems((res?.data || []).slice(0, DROPDOWN_LIMIT)); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    }
    function onClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  function markRead(n) {
    if (!isUnread(n)) return;
    setItems(prev => prev.map(i => (i.id === n.id ? { ...i, read_at: new Date().toISOString() } : i)));
    markReadRemote(n.id);
  }

  function markAll() {
    const now = new Date().toISOString();
    setItems(prev => prev.map(i => ({ ...i, read_at: i.read_at || now })));
    markReadRemote(undefined);
  }

  if (!user) return null;

  const label = t('notificationCenter.unreadCount', { count: unread });

  return (
    <div ref={wrapRef} style={s.wrap}>
      <button
        ref={buttonRef}
        type="button"
        style={s.bell}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="notification-dropdown"
        aria-label={label}
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && <span style={s.badge} aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {unread > 0 && (
        <span role="status" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          {label}
        </span>
      )}
      {open && (
        <div id="notification-dropdown" style={s.panel} role="region" aria-label={t('notificationCenter.title')}>
          <div style={s.header}>
            <span>{t('notificationCenter.title')}</span>
            <button type="button" style={s.linkBtn} onClick={markAll} disabled={unread === 0 && !items.some(isUnread)}>
              {t('notificationCenter.markAllRead')}
            </button>
          </div>
          {loading ? (
            <div style={{ padding: 12, fontSize: 13 }}>{t('notificationCenter.loading')}</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 12, fontSize: 13 }}>{t('notificationCenter.empty')}</div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 360, overflowY: 'auto' }}>
              {items.map(n => (
                <li key={n.id}>
                  <Link
                    to={notificationLink(n)}
                    style={{ ...s.item, fontWeight: isUnread(n) ? 700 : 400 }}
                    onClick={() => { markRead(n); setOpen(false); }}
                  >
                    <div>{n.title}</div>
                    {n.body && <div style={{ color: '#666', marginTop: 2 }}>{n.body}</div>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link to="/notifications" style={s.footer} onClick={() => setOpen(false)}>
            {t('notificationCenter.viewAll')}
          </Link>
        </div>
      )}
    </div>
  );
}
