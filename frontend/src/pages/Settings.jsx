import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const s = {
  page:    { maxWidth: 640, margin: '0 auto', padding: 24 },
  title:   { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 8 },
  sub:     { color: '#888', fontSize: 14, marginBottom: 32 },
  card:    { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001', marginBottom: 24 },
  section: { fontSize: 16, fontWeight: 700, color: '#333', marginBottom: 4 },
  desc:    { fontSize: 13, color: '#888', marginBottom: 16, lineHeight: 1.5 },
  btnDanger: { background: '#c0392b', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', cursor: 'pointer', fontWeight: 600, fontSize: 14 },
  btnGhost:  { background: '#fff', color: '#555', border: '1px solid #ddd', borderRadius: 8, padding: '10px 22px', cursor: 'pointer', fontWeight: 600, fontSize: 14 },
  overlay:   { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modal:     { background: '#fff', borderRadius: 14, padding: 28, maxWidth: 440, width: '100%', boxShadow: '0 8px 32px #0003' },
  modalTitle:{ fontSize: 18, fontWeight: 700, color: '#c0392b', marginBottom: 12 },
  warning:   { background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: 13, color: '#856404', lineHeight: 1.5 },
  balanceBox:{ background: '#fee', border: '1px solid #f5c6cb', borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: 13, color: '#721c24', lineHeight: 1.5 },
  input:     { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', marginBottom: 4 },
  label:     { display: 'block', fontSize: 13, color: '#555', marginBottom: 6 },
  row:       { display: 'flex', gap: 10, marginTop: 20 },
  errMsg:    { color: '#c0392b', fontSize: 13, marginTop: 8 },
};

const CONFIRM_PHRASE = 'delete my account';

export default function Settings() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

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
        setError(e.message || 'Deletion failed. Please try again.');
      }
    } finally {
      setDeleting(false);
    }
  }

  const confirmValid = confirmText.trim().toLowerCase() === CONFIRM_PHRASE;

  return (
    <div style={s.page}>
      <div style={s.title}>Settings</div>
      <div style={s.sub}>Manage your account preferences.</div>

      <div style={s.card}>
        <div style={s.section}>Account Information</div>
        <div style={{ fontSize: 14, color: '#555', marginBottom: 4 }}>
          <strong>Name:</strong> {user?.name}
        </div>
        <div style={{ fontSize: 14, color: '#555', marginBottom: 4 }}>
          <strong>Email:</strong> {user?.email}
        </div>
        <div style={{ fontSize: 14, color: '#555' }}>
          <strong>Role:</strong> {user?.role}
        </div>
      </div>

      <div style={{ ...s.card, border: '1px solid #f5c6cb' }}>
        <div style={{ ...s.section, color: '#c0392b' }}>Danger Zone</div>
        <div style={s.desc}>
          Permanently delete your account and all associated data including orders, products, and profile information.
          Your Stellar wallet will be abandoned — make sure to withdraw any funds first.
        </div>
        <button style={s.btnDanger} onClick={openModal}>
          Delete Account
        </button>
      </div>

      {showModal && (
        <div style={s.overlay} onClick={closeModal} role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div style={s.modal} onClick={e => e.stopPropagation()}>

            {step === 'confirm' && (
              <>
                <div style={s.modalTitle} id="modal-title">Delete Account</div>
                <div style={s.warning}>
                  <strong>This action is permanent and cannot be undone.</strong> All your data will be deleted including orders, listings, and your profile.
                </div>
                <p style={{ fontSize: 13, color: '#555', marginBottom: 16, lineHeight: 1.5 }}>
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
                <p style={{ fontSize: 13, color: '#555', marginBottom: 8, lineHeight: 1.5 }}>
                  We recommend withdrawing your funds first. Go to your{' '}
                  <span
                    style={{ color: '#2d6a4f', cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={() => { closeModal(); navigate('/wallet'); }}
                  >
                    Wallet
                  </span>{' '}
                  to send XLM to another address.
                </p>
                <p style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
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
    </div>
  );
}
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const s = {
  page:    { maxWidth: 640, margin: '0 auto', padding: 24 },
  title:   { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 24 },
  card:    { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001', marginBottom: 24 },
  label:   { display: 'block', fontSize: 13, color: '#555', marginBottom: 4, marginTop: 14 },
  input:   { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' },
  btn:     { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, marginTop: 14 },
  btnSm:   { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  btnGray: { background: '#888', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 13, marginLeft: 8 },
  err:     { color: '#c0392b', fontSize: 13, marginTop: 8, padding: '8px 12px', background: '#fff0f0', borderRadius: 6 },
  ok:      { color: '#2d6a4f', fontSize: 13, marginTop: 8, padding: '8px 12px', background: '#d8f3dc', borderRadius: 6 },
  warn:    { background: '#fff8e1', border: '1px solid #f9a825', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: '#5d4037', marginBottom: 14 },
  mnemonic: {
    background: '#1a1a2e', color: '#e0e0e0', borderRadius: 10, padding: 20,
    fontFamily: 'monospace', fontSize: 15, lineHeight: 2, letterSpacing: 0.5,
    wordBreak: 'break-word', marginTop: 14, userSelect: 'all',
  },
  wordGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px 12px', marginTop: 14,
  },
  wordChip: {
    background: '#1a1a2e', color: '#e0e0e0', borderRadius: 6, padding: '6px 10px',
    fontFamily: 'monospace', fontSize: 13, display: 'flex', gap: 6, alignItems: 'center',
  },
  wordNum: { color: '#888', fontSize: 11, minWidth: 18 },
};

// ── Seed Phrase Backup Section ────────────────────────────────────────────────
function SeedPhraseBackup() {
  const [password, setPassword]   = useState('');
  const [mnemonic, setMnemonic]   = useState(null);
  const [copied, setCopied]       = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [confirmed, setConfirmed] = useState(false);

  async function handleReveal(e) {
    e.preventDefault();
    setError('');
    if (!password) return setError('Please enter your password.');
    setLoading(true);
    try {
      const data = await api.getSeedPhrase(password);
      setMnemonic(data.mnemonic);
      setPassword('');
    } catch (err) {
      setError(err.message || 'Failed to retrieve seed phrase.');
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(mnemonic).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  function handleHide() {
    setMnemonic(null);
    setConfirmed(false);
    setCopied(false);
  }

  const words = mnemonic ? mnemonic.split(' ') : [];

  return (
    <div style={s.card}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#333', marginBottom: 4 }}>🔑 Seed Phrase Backup</h2>
      <p style={{ fontSize: 13, color: '#888', marginBottom: 14 }}>
        Your 24-word seed phrase lets you recover your Stellar wallet if you ever lose access to this account.
        Keep it somewhere safe and never share it with anyone.
      </p>

      {!mnemonic ? (
        <form onSubmit={handleReveal} noValidate>
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
          {error && <div style={s.err} role="alert">{error}</div>}
          <button style={s.btn} type="submit" disabled={loading}>
            {loading ? 'Verifying…' : 'Reveal Seed Phrase'}
          </button>
        </form>
      ) : (
        <div>
          <div style={{ ...s.warn, background: '#fdecea', border: '1px solid #e57373', color: '#b71c1c' }}>
            🚨 Write these words down in order and store them offline. This is the only time they will be shown.
            Never screenshot or share them.
          </div>

          <div style={s.wordGrid} aria-label="Seed phrase words">
            {words.map((word, i) => (
              <div key={i} style={s.wordChip}>
                <span style={s.wordNum}>{i + 1}.</span>
                <span>{word}</span>
              </div>
            ))}
          </div>

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

          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button style={s.btnSm} onClick={handleCopy} disabled={!confirmed}>
              {copied ? '✓ Copied' : 'Copy to clipboard'}
            </button>
            <button style={s.btnGray} onClick={handleHide}>Hide</button>
          </div>
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
      setError(err.message || 'Recovery failed. Check your credentials and seed phrase.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.card}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#333', marginBottom: 4 }}>🔄 Recover Account from Seed Phrase</h2>
      <p style={{ fontSize: 13, color: '#888', marginBottom: 14 }}>
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

// ── Main Settings Page ────────────────────────────────────────────────────────
export default function Settings() {
  const { user } = useAuth();

  return (
    <div style={s.page}>
      <div style={s.title}>⚙️ Settings</div>
      <SeedPhraseBackup />
      {!user && <AccountRecovery />}
    </div>
  );
}

export { AccountRecovery };
