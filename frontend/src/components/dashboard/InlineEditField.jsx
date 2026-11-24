import React, { useState, useRef, useEffect } from 'react';
import { toStroops } from '../../utils/money';
import useXlmRate from '../../utils/useXlmRate';
import { formatFiat } from '../../utils/money';

/**
 * Renders a value as plain text; clicking it switches to an inline <input>.
 * - Enter / Tab  → submit (calls onSave(newValue))
 * - Escape       → cancel, restore original value
 * - onSave must return a Promise; on rejection it reverts + calls onError(msg)
 *
 * When `xlm` is set, the draft is validated with toStroops (max 7 dp, no
 * negatives, no exponent notation) and a live fiat equivalent is shown.
 */
export default function InlineEditField({ value, type = 'number', min, max, step = 'any', format, onSave, onError, style, xlm = false, fiatCurrency = 'KES' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const { rate } = useXlmRate();

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function startEdit() {
    setDraft(String(value));
    setError('');
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setSaving(false);
    setError('');
  }

  function validateXlm(raw) {
    const trimmed = String(raw).trim();
    if (trimmed === '') return 'Price is required';
    if (/[eE]/.test(trimmed)) return 'Exponent notation is not allowed';
    if (trimmed.startsWith('-')) return 'Price cannot be negative';
    const dot = trimmed.indexOf('.');
    if (dot !== -1 && trimmed.length - dot - 1 > 7) return 'At most 7 decimal places';
    try {
      toStroops(trimmed);
    } catch (e) {
      return e?.message || 'Invalid price';
    }
    return '';
  }

  async function commit() {
    let parsed;
    if (xlm) {
      const err = validateXlm(draft);
      if (err) {
        setError(err);
        return;
      }
      parsed = parseFloat(draft);
    } else {
      parsed = type === 'number' ? parseFloat(draft) : draft;
      if (
        type === 'number' &&
        (isNaN(parsed) ||
          (min !== undefined && parsed < min) ||
          (max !== undefined && parsed > max))
      ) {
        cancel();
        return;
      }
    }
    if (String(parsed) === String(value)) { cancel(); return; }
    setSaving(true);
    try {
      await onSave(parsed);
      setEditing(false);
    } catch (e) {
      cancel();
      onError?.(e?.message || 'Save failed');
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Tab') { commit(); }
    if (e.key === 'Escape') cancel();
  }

  function handleChange(e) {
    const next = e.target.value;
    setDraft(next);
    if (xlm) setError(validateXlm(next));
  }

  const displayValue = format ? format(value) : value;

  if (!editing) {
    return (
      <span
        role="button"
        tabIndex={0}
        title="Click to edit"
        onClick={startEdit}
        onKeyDown={(e) => e.key === 'Enter' && startEdit()}
        style={{ cursor: 'pointer', borderBottom: '1px dashed #aaa', ...(style || {}) }}
      >
        {displayValue}
      </span>
    );
  }

  const fiatEquivalent =
    xlm && !error && draft !== '' && !isNaN(parseFloat(draft)) && rate
      ? `≈ ${fiatCurrency} ${formatFiat(parseFloat(draft) * rate, fiatCurrency)}`
      : null;

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
      <input
        ref={inputRef}
        type={type}
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={saving}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        style={{
          width: 80,
          padding: '2px 6px',
          border: error ? '1px solid #c0392b' : '1px solid #2d6a4f',
          borderRadius: 4,
          fontSize: 'inherit',
          ...(style || {}),
        }}
        aria-label="Edit value"
        aria-invalid={error ? 'true' : undefined}
      />
      {error ? (
        <span role="alert" style={{ color: '#c0392b', fontSize: 11, marginTop: 2 }}>
          {error}
        </span>
      ) : fiatEquivalent ? (
        <span style={{ color: '#666', fontSize: 11, marginTop: 2 }}>{fiatEquivalent}</span>
      ) : null}
    </span>
  );
}
