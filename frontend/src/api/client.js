import { showToast } from '../utils/toast';
import { getErrorMessage } from '../utils/errorMessages';

const BASE = '/api/v1';

// Error message handed to callers when the refresh token is gone or rejected.
// The wording is what errorMessages.js maps to the user-facing session-expired copy.
const SESSION_EXPIRED = 'Session expired';

// A refresh that hangs (offline, proxy black hole) must not leave every queued
// 401 pending forever, so the single-flight refresh races this deadline.
const REFRESH_TIMEOUT_MS = 10000;

let accessToken = null;
let loadingCallback = null;
let logoutCallback = null;
// The in-flight refresh, shared by every concurrent 401 (#1381).
let refreshPromise = null;
// Latched when a refresh fails so a burst of 401s ends the session once.
let sessionExpired = false;

export function setAccessToken(token) {
  accessToken = token;
  // A token in hand means a live session again, so re-arm the expiry notice.
  sessionExpired = false;
}

export function clearAccessToken() {
  accessToken = null;
}

export function setLoadingCallback(fn) {
  loadingCallback = typeof fn === 'function' ? fn : null;
}

export function setLogoutCallback(fn) {
  logoutCallback = typeof fn === 'function' ? fn : null;
}

function getCsrfToken() {
  const match = document.cookie
    .split(';')
    .find((c) => c.trim().startsWith('csrf_token='));
  return match ? match.trim().split('=')[1] : null;
}

// The backend serves the token at /api/v1/auth/csrf-token (and /api/csrf-token);
// there is no /api/v1/csrf-token (#1380).
export const CSRF_TOKEN_URL = `${BASE}/auth/csrf-token`;

let csrfReady = null;
/**
 * Makes sure the csrf_token cookie exists, fetching a fresh one when it is
 * missing (or always, with `force`). Throws a descriptive error when the
 * endpoint fails or doesn't set the cookie, instead of letting the next
 * mutation go out without X-CSRF-Token and die with a bare 403.
 */
export function ensureCsrfToken({ force = false } = {}) {
  if (!force && getCsrfToken()) return Promise.resolve();
  if (!csrfReady) {
    csrfReady = (async () => {
      let res;
      try {
        res = await fetch(`${BASE}/auth/csrf-token`, { credentials: 'include' });
      } catch (e) {
        throw new Error(`Could not fetch a CSRF token: ${e.message}`);
      }
      if (!res.ok) {
        throw new Error(`Could not fetch a CSRF token: ${CSRF_TOKEN_URL} returned HTTP ${res.status}`);
      }
      if (!getCsrfToken()) {
        throw new Error(`Could not fetch a CSRF token: ${CSRF_TOKEN_URL} did not set the csrf_token cookie`);
      }
    })().finally(() => {
      csrfReady = null;
    });
  }
  return csrfReady;
}

async function performRefresh(signal) {
  // The refresh endpoint is exempt from CSRF validation on the backend (#1363),
  // but sending the header anyway is harmless — fetch one if it is missing.
  // Best effort: if the token can't be fetched, the refresh call reports the failure.
  await ensureCsrfToken().catch(() => {});
  const csrfToken = getCsrfToken();
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
    signal,
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.token) return null;
  setAccessToken(data.token);
  return data.token;
}

/**
 * Single-flight access-token refresh (#1381).
 *
 * The backend rotates refresh tokens and treats a replay of an already-rotated
 * token as theft, revoking the whole family. So the burst of 401s a dashboard
 * load produces when the access token expires must not turn into one refresh
 * call per in-flight request: every caller awaits this same promise and then
 * retries once with the token it obtained, and only one POST /auth/refresh ever
 * goes out. Always resolves — a failure resolves to null — so no caller has to
 * handle a rejection and the flight is always cleared.
 */
function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;

  const controller = new AbortController();
  let timer;
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Token refresh timed out after ${REFRESH_TIMEOUT_MS}ms`));
    }, REFRESH_TIMEOUT_MS);
  });

  refreshPromise = Promise.race([performRefresh(controller.signal), timedOut])
    .catch(() => null)
    .finally(() => {
      clearTimeout(timer);
      refreshPromise = null;
    });
  return refreshPromise;
}

const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];
// Paths the backend also skips CSRF validation for. Must stay identical to
// EXEMPT_SUFFIXES in backend/src/middleware/csrf.js — the frontend and backend
// Docker build contexts are disjoint directories, so the two cannot import one
// shared module; instead backend/tests/csrf.test.js reads this file and fails if
// the lists ever drift (#1381, backend #1363).
//
// /auth/refresh and /auth/logout rely on the SameSite=Strict refresh-token
// cookie plus an Origin check in the auth routes instead of a CSRF token.
export const CSRF_EXEMPT = [
  '/auth/login',
  '/auth/register',
  '/auth/recover',
  '/auth/refresh',
  '/auth/logout',
];

function isCsrfFailure(status, data) {
  return status === 403 && /csrf token (missing|invalid)/i.test(String(data?.error || data?.message || ''));
}

/**
 * Ends the session after a refresh failed. Latched so the concurrent 401s that
 * triggered the failed refresh produce exactly one logoutCallback() and one
 * "Session expired" toast instead of one of each per request (#1381).
 */
function endSession() {
  clearAccessToken();
  if (sessionExpired) return;
  sessionExpired = true;
  showToast(getErrorMessage(new Error(SESSION_EXPIRED)), 'error');
  if (logoutCallback) logoutCallback();
}

async function request(path, options = {}, retry = true, csrfRetry = true) {
  const method = (options.method || 'GET').toUpperCase();
  const needsCsrf = MUTATING.includes(method) && !CSRF_EXEMPT.includes(path);

  if (needsCsrf) await ensureCsrfToken();
  const csrfToken = needsCsrf ? getCsrfToken() : null;
  const isFormData = options.body instanceof FormData;

  if (loadingCallback && !options.silent) loadingCallback(true);
  try {
    const headers = {};
    if (!isFormData) headers['Content-Type'] = 'application/json';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    Object.assign(headers, options.headers || {});

    const res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'include',
      headers,
      body: isFormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });

    if (res.status === 401 && retry) {
      // Single-flight: concurrent 401s share one refresh and each retries once.
      // Once the session has ended, skip the refresh entirely — replaying the
      // refresh cookie is what trips the backend's reuse detection.
      const token = sessionExpired ? null : await refreshAccessToken();
      if (token) return request(path, options, false, csrfRetry);
      endSession();
      throw new Error(SESSION_EXPIRED);
    }

    const data = await res.json().catch(() => ({}));
    if (needsCsrf && csrfRetry && isCsrfFailure(res.status, data)) {
      // Cookie expired or was rotated elsewhere: fetch a fresh token once and retry.
      await ensureCsrfToken({ force: true });
      return request(path, options, retry, false);
    }
    if (!res.ok) {
      const err = new Error(data.message || data.error || 'Request failed');
      err.code = data.code;
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    if (loadingCallback && !options.silent) loadingCallback(false);
  }
}

/** UUID v4 for X-Idempotency-Key (backend requires v4, #1379). */
export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function requireIdempotencyKey(idempotencyKey) {
  if (idempotencyKey) return idempotencyKey;
  const msg = 'placeOrder requires an idempotency key: generate one per checkout attempt and reuse it for retries';
  if (import.meta.env?.DEV) throw new Error(msg);
  // eslint-disable-next-line no-console
  console.warn(msg);
  return newIdempotencyKey();
}

function toQs(params = {}) {
  const entries = Object.entries(params).filter(([, v]) => v !== '' && v != null);
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
}

export const api = {
  getNetwork: () => request('/network'),
  register: (body) => request('/auth/register', { method: 'POST', body }),
  login: (body) => request('/auth/login', { method: 'POST', body }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  refresh: () => refreshAccessToken(),
  getCurrentUser: () => request('/auth/me'),

  getProducts: (filters = {}) => request(`/products${toQs(filters)}`),
  getCategories: () => request('/products/categories'),
  getProduct: (id, options) => request(`/products/${id}`, options),
  createProduct: (body) => request('/products', { method: 'POST', body }),
  getMyProducts: () => request('/products/mine/list'),
  getHarvestBatches: () => request('/batches'),
  getBatchesByFarmer: (farmerId) => request(`/batches?farmer_id=${farmerId}`),
  createHarvestBatch: (body) => request('/batches', { method: 'POST', body }),
  restockProduct: (id, quantity) => request(`/products/${id}/restock`, { method: 'PATCH', body: { quantity } }),
  deleteProduct: (id) => request(`/products/${id}`, { method: 'DELETE' }),
  updateProduct: (id, body) => request(`/products/${id}`, { method: 'PATCH', body }),
  getProductReviews: (id) => request(`/products/${id}/reviews`),
  searchProducts: (q) => request(`/products/search?q=${encodeURIComponent(q)}`),
  getBundles: () => request('/bundles'),
  createBundle: (body) => request('/bundles', { method: 'POST', body }),
  deleteBundle: (id) => request(`/bundles/${id}`, { method: 'DELETE' }),
  purchaseBundle: (bundle_id) => request('/bundles/purchase', { method: 'POST', body: { bundle_id } }),
  getBundleOrders: () => request('/bundles/orders'),

  // Price tiers
  getProductTiers: (id) => request(`/products/${id}/tiers`),
  getPriceHistory: (id, range) => request(`/products/${id}/price-history${range ? `?range=${range}` : ''}`),
  updateProductTiers: (id, tiers) => request(`/products/${id}/tiers`, { method: 'POST', body: { tiers } }),

  uploadProductImage: (file) => {
    const form = new FormData();
    form.append('image', file);
    return request('/products/upload-image', { method: 'POST', body: form });
  },

  uploadAvatar: (file) => {
    const form = new FormData();
    form.append('image', file);
    return request('/products/upload-image', { method: 'POST', body: form });
  },

  uploadProductVideo: (productId, file) => {
    const form = new FormData();
    form.append('video', file);
    return request(`/products/${productId}/video`, { method: 'POST', body: form });
  },
  getProductImages: (productId) => request(`/products/${productId}/images`),
  getRecommendations: () => request('/recommendations'),
  uploadProductImages: (productId, files) => {
    const form = new FormData();
    files.forEach((f) => form.append('images', f));
    return request(`/products/${productId}/images`, { method: 'POST', body: form });
  },
  deleteProductImage: (productId, imageId) => request(`/products/${productId}/images/${imageId}`, { method: 'DELETE' }),
  reorderProductImages: (productId, order) => request(`/products/${productId}/images/reorder`, { method: 'PATCH', body: { order } }),

  uploadProductsCsv: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request('/products/bulk', { method: 'POST', body: form });
  },

  placeOrder: (body, idempotencyKey) =>
    request('/orders', {
      method: 'POST',
      body,
      headers: { 'X-Idempotency-Key': requireIdempotencyKey(idempotencyKey) },
    }),
  getOrders: (params = {}) => request(`/orders${toQs(params)}`),
  getSales: (params = {}) => request(`/orders/sales${toQs(params)}`),
  updateOrderStatus: (id, status) => request(`/orders/${id}/status`, { method: 'PATCH', body: { status } }),

  fundEscrow: (orderId) => request(`/orders/${orderId}/escrow`, { method: 'POST' }),
  claimEscrow: (orderId) => request(`/orders/${orderId}/claim`, { method: 'POST' }),
  claimPreorder: (orderId) => request(`/orders/${orderId}/claim-preorder`, { method: 'POST' }),
  fileReturn: (orderId, reason) => request(`/orders/${orderId}/return`, { method: 'POST', body: { reason } }),
  downloadReceipt: async (orderId) => {
    const headers = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const res = await fetch(`${BASE}/orders/${orderId}/receipt`, { credentials: 'include', headers });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || 'Download failed'); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `receipt-${orderId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  },
  exportOrders: async (format) => {
    const headers = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const res = await fetch(`${BASE}/export/orders?format=${format}`, { credentials: 'include', headers });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || 'Export failed'); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orders-export.${format === 'pdf' ? 'pdf' : 'csv'}`;
    a.click();
    URL.revokeObjectURL(url);
  },
  approveReturn: (orderId) => request(`/orders/${orderId}/return/approve`, { method: 'PATCH' }),
  rejectReturn: (orderId, reject_reason) => request(`/orders/${orderId}/return/reject`, { method: 'PATCH', body: { reject_reason } }),

  submitReview: (body) => request("/reviews", { method: "POST", body }),

  getWallet: () => request('/wallet'),
  getTransactions: () => request('/wallet/transactions'),
  fundWallet: () => request('/wallet/fund', { method: 'POST' }),
  sendXLM: (body) => request('/wallet/send', { method: 'POST', body }),
  addTrustline: (body) => request('/wallet/trustline', { method: 'POST', body }),
  removeTrustline: (body) => request('/wallet/trustline', { method: 'DELETE', body }),
  getWalletAssets: () => request('/wallet/assets'),
  getPathEstimate: (params) => request(`/wallet/path-estimate${toQs(params)}`),
  mergeWallet: (body) => request('/wallet/merge', { method: 'POST', body }),
  deleteAccount: (force) => request(`/auth/account${force ? '?force=true' : ''}`, { method: 'DELETE' }),
  // Streams need a short-lived, stream-scoped token in the URL (EventSource can't
  // send an Authorization header) instead of the long-lived access token, so it
  // doesn't leak into server/proxy logs, browser history, or Referer (#1170).
  getWalletStreamUrl: async () => {
    const { token } = await request('/auth/stream-token');
    return `/api/wallet/stream?token=${encodeURIComponent(token || '')}`;
  },
  getOrdersStreamUrl: async () => {
    const { token } = await request('/auth/stream-token');
    return `/api/orders/stream?token=${encodeURIComponent(token || '')}`;
  },
  getWalletStreamUrl: () => `/api/wallet/stream?token=${encodeURIComponent(accessToken || '')}`,
  getOrdersStreamUrl: () => `/api/orders/stream?token=${encodeURIComponent(accessToken || '')}`,
  getMessagesStreamUrl: () => `/api/messages/events?token=${encodeURIComponent(accessToken || '')}`,
  getStockStreamUrl: (productId) => `${BASE}/products/${encodeURIComponent(productId)}/stock-stream`,
  getUnreadMessageCount: () => request('/messages/unread-count'),

  getFarmer: (id) => request(`/farmers/${id}`),
  updateFarmerProfile: (body) => request("/farmers/me", { method: "PATCH", body }),
  updateProfile: (body) => request('/auth/me', { method: 'PATCH', body }),
  updateFarmerProfile: (body) => request('/farmers/me', { method: 'PATCH', body }),

  addFavorite: (productId) => request('/favorites', { method: 'POST', body: { product_id: productId } }),
  removeFavorite: (productId) => request(`/favorites/${productId}`, { method: 'DELETE' }),
  getFavorites: (params = {}) => request(`/favorites${toQs(params)}`),
  checkFavorite: (productId) => request(`/favorites/check/${productId}`),

  setStockAlert: (productId) => request(`/products/${productId}/alert`, { method: 'POST' }),
  removeStockAlert: (productId) => request(`/products/${productId}/alert`, { method: 'DELETE' }),
  getMyAlert: (productId) => request(`/products/${productId}/alert/status`),

  joinWaitlist: (productId, body) => request(`/products/${productId}/waitlist`, { method: 'POST', body }),
  leaveWaitlist: (productId) => request(`/products/${productId}/waitlist`, { method: 'DELETE' }),
  getWaitlistStatus: (productId) => request(`/products/${productId}/waitlist/status`),

  getXlmRate: () => request('/rates/xlm-usd'),
  getMarketRate: () => request('/market/xlm-usdc'),
  bulkUpdatePrices: (updates, adjustment_percent) =>
    request('/products/bulk-price', { method: 'PATCH', body: { updates, adjustment_percent } }),

  getAnalytics: () => request('/analytics/farmer'),
  getForecast: () => request('/analytics/farmer/forecast'),
  getWaitlistAnalytics: () => request('/analytics/farmer/waitlist'),


  createAddress: (body) => request('/addresses', { method: 'POST', body }),
  updateAddress: (id, body) => request(`/addresses/${id}`, { method: 'PUT', body }),
  deleteAddress: (id) => request(`/addresses/${id}`, { method: 'DELETE' }),
  setDefaultAddress: (id) => request(`/addresses/${id}/default`, { method: 'PATCH' }),

  adminGetUsers: (page = 1, filters = {}) => {
    const qs = new URLSearchParams({ page });
    if (filters.search) qs.append('search', filters.search);
    if (filters.role) qs.append('role', filters.role);
    if (filters.verified) qs.append('verified', filters.verified);
    if (filters.banned) qs.append('banned', filters.banned);
    return request(`/admin/users?${qs}`);
  },
  adminGetOrders: (page = 1) => request(`/admin/orders?page=${page}`),
  adminDeactivateUser: (id) => request(`/admin/users/${id}`, { method: 'DELETE' }),
  adminBanUser: (id, reason) => request(`/admin/users/${id}/ban`, { method: 'POST', body: { reason } }),
  adminUnbanUser: (id) => request(`/admin/users/${id}/ban`, { method: 'DELETE' }),
  adminGetStats: () => request('/admin/stats'),
  adminGetDisputes: () => request('/disputes'),
  adminResolveDispute: (id, body) => request(`/disputes/${id}/resolve`, { method: 'PATCH', body }),
  adminGetContracts: (qs = '') => request(`/admin/contracts${qs}`),
  adminRegisterContract: (body) => request('/admin/contracts', { method: 'POST', body }),
  adminDeployContract: (formData) => request('/admin/contracts/deploy', { method: 'POST', body: formData }),
  adminDeregisterContract: (id) => request(`/admin/contracts/${id}`, { method: 'DELETE' }),
  adminGetContractUpgrades: (registryId) => request(`/admin/contracts/${registryId}/upgrades`),
  adminRecordContractUpgrade: (registryId, body) =>
    request(`/admin/contracts/${registryId}/upgrade`, { method: 'POST', body }),
  adminGetContractAcl: (registryId) => request(`/admin/contracts/${registryId}/acl`),
  adminGrantContractAcl: (registryId, body) => request(`/admin/contracts/${registryId}/acl`, { method: 'POST', body }),
  adminRevokeContractAcl: (registryId, address) => request(`/admin/contracts/${registryId}/acl/${encodeURIComponent(address)}`, { method: 'DELETE' }),
  adminCompareContractVersions: (registryId, v1, v2) =>
    request(`/admin/contracts/${registryId}/compare?v1=${encodeURIComponent(v1)}&v2=${encodeURIComponent(v2)}`),
  adminGetContractAlerts: (acknowledged) => request(`/admin/contract-alerts${acknowledged !== undefined ? `?acknowledged=${acknowledged}` : ''}`),
  adminAcknowledgeContractAlert: (id) => request(`/admin/contract-alerts/${id}/acknowledge`, { method: 'PATCH' }),
  adminGetContractInvocations: (registryId, params = {}) => request(`/admin/contracts/${registryId}/invocations${toQs(params)}`),

  getBundleDiscounts: () => request('/farmers/me/bundle-discounts'),
  createBundleDiscount: (body) => request('/farmers/me/bundle-discounts', { method: 'POST', body }),
  updateBundleDiscount: (id, body) => request(`/farmers/me/bundle-discounts/${id}`, { method: 'PUT', body }),
  deleteBundleDiscount: (id) => request(`/farmers/me/bundle-discounts/${id}`, { method: 'DELETE' }),
  adminExportContractState: async (registryId, format = 'json', sinceLedger) => {
    const qs = new URLSearchParams({ format });
    if (sinceLedger != null && sinceLedger !== '') qs.set('since_ledger', sinceLedger);
    const headers = { Authorization: `Bearer ${accessToken}` };
    const res = await fetch(`${BASE}/admin/contracts/${registryId}/state/export?${qs}`, { headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Export failed (${res.status})`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contract-state-${registryId}-${new Date().toISOString().slice(0, 10)}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  },

  getAddresses: () => request('/addresses'),

  // Reuse the original attempt's key so the confirmed retry is the same order (#1379).
  placeOrderWithBudgetOverride: (body, idempotencyKey) =>
    request('/orders', {
      method: 'POST',
      body: { ...body, budget_override_confirmed: true },
      headers: { 'X-Idempotency-Key': requireIdempotencyKey(idempotencyKey) },
    }),
  getOrderStatus: (id) => request(`/orders/${id}/status`),
  placeOrderWithBudgetOverride: (body) => request('/orders', { method: 'POST', body: { ...body, budget_override_confirmed: true } }),
  getOrderStatus: (id) => request(`/orders/${id}/status`, { silent: true }),
  getOrderPaymentLink: (orderId) => request(`/orders/${orderId}/payment-link`),
  getOrderPaymentLinkQr: (orderId) => `/api/orders/${orderId}/payment-link/qr`,

  getAuctions: () => request('/auctions'),
  getAuction: (id) => request(`/auctions/${id}`),
  createAuction: (body) => request('/auctions', { method: 'POST', body }),
  placeBid: (id, body) => request(`/auctions/${id}/bid`, { method: 'POST', body }),
  getAuctionBids: (id) => request(`/auctions/${id}/bids`),
  endAuction: (id) => request(`/auctions/${id}/end`, { method: 'PATCH' }),

  setFlashSale: (id, body) => request(`/products/${id}/flash-sale`, { method: 'PATCH', body }),
  cancelFlashSale: (id) => request(`/products/${id}/flash-sale`, { method: 'DELETE' }),
  getProductShareMeta: (id) => request(`/products/${id}/share`),
  trackShareEvent: (id, platform) => request(`/products/${id}/share`, { method: 'POST', body: { platform } }),

  getContractState: (contractId, prefix) => request(`/contracts/${contractId}/state${prefix ? `?prefix=${encodeURIComponent(prefix)}` : ''}`),
  simulateContractCall: (contractId, method, args = []) =>
    request(`/contracts/${contractId}/simulate`, { method: 'POST', body: { method, args } }),
  getBudget: () => request('/wallet/budget'),
  setBudget: (monthly_budget) => request('/wallet/budget', { method: 'PATCH', body: { monthly_budget } }),
  withdrawFunds: (destination, amount) => request('/wallet/withdraw', { method: 'POST', body: { destination, amount } }),
  getContractEvents: (contractId, params = {}) => request(`/contracts/${contractId}/events${toQs(params)}`),

  // Subscriptions
  getSubscriptions: () => request('/subscriptions'),
  createSubscription: (body) => request('/subscriptions', { method: 'POST', body }),
  cancelSubscription: (id) => request(`/subscriptions/${id}`, { method: 'DELETE' }),
  pauseSubscription: (id) => request(`/subscriptions/${id}/pause`, { method: 'PATCH' }),
  resumeSubscription: (id) => request(`/subscriptions/${id}/resume`, { method: 'PATCH' }),

  getPushPublicKey: () => request('/notifications/vapid-public-key'),
  subscribePush: (subscription) => request('/notifications/subscribe', { method: 'POST', body: { subscription } }),
  unsubscribePush: () => request('/notifications/subscribe', { method: 'DELETE' }),
  // Product import (AgroAPI / JSON)
  importProductsPreview: (products) => request('/products/import', { method: 'POST', body: { products } }),
  importProductsConfirm: (products) => request('/products/import/confirm', { method: 'POST', body: { products } }),
  // Seed phrase backup & recovery
  getSeedPhrase: (password) => request('/auth/seed-phrase', { method: 'POST', body: { password } }),
  recoverAccount: (body) => request('/auth/recover', { method: 'POST', body }),
  // Availability calendar
  getCalendar: (productId) => request(`/products/${productId}/calendar`),
  setCalendarWeek: (productId, body) => request(`/products/${productId}/calendar`, { method: 'POST', body }),
  // Cooperatives & multi-sig
  createCooperative: (body) => request('/cooperatives', { method: 'POST', body }),
  getCooperatives: () => request('/cooperatives'),
  getFarmerCooperatives: (farmerId) => request(`/cooperatives?farmer_id=${encodeURIComponent(farmerId)}`),
  setupMultisig: (id, body) => request(`/cooperatives/${id}/multisig-setup`, { method: 'POST', body }),
  initiateCoopTx: (id, body) => request(`/cooperatives/${id}/transactions`, { method: 'POST', body }),
  signPendingTx: (txId) => request(`/cooperatives/transactions/${txId}/sign`, { method: 'POST' }),
  getPendingTxs: (coopId) => request(`/cooperatives/${coopId}/pending`),
  // Coupons
  getMyCoupons: () => request('/coupons'),
  createCoupon: (body) => request('/coupons', { method: 'POST', body }),
  deleteCoupon: (id) => request(`/coupons/${id}`, { method: 'DELETE' }),
  validateCoupon: (body) => request('/coupons/validate', { method: 'POST', body }),

  // Platform fee
  getFeePreview: (amount) => request(`/orders/fee-preview?amount=${amount}`),
  // Account alerts
  getAlerts: () => request('/wallet/alerts'),
  markAlertRead: (id) => request(`/wallet/alerts/${id}/read`, { method: 'PATCH' }),

  // Announcements
  getAnnouncements: () => request('/announcements'),
  adminGetAnnouncements: () => request('/announcements/admin'),
  adminCreateAnnouncement: (body) => request('/announcements/admin', { method: 'POST', body }),
  adminUpdateAnnouncement: (id, body) => request(`/announcements/admin/${id}`, { method: 'PATCH', body }),
  adminDeleteAnnouncement: (id) => request(`/announcements/admin/${id}`, { method: 'DELETE' }),

  // Creator earnings (Stellar claim)
  getCreatorEarnings: () => request('/wallet/earnings'),
  claimCreatorEarnings: () => request('/wallet/earnings/claim', { method: 'POST' }),

  // Payment streams
  getPaymentStreams: () => request('/streams'),
  createPaymentStream: (body) => request('/streams', { method: 'POST', body }),
  cancelPaymentStream: (id) => request(`/streams/${id}/cancel`, { method: 'POST' }),
  decreasePaymentStreamRate: (id, rate) => request(`/streams/${id}/decrease-rate`, { method: 'PATCH', body: { rate } }),
  withdrawPaymentStream: (id) => request(`/streams/${id}/withdraw`, { method: 'POST' }),
  // Claimable balances
  getClaimableBalances: () => request('/wallet/claimable-balances'),
  claimBalance: (balance_id) => request('/wallet/claim', { method: 'POST', body: { balance_id } }),

  // Two-Factor Authentication
  setup2FA: () => request('/auth/2fa/setup', { method: 'POST' }),
  verify2FA: (body) => request('/auth/2fa/verify', { method: 'POST', body }),
  get2FAStatus: () => request('/auth/2fa/status'),
  disable2FA: () => request('/auth/2fa/disable', { method: 'POST' }),
};
