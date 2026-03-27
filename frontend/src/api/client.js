const BASE = '/api';

// Access token lives in memory only — never in localStorage
let accessToken = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function clearAccessToken() {
  accessToken = null;
}

// Reads the csrf_token cookie (not HttpOnly, so JS can read it)
function getCsrfToken() {
  const match = document.cookie.split(';').find(c => c.trim().startsWith('csrf_token='));
  return match ? match.trim().split('=')[1] : null;
}

// Lazily fetches a CSRF token from the server if the cookie is missing
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

// Attempt to get a fresh access token using the HttpOnly refresh cookie
async function refreshAccessToken() {
  const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
  if (!res.ok) return null;
  const data = await res.json();
  accessToken = data.token;
  return accessToken;
}

const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];
const CSRF_EXEMPT = ['/auth/login', '/auth/register'];

async function request(path, options = {}, retry = true) {
  const method = (options.method || 'GET').toUpperCase();
  const needsCsrf = MUTATING.includes(method) && !CSRF_EXEMPT.includes(path);

  if (needsCsrf) await ensureCsrfToken();

  const csrfToken = needsCsrf ? getCsrfToken() : null;

  // If a FormData body is passed, let the browser set Content-Type (multipart boundary)
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
    body: isFormData ? options.body : (options.body ? JSON.stringify(options.body) : undefined),
  });

  // Silent refresh on 401
  if (res.status === 401 && retry) {
    const newToken = await refreshAccessToken();
    if (newToken) return request(path, options, false);
    clearAccessToken();
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Session expired');
  }

  // Rate limited — surface a friendly message
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    const msg = retryAfter
      ? `Too many requests. Please wait ${retryAfter} seconds and try again.`
      : 'Too many requests. Please slow down and try again shortly.';
    throw Object.assign(new Error(msg), { code: 'rate_limited', status: 429 });
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || 'Request failed');
  return data;
}

export const api = {
  register: (body) => request('/auth/register', { method: 'POST', body }),
  login: (body) => request('/auth/login', { method: 'POST', body }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  refresh: () => refreshAccessToken(),

  getProducts: (filters = {}) => {
    const entries = Object.entries(filters).filter(([, v]) => v !== '' && v != null);
    const qs = new URLSearchParams(entries).toString();
    return request(`/products${qs ? `?${qs}` : ''}`);
  },
  getCategories: () => request('/products/categories'),
  getProduct: (id) => request(`/products/${id}`),
  createProduct: (body) => request('/products', { method: 'POST', body }),
  getMyProducts: () => request('/products/mine/list'),
  restockProduct: (id, quantity) => request('/products/' + id + '/restock', { method: 'PATCH', body: { quantity } }),
  deleteProduct: (id) => request(`/products/${id}`, { method: 'DELETE' }),

  // Upload a product image — returns { imageUrl }
  uploadProductImage: (file) => {
    const form = new FormData();
    form.append('image', file);
    return request('/products/upload-image', { method: 'POST', body: form });
  },

  placeOrder: (body) => request('/orders', { method: 'POST', body }),
  getOrders: () => request('/orders'),
  getSales: () => request('/orders/sales'),

  getWallet: () => request('/wallet'),
  getTransactions: () => request('/wallet/transactions'),
  fundWallet: () => request('/wallet/fund', { method: 'POST' }),
  getAnalytics: () => request('/analytics/farmer'),
  updateProduct: (id, body) => request(`/products/${id}`, { method: 'PATCH', body }),
  updateOrderStatus: (id, status) => request(`/orders/${id}/status`, { method: 'PATCH', body: { status } }),

  // Admin
  adminGetUsers: (page = 1) => request(`/admin/users?page=${page}`),
  adminDeactivateUser: (id) => request(`/admin/users/${id}`, { method: 'DELETE' }),
  adminGetStats: () => request('/admin/stats'),

};
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

  placeOrder: function(body) { return request('/orders', { method: 'POST', body: body }); },
  getOrders: function(status) { return request('/orders' + (status ? '?status=' + status : '')); },
  getSales: function() { return request('/orders/sales'); },

  getWallet: function() { return request('/wallet'); },
  getTransactions: function() { return request('/wallet/transactions'); },
  fundWallet: function() { return request('/wallet/fund', { method: 'POST' }); },
};
