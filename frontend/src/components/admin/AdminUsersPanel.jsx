import React from 'react';

/**
 * AdminUsersPanel — paginated users table with search, role/verified/banned
 * filters, ban/unban actions, and a deactivate action.
 * Extracted from AdminDashboard.jsx (#1060).
 *
 * Props:
 *   users            – array of user objects
 *   pagination       – { page, pages, total }
 *   searchQuery      – current search string
 *   roleFilter       – current role filter value
 *   verifiedFilter   – current verified filter value
 *   bannedFilter     – current banned filter value
 *   onSearchChange   – (value: string) => void
 *   onRoleChange     – (value: string) => void
 *   onVerifiedChange – (value: string) => void
 *   onBannedChange   – (value: string) => void
 *   onSearch         – () => void  (trigger search / page 1)
 *   onPageChange     – (page: number) => void
 *   onDeactivate     – (id, name) => void
 *   onBan            – (id, name) => void
 *   onUnban          – (id) => void
 */
export default function AdminUsersPanel({
  users = [],
  pagination = { page: 1, pages: 1, total: 0 },
  searchQuery = '',
  roleFilter = '',
  verifiedFilter = '',
  bannedFilter = '',
  onSearchChange,
  onRoleChange,
  onVerifiedChange,
  onBannedChange,
  onSearch,
  onPageChange,
  onDeactivate,
  onBan,
  onUnban,
}) {
  const s = {
    card: { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
    th: { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #eee', color: '#555', fontWeight: 600 },
    td: { padding: '10px 12px', borderBottom: '1px solid #f0f0f0' },
    input: { padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 },
    deactivate: { background: '#fee', color: '#c0392b', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
    inactive: { color: '#aaa', fontSize: 12, fontStyle: 'italic' },
    pagination: { display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' },
    pgBtn: (disabled) => ({
      padding: '6px 14px', borderRadius: 6, border: '1px solid #ddd',
      cursor: disabled ? 'not-allowed' : 'pointer',
      background: disabled ? '#f5f5f5' : '#fff',
      color: disabled ? '#aaa' : '#333',
    }),
    badge: (role) => ({
      display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600,
      background: role === 'admin' ? '#ffeaa7' : role === 'farmer' ? '#d8f3dc' : '#dfe6e9',
      color: role === 'admin' ? '#b8860b' : role === 'farmer' ? '#2d6a4f' : '#555',
    }),
  };

  return (
    <div style={s.card}>
      <h3 style={{ marginBottom: 16, color: '#333' }}>Users ({pagination.total})</h3>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search by email or name…"
          value={searchQuery}
          onChange={(e) => onSearchChange?.(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSearch?.(); }}
          style={{ flex: '1 1 200px', ...s.input }}
        />
        <select
          value={roleFilter}
          onChange={(e) => onRoleChange?.(e.target.value)}
          style={{ flex: '0 1 120px', ...s.input }}
        >
          <option value="">All Roles</option>
          <option value="admin">Admin</option>
          <option value="farmer">Farmer</option>
          <option value="buyer">Buyer</option>
        </select>
        <select
          value={verifiedFilter}
          onChange={(e) => onVerifiedChange?.(e.target.value)}
          style={{ flex: '0 1 120px', ...s.input }}
        >
          <option value="">All Verified</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
        <select
          value={bannedFilter}
          onChange={(e) => onBannedChange?.(e.target.value)}
          style={{ flex: '0 1 120px', ...s.input }}
        >
          <option value="">All Banned</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
        <button
          onClick={() => onSearch?.()}
          style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#2d6a4f', color: '#fff', fontWeight: 600, cursor: 'pointer', flex: '0 1 auto' }}
        >
          Search
        </button>
      </div>

      {/* Table */}
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>ID</th>
            <th style={s.th}>Name</th>
            <th style={s.th}>Email</th>
            <th style={s.th}>Role</th>
            <th style={s.th}>Verified</th>
            <th style={s.th}>Banned At</th>
            <th style={s.th}>Joined</th>
            <th style={s.th}>Status</th>
            <th style={s.th}>Action</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td style={s.td}>{u.id}</td>
              <td style={s.td}>{u.name}</td>
              <td style={s.td}>{u.email}</td>
              <td style={s.td}><span style={s.badge(u.role)}>{u.role}</span></td>
              <td style={s.td}>{u.verified ? '✓' : '—'}</td>
              <td style={s.td}>{u.banned_at ? new Date(u.banned_at).toLocaleDateString() : '—'}</td>
              <td style={s.td}>{new Date(u.created_at).toLocaleDateString()}</td>
              <td style={s.td}>
                {u.banned_at
                  ? <span style={{ color: '#c0392b', fontSize: 12, fontWeight: 600 }}>Banned</span>
                  : u.active === 0
                    ? <span style={s.inactive}>Inactive</span>
                    : <span style={{ color: '#2d6a4f', fontSize: 12 }}>Active</span>}
              </td>
              <td style={s.td}>
                {u.role !== 'admin' && u.active !== 0 && (
                  u.banned_at ? (
                    <button
                      style={{ ...s.deactivate, background: '#d8f3dc', color: '#2d6a4f' }}
                      onClick={() => onUnban?.(u.id)}
                    >
                      Unban
                    </button>
                  ) : (
                    <button style={s.deactivate} onClick={() => onBan?.(u.id, u.name)}>
                      Ban
                    </button>
                  )
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination */}
      <div style={s.pagination}>
        <button
          style={s.pgBtn(pagination.page <= 1)}
          disabled={pagination.page <= 1}
          onClick={() => onPageChange?.(pagination.page - 1)}
        >← Prev</button>
        <span style={{ fontSize: 13, color: '#666' }}>
          Page {pagination.page} of {pagination.pages}
        </span>
        <button
          style={s.pgBtn(pagination.page >= pagination.pages)}
          disabled={pagination.page >= pagination.pages}
          onClick={() => onPageChange?.(pagination.page + 1)}
        >Next →</button>
      </div>
    </div>
  );
}
