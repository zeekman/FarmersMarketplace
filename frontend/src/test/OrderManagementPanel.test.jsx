import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import OrderManagementPanel from '../components/dashboard/OrderManagementPanel';

const sales = [
  { id: 1, product_name: 'Tomatoes', quantity: 2, total_price: '8', buyer_name: 'Buyer', status: 'paid', created_at: '2026-01-01' },
  { id: 2, product_name: 'Carrots', quantity: 1, total_price: '3', buyer_name: 'Buyer', status: 'shipped', created_at: '2026-01-02', return_status: 'pending', return_reason: 'Damaged' },
  { id: 3, product_name: 'Beans', quantity: 4, total_price: '12', buyer_name: 'Buyer', status: 'cancelled', created_at: '2026-01-03' },
];

describe('OrderManagementPanel', () => {
  it('renders mixed statuses with their status indicators', () => {
    render(<OrderManagementPanel sales={sales} />);
    expect(screen.getByText(/✅ paid/)).toBeInTheDocument();
    expect(screen.getByText(/📦 shipped/)).toBeInTheDocument();
    expect(screen.getByText(/❌ cancelled/)).toBeInTheDocument();
  });

  it('fires status updates with the selected value', () => {
    const onStatusUpdate = vi.fn();
    render(<OrderManagementPanel sales={sales} onStatusUpdate={onStatusUpdate} />);
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'delivered' } });
    expect(onStatusUpdate).toHaveBeenCalledWith(1, 'delivered');
  });

  it('fires each return action once and disables both controls immediately', () => {
    const onApproveReturn = vi.fn();
    const onRejectReturn = vi.fn();
    render(<OrderManagementPanel sales={sales} onApproveReturn={onApproveReturn} onRejectReturn={onRejectReturn} />);
    const approve = screen.getByRole('button', { name: /approve & refund/i });
    const reject = screen.getByRole('button', { name: /reject/i });
    fireEvent.click(approve);
    fireEvent.click(approve);
    fireEvent.click(reject);
    expect(onApproveReturn).toHaveBeenCalledTimes(1);
    expect(onRejectReturn).not.toHaveBeenCalled();
    expect(approve).toBeDisabled();
    expect(reject).toBeDisabled();
  });
});