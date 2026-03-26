const BASE = '/api';

function getToken() {
  return localStorage.getItem('token');
}

// Reads the csrf_token cookie (not HttpOnly, so JS can read it)
function getCsrfToken() {
  const match = document.cookie.split(';').find(function(c) {
    return c.trim().startsWith('csrf_token=');
  });
  return match ? match.trim().split('=')[1] : null;
}

// Lazily fetches a CSRF token from the server if the cookie is missing
var csrfReady = null;
function ensureCsrfToken() {
  if (getCsrfToken()) return Promise.resolve();
  if (!csrfReady) {
    csrfReady = fetch(BASE + '/csrf-token', { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .catch(function() { return null; })
      .finally(function() { csrfReady = null; });
  }
  return csrfReady;
}

var MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];
var CSRF_EXEMPT = ['/auth/login', '/auth/register'];

async function request(path, options) {
  options = options || {};
  var method = (options.method || 'GET').toUpperCase();
  var needsCsrf = MUTATING.indexOf(method) !== -1 && CSRF_EXEMPT.indexOf(path) === -1;

  if (needsCsrf) await ensureCsrfToken();

  var csrfToken = needsCsrf ? getCsrfToken() : null;

  var headers = { 'Content-Type': 'application/json' };
  var token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (options.headers) Object.assign(headers, options.headers);

  var res = await fetch(BASE + path, {
    method: options.method,
    credentials: 'include',
    headers: headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  var data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export var api = {
  register: function(body) { return request('/auth/register', { method: 'POST', body: body }); },
  login: function(body) { return request('/auth/login', { method: 'POST', body: body }); },

  getProducts: function(filters) {
    filters = filters || {};
    var entries = Object.entries(filters).filter(function(e) { return e[1] !== '' && e[1] != null; });
    var qs = new URLSearchParams(entries).toString();
    return request('/products' + (qs ? '?' + qs : ''));
  },
  getCategories: function() { return request('/products/categories'); },
  getProduct: function(id) { return request('/products/' + id); },
  createProduct: function(body) { return request('/products', { method: 'POST', body: body }); },
  getMyProducts: function() { return request('/products/mine/list'); },
  deleteProduct: function(id) { return request('/products/' + id, { method: 'DELETE' }); },

  placeOrder: function(body) { return request('/orders', { method: 'POST', body: body }); },
  getOrders: function() { return request('/orders'); },
  getSales: function() { return request('/orders/sales'); },

  getWallet: function() { return request('/wallet'); },
  getTransactions: function() { return request('/wallet/transactions'); },
  fundWallet: function() { return request('/wallet/fund', { method: 'POST' }); },
};
