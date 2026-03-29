const BASE = '/api';

function getToken() {
  return localStorage.getItem('token');
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

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
    csrfReady = fetch(`${BASE}/csrf-token`, { credentials: 'include' })
      .then((r) => r.json())
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
/** Build a query string from a params object, omitting empty/null values. */
async function request(path, options = {}, retry = true) {
  const method = (options.method || 'GET').toUpperCase();
  const needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !['/auth/login', '/auth/register'].includes(path);

  if (needsCsrf) await ensureCsrfToken();

  const csrfToken = needsCsrf ? getCsrfToken() : null;
  const isFormData = options.body instanceof FormData;

  const headers = {};
  if (!isFormData) headers['Content-Type'] = 'application/json';
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  Object.assign(headers, options.headers || {});

  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: isFormData
      ? options.body
      : options.body
        ? JSON.stringify(options.body)
        : undefined,
  });

  if (res.status === 401 && retry) {
    const newToken = await refreshAccessToken();
    if (newToken) return request(path, options, false);
    clearAccessToken();
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Session expired');
  }

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    const msg = retryAfter
      ? `Too many requests. Please wait ${retryAfter} seconds and try again.`
      : 'Too many requests. Please slow down and try again shortly.';
    throw Object.assign(new Error(msg), { code: 'rate_limited', status: 429 });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || 'Request failed');
  const data = await res.json();
  if (!res.ok) {
    const e = new Error(data.message || data.error || 'Request failed');
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

function toQs(params) {
  const entries = Object.entries(params).filter(([, v]) => v !== '' && v != null);
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
}

export const api = {
  register: (body) => request('/auth/register', { method: 'POST', body }),
  login: (body) => request('/auth/login', { method: 'POST', body }),

  getProducts: (filters = {}) => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== '' && v != null)).toString();
    return request(`/products${qs ? `?${qs}` : ''}`);
  },
  getProducts: (filters = {}) => request(`/products${toQs(filters)}`),
  getCategories: () => request('/products/categories'),
  getProduct: (id) => request(`/products/${id}`),
  createProduct: (body) => request('/products', { method: 'POST', body }),
  getMyProducts: () => request('/products/mine/list'),
  deleteProduct: (id) => request(`/products/${id}`, { method: 'DELETE' }),
  updateProduct: (id, body) => request(`/products/${id}`, { method: 'PATCH', body }),
  searchProducts: (q) => request(`/products/search?q=${encodeURIComponent(q)}`),

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

  getProductImages: (productId) => request(`/products/${productId}/images`),
  uploadProductImages: (productId, files) => {
    const form = new FormData();
    files.forEach((f) => form.append('images', f));
    return request(`/products/${productId}/images`, { method: 'POST', body: form });
  },
  deleteProductImage: (productId, imageId) => request(`/products/${productId}/images/${imageId}`, { method: 'DELETE' }),
  reorderProductImages: (productId, order) => request(`/products/${productId}/images/reorder`, { method: 'PATCH', body: { order } }),

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
  placeOrder: (body, idempotencyKey) => request('/orders', { method: 'POST', body, headers: idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {} }),
  getOrders: (params = {}) => request(`/orders${toQs(params)}`),
  getSales: (params = {}) => request(`/orders/sales${toQs(params)}`),
  updateOrderStatus: (id, status) => request(`/orders/${id}/status`, { method: 'PATCH', body: { status } }),

  submitReview: (body) => request('/reviews', { method: 'POST', body }),

  getWallet: () => request('/wallet'),
  getTransactions: () => request('/wallet/transactions'),
  fundWallet: () => request('/wallet/fund', { method: 'POST' }),
  sendXLM: (body) => request('/wallet/send', { method: 'POST', body }),
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
  getAnalytics: () => request('/analytics/farmer'),
  getForecast: () => request('/analytics/farmer/forecast'),


  createAddress: (body) => request('/addresses', { method: 'POST', body }),
  updateAddress: (id, body) => request(`/addresses/${id}`, { method: 'PUT', body }),
  deleteAddress: (id) => request(`/addresses/${id}`, { method: 'DELETE' }),
  setDefaultAddress: (id) => request(`/addresses/${id}/default`, { method: 'PATCH' }),

  adminGetUsers: (page = 1) => request(`/admin/users?page=${page}`),
  adminDeactivateUser: (id) => request(`/admin/users/${id}`, { method: 'DELETE' }),
  adminGetStats: () => request('/admin/stats'),

  getAddresses: () => request('/addresses'),
  createAddress: (body) => request('/addresses', { method: 'POST', body }),
  updateAddress: (id, body) => request(`/addresses/${id}`, { method: 'PUT', body }),
  deleteAddress: (id) => request(`/addresses/${id}`, { method: 'DELETE' }),
  setDefaultAddress: (id) => request(`/addresses/${id}/default`, { method: 'PATCH' }),

  setStockAlert: (productId) => request(`/products/${productId}/alert`, { method: 'POST' }),
  removeStockAlert: (productId) => request(`/products/${productId}/alert`, { method: 'DELETE' }),
  getMyAlert: (productId) => request(`/products/${productId}/alert/status`),
  fundEscrow: (orderId) => request(`/orders/${orderId}/escrow`, { method: 'POST' }),
  claimEscrow: (orderId) => request(`/orders/${orderId}/claim`, { method: 'POST' }),
  claimPreorder: (orderId) => request(`/orders/${orderId}/claim-preorder`, { method: 'POST' }),

  // Bundles
  getBundles: () => request('/bundles'),
  createBundle: (body) => request('/bundles', { method: 'POST', body }),
  deleteBundle: (id) => request(`/bundles/${id}`, { method: 'DELETE' }),
  purchaseBundle: (bundle_id) => request('/bundles/purchase', { method: 'POST', body: { bundle_id } }),
  getBundleOrders: () => request('/bundles/orders'),

  // Product images (multi-image gallery)
  getProductImages: (productId) => request(`/products/${productId}/images`),
  uploadProductImages: (productId, files) => {
    const form = new FormData();
    files.forEach((f) => form.append("images", f));
    return request(`/products/${productId}/images`, {
      method: "POST",
      body: form,
    });
  },

  placeOrder:   (body)         => request('/orders', { method: 'POST', body }),
  // params may include: status, page, limit
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
  deleteAccount:   (force)     => request(`/auth/account${force ? '?force=true' : ''}`, { method: 'DELETE' }),
  // Returns the SSE URL with the token embedded (EventSource can't set headers)
  getWalletStreamUrl: ()       => `/api/wallet/stream?token=${encodeURIComponent(accessToken || '')}`,
  searchProducts: (q) => request(`/products/search?q=${encodeURIComponent(q)}`),

  placeOrder: (body) => request('/orders', { method: 'POST', body }),
  getOrderStatus: (id) => request(`/orders/${id}/status`),
  getOrders: () => request('/orders'),
  getSales: () => request('/orders/sales'),

  getWallet: () => request('/wallet'),
  getTransactions: () => request('/wallet/transactions'),
  fundWallet: () => request('/wallet/fund', { method: 'POST' }),

  getAuctions: () => request('/auctions'),
  getAuction: (id) => request(`/auctions/${id}`),
  createAuction: (body) => request('/auctions', { method: 'POST', body }),
  placeBid: (id, body) => request(`/auctions/${id}/bid`, { method: 'POST', body }),
  getFarmer: (id) => request(`/farmers/${id}`),
  updateFarmerProfile: (body) => request('/farmers/me', { method: 'PATCH', body }),

  getXlmRate: () => request('/rates/xlm-usd'),
  getAnalytics: () => request('/analytics/farmer'),

  // Admin
  adminGetUsers: (page = 1) => request(`/admin/users?page=${page}`),
  adminDeactivateUser: (id) => request(`/admin/users/${id}`, { method: 'DELETE' }),
  adminGetStats: () => request('/admin/stats'),
  getWallet: function() { return request('/wallet'); },
  getTransactions: function() { return request('/wallet/transactions'); },
  fundWallet: function() { return request('/wallet/fund', { method: 'POST' }); },
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
};
