import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useIdempotencyKey } from './useIdempotencyKey';
import { useFreighter, signWithFreighter } from '../utils/freighter';
import { getStellarErrorMessage } from '../utils/stellarErrors';
import { getErrorMessage } from '../utils/errorMessages';
import { toast } from '../utils/toast';
import { useNetwork } from '../context/NetworkContext';

/**
 * Checkout state machine with validation, idempotency, and Freighter/custodial branching.
 * 
 * @param {Object} product - Product object
 * @returns {Object} Checkout state and handlers
 */
export function useCheckout(product) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { network } = useNetwork();
  const freighter = useFreighter(network);
  const buyAttempt = useIdempotencyKey();
  
  const [qty, setQty] = useState(product?.min_order_quantity || 1);
  const [weight, setWeight] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reviewBody, setReviewBody] = useState(null);
  const [result, setResult] = useState(null);
  const [selectedAddressId, setSelectedAddressId] = useState(null);
  const [useEscrow, setUseEscrow] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [couponResult, setCouponResult] = useState(null);
  const [sourceAsset, setSourceAsset] = useState(null);
  const [useRewards, setUseRewards] = useState(false);
  const [rewardTokens, setRewardTokens] = useState(0);
  
  const submittingRef = useRef(false);

  // Initialize custom price for PWYW/donation models
  useState(() => {
    if (product?.pricing_model === 'pwyw') {
      setCustomPrice(String(product.min_price));
    } else if (product?.pricing_model === 'donation') {
      setCustomPrice('1.00');
    }
    setQty(product?.min_order_quantity || 1);
  }, [product?.id]);

  /**
   * Validate quantity bounds based on product constraints.
   */
  const validateQuantity = useCallback((quantity) => {
    if (!product) return 'Product not loaded';
    
    const q = parseInt(quantity, 10);
    if (isNaN(q) || q < 1) return 'Quantity must be at least 1';
    
    if (product.min_order_quantity && q < product.min_order_quantity) {
      return `Minimum order quantity is ${product.min_order_quantity}`;
    }
    
    if (product.max_order_quantity && q > product.max_order_quantity) {
      return `Maximum order quantity is ${product.max_order_quantity}`;
    }
    
    if (product.quantity !== null && q > product.quantity) {
      return `Only ${product.quantity} available`;
    }
    
    return null;
  }, [product]);

  /**
   * Validate weight for weight-based pricing.
   */
  const validateWeight = useCallback((w) => {
    if (!product || product.pricing_type !== 'weight') return null;
    
    const weightVal = parseFloat(w);
    if (!w || isNaN(weightVal) || weightVal <= 0) {
      return 'Please enter a valid weight';
    }
    
    if (weightVal < product.min_weight) {
      return `Minimum weight is ${product.min_weight} ${product.unit}`;
    }
    
    if (weightVal > product.max_weight) {
      return `Maximum weight is ${product.max_weight} ${product.unit}`;
    }
    
    return null;
  }, [product]);

  /**
   * Validate custom price for PWYW/donation models.
   */
  const validateCustomPrice = useCallback((price) => {
    if (!product) return null;
    
    if (product.pricing_model === 'pwyw') {
      const p = parseFloat(price);
      if (!price || isNaN(p) || p < product.min_price) {
        return `Minimum price is ${product.min_price} XLM`;
      }
    }
    
    if (product.pricing_model === 'donation') {
      const p = parseFloat(price);
      if (!price || isNaN(p) || p <= 0) {
        return 'Donation amount must be positive';
      }
    }
    
    return null;
  }, [product]);

  /**
   * Initiate purchase - validates and opens review modal.
   */
  const handleBuy = useCallback((addresses, pathEstimate, pathEstimateError) => {
    if (!user) return navigate('/login');
    if (user.role === 'farmer') {
      setError('Farmers cannot purchase products');
      return;
    }
    
    if (addresses.length > 0 && !selectedAddressId) {
      setError('Please select a delivery address');
      return;
    }
    
    // Validate weight
    const weightErr = validateWeight(weight);
    if (weightErr) {
      setError(weightErr);
      return;
    }
    
    // Validate custom price
    const priceErr = validateCustomPrice(customPrice);
    if (priceErr) {
      setError(priceErr);
      return;
    }
    
    // Validate path payment
    if (sourceAsset && pathEstimateError) {
      setError(pathEstimateError);
      return;
    }
    
    if (sourceAsset && !pathEstimate) {
      setError('Waiting for path estimate...');
      return;
    }
    
    const orderBody = {
      product_id: product.id,
      quantity: qty,
      address_id: selectedAddressId || undefined,
      use_soroban_escrow: useEscrow,
      coupon_code: couponResult ? couponCode.trim() : undefined,
      source_asset: sourceAsset
        ? { code: sourceAsset.asset_code, issuer: sourceAsset.asset_issuer }
        : undefined,
      weight: product.pricing_type === 'weight' ? parseFloat(weight) : undefined,
      custom_price:
        product.pricing_model === 'pwyw' || product.pricing_model === 'donation'
          ? parseFloat(customPrice)
          : undefined,
      reward_tokens:
        useRewards && rewardTokens > 0 && !sourceAsset ? rewardTokens : undefined,
    };
    
    setError('');
    setReviewBody(orderBody);
  }, [
    user,
    navigate,
    product,
    qty,
    selectedAddressId,
    useEscrow,
    couponResult,
    couponCode,
    sourceAsset,
    weight,
    customPrice,
    useRewards,
    rewardTokens,
    validateWeight,
    validateCustomPrice,
  ]);

  /**
   * Confirm and submit the order. Handles Freighter vs custodial branching.
   * Reuses idempotency key on retry for the same order body.
   */
  const confirmBuy = useCallback(async () => {
    if (!reviewBody || submittingRef.current) return;
    submittingRef.current = true;
    
    // Freighter pays only plain XLM orders; escrow and path payments stay custodial
    const payWithFreighter = freighter.connected && !useEscrow && !sourceAsset;
    
    const orderBody = payWithFreighter
      ? { ...reviewBody, payment_method: 'sep7' }
      : reviewBody;
    
    // Idempotency key is derived from the order body - same body = same key
    const idempotencyKey = buyAttempt.keyFor(orderBody);
    
    setLoading(true);
    setError('');
    let settled = false;
    
    try {
      let res = await api.placeOrder(orderBody, idempotencyKey);
      buyAttempt.settle();
      settled = true;
      
      if (payWithFreighter) {
        // Non-custodial: backend builds unsigned XDR, Freighter signs it
        const prepared = await api.prepareOrderPayment(
          res.orderId,
          freighter.publicKey
        );
        const signed = await signWithFreighter(
          prepared.xdr,
          prepared.networkPassphrase
        );
        res = await api.submitOrderPayment(res.orderId, signed);
      }
      
      setReviewBody(null);
      setResult({ ...res, escrow: useEscrow });
    } catch (e) {
      if (!settled) buyAttempt.settle(e);
      const msg = getStellarErrorMessage(e) || getErrorMessage(e);
      setReviewBody(null);
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }, [
    reviewBody,
    useEscrow,
    sourceAsset,
    freighter,
    buyAttempt,
  ]);

  return {
    // State
    qty,
    weight,
    customPrice,
    loading,
    error,
    reviewBody,
    result,
    selectedAddressId,
    useEscrow,
    couponCode,
    couponResult,
    sourceAsset,
    useRewards,
    rewardTokens,
    
    // Setters
    setQty,
    setWeight,
    setCustomPrice,
    setError,
    setReviewBody,
    setSelectedAddressId,
    setUseEscrow,
    setCouponCode,
    setCouponResult,
    setSourceAsset,
    setUseRewards,
    setRewardTokens,
    
    // Handlers
    handleBuy,
    confirmBuy,
    
    // Validation
    validateQuantity,
    validateWeight,
    validateCustomPrice,
  };
}
