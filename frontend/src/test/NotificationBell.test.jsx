import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import NotificationBell from '../components/NotificationBell';
import { api } from '../api/client';
import { notificationLink } from '../utils/notifications';

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'buyer' } }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) => (k === 'notificationCenter.unreadCount' ? `${o.count} unread notifications` : k),
  }),
}));
vi.mock('../api/client', () => ({
  api: {
    getUnreadNotificationCount: vi.fn(),
    getNotifications: vi.fn(),
    markNotificationRead: vi.fn(() => Promise.resolve({})),
    markAllNotificationsRead: vi.fn(() => Promise.resolve({})),
  },
}));

describe('NotificationBell (FE-12)', () => {
  beforeEach(() => {
    api.getUnreadNotificationCount.mockResolvedValue({ count: 3 });
    api.getNotifications.mockResolvedValue({
      data: [
        { id: 1, title: 'Order shipped', order_id: 9 },
        { id: 2, title: 'Outbid', product_id: 4, read_at: '2026-01-01' },
      ],
    });
  });

  it('announces the unread count and lists the latest notifications', async () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><NotificationBell /></MemoryRouter></QueryClientProvider>);
    const bell = await screen.findByRole('button', { name: '3 unread notifications' });
    fireEvent.click(bell);
    expect(api.getNotifications).toHaveBeenCalledWith({ limit: 10 });
    expect(await screen.findByText('Order shipped')).toBeInTheDocument();
    expect(screen.getByText('notificationCenter.viewAll').getAttribute('href')).toBe('/notifications');
  });

  it('marks all read', async () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><NotificationBell /></MemoryRouter></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: '3 unread notifications' }));
    fireEvent.click(await screen.findByText('notificationCenter.markAllRead'));
    expect(api.markAllNotificationsRead).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: '0 unread notifications' })).toBeInTheDocument());
  });

  it('links notifications to their target', () => {
    expect(notificationLink({ order_id: 5 })).toBe('/orders?order=5');
    expect(notificationLink({ product_id: 7 })).toBe('/product/7');
    expect(notificationLink({ dispute_id: 3 })).toBe('/orders?dispute=3');
  });
});
