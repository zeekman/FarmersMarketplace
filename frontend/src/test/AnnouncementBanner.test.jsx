import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../api/client', () => ({
  api: {
    getAnnouncements: vi.fn(),
  },
}));

import { api } from '../api/client';
import AnnouncementBanner from '../components/AnnouncementBanner';

describe('AnnouncementBanner XSS safety (#431)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('renders plain text without executing script tags', async () => {
    const xssPayload = 'Hello <script>window.__xss = true</script> World';
    api.getAnnouncements.mockResolvedValue({
      data: [{ id: 1, type: 'info', message: xssPayload }],
    });

    render(<AnnouncementBanner />);
    // Wait for async fetch
    await screen.findByRole('region');

    // Script must not have executed
    expect(window.__xss).toBeUndefined();
    // Raw script tag must not be injected into the DOM as HTML
    expect(document.querySelector('script[data-xss]')).toBeNull();
  });

  it('renders bold markdown safely', async () => {
    api.getAnnouncements.mockResolvedValue({
      data: [{ id: 2, type: 'info', message: 'Check **this** out' }],
    });

    render(<AnnouncementBanner />);
    const strong = await screen.findByText('this');
    expect(strong.tagName).toBe('STRONG');
  });
});

describe('AnnouncementBanner session persistence (#780)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('stores dismissed announcement ID in sessionStorage as JSON array', async () => {
    api.getAnnouncements.mockResolvedValue({
      data: [{ id: 10, type: 'info', message: 'Hello' }],
    });

    render(<AnnouncementBanner />);
    const dismissBtn = await screen.findByRole('button', { name: /dismiss/i });
    fireEvent.click(dismissBtn);

    const stored = JSON.parse(sessionStorage.getItem('dismissed_announcements') || '[]');
    expect(stored).toContain(10);
  });

  it('filters out already-dismissed announcements on mount', async () => {
    sessionStorage.setItem('dismissed_announcements', JSON.stringify([20]));
    api.getAnnouncements.mockResolvedValue({
      data: [
        { id: 20, type: 'info', message: 'Already dismissed' },
        { id: 21, type: 'info', message: 'Show me' },
      ],
    });

    render(<AnnouncementBanner />);
    await screen.findByText('Show me');
    expect(screen.queryByText('Already dismissed')).toBeNull();
  });

  it('dismisses individual announcements independently', async () => {
    api.getAnnouncements.mockResolvedValue({
      data: [
        { id: 30, type: 'info', message: 'First announcement' },
        { id: 31, type: 'warning', message: 'Second announcement' },
      ],
    });

    render(<AnnouncementBanner />);
    await screen.findByText('First announcement');
    await screen.findByText('Second announcement');

    // Dismiss only the first one
    const dismissBtns = screen.getAllByRole('button', { name: /dismiss/i });
    fireEvent.click(dismissBtns[0]);

    // Second should still be visible
    expect(screen.queryByText('First announcement')).toBeNull();
    expect(screen.getByText('Second announcement')).toBeTruthy();

    // Only first ID should be in sessionStorage
    const stored = JSON.parse(sessionStorage.getItem('dismissed_announcements') || '[]');
    expect(stored).toContain(30);
    expect(stored).not.toContain(31);
  });

  it('does not re-show dismissed banners after re-render within same session', async () => {
    api.getAnnouncements.mockResolvedValue({
      data: [{ id: 40, type: 'info', message: 'Dismissible' }],
    });

    const { unmount } = render(<AnnouncementBanner />);
    const dismissBtn = await screen.findByRole('button', { name: /dismiss/i });
    fireEvent.click(dismissBtn);
    // Verify it was removed from the DOM
    expect(screen.queryByText('Dismissible')).toBeNull();
    unmount();

    // Re-mount — sessionStorage still has the dismissed ID, component should filter it out
    render(<AnnouncementBanner />);
    // Wait for the fetch to complete — the banner should NOT appear
    await waitFor(() => {
      expect(screen.queryByText('Dismissible')).toBeNull();
    });
    // Verify the sessionStorage entry is still set
    const stored = JSON.parse(sessionStorage.getItem('dismissed_announcements') || '[]');
    expect(stored).toContain(40);
  });

  it('gracefully handles unavailable sessionStorage', async () => {
    // Simulate sessionStorage being unavailable
    const originalGetItem = Object.getOwnPropertyDescriptor(Storage.prototype, 'getItem');
    const originalSetItem = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });

    api.getAnnouncements.mockResolvedValue({
      data: [{ id: 50, type: 'info', message: 'Still shows' }],
    });

    render(<AnnouncementBanner />);
    const banner = await screen.findByText('Still shows');
    expect(banner).toBeTruthy();

    // Clicking dismiss should not throw
    const dismissBtn = screen.getByRole('button', { name: /dismiss/i });
    expect(() => fireEvent.click(dismissBtn)).not.toThrow();

    vi.restoreAllMocks();
  });
});
