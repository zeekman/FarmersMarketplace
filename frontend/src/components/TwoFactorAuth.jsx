import React, { useState, useEffect } from 'react';
import { api } from '../api/client';

const s = {
  card: { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001', marginBottom: 24 },
  section: { fontSize: 16, fontWeight: 700, color: '#333', marginBottom: 4 },
  desc: { fontSize: 13, color: '#888', marginBottom: 16, lineHeight: 1.5 },
  label: { display: 'block', fontSize: 13, color: '#555', marginBottom: 6 },
  input: { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', marginBottom: 4 },
  btn: { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, marginTop: 14 },
  btnDanger: { background: '#c0392b', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, marginTop: 14 },
  btnGhost: { background: '#fff', color: '#555', border: '1px solid #ddd', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, marginTop: 14 },
  err: { color: '#c0392b', fontSize: 13, marginTop: 8, padding: '8px 12px', background: '#fff0f0', borderRadius: 6 },
  ok: { color: '#2d6a4f', fontSize: 13, marginTop: 8, padding: '8px 12px', background: '#d8f3dc', borderRadius: 6 },
  warn: { background: '#fff8e1', border: '1px solid #f9a825', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: '#5d4037', marginBottom: 14 },
  qrContainer: { textAlign: 'center', marginTop: 16, marginBottom: 16 },
  qrImage: { maxWidth: 200, height: 'auto', borderRadius: 8 },
  backupCodes: { background: '#f5f5f5', borderRadius: 8, padding: 12, marginTop: 12, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.8 },
  row: { display: 'flex', gap: 10, marginTop: 20 },
};

export default function TwoFactorAuth() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [setupStep, setSetupStep] = useState(null); // null | 'qr' | 'verify'
  const [qrCode, setQrCode] = useState(null);
  const [secret, setSecret] = useState(null);
  const [backupCodes, setBackupCodes] = useState([]);
  const [verificationCode, setVerificationCode] = useState('');
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);

  // Load 2FA status on mount
  useEffect(() => {
    loadStatus();
  }, []);

  async function loadStatus() {
    setLoading(true);
    try {
      const data = await api.get2FAStatus();
      setEnabled(data.enabled);
    } catch (err) {
      setMsg({ type: 'err', text: 'Failed to load 2FA status' });
    } finally {
      setLoading(false);
    }
  }

  async function handleSetup() {
    setSaving(true);
    setMsg(null);
    try {
      const data = await api.setup2FA();
      setSecret(data.secret);
      setQrCode(data.qrCode);
      setBackupCodes(data.backupCodes);
      setSetupStep('qr');
      setVerificationCode('');
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'Failed to setup 2FA' });
    } finally {
      setSaving(false);
    }
  }

  async function handleVerify() {
    if (!verificationCode || verificationCode.length !== 6) {
      setMsg({ type: 'err', text: 'Please enter a valid 6-digit code' });
      return;
    }

    setSaving(true);
    setMsg(null);
    try {
      await api.verify2FA({
        secret,
        code: verificationCode,
        backupCodes,
      });
      setMsg({ type: 'ok', text: '2FA enabled successfully!' });
      setEnabled(true);
      setSetupStep(null);
      setQrCode(null);
      setSecret(null);
      setBackupCodes([]);
      setVerificationCode('');
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'Verification failed' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDisable() {
    if (!window.confirm('Are you sure you want to disable 2FA? Your account will be less secure.')) {
      return;
    }

    setSaving(true);
    setMsg(null);
    try {
      await api.disable2FA();
      setMsg({ type: 'ok', text: '2FA disabled' });
      setEnabled(false);
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'Failed to disable 2FA' });
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setSetupStep(null);
    setQrCode(null);
    setSecret(null);
    setBackupCodes([]);
    setVerificationCode('');
    setMsg(null);
  }

  if (loading) {
    return (
      <div style={s.card}>
        <div style={s.section}>🔐 Two-Factor Authentication</div>
        <div style={{ fontSize: 13, color: '#888' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={s.card}>
      <div style={s.section}>🔐 Two-Factor Authentication</div>
      <div style={s.desc}>
        Add an extra layer of security to your account using an authenticator app like Google Authenticator, Authy, or Microsoft Authenticator.
      </div>

      {!enabled && !setupStep && (
        <>
          <div style={s.warn}>
            ⚠️ 2FA is currently disabled. Enable it to protect your account from unauthorized access.
          </div>
          {msg && <div style={{ ...s.err, ...(msg.type === 'ok' ? { color: '#2d6a4f', background: '#d8f3dc' } : {}) }}>{msg.text}</div>}
          <button style={s.btn} onClick={handleSetup} disabled={saving}>
            {saving ? 'Setting up...' : 'Enable 2FA'}
          </button>
        </>
      )}

      {enabled && !setupStep && (
        <>
          <div style={{ ...s.warn, background: '#d8f3dc', border: '1px solid #2d6a4f', color: '#2d6a4f' }}>
            ✓ 2FA is enabled on your account.
          </div>
          {msg && <div style={{ ...s.err, ...(msg.type === 'ok' ? { color: '#2d6a4f', background: '#d8f3dc' } : {}) }}>{msg.text}</div>}
          <button style={s.btnDanger} onClick={handleDisable} disabled={saving}>
            {saving ? 'Disabling...' : 'Disable 2FA'}
          </button>
        </>
      )}

      {setupStep === 'qr' && (
        <>
          <div style={s.warn}>
            📱 Scan this QR code with your authenticator app, then enter the 6-digit code to verify.
          </div>
          {qrCode && (
            <div style={s.qrContainer}>
              <img src={qrCode} alt="2FA QR Code" style={s.qrImage} />
            </div>
          )}
          <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
            <strong>Can't scan?</strong> Enter this code manually: <code style={{ background: '#f5f5f5', padding: '2px 6px', borderRadius: 4 }}>{secret}</code>
          </div>
          <div style={{ ...s.warn, background: '#fff3cd', borderColor: '#ffc107', color: '#856404' }}>
            💾 Save these backup codes in a safe place. You can use them to access your account if you lose your authenticator app.
          </div>
          <div style={s.backupCodes}>
            {backupCodes.map((code, i) => (
              <div key={i}>{code}</div>
            ))}
          </div>
          <label style={{ ...s.label, marginTop: 16 }}>Enter 6-digit code from your app</label>
          <input
            style={s.input}
            type="text"
            value={verificationCode}
            onChange={e => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            maxLength="6"
            autoFocus
          />
          {msg && <div style={{ ...s.err, ...(msg.type === 'ok' ? { color: '#2d6a4f', background: '#d8f3dc' } : {}) }}>{msg.text}</div>}
          <div style={s.row}>
            <button style={s.btnGhost} onClick={handleCancel} disabled={saving}>Cancel</button>
            <button style={{ ...s.btn, opacity: verificationCode.length === 6 ? 1 : 0.5 }} onClick={handleVerify} disabled={verificationCode.length !== 6 || saving}>
              {saving ? 'Verifying...' : 'Verify & Enable'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
