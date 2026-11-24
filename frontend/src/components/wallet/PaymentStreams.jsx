import React from 'react';
import StreamAccrual from '../StreamAccrual';
import { WidgetErrorBoundary } from '../RouteErrorBoundary';
import { s, msgTone } from './walletStyles';

/** Active payment streams the user is sending or receiving. */
export default function PaymentStreams({ streams, streamsMsg, streamActionId, publicKey, streamsApi }) {
  const { cancelStream, decreaseStreamRate, withdrawStream } = streamsApi;

  return (
    <div style={s.card}>
      <h3 style={{ marginBottom: 16, color: 'var(--color-text)' }}>Active Payment Streams</h3>
      {streamsMsg && (
        <div style={{ ...s.msg, ...msgTone(streamsMsg.type) }}>
          {streamsMsg.text}
        </div>
      )}
      {streams.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>You have no active payment streams yet.</p>
      ) : (
        streams.map((stream) => {
          const isSender = stream.sender === publicKey || stream.role === 'sender';
          const counterparty = isSender ? stream.recipient : stream.sender;
          return (
            <div key={stream.id} style={s.tx}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>
                  {isSender ? '↑ Streaming to' : '↓ Streaming from'}{' '}
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--color-text-muted)' }}>
                    {counterparty ? `${counterparty.slice(0, 8)}...${counterparty.slice(-4)}` : '-'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  Rate: {Number(stream.rate).toFixed(4)} XLM/sec · Deposit remaining: {Number(stream.deposit_remaining ?? stream.depositRemaining ?? 0).toFixed(2)} XLM
                </div>
                <div style={{ fontSize: 13, color: 'var(--color-primary)', marginTop: 4, fontWeight: 600 }}>
                  Accrued: <WidgetErrorBoundary name="StreamAccrual"><StreamAccrual accrued={stream.accrued} asOf={stream.as_of ?? stream.asOf} rate={stream.rate} /></WidgetErrorBoundary> XLM
                </div>
              </div>
              <div style={{ flexShrink: 0, marginLeft: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {isSender ? (
                  <>
                    <button style={s.btnOutline} disabled={streamActionId === stream.id} onClick={() => decreaseStreamRate(stream.id, stream.rate)}>
                      Decrease rate
                    </button>
                    <button style={s.btnDanger} disabled={streamActionId === stream.id} onClick={() => cancelStream(stream.id)}>
                      {streamActionId === stream.id ? '...' : 'Cancel'}
                    </button>
                  </>
                ) : (
                  <button style={s.btnSm} disabled={streamActionId === stream.id} onClick={() => withdrawStream(stream.id)}>
                    {streamActionId === stream.id ? '...' : 'Withdraw'}
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
