import React, { useState } from 'react';
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
  msg: { fontSize: 12, marginTop: 6, padding: '6px 10px', borderRadius: 6 },
};

function timeLeft(endsAt) {
  const diff = new Date(endsAt) - Date.now();
  if (diff <= 0) return 'Ended';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

export default function AuctionCard({ auction, onBid }) {
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);

  const currentBid = auction.current_bid ?? auction.start_price;

  async function handleBid() {
    setMsg(null);
    setLoading(true);
    try {
      await api.placeBid(auction.id, { amount: parseFloat(amount) });
      setMsg({ ok: true, text: '✓ Bid placed!' });
      setAmount('');
      onBid();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
    setLoading(false);
  }

  return (
    <div style={s.card}>
      <div style={s.badge}>🔨 Auction</div>
      <div style={s.name}>{auction.product_name}</div>
      <div style={s.farmer}>by {auction.farmer_name}</div>
      <div style={s.price}>{currentBid} XLM</div>
      <div style={s.row}><span>⏱ {timeLeft(auction.ends_at)}</span><span>💬 {auction.bid_count} bid{auction.bid_count !== 1 ? 's' : ''}</span></div>
      <input
        style={s.input}
        type="number"
        placeholder={`Bid > ${currentBid} XLM`}
        value={amount}
        min={currentBid}
        step="0.01"
        onChange={e => setAmount(e.target.value)}
      />
      <button style={s.btn} onClick={handleBid} disabled={loading || !amount}>
        {loading ? 'Placing...' : 'Place Bid'}
      </button>
      {msg && (
        <div style={{ ...s.msg, background: msg.ok ? '#d8f3dc' : '#fee', color: msg.ok ? '#2d6a4f' : '#c0392b' }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
