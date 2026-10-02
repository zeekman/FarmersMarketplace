import '@testing-library/jest-dom';
import { expect } from 'vitest';
import { toHaveNoViolations } from 'jest-axe';
import i18n from '../i18n/index.js';
import '../i18n/index.js'; // ensure i18n is initialized

// Enables `expect(await axe(container)).toHaveNoViolations()` in every test file.
expect.extend(toHaveNoViolations);

if (typeof globalThis.EventSource === 'undefined') {
  globalThis.EventSource = class {
    constructor() {
      this.onmessage = null;
      this.onopen = null;
      this.onerror = null;
    }
    close() {}
  };
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
