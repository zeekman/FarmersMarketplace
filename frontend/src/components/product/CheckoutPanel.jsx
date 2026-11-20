import React from 'react';
import { useTranslation } from 'react-i18next';
import { useXlmRate } from '../../utils/useXlmRate';

const s = {
  price: {
    fontSize: 24,
    fontWeight: 700,
    color: '#2d6a4f',
    marginBottom: 8,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  input: {
    width: 80,
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: 8,
    fontSize: 16,
    textAlign: 'center',
  },
  select: {
    width: '100%',
    padding: '9px 12px',
    border: '1px solid #ddd',
    borderRadius: 8,
    fontSize: 14,
    marginBottom: 12,
  },
  btn: {
    background: '#2d6a4f',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '12px 28px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 16,
    minHeight: 44,
  },
  btnSm: {
    background: '#2d6a4f',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '9px 20px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 14,
    minHeight: 44,
  },
  total: {
    background: '#f0faf4',
    borderRadius: 8,
    padding: '12px 16px',
    marginBottom: 20,
    fontSize: 15,
  },
  err: {
    color: '#c0392b',
    fontSize: 14,
    marginTop: 8,
  },
  label: {
    fontSize: 13,
    color: '#555',
    marginBottom: 6,
    display: 'block',
  },
};

/**
 * Checkout panel with quantity/weight controls, address selection, coupon input,
 * escrow toggle, and buy button.
 */
export default function CheckoutPanel({
  product,
  checkout,
  addresses,
  tiers,
  isOutOfDeliveryZone,
  couponLoading,
  couponError,
  onApplyCoupon,
  onBuy,
  currentStock,
  buyerAssets,
  pathEstimate,
  pathEstimateLoading,
  pathEstimateError,
}) {
  const { t } = useTranslation();
  const { usd } = useXlmRate();

  // Calculate pricing
  const getTierPrice = (quantity) => {
    if (!tiers || tiers.length === 0) return product.price;
    for (let i = tiers.length - 1; i >= 0; i--) {
      if (quantity >= tiers[i].min_quantity) {
        return tiers[i].price_per_unit;
      }
    }
    return product.price;
  };

  const isFlashSaleActive = Boolean(
    product.flash_sale_price &&
      product.flash_sale_ends_at &&
      new Date(product.flash_sale_ends_at).getTime() > Date.now()
  );

  const baseUnitPrice = getTierPrice(checkout.qty);
  const unitPrice = isFlashSaleActive
    ? Number(product.flash_sale_price)
    : baseUnitPrice;

  const effectiveUnitPrice =
    product.pricing_model === 'pwyw' || product.pricing_model === 'donation'
      ? parseFloat(checkout.customPrice) || 0
      : unitPrice;

  const subtotal =
    product.pricing_type === 'weight'
      ? (product.price * (parseFloat(checkout.weight) || 0)).toFixed(2)
      : (effectiveUnitPrice * checkout.qty).toFixed(2);

  const total = checkout.couponResult
    ? checkout.couponResult.final_total.toFixed(2)
    : subtotal;

  const outOfStock = currentStock !== null && currentStock <= 0;

  return (
    <>
      {/* Price display */}
      <div style={s.price}>
        {isFlashSaleActive && (
          <>
            <span style={{ textDecoration: 'line-through', color: '#999', fontSize: 18 }}>
              {product.price.toFixed(2)} XLM
            </span>{' '}
          </>
        )}
        {unitPrice.toFixed(2)} XLM
        {usd > 0 && (
          <span style={{ fontSize: 14, fontWeight: 400, color: '#888', marginInlineStart: 8 }}>
            (≈${(unitPrice * usd).toFixed(2)} USD)
          </span>
        )}
      </div>

      {/* Quantity/Weight input */}
      {product.pricing_type === 'weight' ? (
        <div style={s.row}>
          <label htmlFor="weight-input" style={s.label}>
            {t('productDetail.weight')} ({product.unit})
          </label>
          <input
            id="weight-input"
            type="number"
            step="0.1"
            min={product.min_weight}
            max={product.max_weight}
            style={s.input}
            value={checkout.weight}
            onChange={(e) => checkout.setWeight(e.target.value)}
          />
        </div>
      ) : (
        <div style={s.row}>
          <label htmlFor="qty-input" style={s.label}>
            {t('productDetail.quantity')}
          </label>
          <input
            id="qty-input"
            type="number"
            min={product.min_order_quantity || 1}
            max={Math.min(product.max_order_quantity || 999, currentStock || 999)}
            style={s.input}
            value={checkout.qty}
            onChange={(e) => checkout.setQty(parseInt(e.target.value, 10))}
          />
        </div>
      )}

      {/* Custom price for PWYW/donation */}
      {(product.pricing_model === 'pwyw' || product.pricing_model === 'donation') && (
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="custom-price" style={s.label}>
            {product.pricing_model === 'pwyw'
              ? t('productDetail.yourPrice')
              : t('productDetail.donationAmount')}
          </label>
          <input
            id="custom-price"
            type="number"
            step="0.01"
            min={product.pricing_model === 'pwyw' ? product.min_price : 0.01}
            style={{ ...s.input, width: '120px' }}
            value={checkout.customPrice}
            onChange={(e) => checkout.setCustomPrice(e.target.value)}
          />
        </div>
      )}

      {/* Address selection */}
      {addresses.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="address-select" style={s.label}>
            {t('productDetail.deliveryAddress')}
          </label>
          <select
            id="address-select"
            style={s.select}
            value={checkout.selectedAddressId || ''}
            onChange={(e) => checkout.setSelectedAddressId(parseInt(e.target.value, 10))}
          >
            <option value="">{t('productDetail.selectAddress')}</option>
            {addresses.map((addr) => (
              <option key={addr.id} value={addr.id}>
                {addr.label || addr.street_address}
                {addr.is_default ? ' (default)' : ''}
              </option>
            ))}
          </select>
          {isOutOfDeliveryZone && (
            <div style={{ ...s.err, marginTop: 4 }}>
              {t('productDetail.outOfDeliveryZone')}
            </div>
          )}
        </div>
      )}

      {/* Source asset selector for path payments */}
      {buyerAssets && buyerAssets.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="source-asset" style={s.label}>
            {t('productDetail.payWith')}
          </label>
          <select
            id="source-asset"
            style={s.select}
            value={checkout.sourceAsset?.asset_code || 'XLM'}
            onChange={(e) => {
              const code = e.target.value;
              if (code === 'XLM') {
                checkout.setSourceAsset(null);
              } else {
                const asset = buyerAssets.find((a) => a.asset_code === code);
                checkout.setSourceAsset(asset);
              }
            }}
          >
            <option value="XLM">XLM</option>
            {buyerAssets.map((asset) => (
              <option key={`${asset.asset_code}-${asset.asset_issuer}`} value={asset.asset_code}>
                {asset.asset_code} ({Number(asset.balance).toFixed(2)})
              </option>
            ))}
          </select>
          {pathEstimateLoading && (
            <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
              {t('productDetail.calculatingPath')}
            </div>
          )}
          {pathEstimate && (
            <div style={{ fontSize: 13, color: '#2d6a4f', marginTop: 4 }}>
              ≈ {pathEstimate.sourceAmount} {pathEstimate.sourceCode}
            </div>
          )}
          {pathEstimateError && (
            <div style={{ ...s.err, marginTop: 4 }}>{pathEstimateError}</div>
          )}
        </div>
      )}

      {/* Coupon input */}
      <div style={{ marginBottom: 12 }}>
        <label htmlFor="coupon-code" style={s.label}>
          {t('productDetail.couponCode')}
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id="coupon-code"
            type="text"
            style={{ ...s.input, flex: 1, width: 'auto' }}
            value={checkout.couponCode}
            onChange={(e) => checkout.setCouponCode(e.target.value)}
            placeholder={t('productDetail.enterCoupon')}
          />
          <button
            type="button"
            onClick={onApplyCoupon}
            disabled={couponLoading || !checkout.couponCode.trim()}
            style={{
              ...s.btnSm,
              background: couponLoading ? '#ccc' : '#2d6a4f',
              cursor: couponLoading ? 'not-allowed' : 'pointer',
            }}
          >
            {couponLoading ? t('common.loading') : t('productDetail.apply')}
          </button>
        </div>
        {couponError && <div style={s.err}>{couponError}</div>}
        {checkout.couponResult && (
          <div style={{ fontSize: 13, color: '#2d6a4f', marginTop: 4 }}>
            ✓ {t('productDetail.couponApplied')} (−
            {checkout.couponResult.discount.toFixed(2)} XLM)
          </div>
        )}
      </div>

      {/* Escrow toggle */}
      {product.allows_escrow && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={checkout.useEscrow}
              onChange={(e) => checkout.setUseEscrow(e.target.checked)}
            />
            <span style={s.label}>{t('productDetail.useEscrow')}</span>
          </label>
        </div>
      )}

      {/* Total */}
      <div style={s.total}>
        <strong>{t('productDetail.total')}:</strong> {total} XLM
        {usd > 0 && (
          <span style={{ color: '#888', marginInlineStart: 8 }}>
            (≈${(parseFloat(total) * usd).toFixed(2)} USD)
          </span>
        )}
      </div>

      {/* Buy button */}
      <button
        type="button"
        onClick={onBuy}
        disabled={checkout.loading || outOfStock || isOutOfDeliveryZone}
        style={{
          ...s.btn,
          background:
            checkout.loading || outOfStock || isOutOfDeliveryZone ? '#ccc' : '#2d6a4f',
          cursor:
            checkout.loading || outOfStock || isOutOfDeliveryZone
              ? 'not-allowed'
              : 'pointer',
        }}
      >
        {checkout.loading
          ? t('productDetail.processing')
          : outOfStock
            ? t('productDetail.outOfStock')
            : t('productDetail.buyNow')}
      </button>

      {checkout.error && <div style={s.err}>{checkout.error}</div>}
    </>
  );
}
