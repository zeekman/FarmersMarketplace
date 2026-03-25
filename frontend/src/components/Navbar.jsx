import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const s = {
  nav: { background: '#2d6a4f', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  brand: { color: '#fff', fontWeight: 700, fontSize: 20, textDecoration: 'none' },
  links: { display: 'flex', gap: 16, alignItems: 'center' },
  link: { color: '#d8f3dc', textDecoration: 'none', fontSize: 14 },
  btn: { background: '#95d5b2', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
};

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <nav style={s.nav}>
      <Link to="/" style={s.brand}>🌿 FarmersMarket</Link>
      <div style={s.links}>
        {user ? (
          <>
            <Link to="/marketplace" style={s.link}>Browse</Link>
            {user.role === 'farmer' && <Link to="/dashboard" style={s.link}>Dashboard</Link>}
            {user.role === 'buyer' && <Link to="/orders" style={s.link}>Orders</Link>}
            <Link to="/wallet" style={s.link}>Wallet</Link>
            <span style={{ color: '#d8f3dc', fontSize: 13 }}>{user.name} ({user.role})</span>
            <button style={s.btn} onClick={handleLogout}>Logout</button>
          </>
        ) : (
          <>
            <Link to="/login" style={s.link}>Login</Link>
            <Link to="/register" style={s.link}>Register</Link>
          </>
        )}
      </div>
    </nav>
  );
}
