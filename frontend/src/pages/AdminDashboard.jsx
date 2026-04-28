import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';

function DeactivateModal({ user, onConfirm, onCancel }) {
  const confirmRef = useRef(null);
  useEffect(() => { confirmRef.current?.focus(); }, []);
  function handleKeyDown(e) {
    if (e.key === 'Escape') onCancel();
  }
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="deactivate-modal-title"
      onKeyDown={handleKeyDown}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
    >
      <div style={{ background: '#fff', borderRadius: 12, padding: 28, maxWidth: 400, width: '90%', boxShadow: '0 4px 24px #0003' }}>
        <div id="deactivate-modal-title" style={{ fontWeight: 700, fontSize: 17, marginBottom: 10, color: '#333' }}>
          Deactivate {user.name}?
        </div>
        <p style={{ fontSize: 14, color: '#555', marginBottom: 20 }}>
          They will lose access immediately.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>
            Cancel
          </button>
          <button ref={confirmRef} onClick={onConfirm} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#c0392b', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
            Confirm Deactivate
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [orders, setOrders] = useState([]);
  const [orderPagination, setOrderPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [error, setError] = useState('');
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [contractForm, setContractForm] = useState({ contract_id: '', name: '', type: 'escrow', network: 'testnet' });
  const [contractMsg, setContractMsg] = useState('');
  const [contractFilter, setContractFilter] = useState({ network: '', type: '' });

  // Contract deployment
  const [deployForm, setDeployForm] = useState({ name: '', type: 'escrow', wasm: null });
  const [deployMsg, setDeployMsg] = useState('');
  const [deployBusy, setDeployBusy] = useState(false);

  // Contract state viewer
  const [contractId, setContractId] = useState('');
  const [contractPrefix, setContractPrefix] = useState('');
  const [contractState, setContractState] = useState(null);
  const [contractLoading, setContractLoading] = useState(false);
  const [contractError, setContractError] = useState('');
  const [exportFormat, setExportFormat] = useState('json');
  const [exportSinceLedger, setExportSinceLedger] = useState('');

  const [simContractId, setSimContractId] = useState('');
  const [simMethod, setSimMethod] = useState('');
  const [simArgsJson, setSimArgsJson] = useState('[]');
  const [simBusy, setSimBusy] = useState(false);
  const [simFormError, setSimFormError] = useState('');
  const [simOutcome, setSimOutcome] = useState(null);

  const [selectedRegistryId, setSelectedRegistryId] = useState(null);
  const [contractUpgrades, setContractUpgrades] = useState([]);
  const [upgradeDetailLoading, setUpgradeDetailLoading] = useState(false);
  const [upgradeDetailError, setUpgradeDetailError] = useState('');
  const [upgradeForm, setUpgradeForm] = useState({ old_wasm_hash: '', new_wasm_hash: '' });
  const [upgradeSubmitBusy, setUpgradeSubmitBusy] = useState(false);
  const [upgradeSubmitMsg, setUpgradeSubmitMsg] = useState('');
  const [upgradeHashErrors, setUpgradeHashErrors] = useState({ old_wasm_hash: '', new_wasm_hash: '' });

  const WASM_HASH_RE = /^[0-9a-f]{64}$/i;
  function validateWasmHash(value) {
    return WASM_HASH_RE.test(value) ? '' : 'WASM hash must be a 64-character hex string.';
  }

  const inputStyle = { padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 };
  const monoInputStyle = { ...inputStyle, fontFamily: 'monospace' };
  // Contract event log
  const [evtContractId, setEvtContractId] = useState('');
  const [evtFilters, setEvtFilters] = useState({ type: '', from: '', to: '' });
  const [evtPage, setEvtPage] = useState(1);
  const [evtData, setEvtData] = useState(null);
  const [evtLoading, setEvtLoading] = useState(false);
  const [evtError, setEvtError] = useState('');

  // Contract ACL
  const [aclRegistryId, setAclRegistryId] = useState('');
  const [aclEntries, setAclEntries] = useState([]);
  const [aclForm, setAclForm] = useState({ address: '', role: 'admin' });
  const [aclMsg, setAclMsg] = useState('');

  // Contract version comparison
  const [cmpRegistryId, setCmpRegistryId] = useState('');
  const [cmpV1, setCmpV1] = useState('');
  const [cmpV2, setCmpV2] = useState('');
  const [cmpResult, setCmpResult] = useState(null);
  const [cmpLoading, setCmpLoading] = useState(false);
  const [cmpError, setCmpError] = useState('');
  // Contract alerts
  const [contractAlerts, setContractAlerts] = useState([]);
  const [alertsFilter, setAlertsFilter] = useState('unacknowledged');
  const [alertsLoading, setAlertsLoading] = useState(false);

  async function loadContractAlerts(filter = alertsFilter) {
    setAlertsLoading(true);
    try {
      const acknowledged = filter === 'all' ? undefined : filter === 'acknowledged' ? true : false;
      const res = await api.adminGetContractAlerts(acknowledged);
      setContractAlerts(res.data ?? []);
    } catch (e) { console.error(e); }
    finally { setAlertsLoading(false); }
  }

  async function acknowledgeAlert(id) {
    await api.adminAcknowledgeContractAlert(id);
    loadContractAlerts();
  }
  // Contract invocation history
  const [invocRegistryId, setInvocRegistryId] = useState('');
  const [invocFilters, setInvocFilters] = useState({ method: '', from: '', to: '' });
  const [invocPage, setInvocPage] = useState(1);
  const [invocData, setInvocData] = useState(null);
  const [invocLoading, setInvocLoading] = useState(false);
  const [invocError, setInvocError] = useState('');

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
      setSearchParams(prev => { const p = new URLSearchParams(prev); p.set('usersPage', page); return p; });
    } catch (e) { setError(e.message); }
  }

  async function loadOrders(page = 1) {
    try {
      const res = await api.adminGetOrders(page);
      setOrders(res.data);
      setOrderPagination(res.pagination);
      setSearchParams(prev => { const p = new URLSearchParams(prev); p.set('ordersPage', page); return p; });
    } catch (e) { setError(e.message); }
  }

  useEffect(() => {
    const usersPage = parseInt(searchParams.get('usersPage') || '1');
    const ordersPage = parseInt(searchParams.get('ordersPage') || '1');
    loadStats();
    loadUsers(usersPage);
    loadOrders(ordersPage);
    loadContracts();
    loadContractAlerts('unacknowledged');
    loadAnnouncements();
  }, []);

  // Announcements
  const [announcements, setAnnouncements] = useState([]);
  const [annForm, setAnnForm] = useState({ message: '', type: 'info', expires_at: '' });
  const [annMsg, setAnnMsg] = useState('');
  const [editingAnn, setEditingAnn] = useState(null);

  async function loadAnnouncements() {
    try { const res = await api.adminGetAnnouncements(); setAnnouncements(res.data ?? []); } catch {}
  }

  async function handleAnnSubmit(e) {
    e.preventDefault();
    try {
      const body = { ...annForm, expires_at: annForm.expires_at || null };
      if (editingAnn) {
        await api.adminUpdateAnnouncement(editingAnn, body);
        setAnnMsg('Updated.');
        setEditingAnn(null);
      } else {
        await api.adminCreateAnnouncement(body);
        setAnnMsg('Created.');
      }
      setAnnForm({ message: '', type: 'info', expires_at: '' });
      loadAnnouncements();
    } catch (err) { setAnnMsg(err.message); }
  }

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

  async function handleDeployContract(e) {
    e.preventDefault();
    setDeployMsg('');
    if (!deployForm.wasm) {
      setDeployMsg('Please select a WASM file.');
      return;
    }
    setDeployBusy(true);
    try {
      const formData = new FormData();
      formData.append('wasm', deployForm.wasm);
      formData.append('name', deployForm.name);
      formData.append('type', deployForm.type);
      const res = await api.adminDeployContract(formData);
      setDeployForm({ name: '', type: 'escrow', wasm: null });
      setDeployMsg(`Contract deployed! ID: ${res.data.contract_id}`);
      loadContracts();
    } catch (err) {
      setDeployMsg(err.message);
    } finally {
      setDeployBusy(false);
    }
  }

  async function handleDeregisterContract(id) {
    if (!confirm('Deregister this contract?')) return;
    try {
      await api.adminDeregisterContract(id);
      loadContracts();
    } catch (e) { setContractMsg(e.message); }
  }

  async function handleDeactivate(id, name) {
    setDeactivateTarget({ id, name });
  }

  async function confirmDeactivate() {
    const { id } = deactivateTarget;
    setDeactivateTarget(null);
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

  async function loadContractUpgrades(registryId) {
    setUpgradeDetailError('');
    setUpgradeDetailLoading(true);
    try {
      const res = await api.adminGetContractUpgrades(registryId);
      setContractUpgrades(res.data ?? []);
    } catch (e) {
      setUpgradeDetailError(e.message);
      setContractUpgrades([]);
    } finally {
      setUpgradeDetailLoading(false);
    }
  }

  function openContractDetail(c) {
    setSelectedRegistryId(c.id);
    setUpgradeForm({ old_wasm_hash: '', new_wasm_hash: '' });
    setUpgradeSubmitMsg('');
    setUpgradeDetailError('');
    loadContractUpgrades(c.id);
  }

  async function handleRecordUpgrade(e) {
    e.preventDefault();
    if (!selectedRegistryId) return;
    setUpgradeSubmitMsg('');
    setUpgradeSubmitBusy(true);
    try {
      await api.adminRecordContractUpgrade(selectedRegistryId, upgradeForm);
      setUpgradeForm({ old_wasm_hash: '', new_wasm_hash: '' });
      setUpgradeSubmitMsg('Upgrade recorded.');
      await loadContractUpgrades(selectedRegistryId);
    } catch (err) {
      setUpgradeSubmitMsg(err.message || 'Failed to record upgrade');
    } finally {
      setUpgradeSubmitBusy(false);
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
    }
  }

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

  async function loadContractInvocations(e, page = 1) {
    if (e) e.preventDefault();
    if (!invocRegistryId) return;
    setInvocLoading(true);
    setInvocError('');
    try {
      const params = { ...invocFilters, page };
      Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
      const res = await api.adminGetContractInvocations(invocRegistryId, params);
      setInvocData(res);
      setInvocPage(page);
    } catch (e) {
      setInvocError(e.message);
    } finally {
      setInvocLoading(false);
    }
  }

  return (
    <div style={s.page}>
      {deactivateTarget && (
        <DeactivateModal
          user={deactivateTarget}
          onConfirm={confirmDeactivate}
          onCancel={() => setDeactivateTarget(null)}
        />
      )}
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

      {/* Orders Table */}
      <div style={{ ...s.card, marginTop: 32 }}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>Orders ({orderPagination.total})</h3>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>ID</th>
              <th style={s.th}>Buyer</th>
              <th style={s.th}>Product</th>
              <th style={s.th}>Qty</th>
              <th style={s.th}>Total (XLM)</th>
              <th style={s.th}>Status</th>
              <th style={s.th}>Date</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id}>
                <td style={s.td}>{o.id}</td>
                <td style={s.td}>{o.buyer_name || o.buyer_id}</td>
                <td style={s.td}>{o.product_name || o.product_id}</td>
                <td style={s.td}>{o.quantity}</td>
                <td style={s.td}>{Number(o.total_price).toFixed(2)}</td>
                <td style={s.td}>{o.status}</td>
                <td style={s.td}>{new Date(o.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={s.pagination}>
          <button
            style={s.pgBtn(orderPagination.page <= 1)}
            disabled={orderPagination.page <= 1}
            onClick={() => loadOrders(orderPagination.page - 1)}
          >← Prev</button>
          <span style={{ fontSize: 13, color: '#666' }}>Page {orderPagination.page} of {orderPagination.pages}</span>
          <button
            style={s.pgBtn(orderPagination.page >= orderPagination.pages)}
            disabled={orderPagination.page >= orderPagination.pages}
            onClick={() => loadOrders(orderPagination.page + 1)}
          >Next →</button>
        </div>
      </div>

      {/* Contract Deployment */}
      <div style={{ ...s.card, marginTop: 32 }}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>🚀 Deploy Soroban Contract</h3>
        {deployMsg && (
          <div style={{
            color: deployMsg.includes('deployed') ? '#2d6a4f' : '#c0392b',
            fontSize: 14,
            marginBottom: 12,
          }}
          >{deployMsg}</div>
        )}
        <form onSubmit={handleDeployContract} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <input
            style={{ ...inputStyle, flex: '1 1 140px' }}
            placeholder="Display name"
            value={deployForm.name}
            onChange={e => setDeployForm(f => ({ ...f, name: e.target.value }))}
            required
          />
          <select
            style={{ ...inputStyle }}
            value={deployForm.type}
            onChange={e => setDeployForm(f => ({ ...f, type: e.target.value }))}
          >
            <option value="escrow">escrow</option>
            <option value="token">token</option>
            <option value="other">other</option>
          </select>
          <input
            type="file"
            accept=".wasm"
            onChange={e => setDeployForm(f => ({ ...f, wasm: e.target.files[0] }))}
            style={{ ...inputStyle, flex: '2 1 200px' }}
            required
          />
          <button
            type="submit"
            disabled={deployBusy}
            style={{
              padding: '8px 18px',
              borderRadius: 8,
              border: 'none',
              background: deployBusy ? '#ccc' : '#2d6a4f',
              color: '#fff',
              fontWeight: 600,
              cursor: deployBusy ? 'not-allowed' : 'pointer'
            }}
          >
            {deployBusy ? 'Deploying...' : 'Deploy Contract'}
          </button>
        </form>
        <div style={{ fontSize: 13, color: '#666' }}>
          Upload a compiled .wasm file to deploy a new Soroban contract to the network.
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
                        onClick={() => openContractDetail(c)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 6,
                          border: selectedRegistryId === c.id ? '2px solid #2d6a4f' : '1px solid #ccc',
                          background: selectedRegistryId === c.id ? '#e8f5e9' : '#fff',
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >Details</button>
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

        {selectedRegistryId != null && (
          <div style={{ marginTop: 24, padding: 16, borderRadius: 10, border: '1px solid #e0e0e0', background: '#fafafa' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <h4 style={{ margin: 0, color: '#333' }}>
                Contract #{selectedRegistryId}
                {contracts.find((x) => x.id === selectedRegistryId)?.name
                  ? ` — ${contracts.find((x) => x.id === selectedRegistryId).name}`
                  : ''}
                <span style={{ fontWeight: 400, fontSize: 13, color: '#666', marginLeft: 8 }}>WASM upgrade history</span>
              </h4>
              <button
                type="button"
                onClick={() => { setSelectedRegistryId(null); setContractUpgrades([]); setUpgradeSubmitMsg(''); setUpgradeDetailError(''); }}
                style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #ccc', background: '#fff', fontSize: 12, cursor: 'pointer' }}
              >Close</button>
            </div>
            <p style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
              Each row is immutable. <code style={{ fontSize: 11 }}>new_wasm_hash</code> must match the hash Soroban RPC reports for the contract after upgrade.
            </p>
            {upgradeDetailError && <div style={s.err}>{upgradeDetailError}</div>}
            {upgradeDetailLoading ? (
              <div style={{ color: '#666', fontSize: 14 }}>Loading history…</div>
            ) : contractUpgrades.length === 0 ? (
              <div style={{ color: '#888', fontSize: 14, marginBottom: 16 }}>No upgrades recorded yet.</div>
            ) : (
              <table style={{ ...s.table, marginBottom: 20 }}>
                <thead>
                  <tr>
                    <th style={s.th}>When</th>
                    <th style={s.th}>Old WASM hash</th>
                    <th style={s.th}>New WASM hash</th>
                    <th style={s.th}>Recorded by</th>
                  </tr>
                </thead>
                <tbody>
                  {contractUpgrades.map((u) => (
                    <tr key={u.id}>
                      <td style={s.td}>{u.upgraded_at ? new Date(u.upgraded_at).toLocaleString() : '—'}</td>
                      <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{u.old_wasm_hash}</td>
                      <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{u.new_wasm_hash}</td>
                      <td style={s.td}>{u.upgraded_by_name || `user #${u.upgraded_by}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ fontWeight: 600, marginBottom: 8, color: '#444' }}>Record upgrade</div>
            <form onSubmit={handleRecordUpgrade} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 560 }}>
              <div>
                <input
                  style={{ ...monoInputStyle, borderColor: upgradeHashErrors.old_wasm_hash ? '#c0392b' : '#ddd' }}
                  placeholder="Previous WASM hash (64 hex chars)"
                  value={upgradeForm.old_wasm_hash}
                  onChange={(e) => {
                    const v = e.target.value;
                    setUpgradeForm((f) => ({ ...f, old_wasm_hash: v }));
                    setUpgradeHashErrors((err) => ({ ...err, old_wasm_hash: v ? validateWasmHash(v) : '' }));
                  }}
                  required
                />
                {upgradeHashErrors.old_wasm_hash && (
                  <div style={{ color: '#c0392b', fontSize: 12, marginTop: 2 }}>{upgradeHashErrors.old_wasm_hash}</div>
                )}
              </div>
              <div>
                <input
                  style={{ ...monoInputStyle, borderColor: upgradeHashErrors.new_wasm_hash ? '#c0392b' : '#ddd' }}
                  placeholder="New WASM hash — must match Soroban RPC (64 hex)"
                  value={upgradeForm.new_wasm_hash}
                  onChange={(e) => {
                    const v = e.target.value;
                    setUpgradeForm((f) => ({ ...f, new_wasm_hash: v }));
                    setUpgradeHashErrors((err) => ({ ...err, new_wasm_hash: v ? validateWasmHash(v) : '' }));
                  }}
                  required
                />
                {upgradeHashErrors.new_wasm_hash && (
                  <div style={{ color: '#c0392b', fontSize: 12, marginTop: 2 }}>{upgradeHashErrors.new_wasm_hash}</div>
                )}
              </div>
              {upgradeSubmitMsg && (
                <div style={{
                  fontSize: 13,
                  color: upgradeSubmitMsg.includes('recorded') ? '#2d6a4f' : '#c0392b',
                }}
                >{upgradeSubmitMsg}</div>
              )}
              <button
                type="submit"
                disabled={upgradeSubmitBusy || !!upgradeHashErrors.old_wasm_hash || !!upgradeHashErrors.new_wasm_hash}
                style={{
                  alignSelf: 'flex-start',
                  padding: '8px 18px',
                  borderRadius: 8,
                  border: 'none',
                  background: (upgradeSubmitBusy || upgradeHashErrors.old_wasm_hash || upgradeHashErrors.new_wasm_hash) ? '#ccc' : '#2d6a4f',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: (upgradeSubmitBusy || upgradeHashErrors.old_wasm_hash || upgradeHashErrors.new_wasm_hash) ? 'not-allowed' : 'pointer',
                }}
              >{upgradeSubmitBusy ? 'Saving…' : 'Save upgrade record'}</button>
            </form>
          </div>
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
              <>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                  <select
                    value={exportFormat}
                    onChange={e => setExportFormat(e.target.value)}
                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}
                  >
                    <option value="json">JSON</option>
                    <option value="csv">CSV</option>
                  </select>
                  <input
                    type="number"
                    placeholder="Since ledger (optional)"
                    value={exportSinceLedger}
                    onChange={e => setExportSinceLedger(e.target.value)}
                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13, width: 180 }}
                  />
                  {(() => {
                    const reg = contracts.find(c => c.contract_id === contractId.trim());
                    if (!reg) return null;
                    return (
                      <button
                        type="button"
                        onClick={() => api.adminExportContractState(reg.id, exportFormat, exportSinceLedger || undefined).catch(e => setContractError(e.message))}
                        style={{ padding: '6px 16px', borderRadius: 6, background: '#1d4ed8', color: '#fff', fontWeight: 600, fontSize: 13, border: 'none', cursor: 'pointer' }}
                      >⬇ Export</button>
                    );
                  })()}
                </div>
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
              </>
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

      {/* Contract ACL Management */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001', marginBottom: 24 }}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>🔐 Contract Access Control (ACL)</h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}>
          <select
            style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }}
            value={aclRegistryId}
            onChange={async (e) => {
              setAclRegistryId(e.target.value);
              setAclEntries([]);
              setAclMsg('');
              if (e.target.value) {
                try {
                  const res = await api.adminGetContractAcl(e.target.value);
                  setAclEntries(res.data ?? []);
                } catch (err) { setAclMsg(err.message); }
              }
            }}
          >
            <option value="">— Select contract —</option>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>{c.name} · {c.network}</option>
            ))}
          </select>
        </div>

        {aclRegistryId && (
          <>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setAclMsg('');
                try {
                  await api.adminGrantContractAcl(aclRegistryId, aclForm);
                  setAclForm({ address: '', role: 'admin' });
                  const res = await api.adminGetContractAcl(aclRegistryId);
                  setAclEntries(res.data ?? []);
                  setAclMsg('Access granted.');
                } catch (err) { setAclMsg(err.message); }
              }}
              style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}
            >
              <input
                style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, flex: 1, minWidth: 300, fontFamily: 'monospace' }}
                placeholder="Stellar address (G...)"
                value={aclForm.address}
                onChange={(e) => setAclForm((f) => ({ ...f, address: e.target.value.trim() }))}
                required
              />
              <select
                style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }}
                value={aclForm.role}
                onChange={(e) => setAclForm((f) => ({ ...f, role: e.target.value }))}
              >
                <option value="admin">admin</option>
                <option value="operator">operator</option>
                <option value="viewer">viewer</option>
              </select>
              <button type="submit" style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#2d6a4f', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                Grant
              </button>
            </form>

            {aclMsg && <div style={{ fontSize: 13, color: aclMsg.includes('granted') ? '#2d6a4f' : '#c0392b', marginBottom: 12 }}>{aclMsg}</div>}

            {aclEntries.length === 0 ? (
              <div style={{ color: '#888', fontSize: 14 }}>No ACL entries for this contract.</div>
            ) : (
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #eee', textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px' }}>Address</th>
                    <th style={{ padding: '6px 8px' }}>Role</th>
                    <th style={{ padding: '6px 8px' }}>Granted by</th>
                    <th style={{ padding: '6px 8px' }}>Granted at</th>
                    <th style={{ padding: '6px 8px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {aclEntries.map((entry) => (
                    <tr key={entry.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 12 }}>{entry.address}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <span style={{ background: '#d8f3dc', color: '#2d6a4f', borderRadius: 4, padding: '2px 8px', fontWeight: 600 }}>{entry.role}</span>
                      </td>
                      <td style={{ padding: '6px 8px', color: '#666' }}>{entry.granted_by_name ?? '—'}</td>
                      <td style={{ padding: '6px 8px', color: '#888' }}>{new Date(entry.granted_at).toLocaleString()}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <button
                          style={{ padding: '3px 10px', borderRadius: 6, border: 'none', background: '#fee', color: '#c0392b', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                          onClick={async () => {
                            if (!confirm(`Revoke access for ${entry.address}?`)) return;
                            try {
                              await api.adminRevokeContractAcl(aclRegistryId, entry.address);
                              const res = await api.adminGetContractAcl(aclRegistryId);
                              setAclEntries(res.data ?? []);
                              setAclMsg('Access revoked.');
                            } catch (err) { setAclMsg(err.message); }
                          }}
                        >Revoke</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {/* Contract Version Comparison */}
      <div style={{ ...s.card, marginTop: 24 }}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>🔀 Contract Version Comparison</h3>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
          Compare function signatures between two WASM versions of a registered contract.
          Results are cached for 10 minutes.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 10, alignItems: 'end', marginBottom: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4, color: '#555' }}>Registry ID</label>
            <input style={inputStyle} type="number" placeholder="Contract registry ID" value={cmpRegistryId} onChange={(e) => setCmpRegistryId(e.target.value)} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4, color: '#555' }}>v1 WASM Hash (old)</label>
            <input style={monoInputStyle} placeholder="64-char hex" value={cmpV1} onChange={(e) => setCmpV1(e.target.value)} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4, color: '#555' }}>v2 WASM Hash (new)</label>
            <input style={monoInputStyle} placeholder="64-char hex" value={cmpV2} onChange={(e) => setCmpV2(e.target.value)} />
          </div>
          <button
            style={s.btn(cmpLoading)}
            disabled={cmpLoading}
            onClick={async () => {
              setCmpError('');
              setCmpResult(null);
              if (!cmpRegistryId || !cmpV1.trim() || !cmpV2.trim()) {
                setCmpError('Registry ID, v1, and v2 are required.');
                return;
              }
              setCmpLoading(true);
              try {
                const res = await api.adminCompareContractVersions(cmpRegistryId, cmpV1.trim(), cmpV2.trim());
                setCmpResult(res.data);
              } catch (err) {
                setCmpError(err.message || 'Comparison failed');
              } finally {
                setCmpLoading(false);
              }
            }}
          >
            {cmpLoading ? 'Comparing…' : 'Compare'}
          </button>
        </div>
        {cmpError && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 12 }}>{cmpError}</div>}
        {cmpResult && (
          <div>
            {cmpResult.added.length === 0 && cmpResult.removed.length === 0 && cmpResult.changed.length === 0 ? (
              <div style={{ color: '#2d6a4f', fontSize: 14 }}>✅ Identical — no differences found.</div>
            ) : (
              <>
                {cmpResult.added.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, color: '#2d6a4f', marginBottom: 6 }}>➕ Added ({cmpResult.added.length})</div>
                    {cmpResult.added.map((fn) => (
                      <div key={fn.name} style={{ background: '#d8f3dc', borderRadius: 6, padding: '6px 10px', marginBottom: 4, fontFamily: 'monospace', fontSize: 13 }}>
                        <strong>{fn.name}</strong> {fn.signature}
                      </div>
                    ))}
                  </div>
                )}
                {cmpResult.removed.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, color: '#c0392b', marginBottom: 6 }}>➖ Removed ({cmpResult.removed.length})</div>
                    {cmpResult.removed.map((fn) => (
                      <div key={fn.name} style={{ background: '#fee', borderRadius: 6, padding: '6px 10px', marginBottom: 4, fontFamily: 'monospace', fontSize: 13 }}>
                        <strong>{fn.name}</strong> {fn.signature}
                      </div>
                    ))}
                  </div>
                )}
                {cmpResult.changed.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, color: '#b8860b', marginBottom: 6 }}>✏️ Changed ({cmpResult.changed.length})</div>
                    {cmpResult.changed.map((fn) => (
                      <div key={fn.name} style={{ background: '#ffeaa7', borderRadius: 6, padding: '6px 10px', marginBottom: 4, fontFamily: 'monospace', fontSize: 13 }}>
                        <strong>{fn.name}</strong><br />
                        <span style={{ color: '#c0392b' }}>− {fn.old_signature}</span><br />
                        <span style={{ color: '#2d6a4f' }}>+ {fn.new_signature}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {cmpResult.cached && <div style={{ fontSize: 11, color: '#aaa', marginTop: 8 }}>Cached result</div>}
          </div>
        )}
      </div>
      {/* Contract Alerts */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001', marginBottom: 24 }}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>🚨 Contract Monitoring Alerts</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {['unacknowledged', 'acknowledged', 'all'].map((f) => (
            <button
              key={f}
              onClick={() => { setAlertsFilter(f); loadContractAlerts(f); }}
              style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #ddd', cursor: 'pointer', fontWeight: alertsFilter === f ? 700 : 400, background: alertsFilter === f ? '#2d6a4f' : '#fff', color: alertsFilter === f ? '#fff' : '#333' }}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        {alertsLoading ? (
          <div style={{ color: '#888', fontSize: 14 }}>Loading…</div>
        ) : contractAlerts.length === 0 ? (
          <div style={{ color: '#888', fontSize: 14 }}>No alerts.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #eee', textAlign: 'left' }}>
                <th style={{ padding: '8px 10px' }}>Contract ID</th>
                <th style={{ padding: '8px 10px' }}>Type</th>
                <th style={{ padding: '8px 10px' }}>Message</th>
                <th style={{ padding: '8px 10px' }}>Time</th>
                <th style={{ padding: '8px 10px' }}></th>
              </tr>
            </thead>
            <tbody>
              {contractAlerts.map((a) => (
                <tr key={a.id} style={{ borderBottom: '1px solid #f0f0f0', background: a.acknowledged ? '#fafafa' : '#fffbf0' }}>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: 12 }}>{a.contract_id}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ background: a.alert_type === 'large_transfer' ? '#ffeaa7' : '#fde8e8', color: a.alert_type === 'large_transfer' ? '#b8860b' : '#c0392b', borderRadius: 4, padding: '2px 8px', fontWeight: 600, fontSize: 12 }}>
                      {a.alert_type}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px', color: '#444' }}>{a.message}</td>
                  <td style={{ padding: '8px 10px', color: '#888', whiteSpace: 'nowrap' }}>{new Date(a.created_at).toLocaleString()}</td>
                  <td style={{ padding: '8px 10px' }}>
                    {!a.acknowledged && (
                      <button
                        onClick={() => acknowledgeAlert(a.id)}
                        style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: '#d8f3dc', color: '#2d6a4f', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}
                      >
                        Acknowledge
                      </button>
                    )}
                    {!!a.acknowledged && <span style={{ color: '#aaa', fontSize: 12 }}>✓ Acknowledged</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {/* Contract Invocation History */}
      <div style={{ ...s.card, marginTop: 32 }}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>📑 Contract Invocation History</h3>
        <form onSubmit={(e) => loadContractInvocations(e, 1)} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <select
            style={{ ...s.input, flex: '2 1 200px' }}
            value={invocRegistryId}
            onChange={(e) => { setInvocRegistryId(e.target.value); setInvocData(null); }}
            required
          >
            <option value="">— Select contract —</option>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>{c.name} · {c.network}</option>
            ))}
          </select>
          <input
            style={{ ...s.input, flex: '1 1 120px' }}
            placeholder="Method filter"
            value={invocFilters.method}
            onChange={(e) => setInvocFilters((f) => ({ ...f, method: e.target.value }))}
          />
          <input
            type="datetime-local"
            style={{ ...s.input, flex: '1 1 160px' }}
            value={invocFilters.from}
            onChange={(e) => setInvocFilters((f) => ({ ...f, from: e.target.value }))}
          />
          <input
            type="datetime-local"
            style={{ ...s.input, flex: '1 1 160px' }}
            value={invocFilters.to}
            onChange={(e) => setInvocFilters((f) => ({ ...f, to: e.target.value }))}
          />
          <button type="submit" disabled={invocLoading || !invocRegistryId} style={s.btn(invocLoading)}>
            {invocLoading ? 'Loading…' : 'Fetch'}
          </button>
        </form>
        {invocError && <div style={s.err}>{invocError}</div>}
        {invocData && (
          invocData.data.length === 0
            ? <div style={{ color: '#888', fontSize: 14 }}>No invocations found.</div>
            : <>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>When</th>
                    <th style={s.th}>Method</th>
                    <th style={s.th}>Status</th>
                    <th style={s.th}>TX Hash</th>
                    <th style={s.th}>Invoked by</th>
                    <th style={s.th}>Result / Error</th>
                  </tr>
                </thead>
                <tbody>
                  {invocData.data.map((inv) => (
                    <tr key={inv.id}>
                      <td style={{ ...s.td, fontSize: 12 }}>{new Date(inv.invoked_at).toLocaleString()}</td>
                      <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 12 }}>{inv.method}</td>
                      <td style={s.td}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                          background: inv.success ? '#d8f3dc' : '#fee',
                          color: inv.success ? '#2d6a4f' : '#c0392b',
                        }}>
                          {inv.success ? 'success' : 'failed'}
                        </span>
                      </td>
                      <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', maxWidth: 160 }}>
                        {inv.tx_hash || '—'}
                      </td>
                      <td style={{ ...s.td, fontSize: 12 }}>{inv.invoked_by_name || `#${inv.invoked_by || '?'}`}</td>
                      <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', maxWidth: 200, color: inv.success ? '#333' : '#c0392b' }}>
                        {inv.success ? (inv.result ? JSON.stringify(JSON.parse(inv.result)) : '—') : (inv.error || '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={s.pagination}>
                <button style={s.pgBtn(invocPage <= 1)} disabled={invocPage <= 1} onClick={() => loadContractInvocations(null, invocPage - 1)}>← Prev</button>
                <span style={{ fontSize: 13, color: '#666' }}>
                  Page {invocData.pagination.page} of {invocData.pagination.pages} ({invocData.pagination.total} total)
                </span>
                <button style={s.pgBtn(invocPage >= invocData.pagination.pages)} disabled={invocPage >= invocData.pagination.pages} onClick={() => loadContractInvocations(null, invocPage + 1)}>Next →</button>
              </div>
            </>
        )}
      </div>
      {/* Announcements Management */}
      <div style={{ ...s.card, marginTop: 32 }}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>📢 Announcements</h3>
        <form onSubmit={handleAnnSubmit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <textarea
            required
            placeholder="Message (markdown supported)"
            value={annForm.message}
            onChange={e => setAnnForm(f => ({ ...f, message: e.target.value }))}
            style={{ flex: '3 1 260px', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, resize: 'vertical', minHeight: 60 }}
          />
          <select value={annForm.type} onChange={e => setAnnForm(f => ({ ...f, type: e.target.value }))}
            style={{ flex: '0 0 110px', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }}>
            <option value="info">ℹ info</option>
            <option value="warning">⚠ warning</option>
            <option value="error">🔴 error</option>
          </select>
          <input type="datetime-local" value={annForm.expires_at}
            onChange={e => setAnnForm(f => ({ ...f, expires_at: e.target.value }))}
            style={{ flex: '1 1 180px', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }}
            title="Expires at (optional)" />
          <button type="submit" style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#2d6a4f', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
            {editingAnn ? 'Update' : 'Create'}
          </button>
          {editingAnn && (
            <button type="button" onClick={() => { setEditingAnn(null); setAnnForm({ message: '', type: 'info', expires_at: '' }); }}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}>Cancel</button>
          )}
        </form>
        {annMsg && <div style={{ fontSize: 13, color: '#2d6a4f', marginBottom: 10 }}>{annMsg}</div>}
        {announcements.length === 0
          ? <div style={{ color: '#888', fontSize: 14 }}>No announcements yet.</div>
          : (
            <table style={s.table}>
              <thead><tr>
                <th style={s.th}>Message</th>
                <th style={s.th}>Type</th>
                <th style={s.th}>Active</th>
                <th style={s.th}>Expires</th>
                <th style={s.th}></th>
              </tr></thead>
              <tbody>
                {announcements.map(a => (
                  <tr key={a.id}>
                    <td style={{ ...s.td, fontSize: 13, maxWidth: 320, wordBreak: 'break-word' }}>{a.message}</td>
                    <td style={s.td}><span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                      background: a.type === 'error' ? '#fee2e2' : a.type === 'warning' ? '#fef9c3' : '#dbeafe',
                      color: a.type === 'error' ? '#991b1b' : a.type === 'warning' ? '#854d0e' : '#1e40af' }}>{a.type}</span></td>
                    <td style={s.td}>
                      <button onClick={async () => { await api.adminUpdateAnnouncement(a.id, { active: a.active ? 0 : 1 }); loadAnnouncements(); }}
                        style={{ padding: '2px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                          background: a.active ? '#d8f3dc' : '#f3f4f6', color: a.active ? '#2d6a4f' : '#888' }}>
                        {a.active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td style={{ ...s.td, fontSize: 12, color: '#888' }}>{a.expires_at ? new Date(a.expires_at).toLocaleString() : '—'}</td>
                    <td style={{ ...s.td, display: 'flex', gap: 6 }}>
                      <button onClick={() => { setEditingAnn(a.id); setAnnForm({ message: a.message, type: a.type, expires_at: a.expires_at ? a.expires_at.slice(0, 16) : '' }); setAnnMsg(''); }}
                        style={{ padding: '3px 10px', borderRadius: 6, border: 'none', background: '#e0f2fe', color: '#0369a1', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Edit</button>
                      <button onClick={async () => { if (!confirm('Delete?')) return; await api.adminDeleteAnnouncement(a.id); loadAnnouncements(); }}
                        style={{ padding: '3px 10px', borderRadius: 6, border: 'none', background: '#fee2e2', color: '#c0392b', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}