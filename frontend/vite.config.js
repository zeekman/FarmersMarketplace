import { readFileSync, writeFileSync } from 'fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
// Bundle size budgets (kB, uncompressed).
// Raise these deliberately and document the reason — do not bump silently.
const INITIAL_CHUNK_BUDGET_KB = 500;   // vendor + index combined initial load
const TOTAL_BUNDLE_BUDGET_KB  = 5000;  // whole dist/assets directory

// Vite's `define` only rewrites modules it bundles. Files in `public/` are
// copied verbatim, so `self.__APP_VERSION__` inside `public/sw.js` would stay
// undefined in the browser and the cache name would never change. This plugin
// stamps the version into the copied `sw.js` at build time so each deploy gets
// a fresh cache name and the byte-diff triggers a service worker update.
function serviceWorkerVersion() {
  return {
    name: 'sw-version',
    apply: 'build',
    closeBundle() {
      const swPath = 'dist/sw.js';
      let sw;
      try {
        sw = readFileSync(swPath, 'utf8');
      } catch {
        return;
      }
      const stamped = sw.replace(
        /self\.__APP_VERSION__\s*\|\|\s*'[^']*'/,
        JSON.stringify(pkg.version),
      );
      if (stamped !== sw) {
        writeFileSync(swPath, stamped);
      }
    },
  };
}

// Backend-served paths. Production routes these through nginx, so keep this list
// in sync with nginx/farmers-marketplace.conf or dev and prod will diverge.
const PROXY_TARGET = process.env.VITE_API_URL || 'http://localhost:4000';
const BACKEND_PATHS = [
  '/api',
  '/uploads',
  '/federation',
  '/seo',
  '/.well-known',
  '/sitemap.xml',
  '/robots.txt',
];

export default defineConfig({
  plugins: [
    react(),
    serviceWorkerVersion(),
    visualizer({
      filename: 'dist/bundle-report.html',
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
      open: false,
    }),
  ],
  define: {
    'self.__APP_VERSION__': JSON.stringify(pkg.version),
  },
  build: {
    manifest: true,
    // Warn (and fail in CI via the check-bundle-size script) when any single
    // chunk exceeds this limit.
    chunkSizeWarningLimit: INITIAL_CHUNK_BUDGET_KB,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll('\\', '/');
          if (/\/node_modules\/(react|react-dom|react-router-dom)\//.test(normalizedId)) {
            return 'vendor';
          }
          if (/\/node_modules\/(i18next|react-i18next)\//.test(normalizedId)) {
            return 'i18n-vendor';
          }
          if (/\/node_modules\/(recharts|d3-[^/]+|internmap|victory-vendor)\//.test(normalizedId)) {
            return 'charts';
          }
          if (/\/node_modules\/(leaflet|react-leaflet|@react-leaflet\/core)\//.test(normalizedId)) {
            return 'maps';
          }
          // Stellar SDK / Freighter: only wallet and checkout routes need it, so keep it out of the entry.
          if (/\/node_modules\/@stellar\//.test(normalizedId)) {
            return 'stellar-vendor';
          }
        },
      },
      // Treat the optional Sentry SDK as external — it is loaded dynamically
      // only when VITE_SENTRY_DSN is set, so it must never be bundled.
      external: (id) => id === '@sentry/react',
    },
  },
  server: {
    port: 3000,
    // ws + changeOrigin keep WebSocket upgrades and SSE streams working through the proxy.
    proxy: Object.fromEntries(
      BACKEND_PATHS.map((path) => [
        path,
        { target: PROXY_TARGET, changeOrigin: true, ws: true },
      ]),
    ),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
  },
});
