import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';

const s = {
  row: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 },
  status: (enabled) => ({
    fontSize: 13, fontWeight: 700,
    color: enabled ? '#2d6a4f' : '#888',
    background: enabled ? '#d8f3dc' : '#f0f0f0',
    borderRadius: 12, padding: '2px 10px',
  }),
  btn: { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  btnDanger: { background: '#c0392b', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  input: { padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 18, width: 140, letterSpacing: 6, textAlign: 'center', marginRight: 8 },
  qr: { display: 'block', margin: '12px 0', borderRadius: 8 },
  codes: { fontFamily: 'monospace', fontSize: 13, background: '#1a1a2e', color: '#e0e0e0', borderRadius: 8, padding: 12, lineHeight: 2 },
  err: { color: '#c0392b', fontSize: 13, marginTop: 6 },
  ok: { color: '#2d6a4f', fontSize: 13, marginTop: 6 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { background: '#fff', borderRadius: 12, padding: 24, maxWidth: 400, width: '100%', boxShadow: '0 8px 32px #0003' },
};

export default function TwoFactorAuth() {
  const [enabled, setEnabled] = useState(null);
  const [step, setStep] = useState(null); // 'setup' | 'verify' | 'disable' | 'done'
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [backupCodes, setBackupCodes] = useState([]);
  const [totpInput, setTotpInput] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    api.get2faStatus().then(r => setEnabled(r.enabled)).catch(() => {});
  }, []);

  // auto-submit TOTP on 6 digits
  useEffect(() => {
    if (totpInput.length === 6 && step === 'verify') {
      handleVerify();
    }
  }, [totpInput]);

  async function handleSetup() {
    setMsg(null);
    try {
      const res = await api.setup2fa();
      setQrDataUrl(res.qrDataUrl);
      setStep('verify');
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    }
  }

  async function handleVerify() {
    setMsg(null);
    try {
      const res = await api.verify2fa(totpInput);
      setBackupCodes(res.backupCodes);
      setEnabled(true);
      setStep('done');
      setTotpInput('');
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
      setTotpInput('');
    }
  }

  async function handleDisable() {
    setMsg(null);
    try {
      await api.disable2fa(password);
      setEnabled(false);
      setStep(null);
      setPassword('');
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    }
  }

  function downloadBackupCodes() {
    const blob = new Blob([backupCodes.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'backup-codes.txt';
    a.click();
  }

  if (enabled === null) return null;

  return (
    <div>
      <div style={s.row}>
        <span style={{ fontSize: 14, color: '#333' }}>Two-Factor Authentication</span>
        <span style={s.status(enabled)}>{enabled ? 'Enabled' : 'Disabled'}</span>
        {!enabled && <button style={s.btn} onClick={handleSetup}>Enable</button>}
        {enabled && <button style={s.btnDanger} onClick={() => { setStep('disable'); setMsg(null); }}>Disable</button>}
      </div>
      {msg && <div style={msg.type === 'err' ? s.err : s.ok}>{msg.text}</div>}

      {/* Setup: show QR + TOTP input */}
      {step === 'verify' && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>Scan this QR code with your authenticator app, then enter the 6-digit code.</div>
          {qrDataUrl && <img style={s.qr} src={qrDataUrl} alt="2FA QR Code" width={160} height={160} />}
          <input
            ref={inputRef}
            style={s.input}
            maxLength={6}
            inputMode="numeric"
            placeholder="000000"
            value={totpInput}
            onChange={e => setTotpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
            aria-label="6-digit TOTP code"
          />
          <button style={s.btn} onClick={handleVerify}>Confirm</button>
        </div>
      )}

      {/* Backup codes shown once after setup */}
      {step === 'done' && backupCodes.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, color: '#2d6a4f', marginBottom: 8, fontWeight: 600 }}>2FA enabled. Save your backup codes:</div>
          <div style={s.codes}>{backupCodes.join('\n')}</div>
          <button style={{ ...s.btn, marginTop: 10 }} onClick={downloadBackupCodes}>Download backup codes</button>
        </div>
      )}

      {/* Disable confirmation dialog */}
      {step === 'disable' && (
        <div style={s.overlay} role="dialog" aria-modal="true">
          <div style={s.modal}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Disable 2FA</div>
            <div style={{ fontSize: 13, color: '#555', marginBottom: 14 }}>Enter your current password to confirm.</div>
            <input
              style={{ ...s.input, width: '100%', boxSizing: 'border-box', letterSpacing: 0, textAlign: 'left', marginBottom: 12 }}
              type="password"
              placeholder="Current password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
            />
            {msg && <div style={s.err}>{msg.text}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button style={s.btnDanger} onClick={handleDisable}>Disable 2FA</button>
              <button style={{ ...s.btn, background: '#888' }} onClick={() => { setStep(null); setPassword(''); setMsg(null); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
