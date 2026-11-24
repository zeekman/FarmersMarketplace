import { useState, useCallback } from 'react';
import { api } from '../api/client';
import { getStellarErrorMessage } from '../utils/stellarErrors';
import { getErrorMessage } from '../utils/errorMessages';
import { toast } from '../utils/toast';
import { useIdempotencyKey } from './useIdempotencyKey';

export function usePaymentLink() {
  const [paymentLinkData, setPaymentLinkData] = useState(null);
  const [paymentLinkLoading, setPaymentLinkLoading] = useState(false);
  const [paymentLinkError, setPaymentLinkError] = useState('');
  const { keyFor, settle } = useIdempotencyKey();

  const generatePaymentLink = useCallback(async ({ productId, quantity, addressId, couponCode }) => {
    setPaymentLinkLoading(true);
    setPaymentLinkError('');
    setPaymentLinkData(null);
    const orderBody = {
      product_id: productId,
      quantity,
      address_id: addressId || undefined,
      coupon_code: couponCode ? couponCode.trim() : undefined,
      payment_method: 'sep7',
    };
    const idempotencyKey = keyFor(orderBody);
    try {
      let createRes;
      try {
        createRes = await api.placeOrder(orderBody, idempotencyKey);
        settle();
      } catch (e) {
        settle(e);
        throw e;
      }
      const linkRes = await api.getOrderPaymentLink(createRes.orderId);
      setPaymentLinkData({
        orderId: createRes.orderId,
        ...linkRes,
      });
    } catch (e) {
      const msg = getStellarErrorMessage(e) || getErrorMessage(e);
      setPaymentLinkError(msg);
      toast.error(msg);
    } finally {
      setPaymentLinkLoading(false);
    }
  }, [keyFor, settle]);

  return {
    paymentLinkData,
    paymentLinkLoading,
    paymentLinkError,
    generatePaymentLink,
    setPaymentLinkData,
    setPaymentLinkError,
  };
}
