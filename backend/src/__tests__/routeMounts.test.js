const fs = require('fs');
const path = require('path');
const request = require('supertest');

const ROUTES_DIR = path.join(__dirname, '..', 'routes');
const INDEX_FILE = path.join(ROUTES_DIR, 'index.js');

/**
 * Collect every router module that routes/index.js pulls in via a relative
 * `require('./<name>')` (e.g. require('./admin'), require('./contracts')).
 * A missing/mis-declared dependency (such as the removed middleware/adminAuth)
 * shows up here as a load-time failure.
 */
function routerNamesInIndex() {
  const src = fs.readFileSync(INDEX_FILE, 'utf8');
  const names = new Set();
  const re = /require\((['"])\.\/([\w./-]+)\1\)/g;
  let match;
  while ((match = re.exec(src)) !== null) {
    names.add(match[2]);
  }
  return [...names].sort();
}

describe('API route mounts', () => {
  it('serves the versioned CSRF token endpoint', async () => {
    // Required inside the test so a single broken router cannot prevent the
    // router-load assertions below from running and reporting the offender.
    const app = require('../app');
    const response = await request(app).get('/api/v1/csrf-token');

    expect(response.status).toBe(200);
    expect(response.body).not.toEqual({ success: true, data: [] });
  });

  it.each([
    ['get', '/api/v1/not-a-route'],
    ['delete', '/api/v1/not-a-route'],
    ['post', '/api/v1'],
  ])('does not route %s %s through reviews', async (method, path) => {
    const app = require('../app');
    const response = await request(app)[method](path);

    expect(response.status).toBe(404);
    expect(response.body).not.toEqual({ success: true, data: [] });
  });
});

describe('every router mounted by routes/index.js loads without throwing (#009)', () => {
  const routerNames = routerNamesInIndex();

  it('discovers the routers referenced by routes/index.js', () => {
    expect(routerNames.length).toBeGreaterThan(10);
  });

  it.each(routerNames)('requires routes/%s without throwing', (name) => {
    expect(() => require(`../routes/${name}`)).not.toThrow();
  });
});
