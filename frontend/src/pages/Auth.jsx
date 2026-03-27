import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { validateLogin, validateRegister, validatePassword } from '../utils/validation';

const s = {
  wrap: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  card: {
    background: '#fff',
    borderRadius: 12,
    padding: 36,
    width: 360,
    boxShadow: '0 2px 16px #0001',
  },
  title: { fontSize: 24, fontWeight: 700, marginBottom: 24, color: '#2d6a4f' },
  field: { marginBottom: 16 },
  label: { display: 'block', fontSize: 13, marginBottom: 4, color: '#555' },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: 8,
    fontSize: 14,
    boxSizing: 'border-box',
  },
  inputErr: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #c0392b',
    borderRadius: 8,
    fontSize: 14,
    boxSizing: 'border-box',
  },
  select: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: 8,
    fontSize: 14,
  },
  btn: {
    width: '100%',
    padding: '12px',
    background: '#2d6a4f',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 8,
  },
  err: { color: '#c0392b', fontSize: 12, marginTop: 4 },
  formErr: {
    color: '#c0392b',
    fontSize: 13,
    marginTop: 8,
    padding: '8px 12px',
    background: '#fff0f0',
    borderRadius: 6,
  },
  link: { display: 'block', textAlign: 'center', marginTop: 16, color: '#2d6a4f', fontSize: 14 },
  strengthBar: {
    height: 4,
    borderRadius: 2,
    marginTop: 6,
    transition: 'width 0.3s, background 0.3s',
  },
  strengthHint: { fontSize: 11, color: '#888', marginTop: 3 },
};

function PasswordStrength({ password }) {
  const issues = validatePassword(password);
  const score = 4 - issues.length; // 0–4
  const colors = ['#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#2d6a4f'];
  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'];
  if (!password) return null;
  return (
    <div>
      <div style={{ display: 'flex', gap: 3, marginTop: 6 }}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: i < score ? colors[score] : '#e0e0e0',
            }}
          />
        ))}
      </div>
      <div style={{ ...s.strengthHint, color: colors[score] }}>{labels[score]}</div>
      {issues.length > 0 && <div style={s.strengthHint}>Needs: {issues.join(', ')}</div>}
    </div>
  );
}

export function LoginPage() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  function handleChange(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    // Clear field error on change
    if (errors[field]) setErrors((e) => ({ ...e, [field]: '' }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    const errs = validateLogin(form);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    try {
      const { token, user } = await api.login(form);
      login(token, user);
      navigate(user.role === 'farmer' ? '/dashboard' : '/marketplace');
    } catch (err) {
      setFormError(err.message);
    }
  }

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.title}>🌿 Welcome back</div>
        <form onSubmit={handleSubmit} noValidate>
          <div style={s.field}>
            <label style={s.label} htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              style={errors.email ? s.inputErr : s.input}
              type="email"
              value={form.email}
              onChange={(e) => handleChange('email', e.target.value)}
              autoComplete="email"
            />
            {errors.email && (
              <div style={s.err} role="alert">
                {errors.email}
              </div>
            )}
          </div>
          <div style={s.field}>
            <label style={s.label} htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              style={errors.password ? s.inputErr : s.input}
              type="password"
              value={form.password}
              onChange={(e) => handleChange('password', e.target.value)}
              autoComplete="current-password"
            />
            {errors.password && (
              <div style={s.err} role="alert">
                {errors.password}
              </div>
            )}
          </div>
          {formError && (
            <div style={s.formErr} role="alert">
              {formError}
            </div>
          )}
          <button style={s.btn} type="submit">
            Login
          </button>
        </form>
        <Link to="/register" style={s.link}>
          Don't have an account? Register
        </Link>
      </div>
    </div>
  );
}

export function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'buyer' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get('ref');

  function handleChange(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: '' }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    const errs = validateRegister(form);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    try {
      const { token, user } = await api.register({ ...form, ref: refCode });
      login(token, user);
      navigate(user.role === 'farmer' ? '/dashboard' : '/marketplace');
    } catch (err) {
      setFormError(err.message);
    }
  }

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.title}>🌱 Create Account</div>
        <form onSubmit={handleSubmit} noValidate>
          <div style={s.field}>
            <label style={s.label} htmlFor="reg-name">
              Name
            </label>
            <input
              id="reg-name"
              style={errors.name ? s.inputErr : s.input}
              type="text"
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
              autoComplete="name"
            />
            {errors.name && (
              <div style={s.err} role="alert">
                {errors.name}
              </div>
            )}
          </div>
          <div style={s.field}>
            <label style={s.label} htmlFor="reg-email">
              Email
            </label>
            <input
              id="reg-email"
              style={errors.email ? s.inputErr : s.input}
              type="email"
              value={form.email}
              onChange={(e) => handleChange('email', e.target.value)}
              autoComplete="email"
            />
            {errors.email && (
              <div style={s.err} role="alert">
                {errors.email}
              </div>
            )}
          </div>
          <div style={s.field}>
            <label style={s.label} htmlFor="reg-password">
              Password
            </label>
            <input
              id="reg-password"
              style={errors.password ? s.inputErr : s.input}
              type="password"
              value={form.password}
              onChange={(e) => handleChange('password', e.target.value)}
              autoComplete="new-password"
            />
            <PasswordStrength password={form.password} />
            {errors.password && (
              <div style={s.err} role="alert">
                {errors.password}
              </div>
            )}
          </div>
          <div style={s.field}>
            <label style={s.label} htmlFor="reg-role">
              I am a...
            </label>
            <select
              id="reg-role"
              style={s.select}
              value={form.role}
              onChange={(e) => handleChange('role', e.target.value)}
            >
              <option value="buyer">Buyer</option>
              <option value="farmer">Farmer</option>
            </select>
          </div>
          {formError && (
            <div style={s.formErr} role="alert">
              {formError}
            </div>
          )}
          <button style={s.btn} type="submit">
            Create Account
          </button>
        </form>
        <Link to="/login" style={s.link}>
          Already have an account? Login
        </Link>
      </div>
    </div>
  );
}
