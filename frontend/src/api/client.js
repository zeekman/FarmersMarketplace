const BASE = '/api';

let accessToken = null;
let loadingCallback = null;
let logoutCallback = null;

export function setAccessToken(token) {
  accessToken = token;
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

let csrfReady = null;
function ensureCsrfToken() {
  if (getCsrfToken()) return Promise.resolve();
  if (!csrfReady) {
    csrfReady = fetch(`${BASE}/csrf-token`, {
      credentials: 'include',
    })
      .then(() => null)
      .catch(() => null)
      .finally(() => {
        csrfReady = null;
      });
  }
  return csrfReady;
}

async function refreshAccessToken() {
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) return null;
  const data = await res.json();
  accessToken = data.token;
  return accessToken;
}

const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];
const CSRF_EXEMPT = ['/auth/login', '/auth/register', '/auth/refresh'];

async function request(path, options = {}, retry = true) {
  const method = (options.method || 'GET').toUpperCase();
  const needsCsrf = MUTATING.includes(method) && !CSRF_EXEMPT.includes(path);

  if (needsCsrf) await ensureCsrfToken();
  const csrfToken = needsCsrf ? getCsrfToken() : null;
  const isFormData = options.body instanceof FormData;

  if (loadingCallback) loadingCallback(true);
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
    });

    if (res.status === 401 && retry) {
      const token = await refreshAccessToken();
      if (token) return request(path, options, false);
      clearAccessToken();
      if (logoutCallback) logoutCallback();
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || data.error || 'Session expired');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || data.error || 'Request failed');
      err.code = data.code;
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    if (loadingCallback) loadingCallback(false);
  }
}

function toQs(params = {}) {
  const entries = Object.entries(params).filter(([, v]) => v !== '' && v != null);
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
}

export const api = {
  register: (body) => request('/auth/register', { method: 'POST', body }),
  login: (body) => request('/auth/login', { method: 'POST', body }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  refresh: () => refreshAccessToken(),

  getProducts: (filters = {}) => request(`/products${toQs(filters)}`),
  getCategories: () => request('/products/categories'),
  getProduct: (id) => request(`/products/${id}`),
  createProduct: (body) => request('/products', { method: 'POST', body }),
  getMyProducts: () => request('/products/mine/list'),
  getHarvestBatches: () => request('/batches'),
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
  getPriceHistory: (id) => request(`/products/${id}/price-history`),
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

  bulkUploadProducts: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request('/products/bulk', { method: 'POST', body: form });
  },

  placeOrder: (body, idempotencyKey) =>
    request('/orders', {
      method: 'POST',
      body,
      headers: idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {},
    }),
  getOrders: (params = {}) => request(`/orders${toQs(params)}`),
  getSales: (params = {}) => request(`/orders/sales${toQs(params)}`),
  updateOrderStatus: (id, status) => request(`/orders/${id}/status`, { method: 'PATCH', body: { status } }),

  fundEscrow: (orderId) => request(`/orders/${orderId}/escrow`, { method: 'POST' }),
  claimEscrow: (orderId) => request(`/orders/${orderId}/claim`, { method: 'POST' }),
  claimPreorder: (orderId) => request(`/orders/${orderId}/claim-preorder`, { method: 'POST' }),
  fileReturn: (orderId, reason) => request(`/orders/${orderId}/return`, { method: 'POST', body: { reason } }),
  approveReturn: (orderId) => request(`/orders/${orderId}/return/approve`, { method: 'PATCH' }),
  rejectReturn: (orderId, reject_reason) => request(`/orders/${orderId}/return/reject`, { method: 'PATCH', body: { reject_reason } }),

  submitReview: (body) => request('/reviews', { method: 'POST', body }),

  getWallet: () => request('/wallet'),
  getTransactions: () => request('/wallet/transactions'),
  fundWallet: () => request('/wallet/fund', { method: 'POST' }),
  sendXLM: (body) => request('/wallet/send', { method: 'POST', body }),
  addTrustline: (body) => request('/wallet/trustline', { method: 'POST', body }),
  removeTrustline: (body) => request('/wallet/trustline', { method: 'DELETE', body }),
  getWalletAssets: () => request('/wallet/assets'),
  getPathEstimate: (params) => request(`/wallet/path-estimate${toQs(params)}`),
  deleteAccount: (force) => request(`/auth/account${force ? '?force=true' : ''}`, { method: 'DELETE' }),
  getWalletStreamUrl: () => `/api/wallet/stream?token=${encodeURIComponent(accessToken || '')}`,

  getFarmer: (id) => request(`/farmers/${id}`),
  updateFarmerProfile: (body) => request('/farmers/me', { method: 'PATCH', body }),

  addFavorite: (productId) => request('/favorites', { method: 'POST', body: { product_id: productId } }),
  removeFavorite: (productId) => request(`/favorites/${productId}`, { method: 'DELETE' }),
  getFavorites: (params = {}) => request(`/favorites${toQs(params)}`),
  checkFavorite: (productId) => request(`/favorites/check/${productId}`),

  setStockAlert: (productId) => request(`/products/${productId}/alert`, { method: 'POST' }),
  removeStockAlert: (productId) => request(`/products/${productId}/alert`, { method: 'DELETE' }),
  getMyAlert: (productId) => request(`/products/${productId}/alert/status`),

  getXlmRate: () => request('/rates/xlm-usd'),
  bulkUpdatePrices: (updates, adjustment_percent) =>
    request('/products/bulk-price', { method: 'PATCH', body: { updates, adjustment_percent } }),

  getAnalytics: () => request('/analytics/farmer'),
  getForecast: () => request('/analytics/farmer/forecast'),
  getWaitlistAnalytics: () => request('/analytics/farmer/waitlist'),


  createAddress: (body) => request('/addresses', { method: 'POST', body }),
  updateAddress: (id, body) => request(`/addresses/${id}`, { method: 'PUT', body }),
  deleteAddress: (id) => request(`/addresses/${id}`, { method: 'DELETE' }),
  setDefaultAddress: (id) => request(`/addresses/${id}/default`, { method: 'PATCH' }),

  adminGetUsers: (page = 1) => request(`/admin/users?page=${page}`),
  adminDeactivateUser: (id) => request(`/admin/users/${id}`, { method: 'DELETE' }),
  adminGetStats: () => request('/admin/stats'),
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

  placeOrderWithBudgetOverride: (body) => request('/orders', { method: 'POST', body: { ...body, budget_override_confirmed: true } }),
  // params may include: status, page, limit
  getOrderPaymentLink: (id) => request(`/orders/${id}/payment-link`),
  getOrders:    (params = {})  => request(`/orders${toQs(params)}`),
  getSales:     (params = {})  => request(`/orders/sales${toQs(params)}`),

  submitReview: (body)         => request('/reviews', { method: 'POST', body }),

  getWallet:      ()           => request('/wallet'),
  getTransactions: ()          => request('/wallet/transactions'),
  fundWallet:     ()           => request('/wallet/fund', { method: 'POST' }),
  sendXLM:        (body)       => request('/wallet/send', { method: 'POST', body }),
  addTrustline:   (body)       => request('/wallet/trustline', { method: 'POST', body }),
  removeTrustline:(body)       => request('/wallet/trustline', { method: 'DELETE', body }),
  getWalletAssets: ()          => request('/wallet/assets'),
  getPathEstimate: (params)    => request(`/wallet/path-estimate${toQs(params)}`),
  mergeWallet:    (body)       => request('/wallet/merge', { method: 'POST', body }),
  deleteAccount:   (force)     => request(`/auth/account${force ? '?force=true' : ''}`, { method: 'DELETE' }),
  // Returns the SSE URL with the token embedded (EventSource can't set headers)
  getWalletStreamUrl: ()       => `/api/wallet/stream?token=${encodeURIComponent(accessToken || '')}`,
  searchProducts: (q) => request(`/products/search?q=${encodeURIComponent(q)}`),

  placeOrder: (body) => request('/orders', { method: 'POST', body }),
  getOrderStatus: (id) => request(`/orders/${id}/status`),
  getOrderPaymentLink: (orderId) => request(`/orders/${orderId}/payment-link`),
  getOrderPaymentLinkQr: (orderId) => `/api/orders/${orderId}/payment-link/qr`,
  getOrders: (params = {}) => request(`/orders${toQs(params)}`),
  getSales: (params = {}) => request(`/orders/sales${toQs(params)}`),
  updateOrderStatus: (id, status) => request(`/orders/${id}/status`, { method: 'PATCH', body: { status } }),

  getAuctions: () => request('/auctions'),
  getAuction: (id) => request(`/auctions/${id}`),
  createAuction: (body) => request('/auctions', { method: 'POST', body }),
  placeBid: (id, body) => request(`/auctions/${id}/bid`, { method: 'POST', body }),

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
  getWallet: function() { return request('/wallet'); },
  getTransactions: function() { return request('/wallet/transactions'); },
  fundWallet: function() { return request('/wallet/fund', { method: 'POST' }); },
  getBudget: function() { return request('/wallet/budget'); },
  setBudget: function(monthly_budget) { return request('/wallet/budget', { method: 'PATCH', body: { monthly_budget } }); },
  withdrawFunds: function(destination, amount) { return request('/wallet/withdraw', { method: 'POST', body: { destination, amount } }); },
  getBudget: function() { return request('/wallet/budget'); },
  setBudget: function(monthly_budget) { return request('/wallet/budget', { method: 'PATCH', body: { monthly_budget } }); },
  getProductShareMeta: function(id) { return request(`/products/${id}/share`); },
  deleteProductImage: (productId, imageId) =>
    request(`/products/${productId}/images/${imageId}`, { method: "DELETE" }),
  reorderProductImages: (productId, order) =>
    request(`/products/${productId}/images/reorder`, {
      method: "PATCH",
      body: { order },
    }),

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
  setupMultisig: (id, body) => request(`/cooperatives/${id}/multisig-setup`, { method: 'POST', body }),
  initiateCoopTx: (id, body) => request(`/cooperatives/${id}/transactions`, { method: 'POST', body }),
  signPendingTx: (txId) => request(`/cooperatives/transactions/${txId}/sign`, { method: 'POST' }),
  getPendingTxs: (coopId) => request(`/cooperatives/${coopId}/pending`),
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
};
