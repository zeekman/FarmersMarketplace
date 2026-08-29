import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminAnalyticsSummary from '../components/admin/AdminAnalyticsSummary';
import AdminAnnouncementsPanel from '../components/admin/AdminAnnouncementsPanel';
import AdminDisputesPanel from '../components/admin/AdminDisputesPanel';
import AdminOrdersPanel from '../components/admin/AdminOrdersPanel';
import AdminUsersPanel from '../components/admin/AdminUsersPanel';
import { api } from '../api/client';

vi.mock('../api/client', () => ({ api: {
  adminGetAnnouncements: vi.fn(), adminDeleteAnnouncement: vi.fn(),
  adminUpdateAnnouncement: vi.fn(), adminCreateAnnouncement: vi.fn(),
} }));

describe('admin panels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.adminGetAnnouncements.mockResolvedValue({
      data: [{ id: 7, message: 'Harvest update', type: 'info', active: 1 }],
    });
  });

  it('renders analytics values', () => {
    render(<AdminAnalyticsSummary stats={{ users: 9, products: 4, orders: 2, total_revenue_xlm: 12 }} />);
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('12.00')).toBeInTheDocument();
  });

  it('deletes an announcement only after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<AdminAnnouncementsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(api.adminDeleteAnnouncement).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.adminDeleteAnnouncement).toHaveBeenCalledWith(7));
  });

  it('resolves the selected dispute', () => {
    const onResolve = vi.fn();
    const dispute = { id: 3, buyer_name: 'A', product_name: 'Corn', quantity: 1,
      total_price: 2, status: 'open', reason: 'Late' };
    render(<AdminDisputesPanel disputes={[dispute]} onResolve={onResolve} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(onResolve).toHaveBeenCalledWith(dispute);
  });

  it('pages orders forward', () => {
    const onPageChange = vi.fn();
    render(<AdminOrdersPanel orderPagination={{ page: 1, pages: 2, total: 0 }} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('filters roles and bans the correct user', () => {
    const onRoleChange = vi.fn();
    const onBan = vi.fn();
    const user = { id: 8, name: 'Nia', email: 'n@x.test', role: 'buyer',
      active: 1, created_at: '2026-01-01' };
    render(<AdminUsersPanel users={[user]} onRoleChange={onRoleChange} onBan={onBan} />);
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'buyer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ban' }));
    expect(onRoleChange).toHaveBeenCalledWith('buyer');
    expect(onBan).toHaveBeenCalledWith(8, 'Nia');
  });
});
