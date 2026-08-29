import { readFileSync } from 'fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
// Bundle size budgets (kB, uncompressed).
// Raise these deliberately and document the reason — do not bump silently.
const INITIAL_CHUNK_BUDGET_KB = 500;   // vendor + index combined initial load
const TOTAL_BUNDLE_BUDGET_KB  = 5000;  // whole dist/assets directory

export default defineConfig({
  plugins: [react()],
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
