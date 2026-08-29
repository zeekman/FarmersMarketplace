import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import UpdatePrompt from '../components/UpdatePrompt';

function dispatchSwUpdated() {
  const event = new MessageEvent('message', { data: { type: 'SW_UPDATED' } });
  act(() => {
    navigator.serviceWorker.dispatchEvent(event);
  });
}

describe('UpdatePrompt (#1185)', () => {
  let swListeners;

  beforeEach(() => {
    swListeners = [];
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        addEventListener: vi.fn((_, fn) => swListeners.push(fn)),
        removeEventListener: vi.fn(),
        controller: { postMessage: vi.fn() },
        dispatchEvent: (e) => swListeners.forEach(fn => fn(e)),
      },
      configurable: true,
    });
    vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('is hidden on initial render', () => {
    render(<UpdatePrompt />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('appears when service worker sends SW_UPDATED message', () => {
    render(<UpdatePrompt />);
    dispatchSwUpdated();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('clicking Refresh posts SKIP_WAITING and reloads', () => {
    render(<UpdatePrompt />);
    dispatchSwUpdated();

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(navigator.serviceWorker.controller.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(window.location.reload).toHaveBeenCalled();
  });

  it('clicking Dismiss hides the banner', () => {
    render(<UpdatePrompt />);
    dispatchSwUpdated();

    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not show for unrelated SW messages', () => {
    render(<UpdatePrompt />);
    act(() => {
      const e = new MessageEvent('message', { data: { type: 'OTHER_EVENT' } });
      navigator.serviceWorker.dispatchEvent(e);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
