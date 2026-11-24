import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      reportsDirectory: './coverage',
      // Starting floor; raise over time as coverage grows (#1396).
      thresholds: {
        lines: 50,
        branches: 50,
        functions: 50,
        statements: 50,
        // Critical utilities must stay well covered (#1705).
        'src/utils/**': {
          lines: 90,
          branches: 90,
        },
        'src/api/**': {
          lines: 90,
          branches: 90,
        },
      },
    },
  },
});
