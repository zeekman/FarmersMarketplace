import React from 'react';
import { useTranslation } from 'react-i18next';
import { s, msgTone } from './walletStyles';

/** Buyer monthly spending budget: edit the limit and see progress against it. */
export default function BudgetPanel({ budget, budgetInput, setBudgetInput, budgetMsg, onSave }) {
  const { t } = useTranslation();
  const percentUsed = Number(budget?.percentUsed || 0);

  return (
    <div style={s.card}>
      <h3 style={{ marginBottom: 12, color: 'var(--color-text)' }}>{t('wallet.budget.title')}</h3>
      <form onSubmit={onSave}>
        <label style={s.label}>{t('wallet.budget.limitLabel')}</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            style={{ ...s.input, marginBottom: 0 }}
            type="number"
            min="0"
            step="any"
            placeholder={t('wallet.budget.optional')}
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
          />
          <button type="submit" style={{ ...s.btn, marginTop: 0, whiteSpace: 'nowrap' }}>{t('wallet.budget.saveBtn')}</button>
        </div>
      </form>

      {budget?.budget != null && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
            {t('wallet.budget.spent', { spent: Number(budget.spentThisMonth || 0).toFixed(2), limit: Number(budget.budget).toFixed(2) })}
          </div>
          <div style={{ height: 12, background: 'var(--color-track)', borderRadius: 999, overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.min(100, percentUsed)}%`,
                height: '100%',
                background: percentUsed >= 80 ? 'var(--color-danger)' : 'var(--color-primary)',
                transition: 'width 200ms ease',
              }}
            />
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
            {t('wallet.budget.remaining', { amount: Number(budget.remaining || 0).toFixed(2) })}
          </div>
          {percentUsed >= 80 && (
            <div style={{ ...s.msg, background: 'var(--color-warning-bg)', color: 'var(--color-warning-text)', marginTop: 10 }}>
              {t('wallet.budget.warning', { percent: percentUsed.toFixed(0) })}
            </div>
          )}
        </div>
      )}

      {budgetMsg && (
        <div style={{ ...s.msg, ...msgTone(budgetMsg.type) }}>
          {budgetMsg.text}
        </div>
      )}
    </div>
  );
}
