import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';

const s = {
  card: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 8px #0001', border: '2px solid #f4a261' },
  name: { fontWeight: 700, fontSize: 16, marginBottom: 4 },
  farmer: { fontSize: 12, color: '#888', marginBottom: 8 },
  badge: { display: 'inline-block', fontSize: 11, background: '#fff3e0', color: '#e07b00', borderRadius: 4, padding: '2px 7px', marginBottom: 8 },
  row: { display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#555', marginBottom: 4 },
  price: { fontWeight: 700, color: '#e07b00', fontSize: 18, margin: '8px 0' },
  input: { width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, marginTop: 8 },
  btn: { width: '100%', marginTop: 8, padding: '9px 0', background: '#e07b00', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer' },
  btnDisabled: { width: '100%', marginTop: 8, padding: '9px 0', background: '#ccc', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'not-allowed' },
  msg: { fontSize: 12, marginTop: 6, padding: '6px 10px', borderRadius: 6 },
  liveBadge: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, background: '#fee2e2', color: '#dc2626', borderRadius: 4, padding: '2px 7px', marginBottom: 8, fontWeight: 700 },
};

const pulseDot = `
@keyframes ac-pulse { 0%,100%{opacity:1}50%{opacity:0.3} }
.ac-dot { width:7px;height:7px;border-radius:50%;background:#dc2626;animation:ac-pulse 1s ease-in-out infinite; }
`;

function formatTimeLeft(endsAt) {
  const diff = new Date(endsAt) - Date.now();
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const sec = Math.floor((diff % 60000) / 1000);
  return h > 0 ? `${h}h ${m}m ${sec}s left` : m > 0 ? `${m}m ${sec}s left` : `${sec}s left`;
}

export default function AuctionCard({ auction: initialAuction, onBid }) {
  const [auction, setAuction] = useState(initialAuction);
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(() => formatTimeLeft(initialAuction.ends_at));
  const optimisticBid = useRef(null);

  // Countdown timer
  useEffect(() => {
    const id = setInterval(() => setTimeLeft(formatTimeLeft(auction.ends_at)), 1000);
    return () => clearInterval(id);
  }, [auction.ends_at]);

  // Polling for live auctions
  useEffect(() => {
    if (auction.status !== 'active') return;
    const id = setInterval(async () => {
      try {
        const res = await api.getAuction(auction.id);
        const fresh = res.data ?? res;
        setAuction(prev => {
          // Keep optimistic bid if it's higher than server data
          if (optimisticBid.current && optimisticBid.current > (fresh.current_bid ?? fresh.start_price)) {
            return { ...fresh, current_bid: optimisticBid.current };
          }
          optimisticBid.current = null;
          return fresh;
        });
      } catch {}
    }, 5000);
    return () => clearInterval(id);
  }, [auction.id, auction.status]);

  const ended = timeLeft === null;
  const currentBid = auction.current_bid ?? auction.start_price;
  const isLive = auction.status === 'active' && !ended;

  async function handleBid() {
    setMsg(null);
    setLoading(true);
    const bidAmount = parseFloat(amount);
    // Optimistic update
    optimisticBid.current = bidAmount;
    setAuction(prev => ({ ...prev, current_bid: bidAmount }));
    try {
      await api.placeBid(auction.id, { amount: bidAmount });
      setMsg({ ok: true, text: '✓ Bid placed!' });
      setAmount('');
      onBid();
    } catch (e) {
      // Revert optimistic update on error
      optimisticBid.current = null;
      setAuction(initialAuction);
      setMsg({ ok: false, text: e.message });
    }
    setLoading(false);
  }

  return (
    <div style={s.card}>
      <style>{pulseDot}</style>
      <div style={s.badge}>🔨 Auction</div>
      {isLive && (
        <div style={s.liveBadge}>
          <span className="ac-dot" />
          LIVE
        </div>
      )}
      <div style={s.name}>{auction.product_name}</div>
      <div style={s.farmer}>by {auction.farmer_name}</div>
      <div style={s.price}>{currentBid} XLM</div>
      <div style={s.row}>
        <span>⏱ {ended ? 'Auction ended' : timeLeft}</span>
        <span>💬 {auction.bid_count} bid{auction.bid_count !== 1 ? 's' : ''}</span>
      </div>
      {!ended && (
        <input
          style={s.input}
          type="number"
          placeholder={`Bid > ${currentBid} XLM`}
          value={amount}
          min={currentBid}
          step="0.01"
          onChange={e => setAmount(e.target.value)}
        />
      )}
      <button
        style={ended ? s.btnDisabled : s.btn}
        onClick={ended ? undefined : handleBid}
        disabled={ended || loading || !amount}
      >
        {ended ? 'Auction ended' : loading ? 'Placing...' : 'Place Bid'}
      </button>
      {msg && (
        <div style={{ ...s.msg, background: msg.ok ? '#d8f3dc' : '#fee', color: msg.ok ? '#2d6a4f' : '#c0392b' }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
