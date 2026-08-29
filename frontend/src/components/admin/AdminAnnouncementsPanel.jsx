import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';

/**
 * AdminAnnouncementsPanel — create, edit, and delete platform announcements.
 * Extracted from AdminDashboard.jsx (#1060).
 */
export default function AdminAnnouncementsPanel() {
  const [announcements, setAnnouncements] = useState([]);
  const [annForm, setAnnForm] = useState({ message: '', type: 'info', expires_at: '' });
  const [editingAnn, setEditingAnn] = useState(null);
  const [annMsg, setAnnMsg] = useState('');

  const s = {
    card: { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001', marginTop: 32 },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
    th: { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #eee', color: '#555', fontWeight: 600 },
    td: { padding: '10px 12px', borderBottom: '1px solid #f0f0f0' },
  };

  const loadAnnouncements = useCallback(async () => {
    try {
      const res = await api.adminGetAnnouncements();
      setAnnouncements(res.data ?? []);
    } catch {
      setAnnouncements([]);
    }
  }, []);

  useEffect(() => { loadAnnouncements(); }, [loadAnnouncements]);

  async function handleAnnSubmit(e) {
    e.preventDefault();
    try {
      if (editingAnn) {
        await api.adminUpdateAnnouncement(editingAnn, annForm);
        setAnnMsg('Announcement updated.');
      } else {
        await api.adminCreateAnnouncement(annForm);
        setAnnMsg('Announcement created.');
      }
      setEditingAnn(null);
      setAnnForm({ message: '', type: 'info', expires_at: '' });
      loadAnnouncements();
    } catch (err) {
      setAnnMsg(err.message || 'Failed to save announcement.');
    }
  }

  return (
    <div style={s.card}>
      <h3 style={{ marginBottom: 16, color: '#333' }}>📢 Announcements</h3>
      <form onSubmit={handleAnnSubmit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <textarea
          required
          placeholder="Message (markdown supported)"
          value={annForm.message}
          onChange={(e) => setAnnForm((f) => ({ ...f, message: e.target.value }))}
          style={{ flex: '3 1 260px', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, resize: 'vertical', minHeight: 60 }}
        />
        <select
          value={annForm.type}
          onChange={(e) => setAnnForm((f) => ({ ...f, type: e.target.value }))}
          style={{ flex: '0 0 110px', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }}
        >
          <option value="info">ℹ info</option>
          <option value="warning">⚠ warning</option>
          <option value="error">🔴 error</option>
        </select>
        <input
          type="datetime-local"
          value={annForm.expires_at}
          onChange={(e) => setAnnForm((f) => ({ ...f, expires_at: e.target.value }))}
          style={{ flex: '1 1 180px', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }}
          title="Expires at (optional)"
        />
        <button
          type="submit"
          style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#2d6a4f', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
        >
          {editingAnn ? 'Update' : 'Create'}
        </button>
        {editingAnn && (
          <button
            type="button"
            onClick={() => { setEditingAnn(null); setAnnForm({ message: '', type: 'info', expires_at: '' }); }}
            style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}
          >
            Cancel
          </button>
        )}
      </form>
      {annMsg && <div style={{ fontSize: 13, color: '#2d6a4f', marginBottom: 10 }}>{annMsg}</div>}
      {announcements.length === 0 ? (
        <div style={{ color: '#888', fontSize: 14 }}>No announcements yet.</div>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Message</th>
              <th style={s.th}>Type</th>
              <th style={s.th}>Active</th>
              <th style={s.th}>Expires</th>
              <th style={s.th}></th>
            </tr>
          </thead>
          <tbody>
            {announcements.map((a) => (
              <tr key={a.id}>
                <td style={{ ...s.td, fontSize: 13, maxWidth: 320, wordBreak: 'break-word' }}>
                  {a.message}
                </td>
                <td style={s.td}>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 10,
                      fontSize: 11,
                      fontWeight: 600,
                      background: a.type === 'error' ? '#fee2e2' : a.type === 'warning' ? '#fef9c3' : '#dbeafe',
                      color: a.type === 'error' ? '#991b1b' : a.type === 'warning' ? '#854d0e' : '#1e40af',
                    }}
                  >
                    {a.type}
                  </span>
                </td>
                <td style={s.td}>
                  <button
                    onClick={async () => {
                      await api.adminUpdateAnnouncement(a.id, { active: a.active ? 0 : 1 });
                      loadAnnouncements();
                    }}
                    style={{
                      padding: '2px 10px',
                      borderRadius: 6,
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 600,
                      background: a.active ? '#d8f3dc' : '#f3f4f6',
                      color: a.active ? '#2d6a4f' : '#888',
                    }}
                  >
                    {a.active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td style={{ ...s.td, fontSize: 12, color: '#888' }}>
                  {a.expires_at ? new Date(a.expires_at).toLocaleString() : '—'}
                </td>
                <td style={{ ...s.td, display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => {
                      setEditingAnn(a.id);
                      setAnnForm({ message: a.message, type: a.type, expires_at: a.expires_at ? a.expires_at.slice(0, 16) : '' });
                      setAnnMsg('');
                    }}
                    style={{ padding: '3px 10px', borderRadius: 6, border: 'none', background: '#e0f2fe', color: '#0369a1', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm('Delete?')) return;
                      await api.adminDeleteAnnouncement(a.id);
                      loadAnnouncements();
                    }}
                    style={{ padding: '3px 10px', borderRadius: 6, border: 'none', background: '#fee2e2', color: '#c0392b', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
