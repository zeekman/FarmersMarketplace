import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useConfirm } from '../hooks/useConfirm';
import AdminAnalyticsSummary from '../components/admin/AdminAnalyticsSummary';
import AdminUsersPanel from '../components/admin/AdminUsersPanel';
import AdminOrdersPanel from '../components/admin/AdminOrdersPanel';
import AdminDisputesPanel from '../components/admin/AdminDisputesPanel';
import ResolveDisputeModal from '../components/admin/ResolveDisputeModal';
import AdminAnnouncementsPanel from '../components/admin/AdminAnnouncementsPanel';

import { getErrorMessage } from '../utils/errorMessages';
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
      <div style={{ background: 'var(--color-bg-primary)', borderRadius: 12, padding: 28, maxWidth: 400, width: '90%', boxShadow: 'var(--shadow-lg)' }}>
        <div id="deactivate-modal-title" style={{ fontWeight: 700, fontSize: 17, marginBottom: 10, color: 'var(--color-text-primary)' }}>
          Deactivate {user.name}?
        </div>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 20 }}>
          They will lose access immediately.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)', cursor: 'pointer', fontWeight: 600 }}>
            Cancel
          </button>
          <button ref={confirmRef} onClick={onConfirm} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--color-danger)', color: 'var(--color-text-inverse)', cursor: 'pointer', fontWeight: 600 }}>
            Confirm Deactivate
          </button>
        </div>
      </div>
    </div>
  );
}

function BanModal({ user, onConfirm, onCancel, loading }) {
  const confirmRef = useRef(null);
  const [reason, setReason] = useState('');
  useEffect(() => { confirmRef.current?.focus(); }, []);
  function handleKeyDown(e) {
    if (e.key === 'Escape') onCancel();
  }
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ban-modal-title"
      onKeyDown={handleKeyDown}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
    >
      <div style={{ background: 'var(--color-bg-primary)', borderRadius: 12, padding: 28, maxWidth: 400, width: '90%', boxShadow: 'var(--shadow-lg)' }}>
        <div id="ban-modal-title" style={{ fontWeight: 700, fontSize: 17, marginBottom: 10, color: 'var(--color-text-primary)' }}>
          Ban {user.name}?
        </div>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 14 }}>
          This user will be unable to access the platform.
        </p>
        <textarea
          ref={confirmRef}
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Optional ban reason (visible to user)…"
          style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 14, resize: 'vertical', minHeight: 60, boxSizing: 'border-box', marginBottom: 16 }}
        />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} disabled={loading} style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600, color: loading ? 'var(--color-text-muted)' : 'var(--color-text-primary)' }}>
            Cancel
          </button>
          <button onClick={() => onConfirm(reason)} disabled={loading} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: loading ? 'var(--color-border)' : 'var(--color-danger)', color: 'var(--color-text-inverse)', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
            {loading ? 'Banning…' : 'Ban User'}
          </button>
        </div>
      </div>
    </div>
  );
}

const s = {
  page: { maxWidth: 1000, margin: '0 auto', padding: 24 },
  title: { fontSize: 24, fontWeight: 700, color: 'var(--color-primary)', marginBottom: 24 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 },
  stat: { background: 'var(--color-bg-primary)', borderRadius: 12, padding: 20, boxShadow: 'var(--shadow-md)', textAlign: 'center' },
  statVal: { fontSize: 28, fontWeight: 700, color: 'var(--color-primary)' },
  statLabel: { fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 },
  card: { background: 'var(--color-bg-primary)', borderRadius: 12, padding: 24, boxShadow: 'var(--shadow-md)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid var(--color-border-light)', color: 'var(--color-text-secondary)', fontWeight: 600 },
  td: { padding: '10px 12px', borderBottom: '1px solid var(--color-border-light)' },
  badge: (role) => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600,
    background: role === 'admin' ? 'var(--color-warning-lightest)' : role === 'farmer' ? 'var(--color-primary-lightest)' : 'var(--color-bg-tertiary)',
    // Text-primary on the tinted badge backgrounds keeps contrast in both themes (was #b8860b → 2.72:1, failed WCAG AA)
    color: 'var(--color-text-primary)',
  }),
  deactivate: { background: 'var(--color-error-lightest)', color: 'var(--color-danger)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
  inactive: { color: 'var(--color-text-muted)', fontSize: 12, fontStyle: 'italic' },
  pagination: { display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' },
  pgBtn: (disabled) => ({ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--color-border)', cursor: disabled ? 'not-allowed' : 'pointer', background: disabled ? 'var(--color-bg-tertiary)' : 'var(--color-bg-primary)', color: disabled ? 'var(--color-text-muted)' : 'var(--color-text-primary)' }),
  err: { color: 'var(--color-danger)', fontSize: 14, marginBottom: 12 },
  input: { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 14 },
  btn: (loading) => ({ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: 'var(--color-text-inverse)', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }),
};

export default function AdminDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { confirm, confirmDialog } = useConfirm();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [orders, setOrders] = useState([]);
  const [orderPagination, setOrderPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [error, setError] = useState('');
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [verifiedFilter, setVerifiedFilter] = useState('');
  const [bannedFilter, setBannedFilter] = useState('');
  const [banModalData, setBanModalData] = useState(null);
  const [banBusy, setBanBusy] = useState(false);
  const [contracts, setContracts] = useState([]);
  const [contractForm, setContractForm] = useState({ contract_id: '', name: '', type: 'escrow', network: 'testnet' });
  const [contractMsg, setContractMsg] = useState('');
  const [contractFilter, setContractFilter] = useState({ network: '', type: '' });

  // Disputes
  const [disputes, setDisputes] = useState([]);
  const [resolveTarget, setResolveTarget] = useState(null);

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
  const [contractConfig, setContractConfig] = useState(null);
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

  const inputStyle = { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 14 };
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
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
    }
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

  async function loadDisputes() {
    try { const res = await api.adminGetDisputes(); setDisputes(res.data ?? res); } catch {}
  }

  async function loadStats() {
    try {
      const res = await api.adminGetStats();
      setStats(res.data);
    } catch (e) { setError(getErrorMessage(e)); }
  }

  async function loadUsers(page = 1) {
    try {
      const res = await api.adminGetUsers(page, { search: searchQuery, role: roleFilter, verified: verifiedFilter, banned: bannedFilter });
      setUsers(res.data);
      setPagination(res.pagination);
      setSearchParams(prev => { const p = new URLSearchParams(prev); p.set('usersPage', page); return p; });
    } catch (e) { setError(getErrorMessage(e)); }
  }

  async function loadOrders(page = 1) {
    try {
      const res = await api.adminGetOrders(page);
      setOrders(res.data);
      setOrderPagination(res.pagination);
      setSearchParams(prev => { const p = new URLSearchParams(prev); p.set('ordersPage', page); return p; });
    } catch (e) { setError(getErrorMessage(e)); }
  }

  useEffect(() => {
    const usersPage = parseInt(searchParams.get('usersPage') || '1');
    const ordersPage = parseInt(searchParams.get('ordersPage') || '1');
    loadStats();
    loadUsers(usersPage);
    loadOrders(ordersPage);
    loadContracts();
    loadContractAlerts('unacknowledged');
    loadDisputes();
  }, []);

    async function loadContracts(filters = contractFilter) {
    try {
      const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
      const res = await api.adminGetContracts(params ? `?${params}` : '');
      setContracts(res.data ?? []);
    } catch (e) { setContractMsg(getErrorMessage(e)); }
  }

  async function handleRegisterContract(e) {
    e.preventDefault();
    setContractMsg('');
    try {
      await api.adminRegisterContract(contractForm);
      setContractForm({ contract_id: '', name: '', type: 'escrow', network: 'testnet' });
      setContractMsg('Contract registered.');
      loadContracts();
    } catch (err) { setContractMsg(getErrorMessage(err)); }
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
      setDeployMsg(getErrorMessage(err));
    } finally {
      setDeployBusy(false);
    }
  }

  async function handleDeregisterContract(id) {
    const ok = await confirm({
      title: 'Deregister this contract?',
      description: 'It will be removed from the contract registry.',
      confirmLabel: 'Deregister',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.adminDeregisterContract(id);
      loadContracts();
    } catch (e) { setContractMsg(getErrorMessage(e)); }
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
    } catch (e) { setError(getErrorMessage(e)); }
  }

  function handleBan(id, name) {
    setBanModalData({ id, name });
  }

  async function confirmBan(reason) {
    const { id } = banModalData;
    // Optimistic update
    setUsers(prev => prev.map(u => u.id === id ? { ...u, banned_at: new Date().toISOString() } : u));
    setBanBusy(true);
    try {
      await api.adminBanUser(id, reason);
      setBanModalData(null);
    } catch (e) {
      // Revert on error
      setUsers(prev => prev.map(u => u.id === id ? { ...u, banned_at: null } : u));
      setError(getErrorMessage(e));
    }
    setBanBusy(false);
  }

  async function confirmUnban(id) {
    // Optimistic update
    setUsers(prev => prev.map(u => u.id === id ? { ...u, banned_at: null } : u));
    try {
      await api.adminUnbanUser(id);
    } catch (e) {
      // Revert on error
      loadUsers(pagination.page);
      setError(getErrorMessage(e));
    }
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
      setContractError(getErrorMessage(e));
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
      setUpgradeDetailError(getErrorMessage(e));
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
    loadContractConfig(c.contract_id);
  }

  async function loadContractConfig(contractId) {
    setContractConfig({ loading: true });
    try {
      const res = await api.adminGetContractConfig(contractId);
      setContractConfig(res.data ?? null);
    } catch (e) {
      setContractConfig({ error: e.message });
    }
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
      setUpgradeSubmitMsg(getErrorMessage(err));
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
      setSimFormError(getErrorMessage(err));
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
      setEvtError(getErrorMessage(e));
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
      setInvocError(getErrorMessage(e));
    } finally {
      setInvocLoading(false);
    }
  }

  return (
    <div className="admin-dashboard" style={s.page}>
      {deactivateTarget && (
        <DeactivateModal
          user={deactivateTarget}
          onConfirm={confirmDeactivate}
          onCancel={() => setDeactivateTarget(null)}
        />
      )}
      {resolveTarget && (
        <ResolveDisputeModal
          dispute={resolveTarget}
          onConfirm={async (id, body) => {
            await api.adminResolveDispute(id, body);
            setResolveTarget(null);
            loadDisputes();
          }}
          onCancel={() => setResolveTarget(null)}
        />
      )}
      {banModalData && (
        <BanModal
          user={banModalData}
          onConfirm={confirmBan}
          onCancel={() => setBanModalData(null)}
          loading={banBusy}
        />
      )}
      <div style={s.title}>🛡️ Admin Dashboard</div>
      {error && <div style={s.err}>{error}</div>}

      <AdminAnalyticsSummary stats={stats} />

      <AdminUsersPanel
        users={users}
        pagination={pagination}
        searchQuery={searchQuery}
        roleFilter={roleFilter}
        verifiedFilter={verifiedFilter}
        bannedFilter={bannedFilter}
        onSearchChange={setSearchQuery}
        onRoleChange={setRoleFilter}
        onVerifiedChange={setVerifiedFilter}
        onBannedChange={setBannedFilter}
        onSearch={() => loadUsers(1)}
        onPageChange={loadUsers}
        onDeactivate={handleDeactivate}
        onBan={handleBan}
        onUnban={confirmUnban}
      />

            {/* Orders Table */}
      <AdminOrdersPanel
        orders={orders}
        orderPagination={orderPagination}
        onPageChange={loadOrders}
      />

            {/* Disputes */}
      <AdminDisputesPanel
        disputes={disputes}
        onResolve={setResolveTarget}
      />

            {/* Contract Deployment */}
      <div style={{ ...s.card, marginTop: 32 }}>
        <h3 style={{ marginBottom: 16, color: 'var(--color-text-primary)' }}>🚀 Deploy Soroban Contract</h3>
        {deployMsg && (
          <div style={{
            color: deployMsg.includes('deployed') ? 'var(--color-primary)' : 'var(--color-danger)',
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
              background: deployBusy ? 'var(--color-border)' : 'var(--color-primary)',
              color: 'var(--color-text-inverse)',
              fontWeight: 600,
              cursor: deployBusy ? 'not-allowed' : 'pointer'
            }}
          >
            {deployBusy ? 'Deploying...' : 'Deploy Contract'}
          </button>
        </form>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          Upload a compiled .wasm file to deploy a new Soroban contract to the network.
        </div>
      </div>

      {/* Contract registry + simulation (registered contracts only) */}
      <div style={{ ...s.card, marginTop: 32 }}>
        <h3 style={{ marginBottom: 16, color: 'var(--color-text-primary)' }}>📜 Registered Soroban contracts</h3>
        {contractMsg && (
          <div style={{
            color: contractMsg.includes('registered') || contractMsg.includes('Deregister') ? 'var(--color-primary)' : 'var(--color-danger)',
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
          <button type="submit" style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: 'var(--color-text-inverse)', fontWeight: 600, cursor: 'pointer' }}>Register</button>
        </form>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>Filter:</span>
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
          <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No contracts registered. Add one above to enable simulation for this deployment.</div>
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
                        style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--color-primary)', background: 'var(--color-surface-subtle)', color: 'var(--color-primary)', fontSize: 12, cursor: 'pointer' }}
                      >Simulate</button>
                      <button
                        type="button"
                        onClick={() => openContractDetail(c)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 6,
                          border: selectedRegistryId === c.id ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                          background: selectedRegistryId === c.id ? 'var(--color-primary-lightest)' : 'var(--color-bg-primary)',
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >Details</button>
                      <button
                        type="button"
                        onClick={() => handleDeregisterContract(c.id)}
                        style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)', fontSize: 12, cursor: 'pointer' }}
                      >Deregister</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {selectedRegistryId != null && (
          <div style={{ marginTop: 24, padding: 16, borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <h4 style={{ margin: 0, color: 'var(--color-text-primary)' }}>
                Contract #{selectedRegistryId}
                {contracts.find((x) => x.id === selectedRegistryId)?.name
                  ? ` — ${contracts.find((x) => x.id === selectedRegistryId).name}`
                  : ''}
                <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--color-text-secondary)', marginLeft: 8 }}>WASM upgrade history</span>
              </h4>
              <button
                type="button"
                onClick={() => { setSelectedRegistryId(null); setContractUpgrades([]); setUpgradeSubmitMsg(''); setUpgradeDetailError(''); }}
                style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)', fontSize: 12, cursor: 'pointer' }}
              >Close</button>
            </div>
            <div style={{ marginBottom: 16 }}>
              <strong style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>On-chain config</strong>
              {contractConfig?.loading ? (
                <div style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>Loading config…</div>
              ) : contractConfig?.config || contractConfig?.snapshot ? (
                <table style={{ ...s.table, marginTop: 8 }}>
                  <tbody>
                    {Object.entries(contractConfig.config || contractConfig.snapshot).map(([k, v]) => (
                      <tr key={k}>
                        <td style={s.td}>{k}</td>
                        <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
                          {v === null || v === undefined ? '—' : String(v)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
                  {contractConfig?.error || 'No get_config() view available for this contract.'}
                </div>
              )}
              {contractConfig?.snapshot_synced_at && (
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>Snapshot synced {contractConfig.snapshot_synced_at}</div>
              )}
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
              Each row is immutable. <code style={{ fontSize: 11 }}>new_wasm_hash</code> must match the hash Soroban RPC reports for the contract after upgrade.
            </p>
            {upgradeDetailError && <div style={s.err}>{upgradeDetailError}</div>}
            {upgradeDetailLoading ? (
              <div style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>Loading history…</div>
            ) : contractUpgrades.length === 0 ? (
              <div style={{ color: 'var(--color-text-muted)', fontSize: 14, marginBottom: 16 }}>No upgrades recorded yet.</div>
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
            <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--color-text-primary)' }}>Record upgrade</div>
            <form onSubmit={handleRecordUpgrade} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 560 }}>
              <div>
                <input
                  style={{ ...monoInputStyle, borderColor: upgradeHashErrors.old_wasm_hash ? 'var(--color-danger)' : 'var(--color-border)' }}
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
                  <div style={{ color: 'var(--color-danger)', fontSize: 12, marginTop: 2 }}>{upgradeHashErrors.old_wasm_hash}</div>
                )}
              </div>
              <div>
                <input
                  style={{ ...monoInputStyle, borderColor: upgradeHashErrors.new_wasm_hash ? 'var(--color-danger)' : 'var(--color-border)' }}
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
                  <div style={{ color: 'var(--color-danger)', fontSize: 12, marginTop: 2 }}>{upgradeHashErrors.new_wasm_hash}</div>
                )}
              </div>
              {upgradeSubmitMsg && (
                <div style={{
                  fontSize: 13,
                  color: upgradeSubmitMsg.includes('recorded') ? 'var(--color-primary)' : 'var(--color-danger)',
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
                  background: (upgradeSubmitBusy || upgradeHashErrors.old_wasm_hash || upgradeHashErrors.new_wasm_hash) ? 'var(--color-border)' : 'var(--color-primary)',
                  color: 'var(--color-text-inverse)',
                  fontWeight: 600,
                  cursor: (upgradeSubmitBusy || upgradeHashErrors.old_wasm_hash || upgradeHashErrors.new_wasm_hash) ? 'not-allowed' : 'pointer',
                }}
              >{upgradeSubmitBusy ? 'Saving…' : 'Save upgrade record'}</button>
            </form>
          </div>
        )}

        <h4 style={{ marginTop: 28, marginBottom: 12, color: 'var(--color-text-primary)' }}>Simulate contract call</h4>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
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
              background: 'var(--color-primary)',
              color: 'var(--color-text-inverse)',
              fontWeight: 600,
              cursor: simBusy || contracts.length === 0 ? 'not-allowed' : 'pointer',
              opacity: contracts.length === 0 ? 0.5 : 1,
            }}
          >{simBusy ? 'Simulating…' : 'Run simulation'}</button>
        </form>
        {simOutcome && (
          <div style={{ marginTop: 16, padding: 14, borderRadius: 8, background: simOutcome.success ? 'var(--color-surface-subtle)' : 'var(--color-error-lightest)', border: `1px solid ${simOutcome.success ? 'var(--color-border-accent)' : 'var(--color-error-light)'}` }}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--color-text-primary)' }}>Result</div>
            <div style={{ fontSize: 13, fontFamily: 'monospace', wordBreak: 'break-all' }}>
              <div><strong>success:</strong> {String(simOutcome.success)}</div>
              {simOutcome.fee != null && <div><strong>fee (stroops):</strong> {simOutcome.fee}</div>}
              {simOutcome.error != null && simOutcome.error !== '' && <div style={{ color: 'var(--color-danger)' }}><strong>error:</strong> {simOutcome.error}</div>}
              <div style={{ marginTop: 8 }}><strong>result:</strong> {JSON.stringify(simOutcome.result, null, 2)}</div>
            </div>
          </div>
        )}
      </div>

      {/* Soroban Contract State Viewer */}
      <div style={{ ...s.card, marginTop: 32 }}>
        <h3 style={{ marginBottom: 16, color: 'var(--color-text-primary)' }}>🔍 Soroban Contract State</h3>
        <form onSubmit={loadContractState} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <input
            style={{ flex: '2 1 260px', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 14, fontFamily: 'monospace' }}
            placeholder="Contract ID (base32 or hex)"
            value={contractId}
            onChange={e => setContractId(e.target.value)}
            required
          />
          <input
            style={{ flex: '1 1 140px', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 14 }}
            placeholder="Key prefix (optional)"
            value={contractPrefix}
            onChange={e => setContractPrefix(e.target.value)}
          />
          <button
            type="submit"
            disabled={contractLoading}
            style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: 'var(--color-text-inverse)', fontWeight: 600, cursor: contractLoading ? 'not-allowed' : 'pointer' }}
          >{contractLoading ? 'Loading…' : 'Fetch State'}</button>
        </form>
        {contractError && <div style={s.err}>{contractError}</div>}
        {contractState && (
          contractState.length === 0
            ? <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No storage entries found{contractPrefix ? ` matching prefix "${contractPrefix}"` : ''}.</div>
            : (
              <>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                  <select
                    value={exportFormat}
                    onChange={e => setExportFormat(e.target.value)}
                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)', fontSize: 13 }}
                  >
                    <option value="json">JSON</option>
                    <option value="csv">CSV</option>
                  </select>
                  <input
                    type="number"
                    placeholder="Since ledger (optional)"
                    value={exportSinceLedger}
                    onChange={e => setExportSinceLedger(e.target.value)}
                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)', fontSize: 13, width: 180 }}
                  />
                  {(() => {
                    const reg = contracts.find(c => c.contract_id === contractId.trim());
                    if (!reg) return null;
                    return (
                      <button
                        type="button"
                        onClick={() => api.adminExportContractState(reg.id, exportFormat, exportSinceLedger || undefined).catch(e => setContractError(getErrorMessage(e)))}
                        style={{ padding: '6px 16px', borderRadius: 6, background: 'var(--color-secondary)', color: 'var(--color-text-inverse)', fontWeight: 600, fontSize: 13, border: 'none', cursor: 'pointer' }}
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
                    {contractState.map((entry) => (
                      <tr key={`${entry.durability}-${String(entry.key)}`}>
                        <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{String(entry.key)}</td>
                        <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{JSON.stringify(entry.val)}</td>
                        <td style={{ ...s.td, fontSize: 12 }}>
                          <span style={{ padding: '2px 8px', borderRadius: 12, fontWeight: 600, fontSize: 11,
                            background: entry.durability === 'Temporary' ? 'var(--color-warning-lightest)' : 'var(--color-primary-lightest)',
                            color: entry.durability === 'Temporary' ? 'var(--color-text-primary)' : 'var(--color-primary)' }}>
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
        <h3 style={{ marginBottom: 16, color: 'var(--color-text-primary)' }}>📋 Soroban Contract Event Log</h3>
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
            ? <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No events found for this contract.</div>
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
                          background: ev.type === 'contract' ? 'var(--color-primary-lightest)' : 'var(--color-bg-tertiary)',
                          color: ev.type === 'contract' ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
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
                <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
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
      <div style={{ background: 'var(--color-bg-primary)', borderRadius: 12, padding: 24, boxShadow: 'var(--shadow-md)', marginBottom: 24 }}>
        <h3 style={{ marginBottom: 16, color: 'var(--color-text-primary)' }}>🔐 Contract Access Control (ACL)</h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}>
          <select
            style={{ padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 14 }}
            value={aclRegistryId}
            onChange={async (e) => {
              setAclRegistryId(e.target.value);
              setAclEntries([]);
              setAclMsg('');
              if (e.target.value) {
                try {
                  const res = await api.adminGetContractAcl(e.target.value);
                  setAclEntries(res.data ?? []);
                } catch (err) { setAclMsg(getErrorMessage(err)); }
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
                } catch (err) { setAclMsg(getErrorMessage(err)); }
              }}
              style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}
            >
              <input
                style={{ padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 14, flex: 1, minWidth: 300, fontFamily: 'monospace' }}
                placeholder="Stellar address (G...)"
                value={aclForm.address}
                onChange={(e) => setAclForm((f) => ({ ...f, address: e.target.value.trim() }))}
                required
              />
              <select
                style={{ padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 14 }}
                value={aclForm.role}
                onChange={(e) => setAclForm((f) => ({ ...f, role: e.target.value }))}
              >
                <option value="admin">admin</option>
                <option value="operator">operator</option>
                <option value="viewer">viewer</option>
              </select>
              <button type="submit" style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: 'var(--color-text-inverse)', fontWeight: 600, cursor: 'pointer' }}>
                Grant
              </button>
            </form>

            {aclMsg && <div style={{ fontSize: 13, color: aclMsg.includes('granted') ? 'var(--color-primary)' : 'var(--color-danger)', marginBottom: 12 }}>{aclMsg}</div>}

            {aclEntries.length === 0 ? (
              <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No ACL entries for this contract.</div>
            ) : (
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--color-border-light)', textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px' }}>Address</th>
                    <th style={{ padding: '6px 8px' }}>Role</th>
                    <th style={{ padding: '6px 8px' }}>Granted by</th>
                    <th style={{ padding: '6px 8px' }}>Granted at</th>
                    <th style={{ padding: '6px 8px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {aclEntries.map((entry) => (
                    <tr key={entry.id} style={{ borderBottom: '1px solid var(--color-bg-tertiary)' }}>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 12 }}>{entry.address}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <span style={{ background: 'var(--color-primary-lightest)', color: 'var(--color-primary)', borderRadius: 4, padding: '2px 8px', fontWeight: 600 }}>{entry.role}</span>
                      </td>
                      <td style={{ padding: '6px 8px', color: 'var(--color-text-secondary)' }}>{entry.granted_by_name ?? '—'}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--color-text-muted)' }}>{new Date(entry.granted_at).toLocaleString()}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <button
                          style={{ padding: '3px 10px', borderRadius: 6, border: 'none', background: 'var(--color-error-lightest)', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                          onClick={async () => {
                            const ok = await confirm({
                              title: 'Revoke contract access?',
                              description: `${entry.address} will lose its ${entry.role} role.`,
                              confirmLabel: 'Revoke',
                              destructive: true,
                            });
                            if (!ok) return;
                            try {
                              await api.adminRevokeContractAcl(aclRegistryId, entry.address);
                              const res = await api.adminGetContractAcl(aclRegistryId);
                              setAclEntries(res.data ?? []);
                              setAclMsg('Access revoked.');
                            } catch (err) { setAclMsg(getErrorMessage(err)); }
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
        <h3 style={{ marginBottom: 16, color: 'var(--color-text-primary)' }}>🔀 Contract Version Comparison</h3>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
          Compare function signatures between two WASM versions of a registered contract.
          Results are cached for 10 minutes.
        </p>
        <div className="admin-comparison-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 10, alignItems: 'end', marginBottom: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4, color: 'var(--color-text-secondary)' }}>Registry ID</label>
            <input style={inputStyle} type="number" placeholder="Contract registry ID" value={cmpRegistryId} onChange={(e) => setCmpRegistryId(e.target.value)} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4, color: 'var(--color-text-secondary)' }}>v1 WASM Hash (old)</label>
            <input style={monoInputStyle} placeholder="64-char hex" value={cmpV1} onChange={(e) => setCmpV1(e.target.value)} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4, color: 'var(--color-text-secondary)' }}>v2 WASM Hash (new)</label>
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
                setCmpError(getErrorMessage(err));
              } finally {
                setCmpLoading(false);
              }
            }}
          >
            {cmpLoading ? 'Comparing…' : 'Compare'}
          </button>
        </div>
        {cmpError && <div style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 12 }}>{cmpError}</div>}
        {cmpResult && (
          <div>
            {cmpResult.added.length === 0 && cmpResult.removed.length === 0 && cmpResult.changed.length === 0 ? (
              <div style={{ color: 'var(--color-primary)', fontSize: 14 }}>✅ Identical — no differences found.</div>
            ) : (
              <>
                {cmpResult.added.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, color: 'var(--color-primary)', marginBottom: 6 }}>➕ Added ({cmpResult.added.length})</div>
                    {cmpResult.added.map((fn) => (
                      <div key={fn.name} style={{ background: 'var(--color-primary-lightest)', borderRadius: 6, padding: '6px 10px', marginBottom: 4, fontFamily: 'monospace', fontSize: 13 }}>
                        <strong>{fn.name}</strong> {fn.signature}
                      </div>
                    ))}
                  </div>
                )}
                {cmpResult.removed.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, color: 'var(--color-danger)', marginBottom: 6 }}>➖ Removed ({cmpResult.removed.length})</div>
                    {cmpResult.removed.map((fn) => (
                      <div key={fn.name} style={{ background: 'var(--color-error-lightest)', borderRadius: 6, padding: '6px 10px', marginBottom: 4, fontFamily: 'monospace', fontSize: 13 }}>
                        <strong>{fn.name}</strong> {fn.signature}
                      </div>
                    ))}
                  </div>
                )}
                {cmpResult.changed.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6 }}>✏️ Changed ({cmpResult.changed.length})</div>
                    {cmpResult.changed.map((fn) => (
                      <div key={fn.name} style={{ background: 'var(--color-warning-lightest)', borderRadius: 6, padding: '6px 10px', marginBottom: 4, fontFamily: 'monospace', fontSize: 13 }}>
                        <strong>{fn.name}</strong><br />
                        <span style={{ color: 'var(--color-danger)' }}>− {fn.old_signature}</span><br />
                        <span style={{ color: 'var(--color-primary)' }}>+ {fn.new_signature}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {cmpResult.cached && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>Cached result</div>}
          </div>
        )}
      </div>
      {/* Contract Alerts */}
      <div style={{ background: 'var(--color-bg-primary)', borderRadius: 12, padding: 24, boxShadow: 'var(--shadow-md)', marginBottom: 24 }}>
        <h3 style={{ marginBottom: 16, color: 'var(--color-text-primary)' }}>🚨 Contract Monitoring Alerts</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {['unacknowledged', 'acknowledged', 'all'].map((f) => (
            <button
              key={f}
              onClick={() => { setAlertsFilter(f); loadContractAlerts(f); }}
              style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--color-border)', cursor: 'pointer', fontWeight: alertsFilter === f ? 700 : 400, background: alertsFilter === f ? 'var(--color-primary)' : 'var(--color-bg-primary)', color: alertsFilter === f ? 'var(--color-text-inverse)' : 'var(--color-text-primary)' }}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        {alertsLoading ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>Loading…</div>
        ) : contractAlerts.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No alerts.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--color-border-light)', textAlign: 'left' }}>
                <th style={{ padding: '8px 10px' }}>Contract ID</th>
                <th style={{ padding: '8px 10px' }}>Type</th>
                <th style={{ padding: '8px 10px' }}>Message</th>
                <th style={{ padding: '8px 10px' }}>Time</th>
                <th style={{ padding: '8px 10px' }}></th>
              </tr>
            </thead>
            <tbody>
              {contractAlerts.map((a) => (
                <tr key={a.id} style={{ borderBottom: '1px solid var(--color-border-light)', background: a.acknowledged ? 'var(--color-bg-secondary)' : 'var(--color-warning-lightest)' }}>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: 12 }}>{a.contract_id}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ background: a.alert_type === 'large_transfer' ? 'var(--color-warning-lightest)' : 'var(--color-error-lightest)', color: a.alert_type === 'large_transfer' ? 'var(--color-text-primary)' : 'var(--color-danger)', borderRadius: 4, padding: '2px 8px', fontWeight: 600, fontSize: 12 }}>
                      {a.alert_type}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px', color: 'var(--color-text-primary)' }}>{a.message}</td>
                  <td style={{ padding: '8px 10px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{new Date(a.created_at).toLocaleString()}</td>
                  <td style={{ padding: '8px 10px' }}>
                    {!a.acknowledged && (
                      <button
                        onClick={() => acknowledgeAlert(a.id)}
                        style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: 'var(--color-primary-lightest)', color: 'var(--color-primary)', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}
                      >
                        Acknowledge
                      </button>
                    )}
                    {!!a.acknowledged && <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>✓ Acknowledged</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {/* Contract Invocation History */}
      <div style={{ ...s.card, marginTop: 32 }}>
        <h3 style={{ marginBottom: 16, color: 'var(--color-text-primary)' }}>📑 Contract Invocation History</h3>
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
            ? <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No invocations found.</div>
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
                          background: inv.success ? 'var(--color-primary-lightest)' : 'var(--color-error-lightest)',
                          color: inv.success ? 'var(--color-primary)' : 'var(--color-danger)',
                        }}>
                          {inv.success ? 'success' : 'failed'}
                        </span>
                      </td>
                      <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', maxWidth: 160 }}>
                        {inv.tx_hash || '—'}
                      </td>
                      <td style={{ ...s.td, fontSize: 12 }}>{inv.invoked_by_name || `#${inv.invoked_by || '?'}`}</td>
                      <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', maxWidth: 200, color: inv.success ? 'var(--color-text-primary)' : 'var(--color-danger)' }}>
                        {inv.success ? (inv.result ? JSON.stringify(JSON.parse(inv.result)) : '—') : (inv.error || '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={s.pagination}>
                <button style={s.pgBtn(invocPage <= 1)} disabled={invocPage <= 1} onClick={() => loadContractInvocations(null, invocPage - 1)}>← Prev</button>
                <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  Page {invocData.pagination.page} of {invocData.pagination.pages} ({invocData.pagination.total} total)
                </span>
                <button style={s.pgBtn(invocPage >= invocData.pagination.pages)} disabled={invocPage >= invocData.pagination.pages} onClick={() => loadContractInvocations(null, invocPage + 1)}>Next →</button>
              </div>
            </>
        )}
      </div>
      {/* Announcements Management */}
      <AdminAnnouncementsPanel />
      {confirmDialog}
    </div>
  );
}