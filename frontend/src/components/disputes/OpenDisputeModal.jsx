import React, { useId, useState } from 'react';
import { api } from '../../api/client';
import { getErrorMessage } from '../../utils/errorMessages';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey';

export const DISPUTE_REASONS = [
  { value: 'not_received', label: 'Item not received' },
  { value: 'not_as_described', label: 'Not as described' },
  { value: 'damaged', label: 'Damaged or spoiled' },
  { value: 'wrong_item', label: 'Wrong item or quantity' },
  { value: 'other', label: 'Other' },
];

export const MAX_EVIDENCE_FILES = 5;
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
export const EVIDENCE_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const MIN_DESCRIPTION = 20;

/** Returns an error message for the first invalid file, or '' when all are acceptable. */
export function validateEvidenceFiles(files, remaining = MAX_EVIDENCE_FILES) {
  if (files.length > remaining) return `You can attach at most ${remaining} file(s).`;
  const allowed = EVIDENCE_ACCEPT.split(',');
  for (const f of files) {
    if (!allowed.includes(f.type)) return `${f.name}: only images (JPEG, PNG, WebP) or PDF are allowed.`;
    if (f.size > MAX_EVIDENCE_BYTES) return `${f.name}: files must be 5 MB or smaller.`;
  }
  return '';
}

const s = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 },
  box: { background: '#fff', borderRadius: 12, padding: 24, maxWidth: 480, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.2)', maxHeight: '90vh', overflowY: 'auto' },
  label: { display: 'block', fontSize: 13, color: '#555', marginBottom: 4, fontWeight: 600 },
  input: { width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, marginBottom: 12, boxSizing: 'border-box' },
  hint: { fontSize: 12, color: '#666', marginTop: -8, marginBottom: 12 },
  err: { color: '#b42318', fontSize: 13, marginBottom: 10 },
  btn: { padding: '9px 18px', borderRadius: 8, border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
};

/**
 * Buyer opens a dispute on an escrowed order: reason, description (≥20 chars)
 * and up to 5 evidence files. Evidence is uploaded after the dispute exists so
 * its SHA-256 hashes can be submitted on chain against that dispute.
 */
export default function OpenDisputeModal({ order, onClose, onOpened }) {
  const titleId = useId();
  const descHintId = useId();
  const [reason, setReason] = useState(DISPUTE_REASONS[0].value);
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const openAttempt = useIdempotencyKey();

  const descriptionOk = description.trim().length >= MIN_DESCRIPTION;

  function handleFiles(e) {
    const picked = Array.from(e.target.files || []);
    const msg = validateEvidenceFiles(picked);
    setError(msg);
    setFiles(msg ? [] : picked);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    if (!descriptionOk) return setError(`Please describe the problem in at least ${MIN_DESCRIPTION} characters.`);
    setBusy(true);
    setError('');
    try {
      const label = DISPUTE_REASONS.find((r) => r.value === reason)?.label || reason;
      const body = { order_id: order.id, reason: `${label}: ${description.trim()}` };
      const created = await api.openDispute(body, openAttempt.keyFor(body));
      openAttempt.settle();
      if (files.length > 0) await api.submitDisputeEvidence(created.id, files);
      onOpened?.(created);
    } catch (err) {
      openAttempt.settle(err);
      setError(getErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div style={s.overlay} onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose?.()}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} style={s.box}
        onKeyDown={(e) => e.key === 'Escape' && !busy && onClose?.()}>
        <h2 id={titleId} style={{ fontSize: 17, margin: '0 0 12px', color: '#222' }}>
          Open dispute — order #{order.id}
        </h2>
        <form onSubmit={handleSubmit}>
          <label style={s.label} htmlFor={`${titleId}-reason`}>Reason</label>
          <select id={`${titleId}-reason`} style={s.input} value={reason} onChange={(e) => setReason(e.target.value)}>
            {DISPUTE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>

          <label style={s.label} htmlFor={`${titleId}-desc`}>Description</label>
          <textarea id={`${titleId}-desc`} style={{ ...s.input, minHeight: 90, resize: 'vertical' }}
            value={description} onChange={(e) => setDescription(e.target.value)}
            aria-describedby={descHintId} aria-invalid={description.length > 0 && !descriptionOk} />
          <div id={descHintId} style={s.hint}>
            {description.trim().length}/{MIN_DESCRIPTION} characters minimum
          </div>

          <label style={s.label} htmlFor={`${titleId}-files`}>Evidence (optional)</label>
          <input id={`${titleId}-files`} type="file" multiple accept={EVIDENCE_ACCEPT} onChange={handleFiles} style={{ marginBottom: 6 }} />
          <div style={s.hint}>Up to {MAX_EVIDENCE_FILES} images or PDFs, 5 MB each. You can add more within 48 h.</div>
          {files.length > 0 && (
            <ul style={{ fontSize: 13, color: '#444', margin: '0 0 12px', paddingLeft: 18 }}>
              {files.map((f) => <li key={f.name}>{f.name} ({(f.size / 1024).toFixed(0)} KB)</li>)}
            </ul>
          )}

          {error && <div role="alert" style={s.err}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" style={{ ...s.btn, background: '#f0f0f0', color: '#333' }} onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" disabled={busy || !descriptionOk}
              style={{ ...s.btn, background: busy || !descriptionOk ? '#ccc' : '#b42318', color: '#fff', cursor: busy || !descriptionOk ? 'not-allowed' : 'pointer' }}>
              {busy ? 'Submitting…' : 'Open dispute'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
