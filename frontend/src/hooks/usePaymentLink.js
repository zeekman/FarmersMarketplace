import { useState, useCallback } from 'react';
import { api } from '../api/client';
import { getStellarErrorMessage } from '../utils/stellarErrors';
import { getErrorMessage } from '../utils/errorMessages';

export function usePaymentLink() {
  const [paymentLinkData, setPaymentLinkData] = useState(null);
  const [paymentLinkLoading, setPaymentLinkLoading] = useState(false);
  const [paymentLinkError, setPaymentLinkError] = useState('');

  const generatePaymentLink = useCallback(async ({ productId, quantity, addressId, couponCode }) => {
    setPaymentLinkLoading(true);
    setPaymentLinkError('');
    setPaymentLinkData(null);
    try {
      const createRes = await api.placeOrder({
        product_id: productId,
        quantity,
        address_id: addressId || undefined,
        coupon_code: couponCode ? couponCode.trim() : undefined,
        payment_method: 'sep7',
      });
      const linkRes = await api.getOrderPaymentLink(createRes.orderId);
      setPaymentLinkData({
        orderId: createRes.orderId,
        ...linkRes,
      });
    } catch (e) {
      setPaymentLinkError(getStellarErrorMessage(e) || getErrorMessage(e));
    } finally {
      setPaymentLinkLoading(false);
    }
  }, []);

  return {
    paymentLinkData,
    paymentLinkLoading,
    paymentLinkError,
    generatePaymentLink,
    setPaymentLinkData,
    setPaymentLinkError,
  };
}

  }, [productId, navigate]);

  return {
    paymentLinkData,
    paymentLinkLoading,
    paymentLinkError,
    generatePaymentLink,
    setPaymentLinkData,
    setPaymentLinkError,
  };
}
