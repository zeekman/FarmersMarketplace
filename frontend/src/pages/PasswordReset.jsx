import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { isValidEmail, validatePassword } from '../utils/validation';
import { getErrorMessage } from '../utils/errorMessages';
import { authStyles as s } from './Auth';
import { PasswordStrength } from '../components/PasswordStrength';

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    if (!isValidEmail(email)) { setEmailError(t('auth.invalidEmail')); return; }
    setEmailError('');
    setSubmitting(true);
    try {
      await api.forgotPassword(email.trim());
      // Same message whether or not the account exists, so the form can't be used to probe emails.
      setSent(true);
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={s.wrap}>
      <Helmet>
        <title>Forgot password – Farmers Marketplace</title>
        <meta name="description" content="Request a link to reset your Farmers Marketplace password." />
      </Helmet>
      <div style={s.card}>
        <div style={s.title}>{t('auth.forgot.title')}</div>
        {sent ? (
          <div role="status">{t('auth.forgot.sent')}</div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <p style={{ ...s.label, marginBottom: 16 }}>{t('auth.forgot.intro')}</p>
            <div style={s.field}>
              <label style={s.label} htmlFor="forgot-email">{t('auth.email')}</label>
              <input id="forgot-email" style={emailError ? s.inputErr : s.input} type="email"
                value={email} onChange={e => { setEmail(e.target.value); setEmailError(''); }} autoComplete="email"
                aria-invalid={!!emailError}
                aria-describedby={emailError ? 'forgot-email-err' : undefined} />
              {emailError && <div id="forgot-email-err" style={s.err} role="alert">{emailError}</div>}
            </div>
            {formError && <div style={s.formErr} role="alert">{formError}</div>}
            <button style={s.btn} type="submit" disabled={submitting}>{t('auth.forgot.sendBtn')}</button>
          </form>
        )}
        <Link to="/login" style={s.link}>{t('auth.backToLogin')}</Link>
      </div>
    </div>
  );
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(token ? 'idle' : 'missingToken');

  function handleChange(field, value) {
    setForm(f => ({ ...f, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: '' }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    const errs = {};
    const issues = validatePassword(form.password);
    if (issues.length > 0) errs.password = t('auth.passwordStrength.needs', { issues: issues.join(', ') });
    if (form.confirm !== form.password) errs.confirm = t('auth.reset.mismatch');
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      await api.resetPassword(token, form.password);
      setStatus('success');
    } catch (err) {
      // The backend answers 400 only for a token that is unknown, used or expired.
      if (err.status === 400) setStatus('invalid');
      else setFormError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={s.wrap}>
      <Helmet>
        <title>Reset password – Farmers Marketplace</title>
        <meta name="description" content="Choose a new password for your Farmers Marketplace account." />
      </Helmet>
      <div style={s.card}>
        <div style={s.title}>{t('auth.reset.title')}</div>
        {status === 'success' && <div role="status">{t('auth.reset.success')}</div>}
        {status === 'missingToken' && <div role="alert">{t('auth.reset.missingToken')}</div>}
        {status === 'invalid' && <div role="alert">{t('auth.reset.invalidToken')}</div>}
        {(status === 'missingToken' || status === 'invalid') && (
          <Link to="/forgot-password" style={s.link}>{t('auth.reset.requestNew')}</Link>
        )}
        {status === 'idle' && (
          <form onSubmit={handleSubmit} noValidate>
            <div style={s.field}>
              <label style={s.label} htmlFor="reset-password">{t('auth.reset.newPassword')}</label>
              <input id="reset-password" style={errors.password ? s.inputErr : s.input} type="password"
                value={form.password} onChange={e => handleChange('password', e.target.value)} autoComplete="new-password"
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? 'reset-password-err' : undefined} />
              <PasswordStrength password={form.password} />
              {errors.password && <div id="reset-password-err" style={s.err} role="alert">{errors.password}</div>}
            </div>
            <div style={s.field}>
              <label style={s.label} htmlFor="reset-confirm">{t('auth.reset.confirmPassword')}</label>
              <input id="reset-confirm" style={errors.confirm ? s.inputErr : s.input} type="password"
                value={form.confirm} onChange={e => handleChange('confirm', e.target.value)} autoComplete="new-password"
                aria-invalid={!!errors.confirm}
                aria-describedby={errors.confirm ? 'reset-confirm-err' : undefined} />
              {errors.confirm && <div id="reset-confirm-err" style={s.err} role="alert">{errors.confirm}</div>}
            </div>
            {formError && <div style={s.formErr} role="alert">{formError}</div>}
            <button style={s.btn} type="submit" disabled={submitting}>{t('auth.reset.submitBtn')}</button>
          </form>
        )}
        {status === 'success' && <Link to="/login" style={s.link}>{t('auth.backToLogin')}</Link>}
      </div>
    </div>
  );
}
