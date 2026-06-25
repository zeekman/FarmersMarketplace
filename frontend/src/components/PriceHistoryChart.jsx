import React, { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { api } from '../api/client';

const RANGES = [
  { label: '7D', value: '7d' },
  { label: '30D', value: '30d' },
  { label: 'All', value: 'all' },
];

export default function PriceHistoryChart({ productId, data: initialData, locale }) {
  const [range, setRange] = useState('30d');
  const [data, setData] = useState(initialData ?? null);
  const [loading, setLoading] = useState(false);

  const activeLocale = locale || (typeof navigator !== 'undefined' ? navigator.language : 'en');

  useEffect(() => {
    if (!productId) return;
    setLoading(true);
    api.getPriceHistory(productId, range)
      .then(res => setData(res.data ?? res))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [productId, range]);

  if (!data || data.length < 2) {
    return (
      <div style={{ marginBottom: 24 }}>
        <RangeToggle range={range} onRange={setRange} />
        <div style={{ fontSize: 14, color: '#888' }}>No price history available.</div>
      </div>
    );
  }

  const formatted = data.map(d => ({
    date: new Date(d.recorded_at).toLocaleDateString(activeLocale, { month: 'short', day: 'numeric' }),
    price: parseFloat(d.price),
  }));

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#2d6a4f' }}>📈 Price History</div>
        <RangeToggle range={range} onRange={setRange} />
      </div>
      {loading ? (
        <div style={{ fontSize: 13, color: '#aaa', height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading…</div>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={formatted} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} unit=" XLM" />
            <Tooltip formatter={v => [`${v} XLM`, 'Price']} />
            <Line type="monotone" dataKey="price" stroke="#2d6a4f" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function RangeToggle({ range, onRange }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {RANGES.map(r => (
        <button
          key={r.value}
          onClick={() => onRange(r.value)}
          style={{
            padding: '3px 10px', fontSize: 12, borderRadius: 4, border: '1px solid #ddd', cursor: 'pointer',
            background: range === r.value ? '#2d6a4f' : '#fff',
            color: range === r.value ? '#fff' : '#333',
            fontWeight: range === r.value ? 700 : 400,
          }}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
