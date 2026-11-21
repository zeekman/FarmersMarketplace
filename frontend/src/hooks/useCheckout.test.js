import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCheckout } from './useCheckout';
import { api } from '../api/client';
import * as freighterUtils from '../utils/freighter';
import { getStellarErrorMessage } from '../utils/stellarErrors';

// Mock dependencies
vi.mock('../api/client');
vi.mock('../utils/freighter');
vi.mock('../utils/stellarErrors');
vi.mock('../utils/toast');
vi.mock('../utils/errorMessages', () => ({
  getErrorMessage: (err) => err?.message || 'Unknown error',
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'buyer' } }),
}));
vi.mock('../context/NetworkContext', () => ({
  useNetwork: () => ({ network: 'testnet' }),
}));

describe('useCheckout', () => {
  const mockProduct = {
    id: 1,
    name: 'Test Product',
    price: 10,
    quantity: 50,
    min_order_quantity: 1,
    max_order_quantity: 20,
    pricing_type: 'unit',
    pricing_model: 'standard',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    freighterUtils.useFreighter = vi.fn(() => ({
      connected: false,
      publicKey: null,
    }));
    getStellarErrorMessage.mockReturnValue(null);
  });

  describe('validateQuantity', () => {
    it('rejects quantity below minimum', () => {
      const { result } = renderHook(() => useCheckout(mockProduct));
      const error = result.current.validateQuantity(0);
      expect(error).toBe('Quantity must be at least 1');
    });

    it('rejects quantity above maximum', () => {
      const { result } = renderHook(() => useCheckout(mockProduct));
      const error = result.current.validateQuantity(25);
      expect(error).toBe('Maximum order quantity is 20');
    });

    it('rejects quantity exceeding stock', () => {
      const { result } = renderHook(() => useCheckout(mockProduct));
      const error = result.current.validateQuantity(100);
      expect(error).toBe('Only 50 available');
    });

    it('accepts valid quantity', () => {
      const { result } = renderHook(() => useCheckout(mockProduct));
      const error = result.current.validateQuantity(10);
      expect(error).toBeNull();
    });
  });

  describe('validateWeight', () => {
    const weightProduct = {
      ...mockProduct,
      pricing_type: 'weight',
      min_weight: 0.5,
      max_weight: 10,
      unit: 'kg',
    };

    it('rejects invalid weight', () => {
      const { result } = renderHook(() => useCheckout(weightProduct));
      const error = result.current.validateWeight('');
      expect(error).toBe('Please enter a valid weight');
    });

    it('rejects weight below minimum', () => {
      const { result } = renderHook(() => useCheckout(weightProduct));
      const error = result.current.validateWeight('0.2');
      expect(error).toBe('Minimum weight is 0.5 kg');
    });

    it('rejects weight above maximum', () => {
      const { result } = renderHook(() => useCheckout(weightProduct));
      const error = result.current.validateWeight('15');
      expect(error).toBe('Maximum weight is 10 kg');
    });

    it('accepts valid weight', () => {
      const { result } = renderHook(() => useCheckout(weightProduct));
      const error = result.current.validateWeight('5');
      expect(error).toBeNull();
    });
  });

  describe('validateCustomPrice', () => {
    const pwyProduct = {
      ...mockProduct,
      pricing_model: 'pwyw',
      min_price: 5,
    };

    it('rejects price below minimum for PWYW', () => {
      const { result } = renderHook(() => useCheckout(pwyProduct));
      const error = result.current.validateCustomPrice('2');
      expect(error).toBe('Minimum price is 5 XLM');
    });

    it('accepts valid price for PWYW', () => {
      const { result } = renderHook(() => useCheckout(pwyProduct));
      const error = result.current.validateCustomPrice('10');
      expect(error).toBeNull();
    });

    const donationProduct = {
      ...mockProduct,
      pricing_model: 'donation',
    };

    it('rejects zero donation', () => {
      const { result } = renderHook(() => useCheckout(donationProduct));
      const error = result.current.validateCustomPrice('0');
      expect(error).toBe('Donation amount must be positive');
    });
  });

  describe('idempotency key reuse', () => {
    it('generates same key for identical order body', async () => {
      api.placeOrder = vi.fn().mockRejectedValue(new Error('Network error'));
      
      const { result } = renderHook(() => useCheckout(mockProduct));
      
      act(() => {
        result.current.setSelectedAddressId(1);
      });

      // First attempt
      await act(async () => {
        result.current.handleBuy([], null, null);
      });
      
      const firstKey = result.current.reviewBody;
      
      // Retry with same params should reuse key
      await act(async () => {
        result.current.handleBuy([], null, null);
      });
      
      const secondKey = result.current.reviewBody;
      
      // Bodies should be identical
      expect(firstKey).toEqual(secondKey);
    });
  });

  describe('Freighter vs custodial branching', () => {
    it('uses custodial payment when Freighter not connected', async () => {
      api.placeOrder = vi.fn().mockResolvedValue({
        orderId: 123,
        totalPrice: 10,
        txHash: 'abc123',
      });

      const { result } = renderHook(() => useCheckout(mockProduct));
      
      await act(async () => {
        result.current.handleBuy([], null, null);
      });
      
      await act(async () => {
        await result.current.confirmBuy();
      });

      expect(api.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({ product_id: 1, quantity: 1 }),
        expect.any(String)
      );
      expect(api.placeOrder).toHaveBeenCalledTimes(1);
    });

    it('uses Freighter when connected and no escrow', async () => {
      freighterUtils.useFreighter = vi.fn(() => ({
        connected: true,
        publicKey: 'GABC123',
      }));
      freighterUtils.signWithFreighter = vi.fn().mockResolvedValue('signedXDR');
      
      api.placeOrder = vi.fn().mockResolvedValue({ orderId: 123 });
      api.prepareOrderPayment = vi.fn().mockResolvedValue({
        xdr: 'unsignedXDR',
        networkPassphrase: 'Test SDF Network ; September 2015',
      });
      api.submitOrderPayment = vi.fn().mockResolvedValue({
        orderId: 123,
        totalPrice: 10,
        txHash: 'xyz789',
      });

      const { result } = renderHook(() => useCheckout(mockProduct));
      
      await act(async () => {
        result.current.handleBuy([], null, null);
      });
      
      await act(async () => {
        await result.current.confirmBuy();
      });

      expect(api.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({ payment_method: 'sep7' }),
        expect.any(String)
      );
      expect(api.prepareOrderPayment).toHaveBeenCalledWith(123, 'GABC123');
      expect(freighterUtils.signWithFreighter).toHaveBeenCalled();
      expect(api.submitOrderPayment).toHaveBeenCalledWith(123, 'signedXDR');
    });

    it('uses custodial payment when escrow is enabled', async () => {
      freighterUtils.useFreighter = vi.fn(() => ({
        connected: true,
        publicKey: 'GABC123',
      }));
      
      api.placeOrder = vi.fn().mockResolvedValue({
        orderId: 123,
        totalPrice: 10,
      });

      const { result } = renderHook(() => useCheckout(mockProduct));
      
      act(() => {
        result.current.setUseEscrow(true);
      });
      
      await act(async () => {
        result.current.handleBuy([], null, null);
      });
      
      await act(async () => {
        await result.current.confirmBuy();
      });

      // Should not call prepareOrderPayment when escrow is enabled
      expect(api.prepareOrderPayment).toBeUndefined();
      expect(api.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({ use_soroban_escrow: true }),
        expect.any(String)
      );
    });
  });

  describe('error mapping via stellarErrors.js', () => {
    it('maps Stellar errors to user-friendly messages', async () => {
      const stellarError = { code: 'tx_insufficient_fee', message: 'Fee too low' };
      getStellarErrorMessage.mockReturnValue(
        'The transaction fee is insufficient. Please increase the fee and retry.'
      );
      
      api.placeOrder = vi.fn().mockRejectedValue(stellarError);

      const { result } = renderHook(() => useCheckout(mockProduct));
      
      await act(async () => {
        result.current.handleBuy([], null, null);
      });
      
      await act(async () => {
        await result.current.confirmBuy();
      });

      await waitFor(() => {
        expect(result.current.error).toBe(
          'The transaction fee is insufficient. Please increase the fee and retry.'
        );
      });
      expect(getStellarErrorMessage).toHaveBeenCalledWith(stellarError);
    });
  });
});
