import React from 'react';
import { useTranslation } from 'react-i18next';
import { useModalA11y } from '../../hooks/useModalA11y';
import QRCode from 'qrcode.react';

const CopyButton = ({ url }) => {
  const [copied, setCopied] = React.useState(false);
  
  function handleCopy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  
  return (
    <button
      style={{
        background: '#2d6a4f',
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        padding: '9px 20px',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: 14,
        width: '100%',
      }}
      onClick={handleCopy}
    >
      {copied ? 'Copied!' : 'Copy link'}
    </button>
  );
};

/**
 * SEP-7 payment link modal with QR code and copy button.
 * Uses useModalA11y for focus trap and keyboard handling.
 */
export default function PaymentLinkModal({ paymentLinkData, onClose }) {
  const { t } = useTranslation();
  const dialogRef = useModalA11y(!!paymentLinkData, onClose);

  if (!paymentLinkData) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-link-title"
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 24,
          maxWidth: 400,
          width: '100%',
          boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
        }}
      >
        <h2
          id="payment-link-title"
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: '#2d6a4f',
            marginBottom: 16,
          }}
        >
          {t('productDetail.paymentLink', 'Payment Link')}
        </h2>
        
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <QRCode value={paymentLinkData.paymentLink} size={200} />
        </div>
        
        <div
          style={{
            background: '#f8f8f8',
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 12,
            wordBreak: 'break-all',
            fontFamily: 'monospace',
          }}
        >
          {paymentLinkData.paymentLink}
        </div>
        
        <CopyButton url={paymentLinkData.paymentLink} />
        
        <button
          onClick={onClose}
          style={{
            width: '100%',
            marginTop: 12,
            padding: '9px 20px',
            borderRadius: 8,
            border: '1px solid #ddd',
            background: '#fff',
            color: '#333',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {t('common.close', 'Close')}
        </button>
      </div>
    </div>
  );
}
