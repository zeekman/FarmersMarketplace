import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';

const s = {
  nav: { background: '#2d6a4f', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  brand: { color: '#fff', fontWeight: 700, fontSize: 20, textDecoration: 'none' },
  link: { color: '#d8f3dc', textDecoration: 'none', fontSize: 14, minHeight: 44, display: 'flex', alignItems: 'center' },
  btn: { background: '#95d5b2', border: 'none', borderRadius: 6, padding: '10px 14px', cursor: 'pointer', fontSize: 14, fontWeight: 600, minHeight: 44 },
  toggleBtn: { background: 'none', border: '1px solid #95d5b2', borderRadius: 6, padding: '10px', cursor: 'pointer', fontSize: 16, color: '#d8f3dc', minHeight: 44, minWidth: 44 },
  langSelect: { background: 'none', border: '1px solid #95d5b2', borderRadius: 6, padding: '6px 10px', color: '#d8f3dc', fontSize: 13, cursor: 'pointer', minHeight: 44 },
};

export default function Navbar() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [network, setNetwork] = useState(null);

  useEffect(() => {
    api.getNetwork().then(res => setNetwork(res.network)).catch(() => {});
  }, []);

  function handleLogout() {
    logout();
    navigate('/login');
    setOpen(false);
  }

  return (
    <nav style={s.nav}>
      <Link to="/" style={s.brand}>🌿 FarmersMarket</Link>
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
      <button className="hamburger" onClick={() => setOpen(o => !o)} aria-label="Toggle menu" aria-expanded={open}>
        {open ? '✕' : '☰'}
      </button>
      <div className={`nav-links${open ? ' open' : ''}`}>
        {user ? (
          <>
            <Link to="/marketplace" style={s.link}>Browse</Link>
            {user.role === 'farmer' && <Link to="/dashboard" style={s.link}>Dashboard</Link>}
            {user.role === 'buyer' && <Link to="/orders" style={s.link}>Orders</Link>}
            {user.role === 'buyer' && <Link to="/subscriptions" style={s.link}>Subscriptions</Link>}
            {user.role === 'buyer' && <Link to="/addresses" style={s.link}>Addresses</Link>}
            {user.role === 'admin' && <Link to="/admin" style={{ ...s.link, color: '#ffeaa7' }}>Admin</Link>}
            {user.role !== 'admin' && <Link to="/wallet" style={s.link}>Wallet</Link>}
            <Link to="/settings" style={s.link}>Settings</Link>
            <Link to="/marketplace" style={s.link} onClick={() => setOpen(false)}>Browse</Link>
            {user.role === 'farmer' && <Link to="/dashboard" style={s.link} onClick={() => setOpen(false)}>Dashboard</Link>}
            {user.role === 'buyer' && <Link to="/orders" style={s.link} onClick={() => setOpen(false)}>Orders</Link>}
            {user.role === 'buyer' && <Link to="/addresses" style={s.link} onClick={() => setOpen(false)}>Addresses</Link>}
            {user.role === 'admin' && <Link to="/admin" style={{ ...s.link, color: '#ffeaa7' }} onClick={() => setOpen(false)}>Admin</Link>}
            {user.role !== 'admin' && <Link to="/wallet" style={s.link} onClick={() => setOpen(false)}>Wallet</Link>}
            <span style={{ color: '#d8f3dc', fontSize: 13 }}>{user.name} ({user.role})</span>
            <button style={s.toggleBtn} onClick={toggleTheme} aria-label="Toggle dark mode">{theme === 'light' ? '🌙' : '☀️'}</button>
            <button style={s.btn} onClick={handleLogout}>Logout</button>
          </>
        ) : (
          <>
            <Link to="/login" style={s.link} onClick={() => setOpen(false)}>Login</Link>
            <Link to="/register" style={s.link} onClick={() => setOpen(false)}>Register</Link>
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
        </select>
      </div>
    </nav>
  );
}
