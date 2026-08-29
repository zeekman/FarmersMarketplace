import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { getErrorMessage } from '../utils/errorMessages';

export function useReviewForm(productId, { onSuccess }) {
  const { t } = useTranslation();
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewOrderId, setReviewOrderId] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [reviewSuccess, setReviewSuccess] = useState('');
  const [ordersLoadError, setOrdersLoadError] = useState(false);

  const loadPaidOrders = useCallback(async () => {
    setOrdersLoadError(false);
    try {
      const res = await api.getOrders({ limit: 100 });
      const orders = (res.data ?? []).filter(
        (o) => o.product_id === parseInt(productId) && o.status === 'paid'
      );
      if (orders.length > 0) setReviewOrderId(String(orders[0].id));
    } catch {
      setOrdersLoadError(true);
    }
  }, [productId]);

  const handleReviewSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setReviewError('');
      setReviewSuccess('');
      if (ordersLoadError) return setReviewError(t('productDetail.ordersLoadError'));
      if (!reviewOrderId) return setReviewError(t('productDetail.noEligibleOrder'));
      setReviewLoading(true);
      try {
        await api.submitReview({
          order_id: parseInt(reviewOrderId),
          rating: reviewRating,
          comment: reviewComment.trim() || undefined,
        });
        setReviewSuccess(t('productDetail.reviewSubmitted'));
        setReviewComment('');
        setReviewRating(5);
        onSuccess?.();
      } catch (e) {
        setReviewError(getErrorMessage(e));
      } finally {
        setReviewLoading(false);
      }
    },
    [reviewOrderId, reviewRating, reviewComment, onSuccess, t, ordersLoadError]
  );

  return {
    reviewRating,
    setReviewRating,
    reviewComment,
    setReviewComment,
    reviewOrderId,
    setReviewOrderId,
    reviewLoading,
    reviewError,
    reviewSuccess,
    ordersLoadError,
    loadPaidOrders,
    handleReviewSubmit,
  };
}
