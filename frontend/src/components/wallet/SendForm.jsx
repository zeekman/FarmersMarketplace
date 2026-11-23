import React from 'react';
import { s, msgTone } from './walletStyles';
import Modal from '../Modal';
import { MEMO_TYPES, memoByteLength, SEND_FEE_XLM } from '../../utils/stellarAddress';

/** Withdraw XLM to a Stellar public key, muxed address or federation address. */
export default function SendForm({ send, availableBalance, explorerUrl, twoFactorEnabled }) {
  const {
    sendForm, setSendForm, updateSend, handleMax, cancelReview,
    sending, reviewing, sendMsg, sendReview,
    sendExceedsBalance, memoError, exchangeName, amountDecimalsError,
    handleReview, handleSend,
  } = send;

  return (
    <div style={s.card}>
      <h3 style={{ marginBottom: 4, color: 'var(--color-text)' }}>Withdraw XLM</h3>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 8 }}>Transfer XLM from your platform wallet to a Stellar public key, muxed address or federation address.</p>
      <form onSubmit={handleReview} noValidate>
        <label style={s.label} htmlFor="send-destination">Destination Address</label>
        <input
          id="send-destination"
          style={s.input} type="text" placeholder="G…, M… or name*domain" spellCheck={false} autoComplete="off"
          value={sendForm.destination}
          onChange={e => updateSend({ destination: e.target.value })}
        />
        <label style={s.label} htmlFor="send-amount">Amount (XLM)</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            id="send-amount"
            style={{ ...s.input, flex: 1, borderColor: sendExceedsBalance || amountDecimalsError ? 'var(--color-danger)' : undefined }}
            type="text" inputMode="decimal" placeholder="0.00"
            value={sendForm.amount}
            onChange={e => updateSend({ amount: e.target.value.replace(/[^\d.]/g, '') })}
            aria-describedby={sendExceedsBalance ? 'send-balance-warning' : undefined}
          />
          <button type="button" style={{ ...s.btn, marginTop: 0, padding: '8px 12px' }} onClick={handleMax} title="Send everything except the reserve and network fee">
            Max
          </button>
        </div>
        {sendExceedsBalance && (
          <div id="send-balance-warning" role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 4 }}>
            Insufficient balance. You have {availableBalance.toFixed(2)} XLM available.
          </div>
        )}
        {!sendExceedsBalance && amountDecimalsError && (
          <div role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 4 }}>{amountDecimalsError}</div>
        )}
        <label style={s.label} htmlFor="send-memo">Memo <span style={{ color: 'var(--color-text-faint)', fontWeight: 400 }}>(optional)</span></label>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            aria-label="Memo type"
            style={{ ...s.input, width: 100 }}
            value={sendForm.memoType}
            onChange={e => updateSend({ memoType: e.target.value })}
          >
            {MEMO_TYPES.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
          </select>
          <input
            id="send-memo"
            style={{ ...s.input, flex: 1, borderColor: memoError ? 'var(--color-danger)' : undefined }}
            type="text" spellCheck={false} autoComplete="off"
            placeholder={sendForm.memoType === 'id' ? 'e.g. 123456789' : sendForm.memoType === 'hash' ? '64 hex characters' : 'e.g. payment for order #42'}
            value={sendForm.memo}
            onChange={e => updateSend({ memo: e.target.value })}
          />
        </div>
        {sendForm.memoType === 'text' && (
          <div style={{ fontSize: 12, color: memoError ? 'var(--color-danger)' : 'var(--color-text-muted)', marginTop: 4 }}>{memoByteLength(sendForm.memo)}/28 bytes</div>
        )}
        {memoError && sendForm.memoType !== 'text' && <div role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 4 }}>{memoError}</div>}
        {exchangeName && !sendForm.memo && (
          <div role="alert" style={{ background: '#fff3cd', border: '1px solid #ffc107', color: '#856404', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginTop: 8 }}>
            ⚠️ This looks like a {exchangeName} deposit address. Exchanges usually require a memo — without one your funds may be lost.
          </div>
        )}
        <button type="submit" style={{ ...s.btn, opacity: sendExceedsBalance ? 0.5 : 1 }} disabled={reviewing || sending || sendExceedsBalance || !!memoError || !!amountDecimalsError}>
          {reviewing ? 'Checking…' : 'Review'}
        </button>
      </form>

      <Modal open={!!sendReview} onClose={cancelReview} title="Confirm withdrawal" titleId="send-review-title">
        {sendReview && (
          <>
            <div style={{ fontSize: 13, lineHeight: 1.7 }}>
              <div><strong>Amount:</strong> {sendReview.amount} XLM</div>
              <div><strong>Network fee:</strong> {SEND_FEE_XLM} XLM</div>
              <div><strong>Remaining balance after send:</strong> {(availableBalance - Number(sendReview.amount) - SEND_FEE_XLM).toFixed(7)} XLM</div>
              {sendReview.federation && <div><strong>Federation:</strong> {sendReview.federation}</div>}
              <div style={{ wordBreak: 'break-all' }}><strong>Destination:</strong> {sendReview.publicKey}</div>
              <div><strong>Memo:</strong> {sendReview.memo ? `${sendReview.memo} (${sendReview.memoType.toUpperCase()})` : 'none'}</div>
            </div>
            {!sendReview.exists && (
              <div role="alert" style={{ background: '#fff3cd', color: '#856404', borderRadius: 6, padding: '8px 10px', fontSize: 13, marginTop: 8 }}>
                ⚠️ This account doesn't exist yet. It will be created with {sendReview.amount} XLM as its starting balance.
              </div>
            )}
            {twoFactorEnabled && (
              <>
                <label style={s.label} htmlFor="send-totp">Authenticator code</label>
                <input
                  id="send-totp" style={s.input} inputMode="numeric" maxLength={6} autoComplete="one-time-code" placeholder="123456"
                  value={sendForm.totp}
                  onChange={e => setSendForm(f => ({ ...f, totp: e.target.value.replace(/\D/g, '') }))}
                />
              </>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" style={s.btn} onClick={handleSend} disabled={sending}>
                {sending ? 'Sending…' : 'Confirm & Send'}
              </button>
              <button type="button" style={{ ...s.btn, background: 'var(--color-text-muted)' }} onClick={cancelReview} disabled={sending}>
                Back
              </button>
            </div>
          </>
        )}
      </Modal>

      {sendMsg && (
        <div style={{ ...s.msg, ...msgTone(sendMsg.type) }}>
          {sendMsg.text}
          {sendMsg.txHash && (
            <div style={{ marginTop: 6, fontSize: 12 }}>
              TX: <a href={explorerUrl('tx', sendMsg.txHash)} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)', wordBreak: 'break-all' }}>{sendMsg.txHash}</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
