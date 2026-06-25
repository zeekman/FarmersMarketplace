import React, { useState, useRef, useEffect } from 'react';

/**
 * Renders a value as plain text; clicking it switches to an inline <input>.
 * - Enter / Tab  → submit (calls onSave(newValue))
 * - Escape       → cancel, restore original value
 * - onSave must return a Promise; on rejection it reverts + calls onError(msg)
 */
export default function InlineEditField({ value, type = 'number', min, step = 'any', format, onSave, onError, style }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function startEdit() {
    setDraft(String(value));
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setSaving(false);
  }

  async function commit() {
    const parsed = type === 'number' ? parseFloat(draft) : draft;
    if (type === 'number' && (isNaN(parsed) || (min !== undefined && parsed < min))) {
      cancel();
      return;
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
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') cancel();
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

  return (
    <input
      ref={inputRef}
      type={type}
      min={min}
      step={step}
      value={draft}
      disabled={saving}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={commit}
      style={{
        width: 80,
        padding: '2px 6px',
        border: '1px solid #2d6a4f',
        borderRadius: 4,
        fontSize: 'inherit',
        ...(style || {}),
      }}
      aria-label="Edit value"
    />
  );
}
