import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

export default function PriceHistoryChart({ data }) {
  if (!data || data.length < 2) return null;

  const formatted = data.map((d) => ({
    date: new Date(d.recorded_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    price: parseFloat(d.price),
  }));

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#2d6a4f', marginBottom: 8 }}>
        📈 Price History (last 30 days)
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={formatted} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit=" XLM" />
          <Tooltip formatter={(v) => [`${v} XLM`, 'Price']} />
          <Line type="monotone" dataKey="price" stroke="#2d6a4f" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
