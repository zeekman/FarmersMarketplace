import React, { useState, useCallback, useEffect, useRef } from 'react';
import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { validatePassword } from '../utils/validation';
import TwoFactorAuth from '../components/TwoFactorAuth';
import { getErrorMessage } from '../utils/errorMessages';

const s = {
  page:    { maxWidth: 640, margin: '0 auto', padding: 24 },
  title:   { fontSize: 24, fontWeight: 700, color: 'var(--color-primary)', marginBottom: 8 },
  sub:     { color: 'var(--color-text-muted)', fontSize: 14, marginBottom: 32 },
  card:    { background: 'var(--color-bg-primary)', borderRadius: 12, padding: 24, boxShadow: 'var(--shadow-md)', marginBottom: 24 },
  section: { fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 4 },
  desc:    { fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16, lineHeight: 1.5 },
  btnDanger: { background: 'var(--color-danger)', color: 'var(--color-text-inverse)', border: 'none', borderRadius: 8, padding: '10px 22px', cursor: 'pointer', fontWeight: 600, fontSize: 14 },
  btnGhost:  { background: 'var(--color-bg-primary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 22px', cursor: 'pointer', fontWeight: 600, fontSize: 14 },
  overlay:   { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modal:     { background: 'var(--color-bg-primary)', borderRadius: 14, padding: 28, maxWidth: 440, width: '100%', boxShadow: 'var(--shadow-xl)' },
  modalTitle:{ fontSize: 18, fontWeight: 700, color: 'var(--color-danger)', marginBottom: 12 },
  warning:   { background: 'var(--color-warning-lightest)', border: '1px solid var(--color-warning-light)', borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: 13, color: 'var(--color-text-primary)', lineHeight: 1.5 },
  balanceBox:{ background: 'var(--color-error-lightest)', border: '1px solid var(--color-error-light)', borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: 13, color: 'var(--color-text-primary)', lineHeight: 1.5 },
  input:     { width: '100%', padding: '9px 12px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', marginBottom: 4 },
  label:     { display: 'block', fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 6 },
  row:       { display: 'flex', gap: 10, marginTop: 20 },
  errMsg:    { color: 'var(--color-danger)', fontSize: 13, marginTop: 8 },
  btn:     { background: 'var(--color-primary)', color: 'var(--color-text-inverse)', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, marginTop: 14 },
  btnSm:   { background: 'var(--color-primary)', color: 'var(--color-text-inverse)', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  btnGray: { background: 'var(--color-text-muted)', color: 'var(--color-text-inverse)', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 13, marginLeft: 8 },
  err:     { color: 'var(--color-danger)', fontSize: 13, marginTop: 8, padding: '8px 12px', background: 'var(--color-error-lightest)', borderRadius: 6 },
  ok:      { color: 'var(--color-primary)', fontSize: 13, marginTop: 8, padding: '8px 12px', background: 'var(--color-primary-lightest)', borderRadius: 6 },
  warn:    { background: 'var(--color-warning-lightest)', border: '1px solid var(--color-warning-light)', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: 'var(--color-text-primary)', marginBottom: 14 },
  mnemonic: {
    background: 'var(--color-bg-tertiary)', color: 'var(--color-text-primary)', borderRadius: 10, padding: 20,
    fontFamily: 'monospace', fontSize: 15, lineHeight: 2, letterSpacing: 0.5,
    wordBreak: 'break-word', marginTop: 14, userSelect: 'all',
  },
  wordGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px 12px', marginTop: 14,
  },
  wordChip: {
    background: 'var(--color-bg-tertiary)', color: 'var(--color-text-primary)', borderRadius: 6, padding: '6px 10px',
    fontFamily: 'monospace', fontSize: 13, display: 'flex', gap: 6, alignItems: 'center',
  },
  wordNum: { color: 'var(--color-text-muted)', fontSize: 11, minWidth: 18 },
};

const CONFIRM_PHRASE = 'delete my account';

function useToast() {
  const [toast, setToast] = useState(null);
  const show = useCallback((type, text) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3000);
  }, []);
  return [toast, show];
}

function Toast({ toast }) {
  if (!toast) return null;
  const isOk = toast.type === 'ok';
  return (
    <div
      role={isOk ? 'status' : 'alert'}
      aria-live={isOk ? 'polite' : 'assertive'}
      style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
        background: isOk ? 'var(--color-primary)' : 'var(--color-danger)', color: 'var(--color-text-inverse)',
        borderRadius: 10, padding: '12px 20px', fontSize: 14,
        boxShadow: 'var(--shadow-lg)', minWidth: 240,
      }}
    >
      {toast.text}
    </div>
  );
}

function PasswordStrengthBar({ password }) {
  if (!password) return null;
  const issues = validatePassword(password);
  const score = 4 - issues.length; // 0–4
  const colors = ['var(--color-danger)', 'var(--color-warning)', 'var(--color-accent-light)', 'var(--color-success-light)', 'var(--color-primary)'];
  const labels = ['Weak', 'Weak', 'Fair', 'Good', 'Strong'];
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', gap: 3 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i < score ? colors[score] : 'var(--color-border)' }} />
        ))}
      </div>
      <div style={{ fontSize: 11, color: colors[score], marginTop: 3 }}>{labels[score]}</div>
      {issues.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>Needs: {issues.join(', ')}</div>
      )}
    </div>
  );
}

function PasswordChangeForm() {
  const [form, setForm] = useState({ current: '', newPw: '', confirm: '' });
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);

  const newPwIssues = validatePassword(form.newPw);
  const isStrong = form.newPw.length > 0 && newPwIssues.length === 0;
  const canSubmit = isStrong && form.current.length > 0 && form.newPw === form.confirm;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setMsg(null);
    try {
      await api.changePassword({ current_password: form.current, new_password: form.newPw });
      setMsg({ type: 'ok', text: 'Password updated successfully.' });
      setForm({ current: '', newPw: '', confirm: '' });
    } catch (err) {
      setMsg({ type: 'err', text: getErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={s.card}>
      <div style={s.section}>Change Password</div>
      <div style={s.desc}>Update your account password. Must be at least 8 characters with 1 uppercase letter and 1 number.</div>
      <form onSubmit={handleSubmit} noValidate>
        <label style={s.label} htmlFor="cp-current">Current Password</label>
        <input id="cp-current" style={s.input} type="password" value={form.current}
          onChange={e => setForm(f => ({ ...f, current: e.target.value }))} autoComplete="current-password" />

        <label style={{ ...s.label, marginTop: 12 }} htmlFor="cp-new">New Password</label>
        <input id="cp-new" style={s.input} type="password" value={form.newPw}
          onChange={e => setForm(f => ({ ...f, newPw: e.target.value }))} autoComplete="new-password" />
        <PasswordStrengthBar password={form.newPw} />

        <label style={{ ...s.label, marginTop: 12 }} htmlFor="cp-confirm">Confirm New Password</label>
        <input id="cp-confirm"
          style={{ ...s.input, ...(form.confirm && form.newPw !== form.confirm ? { border: '1px solid var(--color-danger)' } : {}) }}
          type="password" value={form.confirm}
          onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))} autoComplete="new-password"
          aria-invalid={!!(form.confirm && form.newPw !== form.confirm)}
          aria-describedby={form.confirm && form.newPw !== form.confirm ? 'cp-confirm-err' : undefined} />
        {form.confirm && form.newPw !== form.confirm && (
          <div id="cp-confirm-err" style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 3 }} role="alert">Passwords do not match</div>
        )}

        {msg && (
          <div role={msg.type === 'ok' ? 'status' : 'alert'} style={{ ...s.err, ...(msg.type === 'ok' ? { color: 'var(--color-primary)', background: 'var(--color-primary-lightest)' } : {}), marginTop: 10 }}>
            {msg.text}
          </div>
        )}
        <button style={{ ...s.btn, opacity: canSubmit ? 1 : 0.5 }} type="submit" disabled={!canSubmit || saving}>
          {saving ? 'Saving…' : 'Save Password'}
        </button>
      </form>
    </div>
  );
}

function SettingsAccountBody() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // --- Account merge state ---
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeDestination, setMergeDestination]   = useState('');
  const [mergePassword, setMergePassword]         = useState('');
  const [merging, setMerging]                     = useState(false);
  const [mergeError, setMergeError]               = useState('');
  const [mergeSuccess, setMergeSuccess]           = useState('');

  function openMergeModal() {
    setMergeDestination('');
    setMergePassword('');
    setMergeError('');
    setMergeSuccess('');
    setShowMergeModal(true);
  }

  function closeMergeModal() {
    if (merging) return;
    setShowMergeModal(false);
  }

  async function handleMerge() {
    setMerging(true);
    setMergeError('');
    try {
      const result = await api.mergeWallet({ destination: mergeDestination, password: mergePassword });
      setMergeSuccess(`Merge complete. TX: ${result.txHash}`);
    } catch (e) {
      setMergeError(getErrorMessage(e));
    } finally {
      setMerging(false);
    }
  }

  const [showModal, setShowModal]       = useState(false);
  const [step, setStep]                 = useState('confirm'); // 'confirm' | 'balance_warning'
  const [balanceInfo, setBalanceInfo]   = useState(null); // { balance, publicKey }
  const [confirmText, setConfirmText]   = useState('');
  const [deleting, setDeleting]         = useState(false);
  const [error, setError]               = useState('');

  function openModal() {
    setStep('confirm');
    setConfirmText('');
    setBalanceInfo(null);
    setError('');
    setShowModal(true);
  }

  function closeModal() {
    if (deleting) return;
    setShowModal(false);
  }

  async function handleDelete(force = false) {
    setDeleting(true);
    setError('');
    try {
      await api.deleteAccount(force);
      await logout();
      navigate('/login', { replace: true });
    } catch (e) {
      if (e.status === 409 && e.data?.code === 'balance_warning') {
        setBalanceInfo({ balance: e.data.balance, publicKey: e.data.publicKey });
        setStep('balance_warning');
      } else {
        setError(getErrorMessage(e));
      }
    } finally {
      setDeleting(false);
    }
  }

  const confirmValid = confirmText.trim().toLowerCase() === CONFIRM_PHRASE;

  return (
    <>
      <div style={s.sub}>Manage your account preferences.</div>

      <div style={s.card}>
        <div style={s.section}>Account Information</div>
        <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
          <strong>Name:</strong> {user?.name}
        </div>
        <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
          <strong>Email:</strong> {user?.email}
        </div>
        <div style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
          <strong>Role:</strong> {user?.role}
        </div>
      </div>

      <div style={{ ...s.card, border: '1px solid var(--color-error-light)' }}>
        <div style={{ ...s.section, color: 'var(--color-danger)' }}>Danger Zone</div>
        <div style={s.desc}>
          Permanently delete your account and all associated data including orders, products, and profile information.
          Your Stellar wallet will be abandoned — make sure to withdraw any funds first.
        </div>
        <button style={s.btnDanger} onClick={openModal}>
          Delete Account
        </button>
      </div>

      <div style={{ ...s.card, border: '1px solid var(--color-warning-light)' }}>
        <div style={s.section}>Wallet Consolidation</div>
        <div style={s.desc}>
          Merge this account's Stellar wallet into another address. All XLM will be transferred and the source account will be permanently closed on the ledger. This action is irreversible.
        </div>
        <button style={{ ...s.btnDanger, background: 'var(--color-warning)' }} onClick={openMergeModal}>
          Merge Wallet
        </button>
      </div>

      {showMergeModal && (
        <div style={s.overlay} onClick={closeMergeModal} role="dialog" aria-modal="true" aria-labelledby="merge-modal-title">
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalTitle} id="merge-modal-title">Merge Wallet</div>
            <div style={s.warning}>
              <strong>⚠️ This is irreversible.</strong> All XLM will be transferred to the destination and your current Stellar account will be permanently closed.
            </div>
            {mergeSuccess ? (
              <>
                <div style={{ color: 'var(--color-primary)', fontSize: 13, background: 'var(--color-primary-lightest)', borderRadius: 6, padding: '10px 12px', wordBreak: 'break-all' }}>{mergeSuccess}</div>
                <div style={s.row}>
                  <button style={s.btnGhost} onClick={closeMergeModal}>Close</button>
                </div>
              </>
            ) : (
              <>
                <label style={s.label}>Destination Stellar address</label>
                <input
                  style={s.input}
                  type="text"
                  value={mergeDestination}
                  onChange={e => setMergeDestination(e.target.value)}
                  placeholder="G..."
                  autoFocus
                />
                <label style={{ ...s.label, marginTop: 12 }}>Confirm your password</label>
                <input
                  style={s.input}
                  type="password"
                  value={mergePassword}
                  onChange={e => setMergePassword(e.target.value)}
                  placeholder="Your account password"
                />
                {mergeError && <div style={s.errMsg}>{mergeError}</div>}
                <div style={s.row}>
                  <button style={s.btnGhost} onClick={closeMergeModal} disabled={merging}>Cancel</button>
                  <button
                    style={{ ...s.btnDanger, background: 'var(--color-warning)', opacity: mergeDestination && mergePassword ? 1 : 0.5 }}
                    disabled={!mergeDestination || !mergePassword || merging}
                    onClick={handleMerge}
                  >
                    {merging ? 'Merging...' : 'Confirm Merge'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showModal && (
        <div style={s.overlay} onClick={closeModal} role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div style={s.modal} onClick={e => e.stopPropagation()}>

            {step === 'confirm' && (
              <>
                <div style={s.modalTitle} id="modal-title">Delete Account</div>
                <div style={s.warning}>
                  <strong>This action is permanent and cannot be undone.</strong> All your data will be deleted including orders, listings, and your profile.
                </div>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
                  Your Stellar wallet (<code style={{ fontSize: 11 }}>{user?.publicKey?.slice(0, 10)}...</code>) will be abandoned on the ledger.
                  Please withdraw any remaining XLM before proceeding.
                </p>
                <label style={s.label}>
                  Type <strong>{CONFIRM_PHRASE}</strong> to confirm
                </label>
                <input
                  style={s.input}
                  type="text"
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  placeholder={CONFIRM_PHRASE}
                  autoFocus
                />
                {error && <div style={s.errMsg}>{error}</div>}
                <div style={s.row}>
                  <button style={s.btnGhost} onClick={closeModal} disabled={deleting}>Cancel</button>
                  <button
                    style={{ ...s.btnDanger, opacity: confirmValid ? 1 : 0.5 }}
                    disabled={!confirmValid || deleting}
                    onClick={() => handleDelete(false)}
                  >
                    {deleting ? 'Deleting...' : 'Delete My Account'}
                  </button>
                </div>
              </>
            )}

            {step === 'balance_warning' && balanceInfo && (
              <>
                <div style={s.modalTitle} id="modal-title">Wallet Balance Detected</div>
                <div style={s.balanceBox}>
                  Your Stellar wallet still holds <strong>{balanceInfo.balance.toFixed(4)} XLM</strong>.
                  If you delete your account now, these funds will be permanently inaccessible.
                </div>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>
                  We recommend withdrawing your funds first. Go to your{' '}
                  <span
                    style={{ color: 'var(--color-primary)', cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={() => { closeModal(); navigate('/wallet'); }}
                  >
                    Wallet
                  </span>{' '}
                  to send XLM to another address.
                </p>
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16 }}>
                  Public key: <code style={{ wordBreak: 'break-all' }}>{balanceInfo.publicKey}</code>
                </p>
                {error && <div style={s.errMsg}>{error}</div>}
                <div style={s.row}>
                  <button style={s.btnGhost} onClick={closeModal} disabled={deleting}>Cancel</button>
                  <button
                    style={{ ...s.btnDanger }}
                    disabled={deleting}
                    onClick={() => handleDelete(true)}
                  >
                    {deleting ? 'Deleting...' : 'Delete Anyway'}
                  </button>
                </div>
              </>
            )}

          </div>
        </div>
      )}
    </>
  );
}

// ── Seed Phrase Backup Section ────────────────────────────────────────────────
const SEED_AUTO_HIDE_MS = 60_000;
const CLIPBOARD_CLEAR_MS = 60_000;
const VERIFY_POSITIONS = [3, 7, 11];
// Keep browsers, translators and extensions from processing the phrase.
const SENSITIVE_TEXT_PROPS = { autoComplete: 'off', spellCheck: false, translate: 'no', className: 'notranslate' };

function SeedPhraseBackup() {
  const [password, setPassword]   = useState('');
  const [totp, setTotp]           = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [mnemonic, setMnemonic]   = useState(null);
  const [revealed, setRevealed]   = useState(false);
  const [copied, setCopied]       = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [answers, setAnswers]     = useState({});
  const [verifyResult, setVerifyResult] = useState(null);
  const hideTimer = useRef(null);
  const clipboardTimer = useRef(null);

  useEffect(() => {
    api.get2FAStatus().then(d => setNeedsTotp(!!d?.enabled)).catch(() => {});
  }, []);

  const handleHide = useCallback(() => {
    clearTimeout(hideTimer.current);
    setMnemonic(null);
    setRevealed(false);
    setConfirmed(false);
    setCopied(false);
    setVerifying(false);
    setAnswers({});
    setVerifyResult(null);
  }, []);

  // Auto-hide after 60 s and wipe the phrase from state on unmount.
  useEffect(() => {
    if (!mnemonic) return undefined;
    hideTimer.current = setTimeout(handleHide, SEED_AUTO_HIDE_MS);
    return () => clearTimeout(hideTimer.current);
  }, [mnemonic, handleHide]);

  useEffect(() => () => {
    clearTimeout(hideTimer.current);
    setMnemonic(null);
  }, []);

  async function handleReveal(e) {
    e.preventDefault();
    setError('');
    if (!password) return setError('Please enter your password.');
    if (needsTotp && !/^\d{6}$/.test(totp)) return setError('Please enter your 6-digit authenticator code.');
    setLoading(true);
    try {
      const data = await api.getSeedPhrase(password, needsTotp ? totp : undefined);
      setMnemonic(data.mnemonic);
      setPassword('');
      setTotp('');
    } catch (err) {
      if (err.code === 'totp_required') setNeedsTotp(true);
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    const phrase = mnemonic;
    navigator.clipboard.writeText(phrase).then(() => {
      setCopied(true);
      clearTimeout(clipboardTimer.current);
      // Best effort: only clear the clipboard if it still holds the phrase.
      clipboardTimer.current = setTimeout(async () => {
        try {
          const current = await navigator.clipboard.readText();
          if (current === phrase) await navigator.clipboard.writeText('');
        } catch { /* clipboard read not permitted — nothing more we can do */ }
      }, CLIPBOARD_CLEAR_MS);
    });
  }

  function handleVerify(e) {
    e.preventDefault();
    const ok = VERIFY_POSITIONS.every(
      pos => (answers[pos] || '').trim().toLowerCase() === words[pos - 1]
    );
    setVerifyResult(ok);
  }

  const words = mnemonic ? mnemonic.split(' ') : [];

  return (
    <div style={s.card}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 4 }}>🔑 Seed Phrase Backup</h2>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 14 }}>
        Your 24-word seed phrase lets you recover your Stellar wallet if you ever lose access to this account.
        Keep it somewhere safe and never share it with anyone.
      </p>

      {!mnemonic ? (
        <form onSubmit={handleReveal} noValidate autoComplete="off">
          <div style={s.warn}>
            ⚠️ Your seed phrase gives full access to your wallet. Only view it in a private location.
          </div>
          <label style={s.label} htmlFor="sp-password">Confirm your password to reveal</label>
          <input
            id="sp-password"
            style={s.input}
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="Enter your password"
          />
          {needsTotp && (
            <>
              <label style={{ ...s.label, marginTop: 10 }} htmlFor="sp-totp">Authenticator code</label>
              <input
                id="sp-totp"
                style={s.input}
                inputMode="numeric"
                maxLength={6}
                value={totp}
                onChange={e => setTotp(e.target.value.replace(/\D/g, ''))}
                autoComplete="one-time-code"
                placeholder="123456"
              />
            </>
          )}
          {error && <div style={s.err} role="alert">{error}</div>}
          <button style={s.btn} type="submit" disabled={loading}>
            {loading ? 'Verifying…' : 'Reveal Seed Phrase'}
          </button>
        </form>
      ) : (
        <div>
          <div style={{ ...s.warn, background: 'var(--color-error-lightest)', border: '1px solid var(--color-error-light)', color: 'var(--color-danger)' }}>
            🚨 Write these words down in order and store them offline. They hide automatically after 60 seconds.
            Never screenshot or share them.
          </div>

          <div
            style={{ ...s.wordGrid, filter: revealed ? 'none' : 'blur(6px)', transition: 'filter 0.15s', userSelect: revealed ? 'text' : 'none' }}
            aria-label="Seed phrase words"
            aria-hidden={!revealed}
            translate="no"
            className="notranslate"
            spellCheck={false}
            onMouseDown={() => setRevealed(true)}
            onMouseUp={() => setRevealed(false)}
            onMouseLeave={() => setRevealed(false)}
            onTouchStart={() => setRevealed(true)}
            onTouchEnd={() => setRevealed(false)}
          >
            {/* Seed words can repeat, and the list is static and never reordered,
                so the position is the identity here. */}
            {words.map((word, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <div key={`${i}-${word}`} style={s.wordChip}>
                <span style={s.wordNum}>{i + 1}.</span>
                <span>{word}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>Press and hold the words, or use “Show”, to reveal them.</p>

          <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={e => setConfirmed(e.target.checked)}
              />
              I have written down my seed phrase
            </label>
          </div>

          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={s.btnSm} type="button" onClick={() => setRevealed(r => !r)}>
              {revealed ? 'Blur' : 'Show'}
            </button>
            <button style={s.btnSm} type="button" onClick={handleCopy} disabled={!confirmed}>
              {copied ? '✓ Copied' : 'Copy to clipboard'}
            </button>
            <button style={s.btnSm} type="button" onClick={() => { setVerifying(true); setRevealed(false); }} disabled={!confirmed}>
              Verify backup
            </button>
            <button style={s.btnGray} type="button" onClick={handleHide}>Hide</button>
          </div>

          {copied && (
            <div style={{ ...s.warn, marginTop: 12 }} role="status">
              ⚠️ Your seed phrase is on the clipboard. Paste it somewhere safe now — we will try to clear the clipboard in 60 seconds.
            </div>
          )}

          {verifying && (
            <form onSubmit={handleVerify} noValidate autoComplete="off" style={{ marginTop: 14 }}>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 8 }}>Enter words {VERIFY_POSITIONS.join(', ')} to confirm your backup.</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {VERIFY_POSITIONS.map(pos => (
                  <input
                    key={pos}
                    aria-label={`Word ${pos}`}
                    placeholder={`Word ${pos}`}
                    style={{ ...s.input, width: 120 }}
                    value={answers[pos] || ''}
                    onChange={e => setAnswers(a => ({ ...a, [pos]: e.target.value }))}
                    {...SENSITIVE_TEXT_PROPS}
                  />
                ))}
              </div>
              <button style={s.btnSm} type="submit">Check</button>
              {verifyResult === true && <div style={s.ok} role="status">✓ Backup verified.</div>}
              {verifyResult === false && <div style={s.err} role="alert">Those words don't match. Check your written backup.</div>}
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// ── Account Recovery Section ──────────────────────────────────────────────────
function AccountRecovery() {
  const { login } = useAuth();
  const navigate  = useNavigate();
  const [form, setForm]   = useState({ email: '', password: '', mnemonic: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState('');

  function handleChange(field, value) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleRecover(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    const { email, password, mnemonic } = form;
    if (!email || !password || !mnemonic.trim()) {
      return setError('All fields are required.');
    }
    const wordCount = mnemonic.trim().split(/\s+/).length;
    if (wordCount !== 12 && wordCount !== 24) {
      return setError('Seed phrase must be 12 or 24 words.');
    }
    setLoading(true);
    try {
      const data = await api.recoverAccount({ email, password, mnemonic: mnemonic.trim() });
      login(data.token, data.user);
      setSuccess('Wallet recovered successfully. Redirecting…');
      setTimeout(() => navigate(data.user.role === 'farmer' ? '/dashboard' : '/marketplace'), 1500);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.card}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 4 }}>🔄 Recover Account from Seed Phrase</h2>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 14 }}>
        Lost access? Enter your email, password, and seed phrase to restore your wallet.
      </p>
      <form onSubmit={handleRecover} noValidate>
        <label style={s.label} htmlFor="rec-email">Email</label>
        <input
          id="rec-email"
          style={s.input}
          type="email"
          value={form.email}
          onChange={e => handleChange('email', e.target.value)}
          autoComplete="email"
          placeholder="you@example.com"
        />

        <label style={s.label} htmlFor="rec-password">Password</label>
        <input
          id="rec-password"
          style={s.input}
          type="password"
          value={form.password}
          onChange={e => handleChange('password', e.target.value)}
          autoComplete="current-password"
          placeholder="Your account password"
        />

        <label style={s.label} htmlFor="rec-mnemonic">Seed Phrase (12 or 24 words)</label>
        <textarea
          id="rec-mnemonic"
          style={{ ...s.input, minHeight: 80, resize: 'vertical', fontFamily: 'monospace' }}
          value={form.mnemonic}
          onChange={e => handleChange('mnemonic', e.target.value)}
          placeholder="word1 word2 word3 … word24"
          spellCheck={false}
          autoComplete="off"
        />

        {error   && <div style={s.err} role="alert">{error}</div>}
        {success && <div style={s.ok}  role="status">{success}</div>}

        <button style={s.btn} type="submit" disabled={loading}>
          {loading ? 'Recovering…' : 'Recover Wallet'}
        </button>
      </form>
    </div>
  );
}

// ── Profile / Notification Settings ─────────────────────────────────────────
function ProfileSettings({ showToast }) {
  const { user } = useAuth();
  const [form, setForm] = useState({ name: user?.name ?? '', email: user?.email ?? '' });
  const [saving, setSaving] = useState(false);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateProfile(form);
      showToast('ok', 'Settings saved successfully.');
    } catch (err) {
      showToast('err', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={s.card}>
      <div style={s.section}>Profile</div>
      <form onSubmit={handleSave} noValidate>
        <label style={s.label} htmlFor="profile-name">Name</label>
        <input
          id="profile-name"
          style={s.input}
          type="text"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        />
        <label style={s.label} htmlFor="profile-email">Email</label>
        <input
          id="profile-email"
          style={s.input}
          type="email"
          value={form.email}
          onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
        />
        <button style={s.btn} type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}

// ── Push Notification Settings ───────────────────────────────────────────────
function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) output[i] = rawData.charCodeAt(i);
  return output;
}

function PushNotificationSettings() {
  const supported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  const [permission, setPermission] = useState(supported ? Notification.permission : 'unsupported');
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy]             = useState(false);
  const [msg, setMsg]               = useState(null);

  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((subscription) => setSubscribed(!!subscription))
      .catch(() => {});
  }, [supported]);

  // Only ever runs from a click, so the browser prompt is user-initiated.
  async function handleEnable() {
    setBusy(true);
    setMsg(null);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') return;

      const reg = await navigator.serviceWorker.ready;
      let subscription = await reg.pushManager.getSubscription();
      if (!subscription) {
        const keyRes = await api.getPushPublicKey();
        const publicKey = keyRes?.data?.publicKey;
        if (!publicKey) throw new Error('Push notifications are not configured on the server.');
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8Array(publicKey),
        });
      }

      await api.subscribePush(subscription);
      setSubscribed(true);
      setMsg({ type: 'ok', text: 'Push notifications enabled.' });
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'Failed to enable push notifications.' });
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    setMsg(null);
    try {
      await api.unsubscribePush();
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
      setSubscribed(false);
      setMsg({ type: 'ok', text: 'Push notifications disabled.' });
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'Failed to disable push notifications.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={s.card}>
      <div style={s.section}>Notifications</div>
      {!supported ? (
        <div style={s.desc}>Push notifications are not supported in this browser.</div>
      ) : (
        <>
          <div style={s.desc}>
            Browser permission: <strong>{permission}</strong>
            {permission === 'denied' && (
              <>. Notifications are blocked for this site. To turn them on, allow notifications in your browser's site settings and reload this page.</>
            )}
          </div>
          {permission !== 'denied' && (subscribed ? (
            <button style={s.btnGhost} onClick={handleDisable} disabled={busy}>
              {busy ? 'Working…' : 'Disable push notifications'}
            </button>
          ) : (
            <button style={s.btn} onClick={handleEnable} disabled={busy}>
              {busy ? 'Working…' : 'Enable push notifications'}
            </button>
          ))}
        </>
      )}
      {msg && (
        <div role={msg.type === 'ok' ? 'status' : 'alert'} style={msg.type === 'ok' ? s.ok : s.err}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

// ── Main Settings Page ────────────────────────────────────────────────────────
export default function Settings() {
  const { user } = useAuth();
  const [toast, showToast] = useToast();

  return (
    <div style={s.page}>
      <Toast toast={toast} />
      <div style={s.title}>⚙️ Settings</div>
      {user ? (
        <>
          <ProfileSettings showToast={showToast} />
          <PushNotificationSettings />
          <SettingsAccountBody />
          <PasswordChangeForm />
          <TwoFactorAuth />
          <SeedPhraseBackup />
          <div style={s.card}>
            <div style={s.section}>Security</div>
            <div style={s.desc}>Protect your account with two-factor authentication.</div>
            <TwoFactorAuth />
          </div>
        </>
      ) : (
        <AccountRecovery />
      )}
    </div>
  );
}

export { AccountRecovery };
