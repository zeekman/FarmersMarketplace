import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    // Single test directory convention: all tests live under src/test/.
    // See CONTRIBUTING.md for details.
    include: ['src/test/**/*.{test,spec}.{js,jsx,ts,tsx}'],
  },
});
