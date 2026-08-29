import React, { useState, useEffect, useRef, useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';

const s = {
  nav: { background: '#2d6a4f', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  brand: { color: '#fff', fontWeight: 700, fontSize: 20, textDecoration: 'none' },
  link: { color: '#d8f3dc', textDecoration: 'none', fontSize: 14, minHeight: 44, display: 'flex', alignItems: 'center' },
  activeLink: { color: '#fff', textDecoration: 'underline', fontWeight: 700, fontSize: 14, minHeight: 44, display: 'flex', alignItems: 'center' },
  btn: { background: '#95d5b2', border: 'none', borderRadius: 6, padding: '10px 14px', cursor: 'pointer', fontSize: 14, fontWeight: 600, minHeight: 44 },
  toggleBtn: { background: 'none', border: '1px solid #95d5b2', borderRadius: 6, padding: '10px', cursor: 'pointer', fontSize: 16, color: '#d8f3dc', minHeight: 44, minWidth: 44 },
  langSelect: { background: 'none', border: '1px solid #95d5b2', borderRadius: 6, padding: '6px 10px', color: '#d8f3dc', fontSize: 13, cursor: 'pointer', minHeight: 44 },
};

function navLinkStyle({ isActive }) {
  return isActive ? s.activeLink : s.link;
}

export default function Navbar() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme, useSystemTheme, isUsingSystemTheme } = useTheme();
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [network, setNetwork] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const navRef = useRef(null);
  const hamburgerRef = useRef(null);
  const drawerRef = useRef(null);

  useEffect(() => {
    api.getNetwork().then(res => setNetwork(res.network)).catch(() => {});
  }, []);

  // Initial unread-message count
  useEffect(() => {
    if (!user || typeof api.getUnreadMessageCount !== 'function') { setUnreadCount(0); return; }
    let cancelled = false;
    api.getUnreadMessageCount()
      .then(res => { if (!cancelled) setUnreadCount(res.count || 0); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user]);

  // Live updates via SSE — increment on new_message
  useEffect(() => {
    if (!user || typeof EventSource === 'undefined' || typeof api.getMessagesStreamUrl !== 'function') return;
    const es = new EventSource(api.getMessagesStreamUrl());
    es.addEventListener('new_message', () => {
      setUnreadCount(c => c + 1);
    });
    return () => es.close();
  }, [user]);

  // Refresh the count whenever messages are marked read elsewhere in the app
  useEffect(() => {
    if (!user) return;
    function handleMessagesRead() {
      if (typeof api.getUnreadMessageCount !== 'function') return;
      api.getUnreadMessageCount()
        .then(res => setUnreadCount(res.count || 0))
        .catch(() => {});
    }
    window.addEventListener('messages:read', handleMessagesRead);
    return () => window.removeEventListener('messages:read', handleMessagesRead);
  }, [user]);

  // Escape key handler
  useEffect(() => {
    function handleEscape(e) {
      if (e.key === 'Escape') {
        setOpen(false);
        hamburgerRef.current?.focus();
      }
    }
    if (open) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [open]);

  // Outside click handler
  useEffect(() => {
    function handleClickOutside(e) {
      if (navRef.current && !navRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  // Focus trap inside the drawer when open
  const handleDrawerKeyDown = useCallback((e) => {
    if (!open || e.key !== 'Tab') return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    const focusable = drawer.querySelectorAll(
      'a[href], button:not([disabled]), select, input, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, [open]);

  function handleLogout() {
    logout();
    navigate('/login');
    setOpen(false);
  }

  function closeDrawer() {
    setOpen(false);
    hamburgerRef.current?.focus();
  }

  return (
    <nav ref={navRef} style={s.nav} aria-label="Main navigation">
      <NavLink
        to="/"
        end
        style={({ isActive }) => (isActive ? { ...s.brand, textDecoration: 'underline' } : s.brand)}
      >
        🌿 FarmersMarket
      </NavLink>
      {network && (
        <span style={{
          background: network === 'mainnet' ? '#c0392b' : '#2d6a4f',
          color: '#fff',
          borderRadius: 4,
          padding: '2px 8px',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
        }}>
          {network}
        </span>
      )}
      <button
        ref={hamburgerRef}
        className="hamburger"
        onClick={() => setOpen(o => !o)}
        aria-label="Toggle menu"
        aria-expanded={open}
        aria-controls="nav-drawer"
      >
        {open ? '✕' : '☰'}
      </button>
      <div
        id="nav-drawer"
        ref={drawerRef}
        className={`nav-links${open ? ' open' : ''}`}
        role="navigation"
        aria-label="Site links"
        onKeyDown={handleDrawerKeyDown}
      >
        {user ? (
          <>
            <NavLink to="/marketplace" style={navLinkStyle} onClick={closeDrawer}>Browse</NavLink>
            {user.role === 'farmer' && <NavLink to="/dashboard" style={navLinkStyle} onClick={closeDrawer}>Dashboard</NavLink>}
            {user.role === 'buyer' && <NavLink to="/orders" style={navLinkStyle} onClick={closeDrawer}>Orders</NavLink>}
            {user.role === 'buyer' && <NavLink to="/subscriptions" style={navLinkStyle} onClick={closeDrawer}>Subscriptions</NavLink>}
            {user.role === 'buyer' && <NavLink to="/addresses" style={navLinkStyle} onClick={closeDrawer}>Addresses</NavLink>}
            {user.role === 'admin' && (
              <NavLink
                to="/admin"
                style={({ isActive }) => ({ ...(isActive ? s.activeLink : s.link), color: isActive ? '#fff' : '#ffeaa7' })}
                onClick={closeDrawer}
              >
                Admin
              </NavLink>
            )}
            {user.role !== 'admin' && <NavLink to="/wallet" style={navLinkStyle} onClick={closeDrawer}>Wallet</NavLink>}
            <NavLink to="/settings" style={navLinkStyle} onClick={closeDrawer}>Settings</NavLink>
            <span style={{ color: '#d8f3dc', fontSize: 13 }}>{user.name} ({user.role})</span>
            {unreadCount > 0 && (
              <span
                role="status"
                aria-label={`${unreadCount} unread message${unreadCount !== 1 ? 's' : ''}`}
                style={{ background: '#e63946', color: '#fff', borderRadius: 10, padding: '2px 7px', fontSize: 11, fontWeight: 700, minWidth: 18, textAlign: 'center' }}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
            <button style={s.toggleBtn} onClick={toggleTheme} aria-label="Toggle dark mode">{theme === 'light' ? '🌙' : '☀️'}</button>
            <button style={{ ...s.toggleBtn, fontSize: 12, minWidth: 120, color: '#fff' }} onClick={useSystemTheme} aria-label="Use system theme">
              {isUsingSystemTheme ? 'System' : 'Use system'}
            </button>
            <button style={s.btn} onClick={handleLogout}>Logout</button>
          </>
        ) : (
          <>
            <NavLink to="/login" style={navLinkStyle} onClick={closeDrawer}>Login</NavLink>
            <NavLink to="/register" style={navLinkStyle} onClick={closeDrawer}>Register</NavLink>
          </>
        )}
        <select
          style={s.langSelect}
          value={i18n.language}
          onChange={e => i18n.changeLanguage(e.target.value)}
          aria-label="Select language"
        >
          <option value="en">EN</option>
          <option value="sw">SW</option>
          <option value="ar">AR</option>
        </select>
      </div>
    </nav>
  );
}
