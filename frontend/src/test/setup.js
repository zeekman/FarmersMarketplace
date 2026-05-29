import '@testing-library/jest-dom';
import i18n from '../i18n/index.js';
import '../i18n/index.js'; // ensure i18n is initialized

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
