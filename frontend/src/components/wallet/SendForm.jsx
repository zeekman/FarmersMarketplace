import React from 'react';
import { useTranslation } from 'react-i18next';
import { s, msgTone } from './walletStyles';

/** Withdraw XLM to a Stellar public key or federation address. */
export default function SendForm({ send, availableBalance, explorerUrl }) {
  const { t, i18n } = useTranslation();
  const { sendForm, setSendForm, sending, sendMsg, sendExceedsBalance, handleSend } = send;

  return (
    <div style={s.card}>
      <h3 style={{ marginBottom: 4, color: 'var(--color-text)' }}>{t('wallet.send.title')}</h3>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 8 }}>{t('wallet.send.description')}</p>
      <form onSubmit={handleSend} noValidate>
        <label style={s.label}>{t('wallet.send.destinationLabel')}</label>
        <input
          style={s.input} type="text" placeholder={t('wallet.send.destinationPlaceholder')} spellCheck={false}
          value={sendForm.destination}
          onChange={e => setSendForm(f => ({ ...f, destination: e.target.value }))}
        />
        <label style={s.label}>{t('wallet.send.amountLabel')}</label>
        <input
          style={{ ...s.input, borderColor: sendExceedsBalance ? 'var(--color-danger)' : undefined }}
          type="number" min="0.0000001" step="any" placeholder="0.00"
          value={sendForm.amount}
          onChange={e => setSendForm(f => ({ ...f, amount: e.target.value }))}
          aria-describedby={sendExceedsBalance ? 'send-balance-warning' : undefined}
        />
        {sendExceedsBalance && (
          <div id="send-balance-warning" role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 4 }}>
            {t('wallet.send.insufficientBalance', { available: availableBalance.toFixed(2) })}
          </div>
        )}
        <label style={s.label}>{t('wallet.send.memoLabel')} <span style={{ color: 'var(--color-text-faint)', fontWeight: 400 }}>{t('wallet.send.memoOptional')}</span></label>
        <input
          style={s.input} type="text" maxLength={28} placeholder={t('wallet.send.memoPh')}
          value={sendForm.memo}
          onChange={e => setSendForm(f => ({ ...f, memo: e.target.value }))}
        />
        <button type="submit" style={{ ...s.btn, opacity: sendExceedsBalance ? 0.5 : 1 }} disabled={sending || sendExceedsBalance}>
          {sending ? t('wallet.sending') : t('wallet.send.withdrawBtn')}
        </button>
      </form>
      {sendMsg && (
        <div style={{ ...s.msg, ...msgTone(sendMsg.type) }}>
          {sendMsg.text}
          {sendMsg.txHash && (
            <div style={{ marginTop: 6, fontSize: 12 }}>
              {t('wallet.send.tx')} <a href={explorerUrl('tx', sendMsg.txHash)} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)', wordBreak: 'break-all' }}>{sendMsg.txHash}</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
