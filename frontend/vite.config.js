import { readFileSync, writeFileSync } from 'fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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

export default defineConfig({
  plugins: [react(), serviceWorkerVersion()],
  define: {
    'self.__APP_VERSION__': JSON.stringify(pkg.version),
  },
  build: {
    // Warn (and fail in CI via the check-bundle-size script) when any single
    // chunk exceeds this limit.
    chunkSizeWarningLimit: INITIAL_CHUNK_BUDGET_KB,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
      // Treat the optional Sentry SDK as external — it is loaded dynamically
      // only when VITE_SENTRY_DSN is set, so it must never be bundled.
      external: (id) => id === '@sentry/react',
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': process.env.VITE_API_URL || 'http://localhost:4000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
  },
});
