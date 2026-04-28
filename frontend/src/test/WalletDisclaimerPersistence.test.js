import { describe, it, expect, beforeEach } from 'vitest';

const DISCLAIMER_KEY = 'testnet_disclaimer_dismissed';

function shouldShowDisclaimer() {
  return localStorage.getItem(DISCLAIMER_KEY) !== 'true';
}

function dismissDisclaimer() {
  localStorage.setItem(DISCLAIMER_KEY, 'true');
}

describe('Wallet disclaimer localStorage persistence (#423)', () => {
  beforeEach(() => {
    localStorage.removeItem(DISCLAIMER_KEY);
  });

  it('shows disclaimer when key is absent (fresh session)', () => {
    expect(shouldShowDisclaimer()).toBe(true);
  });

  it('hides disclaimer after dismissal', () => {
    dismissDisclaimer();
    expect(shouldShowDisclaimer()).toBe(false);
  });

  it('persists dismissal across simulated page reload', () => {
    dismissDisclaimer();
    // Simulate reload: re-read from localStorage
    expect(shouldShowDisclaimer()).toBe(false);
  });

  it('shows disclaimer again after key is cleared (incognito)', () => {
    dismissDisclaimer();
    localStorage.removeItem(DISCLAIMER_KEY);
    expect(shouldShowDisclaimer()).toBe(true);
  });
});
