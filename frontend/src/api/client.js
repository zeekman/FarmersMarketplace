const BASE = '/api';

// Access token lives in memory only — never in localStorage
let accessToken = null;

export function setAccessToken(token) { accessToken = token; }
export function clearAccessToken()    { accessToken = null; }

function getCsrfToken() {
  const match = document.cookie.split(';').find(c => c.trim().startsWith('csrf_token='));
  return match ? match.trim().split('=')[1] : null;
}

let csrfReady = null;
function ensureCsrfToken() {
  if (getCsrfToken()) return Promise.resolve();
  if (!csrfReady) {
    csrfReady = fetch(`${BASE}/csrf-token`, { credentials: 'include' })
      .then(r => r.json())
      .catch(() => null)
      .finally(() => { csrfReady = null; });
  }
  return csrfReady;
}

async function refreshAccessToken() {
  const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
  if (!res.ok) return null;
  const data = await res.json();
  accessToken = data.token;
  return accessToken;
}

const MUTATING    = ['POST', 'PUT', 'PATCH', 'DELETE'];
const CSRF_EXEMPT = ['/auth/login', '/auth/register'];

async function request(path, options = {}, retry = true) {
  const method = (options.method || 'GET').toUpperCase();
  const needsCsrf = MUTATING.includes(method) && !CSRF_EXEMPT.includes(path);
  if (needsCsrf) await ensureCsrfToken();

  const csrfToken  = needsCsrf ? getCsrfToken() : null;
  const isFormData = options.body instanceof FormData;

  const headers = {};
  if (!isFormData) headers['Content-Type'] = 'application/json';
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  if (csrfToken)   headers['X-CSRF-Token']  = csrfToken;
  Object.assign(headers, options.headers || {});

  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: isFormData ? options.body : (options.body ? JSON.stringify(options.body) : undefined),
  });

  if (res.status === 401 && retry) {
    const newToken = await refreshAccessToken();
    if (newToken) return request(path, options, false);
    clearAccessToken();
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Session expired');
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || 'Request failed');
  return data;
}

/** Build a query string from a params object, omitting empty/null values. */
function toQs(params) {
  const entries = Object.entries(params).filter(([, v]) => v !== '' && v != null);
  return entries.length ? '?' + new URLSearchParams(entries).toString() : '';
}

export const api = {
  register: (body) => request('/auth/register', { method: 'POST', body }),
  login:    (body) => request('/auth/login',    { method: 'POST', body }),
  logout:   ()     => request('/auth/logout',   { method: 'POST' }),
  refresh:  ()     => refreshAccessToken(),

  // filters may include: category, minPrice, maxPrice, seller, available, page, limit
  getProducts:  (filters = {}) => request(`/products${toQs(filters)}`),
  getCategories: ()            => request('/products/categories'),
  getProduct:   (id)           => request(`/products/${id}`),
  createProduct: (body)        => request('/products', { method: 'POST', body }),
  getMyProducts: ()            => request('/products/mine/list'),
  deleteProduct: (id)          => request(`/products/${id}`, { method: 'DELETE' }),
  getProductReviews: (id)      => request(`/products/${id}/reviews`),
  login: (body) => request('/auth/login', { method: 'POST', body }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  refresh: () => refreshAccessToken(),

  // filters may include: category, minPrice, maxPrice, seller, available, page, limit
  getProducts: (filters = {}) => request(`/products${toQs(filters)}`),
  getCategories: () => request('/products/categories'),
  getProduct: (id) => request(`/products/${id}`),
  createProduct: (body) => request('/products', { method: 'POST', body }),
  getMyProducts: () => request('/products/mine/list'),
  deleteProduct: (id) => request(`/products/${id}`, { method: 'DELETE' }),
  updateProduct: (id, body) => request(`/products/${id}`, { method: 'PATCH', body }),

  uploadProductImage: (file) => {
    const form = new FormData();
    form.append('image', file);
    return request('/products/upload-image', { method: 'POST', body: form });
  },

  placeOrder:   (body)         => request('/orders', { method: 'POST', body }),
  // params may include: status, page, limit
  getOrders:    (params = {})  => request(`/orders${toQs(params)}`),
  getSales:     (params = {})  => request(`/orders/sales${toQs(params)}`),

  submitReview: (body)         => request('/reviews', { method: 'POST', body }),

  getWallet:      ()           => request('/wallet'),
  getTransactions: ()          => request('/wallet/transactions'),
  fundWallet:     ()           => request('/wallet/fund', { method: 'POST' }),
  searchProducts: (q) => request(`/products/search?q=${encodeURIComponent(q)}`),

  placeOrder: (body) => request('/orders', { method: 'POST', body }),
  // params may include: status, page, limit
  getOrders: (params = {}) => request(`/orders${toQs(params)}`),
  // params may include: page, limit
  getSales: (params = {}) => request(`/orders/sales${toQs(params)}`),
  getOrders: (status) => request(`/orders${status ? `?status=${status}` : ''}`),
  getSales: () => request('/orders/sales'),
  updateOrderStatus: (id, status) => request(`/orders/${id}/status`, { method: 'PATCH', body: { status } }),

  getWallet: () => request('/wallet'),
  getTransactions: () => request('/wallet/transactions'),
  fundWallet: () => request('/wallet/fund', { method: 'POST' }),
  getAnalytics: () => request('/analytics/farmer'),
  getCategories: function() { return request('/products/categories'); },
  getProduct: function(id) { return request('/products/' + id); },
  createProduct: function(body) { return request('/products', { method: 'POST', body: body }); },
  getMyProducts: function() { return request('/products/mine/list'); },
  deleteProduct: function(id) { return request('/products/' + id, { method: 'DELETE' }); },

  placeOrder: function(body, idempotencyKey) {
    return request('/orders', {
      method: 'POST',
      body: body,
      headers: idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}
    });
  },
  getOrders: function(status) { return request('/orders' + (status ? '?status=' + status : '')); },
  getSales: function() { return request('/orders/sales'); },

  getWallet: function() { return request('/wallet'); },
  getTransactions: function() { return request('/wallet/transactions'); },
  fundWallet: function() { return request('/wallet/fund', { method: 'POST' }); },

  fundEscrow: (orderId) => request(`/orders/${orderId}/escrow`, { method: 'POST' }),
  claimEscrow: (orderId) => request(`/orders/${orderId}/claim`, { method: 'POST' }),

  setStockAlert: (productId) => request(`/products/${productId}/alert`, { method: 'POST' }),
  removeStockAlert: (productId) => request(`/products/${productId}/alert`, { method: 'DELETE' }),
  getMyAlert: (productId) => request(`/products/${productId}/alert/status`),
};
