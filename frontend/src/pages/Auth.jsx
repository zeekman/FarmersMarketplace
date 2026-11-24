import React, { useState } from 'react';
import { useNavigate, useLocation, Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { validateLogin, validateRegister, validatePassword } from '../utils/validation';
import { getErrorMessage, getFieldErrors } from '../utils/errorMessages';
import { useTranslation } from 'react-i18next';
import { PasswordStrength } from '../components/PasswordStrength';

const s = {
  wrap: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { background: 'var(--color-bg-primary)', borderRadius: 12, padding: 36, width: '100%', maxWidth: 400, boxShadow: 'var(--shadow-lg)' },
  title: { fontSize: 24, fontWeight: 700, marginBottom: 24, color: 'var(--color-primary)' },
  field: { marginBottom: 16 },
  label: { display: 'block', fontSize: 13, marginBottom: 4, color: 'var(--color-text-secondary)' },
  input: { width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 16, boxSizing: 'border-box', minHeight: 44 },
  inputErr: { width: '100%', padding: '10px 12px', border: '1px solid var(--color-danger)', borderRadius: 8, fontSize: 16, boxSizing: 'border-box', minHeight: 44 },
  select: { width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 16, minHeight: 44 },
  btn: { width: '100%', padding: '12px', background: 'var(--color-primary)', color: 'var(--color-text-inverse)', border: 'none', borderRadius: 8, fontSize: 16, fontWeight: 600, cursor: 'pointer', marginTop: 8, minHeight: 44 },
  err: { color: 'var(--color-danger)', fontSize: 12, marginTop: 4 },
  formErr: { color: 'var(--color-danger)', fontSize: 13, marginTop: 8, padding: '8px 12px', background: 'var(--color-error-lightest)', borderRadius: 6 },
  link: { display: 'block', textAlign: 'center', marginTop: 16, color: 'var(--color-primary)', fontSize: 14 },
  strengthHint: { fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 3 },
  hint: { fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 16, lineHeight: 1.5 },
  linkBtn: { display: 'block', width: '100%', background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: 14, cursor: 'pointer', marginTop: 16, textAlign: 'center' },
};

export const authStyles = s;

// Returns the path the user was trying to reach before being sent to login,
// falling back to the role's home page. Only same-origin paths are honoured.
function getPostLoginPath(state, user) {
  const from = state?.from;
  if (from?.pathname) {
    const path = `${from.pathname}${from.search || ''}${from.hash || ''}`;
    if (path.startsWith('/') && !path.startsWith('//')) return path;
  }
  return user.role === 'farmer' ? '/dashboard' : '/marketplace';
}

function PasswordStrength({ password }) {
  const { t } = useTranslation();
  const issues = validatePassword(password);
  const score = 4 - issues.length;
  const colors = ['var(--color-danger)', 'var(--color-warning)', 'var(--color-accent-light)', 'var(--color-success-light)', 'var(--color-primary)'];
  const labelKeys = ['auth.passwordStrength.veryWeak', 'auth.passwordStrength.weak', 'auth.passwordStrength.fair', 'auth.passwordStrength.good', 'auth.passwordStrength.strong'];
  if (!password) return null;
  return (
    <div>
      <div style={{ display: 'flex', gap: 3, marginTop: 6 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i < score ? colors[score] : 'var(--color-border)' }} />
        ))}
      </div>
      <div style={{ ...s.strengthHint, color: colors[score] }}>{t(labelKeys[score])}</div>
      {issues.length > 0 && (
        <div style={s.strengthHint}>{t('auth.passwordStrength.needs', { issues: issues.join(', ') })}</div>
      )}
    </div>
  );
}

// Maps a failed second-factor attempt to copy. 429/423 mean rate-limited or locked out,
// other 4xx mean the code was rejected, and anything without a status is a network failure.
function mfaErrorMessage(t, err) {
  if (!err.status) return getErrorMessage(err);
  if (err.status === 429 || err.status === 423) {
    return err.retryAfter ? t('auth.mfa.locked', { seconds: err.retryAfter }) : getErrorMessage(err);
  }
  if (err.status >= 400 && err.status < 500) return t('auth.mfa.invalidCode');
  return getErrorMessage(err);
}

export function LoginPage() {
  const { t } = useTranslation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  // Set when the password step returns mfa_required; the code step is shown until verified.
  const [mfaToken, setMfaToken] = useState(null);
  const [mfaCode, setMfaCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const passwordRef = React.useRef(null);
  const mfaInputRef = React.useRef(null);

  function handleChange(field, value) {
    const updatedForm = { ...form, [field]: value };
    setForm(updatedForm);
    const fieldErrors = validateLogin(updatedForm);
    setErrors((prev) => ({ ...prev, [field]: fieldErrors[field] || '' }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    const errs = validateLogin(form);
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    try {
      const data = await api.login(form);
      if (data.mfa_required) {
        setMfaToken(data.mfa_token);
        setMfaCode('');
        return;
      }
      login(data.token, data.user);
      navigate(data.user.role === 'farmer' ? '/dashboard' : '/marketplace');
      const { token, user } = await api.login(form);
      login(token, user);
      
      // Redirect to intended destination if present, otherwise role default
      const from = location.state?.from;
      if (from?.pathname) {
        const fullPath = from.pathname + (from.search || '');
        // Only accept same-origin relative paths
        if (fullPath.startsWith('/') && !fullPath.startsWith('//')) {
          navigate(fullPath, { replace: true });
          return;
        }
      }
      
      navigate(user.role === 'farmer' ? '/dashboard' : '/marketplace', { replace: true });
      navigate(getPostLoginPath(location.state, user));
    } catch (err) {
      setErrors(getFieldErrors(err));
      setFormError(getErrorMessage(err));
      setForm(f => ({ ...f, password: '' }));
      passwordRef.current?.focus();
    }
  }

  async function handleMfaSubmit(e) {
    e.preventDefault();
    setFormError('');
    try {
      const { token, user } = await api.verifyLogin2FA({ mfa_token: mfaToken, code: mfaCode.trim() });
      login(token, user);
      navigate(user.role === 'farmer' ? '/dashboard' : '/marketplace');
    } catch (err) {
      setFormError(mfaErrorMessage(t, err));
      setMfaCode('');
      mfaInputRef.current?.focus();
    }
  }

  function handleMfaCodeChange(value) {
    // Authenticator codes are digits only; pasted codes like "123 456" are cleaned here.
    setMfaCode(useBackupCode ? value : value.replace(/\D/g, '').slice(0, 6));
  }

  function toggleBackupCode() {
    setUseBackupCode(v => !v);
    setMfaCode('');
    setFormError('');
    mfaInputRef.current?.focus();
  }

  function backToLogin() {
    setMfaToken(null);
    setMfaCode('');
    setUseBackupCode(false);
    setFormError('');
  }

  return (
    <div style={s.wrap}>
      <Helmet>
        <title>Login – Farmers Marketplace</title>
        <meta name="description" content="Sign in to your Farmers Marketplace account." />
      </Helmet>
      <div style={s.card}>
        <div style={s.title}>{t('auth.welcomeBack')}</div>
        <form onSubmit={handleSubmit} noValidate>
          <div style={s.field}>
            <label style={s.label} htmlFor="login-email">{t('auth.email')}</label>
            <input id="login-email" style={errors.email ? s.inputErr : s.input} type="email"
              value={form.email} onChange={e => handleChange('email', e.target.value)} autoComplete="email"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'login-email-err' : undefined} />
            {errors.email && <div id="login-email-err" style={s.err} role="alert">{errors.email}</div>}
          </div>
          <div style={s.field}>
            <label style={s.label} htmlFor="login-password">{t('auth.password')}</label>
            <input id="login-password" ref={passwordRef} style={errors.password ? s.inputErr : s.input} type="password"
              value={form.password} onChange={e => handleChange('password', e.target.value)} autoComplete="current-password"
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'login-password-err' : undefined} />
            <PasswordStrength password={form.password} />
            {errors.password && <div id="login-password-err" style={s.err} role="alert">{errors.password}</div>}
          </div>
          {formError && <div style={s.formErr} role="alert">{formError}</div>}
          <button style={s.btn} type="submit">{t('auth.loginBtn')}</button>
        </form>
        <Link to="/forgot-password" style={s.link}>{t('auth.forgotPassword')}</Link>
        {mfaToken ? (
          <form onSubmit={handleMfaSubmit} noValidate>
            <div style={s.hint}>{t(useBackupCode ? 'auth.mfa.backupPrompt' : 'auth.mfa.prompt')}</div>
            <div style={s.field}>
              <label style={s.label} htmlFor="login-mfa-code">
                {t(useBackupCode ? 'auth.mfa.backupLabel' : 'auth.mfa.codeLabel')}
              </label>
              <input id="login-mfa-code" ref={mfaInputRef} style={formError ? s.inputErr : s.input} type="text"
                value={mfaCode} onChange={e => handleMfaCodeChange(e.target.value)}
                autoComplete="one-time-code" inputMode={useBackupCode ? 'text' : 'numeric'} autoFocus
                aria-invalid={!!formError}
                aria-describedby={formError ? 'login-mfa-err' : undefined} />
            </div>
            {formError && <div id="login-mfa-err" style={s.formErr} role="alert">{formError}</div>}
            <button style={s.btn} type="submit" disabled={!mfaCode.trim()}>{t('auth.mfa.verifyBtn')}</button>
            <button style={s.linkBtn} type="button" onClick={toggleBackupCode}>
              {t(useBackupCode ? 'auth.mfa.useAuthenticator' : 'auth.mfa.useBackup')}
            </button>
            <button style={{ ...s.linkBtn, color: 'var(--color-text-muted)', marginTop: 4 }} type="button" onClick={backToLogin}>
              {t('auth.mfa.back')}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <div style={s.field}>
              <label style={s.label} htmlFor="login-email">{t('auth.email')}</label>
              <input id="login-email" style={errors.email ? s.inputErr : s.input} type="email"
                value={form.email} onChange={e => handleChange('email', e.target.value)} autoComplete="email"
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'login-email-err' : undefined} />
              {errors.email && <div id="login-email-err" style={s.err} role="alert">{errors.email}</div>}
            </div>
            <div style={s.field}>
              <label style={s.label} htmlFor="login-password">{t('auth.password')}</label>
              <input id="login-password" ref={passwordRef} style={errors.password ? s.inputErr : s.input} type="password"
                value={form.password} onChange={e => handleChange('password', e.target.value)} autoComplete="current-password"
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? 'login-password-err' : undefined} />
              <PasswordStrength password={form.password} />
              {errors.password && <div id="login-password-err" style={s.err} role="alert">{errors.password}</div>}
            </div>
            {formError && <div style={s.formErr} role="alert">{formError}</div>}
            <button style={s.btn} type="submit">{t('auth.loginBtn')}</button>
          </form>
        )}
        <Link to="/register" style={s.link}>{t('auth.noAccount')}</Link>
        <Link to="/recover" style={{ ...s.link, fontSize: 12, color: 'var(--color-text-muted)' }}>Lost wallet access? Recover with seed phrase</Link>
      </div>
    </div>
  );
}

export function RegisterPage() {
  const { t } = useTranslation();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'buyer' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get('ref');

  function handleChange(field, value) {
    const updatedForm = { ...form, [field]: value };
    setForm(updatedForm);
    const fieldErrors = validateRegister(updatedForm);
    setErrors((prev) => ({ ...prev, [field]: fieldErrors[field] || '' }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    const errs = validateRegister(form);
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    try {
      const { token, user } = await api.register({ ...form, ref: refCode });
      login(token, user);
      navigate(user.role === 'farmer' ? '/dashboard' : '/marketplace');
    } catch (err) {
      setErrors(getFieldErrors(err));
      setFormError(getErrorMessage(err));
    }
  }

  return (
    <div style={s.wrap}>
      <Helmet>
        <title>Register – Farmers Marketplace</title>
        <meta name="description" content="Create a free account on Farmers Marketplace to buy fresh produce or sell your farm products." />
      </Helmet>
      <div style={s.card}>
        <div style={s.title}>{t('auth.createAccount')}</div>
        <form onSubmit={handleSubmit} noValidate>
          <div style={s.field}>
            <label style={s.label} htmlFor="reg-name">{t('auth.name')}</label>
            <input id="reg-name" style={errors.name ? s.inputErr : s.input} type="text"
              value={form.name} onChange={e => handleChange('name', e.target.value)} autoComplete="name"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? 'reg-name-err' : undefined} />
            {errors.name && <div id="reg-name-err" style={s.err} role="alert">{errors.name}</div>}
          </div>
          <div style={s.field}>
            <label style={s.label} htmlFor="reg-email">{t('auth.email')}</label>
            <input id="reg-email" style={errors.email ? s.inputErr : s.input} type="email"
              value={form.email} onChange={e => handleChange('email', e.target.value)} autoComplete="email"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'reg-email-err' : undefined} />
            {errors.email && <div id="reg-email-err" style={s.err} role="alert">{errors.email}</div>}
          </div>
          <div style={s.field}>
            <label style={s.label} htmlFor="reg-password">{t('auth.password')}</label>
            <input id="reg-password" style={errors.password ? s.inputErr : s.input} type="password"
              value={form.password} onChange={e => handleChange('password', e.target.value)} autoComplete="new-password"
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'reg-password-err' : undefined} />
            <PasswordStrength password={form.password} />
            {errors.password && <div id="reg-password-err" style={s.err} role="alert">{errors.password}</div>}
          </div>
          <div style={s.field}>
            <label style={s.label} htmlFor="reg-role">{t('auth.iAm')}</label>
            <select id="reg-role" style={s.select} value={form.role} onChange={e => handleChange('role', e.target.value)}>
              <option value="buyer">{t('auth.buyer')}</option>
              <option value="farmer">{t('auth.farmer')}</option>
            </select>
          </div>
          {formError && <div style={s.formErr} role="alert">{formError}</div>}
          <button style={s.btn} type="submit">{t('auth.registerBtn')}</button>
        </form>
        <Link to="/login" style={s.link}>{t('auth.haveAccount')}</Link>
      </div>
    </div>
  );
}
