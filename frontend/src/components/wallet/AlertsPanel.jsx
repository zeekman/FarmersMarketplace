import React from 'react';
import { useTranslation } from 'react-i18next';
import { s } from './walletStyles';

/** Activity alerts with unread count and mark-as-read. */
export default function AlertsPanel({ alerts, unreadCount, onMarkRead }) {
  const { t, i18n } = useTranslation();

  return (
    <div style={s.card}>
      <h3 style={{ marginBottom: 16, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
        🔔 {t('wallet.alerts.title')}
        {unreadCount > 0 && (
          <span style={{ background: 'var(--color-danger)', color: 'var(--color-on-primary)', borderRadius: 12, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>
            {unreadCount}
          </span>
        )}
      </h3>
      {alerts.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>{t('wallet.alerts.noAlerts')}</p>
      ) : (
        alerts.map((alert) => (
          <div key={alert.id} style={{ borderBottom: '1px solid var(--color-border)', padding: '10px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', opacity: alert.read_at ? 0.6 : 1 }}>
            <div>
              <div style={{ fontSize: 14, color: alert.type === 'large_payment' ? 'var(--color-danger)' : 'var(--color-warning-text)', fontWeight: alert.read_at ? 400 : 600 }}>
                {alert.type === 'large_payment' ? `⚠️ ${t('wallet.alerts.largePayment')}` : `❌ ${t('wallet.alerts.failedTransactions')}`}
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 2 }}>{alert.message}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 2 }}>
                {new Date(alert.created_at).toLocaleDateString(i18n.language, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            {!alert.read_at && (
              <button
                style={{ background: 'none', border: '1px solid var(--color-border-input)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, color: 'var(--color-text-secondary)', flexShrink: 0, marginLeft: 8 }}
                onClick={() => onMarkRead(alert.id)}
              >
                {t('wallet.alerts.markRead')}
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}
