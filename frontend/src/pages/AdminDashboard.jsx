import React, { useEffect, useState } from 'react';
import { api } from '../api/client';

const s = {
  page: { maxWidth: 1000, margin: '0 auto', padding: 24 },
  title: { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 24 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 },
  stat: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 8px #0001', textAlign: 'center' },
  statVal: { fontSize: 28, fontWeight: 700, color: '#2d6a4f' },
  statLabel: { fontSize: 13, color: '#666', marginTop: 4 },
  card: { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #eee', color: '#555', fontWeight: 600 },
  td: { padding: '10px 12px', borderBottom: '1px solid #f0f0f0' },
  badge: (role) => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600,
    background: role === 'admin' ? '#ffeaa7' : role === 'farmer' ? '#d8f3dc' : '#dfe6e9',
    color: role === 'admin' ? '#b8860b' : role === 'farmer' ? '#2d6a4f' : '#555',
  }),
  deactivate: { background: '#fee', color: '#c0392b', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
  inactive: { color: '#aaa', fontSize: 12, fontStyle: 'italic' },
  pagination: { display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' },
  pgBtn: (disabled) => ({ padding: '6px 14px', borderRadius: 6, border: '1px solid #ddd', cursor: disabled ? 'not-allowed' : 'pointer', background: disabled ? '#f5f5f5' : '#fff', color: disabled ? '#aaa' : '#333' }),
  err: { color: '#c0392b', fontSize: 14, marginBottom: 12 },
  input: { padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 },
  btn: (loading) => ({ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#2d6a4f', color: '#fff', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }),
};

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [error, setError] = useState('');
  const [contracts, setContracts] = useState([]);
  const [contractForm, setContractForm] = useState({ contract_id: '', name: '', type: 'escrow', network: 'testnet' });
  const [contractMsg, setContractMsg] = useState('');
  const [contractFilter, setContractFilter] = useState({ network: '', type: '' });

  // Contract state viewer
  const [contractId, setContractId] = useState('');
  const [contractPrefix, setContractPrefix] = useState('');
  const [contractState, setContractState] = useState(null);
  const [contractLoading, setContractLoading] = useState(false);
  const [contractError, setContractError] = useState('');

  const [simContractId, setSimContractId] = useState('');
  const [simMethod, setSimMethod] = useState('');
  const [simArgsJson, setSimArgsJson] = useState('[]');
  const [simBusy, setSimBusy] = useState(false);
  const [simFormError, setSimFormError] = useState('');
  const [simOutcome, setSimOutcome] = useState(null);

  const inputStyle = { padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 };
  const monoInputStyle = { ...inputStyle, fontFamily: 'monospace' };
  // Contract event log
  const [evtContractId, setEvtContractId] = useState('');
  const [evtFilters, setEvtFilters] = useState({ type: '', from: '', to: '' });
  const [evtPage, setEvtPage] = useState(1);
  const [evtData, setEvtData] = useState(null);
  const [evtLoading, setEvtLoading] = useState(false);
  const [evtError, setEvtError] = useState('');

  async function loadStats() {
    try {
      const res = await api.adminGetStats();
      setStats(res.data);
    } catch (e) { setError(e.message); }
  }

  async function loadUsers(page = 1) {
    try {
      const res = await api.adminGetUsers(page);
      setUsers(res.data);
      setPagination(res.pagination);
    } catch (e) { setError(e.message); }
  }

  useEffect(() => {
    loadStats();
    loadUsers(1);
    loadContracts();
  }, []);

  async function loadContracts(filters = contractFilter) {
    try {
      const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
      const res = await api.adminGetContracts(params ? `?${params}` : '');
      setContracts(res.data ?? []);
    } catch (e) { setContractMsg(e.message); }
  }

  async function handleRegisterContract(e) {
    e.preventDefault();
    setContractMsg('');
    try {
      await api.adminRegisterContract(contractForm);
      setContractForm({ contract_id: '', name: '', type: 'escrow', network: 'testnet' });
      setContractMsg('Contract registered.');
      loadContracts();
    } catch (err) { setContractMsg(err.message); }
  }

  async function handleDeregisterContract(id) {
    if (!confirm('Deregister this contract?')) return;
    try {
      await api.adminDeregisterContract(id);
      loadContracts();
    } catch (e) { setContractMsg(e.message); }
  }

  async function handleDeactivate(id, name) {
    if (!confirm(`Deactivate user "${name}"?`)) return;
    try {
      await api.adminDeactivateUser(id);
      loadUsers(pagination.page);
    } catch (e) { setError(e.message); }
  }

  async function loadContractState(e) {
    e.preventDefault();
    if (!contractId.trim()) return;
    setContractLoading(true);
    setContractError('');
    setContractState(null);
    try {
      const res = await api.getContractState(contractId.trim(), contractPrefix.trim() || undefined);
      setContractState(res.data);
    } catch (e) {
      setContractError(e.message);
    } finally {
      setContractLoading(false);
    }
  }

  async function handleSimulate(e) {
    e.preventDefault();
    setSimFormError('');
    setSimOutcome(null);
    let args;
    try {
      args = JSON.parse(simArgsJson.trim() || '[]');
    } catch {
      setSimFormError('Arguments must be valid JSON (array of { type, value } objects).');
      return;
    }
    if (!Array.isArray(args)) {
      setSimFormError('Arguments must be a JSON array.');
      return;
    }
    if (!simContractId.trim() || !simMethod.trim()) {
      setSimFormError('Select a registered contract and enter a method name.');
      return;
    }
    setSimBusy(true);
    try {
      const data = await api.simulateContractCall(simContractId.trim(), simMethod.trim(), args);
      setSimOutcome(data);
    } catch (err) {
      setSimFormError(err.message);
    } finally {
      setSimBusy(false);
  async function loadContractEvents(e, page = 1) {
    if (e) e.preventDefault();
    if (!evtContractId.trim()) return;
    setEvtLoading(true);
    setEvtError('');
    try {
      const params = { ...evtFilters, page };
      Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
      const res = await api.getContractEvents(evtContractId.trim(), params);
      setEvtData(res);
      setEvtPage(page);
    } catch (e) {
      setEvtError(e.message);
    } finally {
      setEvtLoading(false);
    }
  }

  return (
    <div style={s.page}>
      <div style={s.title}>🛡️ Admin Dashboard</div>
      {error && <div style={s.err}>{error}</div>}

      {stats && (
        <div style={s.grid}>
          <div style={s.stat}>
            <div style={s.statVal}>{stats.users}</div>
            <div style={s.statLabel}>Total Users</div>
          </div>
          <div style={s.stat}>
            <div style={s.statVal}>{stats.products}</div>
            <div style={s.statLabel}>Products Listed</div>
          </div>
          <div style={s.stat}>
            <div style={s.statVal}>{stats.orders}</div>
            <div style={s.statLabel}>Total Orders</div>
          </div>
          <div style={s.stat}>
            <div style={s.statVal}>{Number(stats.total_revenue_xlm).toFixed(2)}</div>
            <div style={s.statLabel}>Revenue (XLM)</div>
          </div>
          {stats.fee_bump_enabled && (
            <div style={s.stat}>
              <div style={s.statVal}>{stats.fee_bump_count ?? 0}</div>
              <div style={s.statLabel}>Fee Bumps Used</div>
            </div>
          )}
        </div>
      )}

      <div style={s.card}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>Users ({pagination.total})</h3>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>ID</th>
              <th style={s.th}>Name</th>
              <th style={s.th}>Email</th>
              <th style={s.th}>Role</th>
              <th style={s.th}>Joined</th>
              <th style={s.th}>Status</th>
              <th style={s.th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td style={s.td}>{u.id}</td>
                <td style={s.td}>{u.name}</td>
                <td style={s.td}>{u.email}</td>
                <td style={s.td}><span style={s.badge(u.role)}>{u.role}</span></td>
                <td style={s.td}>{new Date(u.created_at).toLocaleDateString()}</td>
                <td style={s.td}>
                  {u.active === 0
                    ? <span style={s.inactive}>Inactive</span>
                    : <span style={{ color: '#2d6a4f', fontSize: 12 }}>Active</span>}
                </td>
                <td style={s.td}>
                  {u.role !== 'admin' && u.active !== 0 && (
                    <button style={s.deactivate} onClick={() => handleDeactivate(u.id, u.name)}>
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={s.pagination}>
          <button
            style={s.pgBtn(pagination.page <= 1)}
            disabled={pagination.page <= 1}
            onClick={() => loadUsers(pagination.page - 1)}
          >← Prev</button>
          <span style={{ fontSize: 13, color: '#666' }}>Page {pagination.page} of {pagination.pages}</span>
          <button
            style={s.pgBtn(pagination.page >= pagination.pages)}
            disabled={pagination.page >= pagination.pages}
            onClick={() => loadUsers(pagination.page + 1)}
          >Next →</button>
        </div>
      </div>

      {/* Contract registry + simulation (registered contracts only) */}
      <div style={{ ...s.card, marginTop: 32 }}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>📜 Registered Soroban contracts</h3>
        {contractMsg && (
          <div style={{
            color: contractMsg.includes('registered') || contractMsg.includes('Deregister') ? '#2d6a4f' : '#c0392b',
            fontSize: 14,
            marginBottom: 12,
          }}
          >{contractMsg}</div>
        )}
        <form onSubmit={handleRegisterContract} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <input style={{ ...monoInputStyle, flex: '2 1 200px' }} placeholder="Contract ID" value={contractForm.contract_id} onChange={e => setContractForm(f => ({ ...f, contract_id: e.target.value }))} required />
          <input style={{ ...inputStyle, flex: '1 1 140px' }} placeholder="Display name" value={contractForm.name} onChange={e => setContractForm(f => ({ ...f, name: e.target.value }))} required />
          <select style={{ ...inputStyle }} value={contractForm.type} onChange={e => setContractForm(f => ({ ...f, type: e.target.value }))}>
            <option value="escrow">escrow</option>
            <option value="token">token</option>
            <option value="other">other</option>
          </select>
          <select style={{ ...inputStyle }} value={contractForm.network} onChange={e => setContractForm(f => ({ ...f, network: e.target.value }))}>
            <option value="testnet">testnet</option>
            <option value="mainnet">mainnet</option>
          </select>
          <button type="submit" style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#2d6a4f', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Register</button>
        </form>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#666' }}>Filter:</span>
          <select style={inputStyle} value={contractFilter.network} onChange={(e) => { const nf = { ...contractFilter, network: e.target.value }; setContractFilter(nf); loadContracts(nf); }}>
            <option value="">All networks</option>
            <option value="testnet">testnet</option>
            <option value="mainnet">mainnet</option>
          </select>
          <select style={inputStyle} value={contractFilter.type} onChange={(e) => { const tf = { ...contractFilter, type: e.target.value }; setContractFilter(tf); loadContracts(tf); }}>
            <option value="">All types</option>
            <option value="escrow">escrow</option>
            <option value="token">token</option>
            <option value="other">other</option>
          </select>
        </div>
        {contracts.length === 0 ? (
          <div style={{ color: '#888', fontSize: 14 }}>No contracts registered. Add one above to enable simulation for this deployment.</div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Name</th>
                <th style={s.th}>Contract ID</th>
                <th style={s.th}>Type</th>
                <th style={s.th}>Network</th>
                <th style={s.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id}>
                  <td style={s.td}>{c.name}</td>
                  <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{c.contract_id}</td>
                  <td style={s.td}>{c.type}</td>
                  <td style={s.td}>{c.network}</td>
                  <td style={s.td}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => { setSimContractId(c.contract_id); setSimFormError(''); setSimOutcome(null); }}
                        style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #2d6a4f', background: '#f0fdf4', color: '#2d6a4f', fontSize: 12, cursor: 'pointer' }}
                      >Simulate</button>
                      <button
                        type="button"
                        onClick={() => handleDeregisterContract(c.id)}
                        style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', fontSize: 12, cursor: 'pointer' }}
                      >Deregister</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h4 style={{ marginTop: 28, marginBottom: 12, color: '#444' }}>Simulate contract call</h4>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
          Runs Soroban <code style={{ fontSize: 12 }}>simulateTransaction</code> only (nothing is submitted). Each argument must be a JSON object with <code style={{ fontSize: 12 }}>type</code> and <code style={{ fontSize: 12 }}>value</code> for Stellar <code style={{ fontSize: 12 }}>nativeToScVal</code>.
        </p>
        <form onSubmit={handleSimulate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <select
            style={monoInputStyle}
            value={simContractId}
            onChange={(e) => setSimContractId(e.target.value)}
          >
            <option value="">— Select registered contract —</option>
            {contracts.map((c) => (
              <option key={c.id} value={c.contract_id}>{c.name} · {c.network}</option>
            ))}
          </select>
          <input
            style={inputStyle}
            placeholder="Method name (e.g. balance, deposit)"
            value={simMethod}
            onChange={(e) => setSimMethod(e.target.value)}
          />
          <textarea
            style={{ ...monoInputStyle, minHeight: 100, resize: 'vertical' }}
            placeholder='[{"type":"u64","value":"1"}]'
            value={simArgsJson}
            onChange={(e) => setSimArgsJson(e.target.value)}
          />
          {simFormError && <div style={s.err}>{simFormError}</div>}
          <button
            type="submit"
            disabled={simBusy || contracts.length === 0}
            style={{
              alignSelf: 'flex-start',
              padding: '8px 20px',
              borderRadius: 8,
              border: 'none',
              background: '#2d6a4f',
              color: '#fff',
              fontWeight: 600,
              cursor: simBusy || contracts.length === 0 ? 'not-allowed' : 'pointer',
              opacity: contracts.length === 0 ? 0.5 : 1,
            }}
          >{simBusy ? 'Simulating…' : 'Run simulation'}</button>
        </form>
        {simOutcome && (
          <div style={{ marginTop: 16, padding: 14, borderRadius: 8, background: simOutcome.success ? '#f0fdf4' : '#fff5f5', border: `1px solid ${simOutcome.success ? '#bbf7d0' : '#fecaca'}` }}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: '#333' }}>Result</div>
            <div style={{ fontSize: 13, fontFamily: 'monospace', wordBreak: 'break-all' }}>
              <div><strong>success:</strong> {String(simOutcome.success)}</div>
              {simOutcome.fee != null && <div><strong>fee (stroops):</strong> {simOutcome.fee}</div>}
              {simOutcome.error != null && simOutcome.error !== '' && <div style={{ color: '#b91c1c' }}><strong>error:</strong> {simOutcome.error}</div>}
              <div style={{ marginTop: 8 }}><strong>result:</strong> {JSON.stringify(simOutcome.result, null, 2)}</div>
            </div>
          </div>
        )}
      </div>

      {/* Soroban Contract State Viewer */}
      <div style={{ ...s.card, marginTop: 32 }}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>🔍 Soroban Contract State</h3>
        <form onSubmit={loadContractState} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <input
            style={{ flex: '2 1 260px', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, fontFamily: 'monospace' }}
            placeholder="Contract ID (base32 or hex)"
            value={contractId}
            onChange={e => setContractId(e.target.value)}
            required
          />
          <input
            style={{ flex: '1 1 140px', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }}
            placeholder="Key prefix (optional)"
            value={contractPrefix}
            onChange={e => setContractPrefix(e.target.value)}
          />
          <button
            type="submit"
            disabled={contractLoading}
            style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#2d6a4f', color: '#fff', fontWeight: 600, cursor: contractLoading ? 'not-allowed' : 'pointer' }}
          >{contractLoading ? 'Loading…' : 'Fetch State'}</button>
        </form>
        {contractError && <div style={s.err}>{contractError}</div>}
        {contractState && (
          contractState.length === 0
            ? <div style={{ color: '#888', fontSize: 14 }}>No storage entries found{contractPrefix ? ` matching prefix "${contractPrefix}"` : ''}.</div>
            : (
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Key</th>
                    <th style={s.th}>Value</th>
                    <th style={s.th}>Durability</th>
                  </tr>
                </thead>
                <tbody>
                  {contractState.map((entry, i) => (
                    <tr key={i}>
                      <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{String(entry.key)}</td>
                      <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{JSON.stringify(entry.val)}</td>
                      <td style={{ ...s.td, fontSize: 12 }}>
                        <span style={{ padding: '2px 8px', borderRadius: 12, fontWeight: 600, fontSize: 11,
                          background: entry.durability === 'Temporary' ? '#fff3cd' : '#d8f3dc',
                          color: entry.durability === 'Temporary' ? '#856404' : '#2d6a4f' }}>
                          {entry.durability}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
        )}
      </div>
      {/* Soroban Contract Event Log */}
      <div style={{ ...s.card, marginTop: 32 }}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>📋 Soroban Contract Event Log</h3>
        <form onSubmit={(e) => loadContractEvents(e, 1)} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <input
            style={{ ...s.input, flex: '2 1 240px', fontFamily: 'monospace' }}
            placeholder="Contract ID (base32 or hex)"
            value={evtContractId}
            onChange={e => setEvtContractId(e.target.value)}
            required
          />
          <select
            style={{ ...s.input, flex: '1 1 120px' }}
            value={evtFilters.type}
            onChange={e => setEvtFilters(f => ({ ...f, type: e.target.value }))}
          >
            <option value="">All types</option>
            <option value="contract">contract</option>
            <option value="system">system</option>
            <option value="diagnostic">diagnostic</option>
          </select>
          <input
            type="datetime-local"
            style={{ ...s.input, flex: '1 1 160px' }}
            placeholder="From"
            value={evtFilters.from}
            onChange={e => setEvtFilters(f => ({ ...f, from: e.target.value }))}
          />
          <input
            type="datetime-local"
            style={{ ...s.input, flex: '1 1 160px' }}
            placeholder="To"
            value={evtFilters.to}
            onChange={e => setEvtFilters(f => ({ ...f, to: e.target.value }))}
          />
          <button type="submit" disabled={evtLoading} style={s.btn(evtLoading)}>
            {evtLoading ? 'Loading…' : 'Fetch Events'}
          </button>
        </form>
        {evtError && <div style={s.err}>{evtError}</div>}
        {evtData && (
          evtData.events.length === 0
            ? <div style={{ color: '#888', fontSize: 14 }}>No events found for this contract.</div>
            : <>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Ledger</th>
                    <th style={s.th}>Timestamp</th>
                    <th style={s.th}>Type</th>
                    <th style={s.th}>Topics</th>
                    <th style={s.th}>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {evtData.events.map((ev) => (
                    <tr key={ev.id}>
                      <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 12 }}>{ev.ledger}</td>
                      <td style={{ ...s.td, fontSize: 12 }}>{ev.ledgerClosedAt ? new Date(ev.ledgerClosedAt).toLocaleString() : '—'}</td>
                      <td style={s.td}>
                        <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                          background: ev.type === 'contract' ? '#d8f3dc' : '#dfe6e9',
                          color: ev.type === 'contract' ? '#2d6a4f' : '#555' }}>
                          {ev.type}
                        </span>
                      </td>
                      <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', maxWidth: 220 }}>
                        {JSON.stringify(ev.topics)}
                      </td>
                      <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', maxWidth: 200 }}>
                        {JSON.stringify(ev.data)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={s.pagination}>
                <button
                  style={s.pgBtn(evtPage <= 1)}
                  disabled={evtPage <= 1}
                  onClick={() => loadContractEvents(null, evtPage - 1)}
                >← Prev</button>
                <span style={{ fontSize: 13, color: '#666' }}>
                  Page {evtData.pagination.page} of {evtData.pagination.pages} ({evtData.pagination.total} events)
                </span>
                <button
                  style={s.pgBtn(evtPage >= evtData.pagination.pages)}
                  disabled={evtPage >= evtData.pagination.pages}
                  onClick={() => loadContractEvents(null, evtPage + 1)}
                >Next →</button>
              </div>
            </>
        )}
      </div>
    </div>
  );
}
