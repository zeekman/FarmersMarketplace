'use strict';

const app = require('../src/app');

/**
 * Collect every path string registered on the root Express router stack,
 * including nested routers mounted via router.use().
 */
function collectMountPaths(stack, prefix = '') {
  const paths = [];
  for (const layer of stack || []) {
    const seg = layer.regexp?.source ?? '';
    const path = prefix + (layer.route?.path ?? '');
    if (layer.handle?.stack) {
      // nested router
      const mountPath = layer.regexp
        ? prefix + (layer.keys?.length === 0 ? routerRegexpToPath(layer.regexp) : '')
        : prefix;
      paths.push(...collectMountPaths(layer.handle.stack, mountPath));
    } else {
      paths.push(path || seg);
    }
  }
  return paths;
}

function routerRegexpToPath(re) {
  // Express converts '/api/coupons' → /^\/api\/coupons\/?(?=\/|$)/i
  const m = re.source.match(/^\^\\\/(.+?)\\\/\?\(\?=\\\/\|\$\)/);
  return m ? '/' + m[1].replace(/\\\//g, '/') : '';
}

/**
 * Walk app._router.stack and collect (mountPath, routerHandle) pairs so we
 * can count how many times the same router object is wired in.
 */
function collectRouterEntries(stack, prefix = '') {
  const entries = [];
  for (const layer of stack || []) {
    if (layer.handle?.stack) {
      const mountPath = prefix + routerRegexpToPath(layer.regexp);
      entries.push({ path: mountPath, handle: layer.handle });
      entries.push(...collectRouterEntries(layer.handle.stack, mountPath));
    }
  }
  return entries;
}

describe('Route deduplication', () => {
  let routerStack;

  beforeAll(() => {
    // app._router is populated after the first request or after listen; force it.
    routerStack = app._router ? app._router.stack : [];
  });

  const suspectPaths = [
    '/api/coupons',
    '/api/export',
    '/api/categories',
    '/api/reviews',
  ];

  test.each(suspectPaths)('%s is mounted exactly once', (mountPath) => {
    const entries = collectRouterEntries(routerStack);
    const matches = entries.filter((e) => e.path === mountPath);
    expect(matches.length).toBe(1);
  });

  test('no router handle object appears more than once in the top-level stack', () => {
    const seen = new Map();
    for (const layer of routerStack) {
      if (!layer.handle?.stack) continue;
      const count = (seen.get(layer.handle) || 0) + 1;
      seen.set(layer.handle, count);
    }
    for (const [handle, count] of seen) {
      expect(count).toBe(1);
    }
  });
});
