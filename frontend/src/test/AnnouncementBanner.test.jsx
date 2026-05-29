import React from 'react';
import { render, screen } from '@testing-library/react';
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
    localStorage.clear();
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
