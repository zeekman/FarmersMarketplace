import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';

const s = {
  page: { maxWidth: 900, margin: '0 auto', padding: 24 },
  header: {
    background: '#fff',
    borderRadius: 12,
    padding: 28,
    boxShadow: '0 1px 8px #0001',
    marginBottom: 24,
    display: 'flex',
    gap: 24,
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: '50%',
    objectFit: 'cover',
    flexShrink: 0,
    background: '#d8f3dc',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 40,
  },
  name: { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 4 },
  location: { fontSize: 14, color: '#888', marginBottom: 8 },
  bio: { fontSize: 14, color: '#555', lineHeight: 1.6, maxWidth: 560 },
  since: { fontSize: 12, color: '#aaa', marginTop: 8 },
  sectionTitle: { fontSize: 18, fontWeight: 700, color: '#2d6a4f', marginBottom: 16 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 18 },
  card: {
    background: '#fff',
    borderRadius: 12,
    padding: 18,
    boxShadow: '0 1px 8px #0001',
    cursor: 'pointer',
    transition: 'transform 0.1s',
  },
  cardName: { fontWeight: 700, fontSize: 15, marginBottom: 4 },
  cardDesc: { fontSize: 13, color: '#666', marginBottom: 10, minHeight: 32 },
  cardPrice: { fontWeight: 700, color: '#2d6a4f', fontSize: 16 },
  cardQty: { fontSize: 12, color: '#888', marginTop: 3 },
  badge: {
    display: 'inline-block',
    fontSize: 11,
    background: '#d8f3dc',
    color: '#2d6a4f',
    borderRadius: 4,
    padding: '2px 7px',
    marginBottom: 6,
  },
  empty: { color: '#aaa', fontSize: 14, padding: '32px 0', textAlign: 'center' },
  back: {
    fontSize: 13,
    color: '#2d6a4f',
    cursor: 'pointer',
    marginBottom: 16,
    display: 'inline-block',
  },
};

export default function FarmerProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [farmer, setFarmer] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    api
      .getFarmer(id)
      .then((res) => setFarmer(res.data))
      .catch(() => setNotFound(true));
  }, [id]);

  if (notFound) {
    return (
      <div style={{ ...s.page, textAlign: 'center', paddingTop: 60 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🌾</div>
        <div style={{ fontSize: 18, color: '#888' }}>Farmer not found.</div>
        <button style={{ marginTop: 16, ...s.back }} onClick={() => navigate('/marketplace')}>
          ← Back to Marketplace
        </button>
      </div>
    );
  }

  if (!farmer) return <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div>;

  return (
    <div style={s.page}>
      <span style={s.back} onClick={() => navigate(-1)}>
        ← Back
      </span>

      {/* Profile header */}
      <div style={s.header}>
        {farmer.avatar_url ? (
          <img src={farmer.avatar_url} alt={farmer.name} style={s.avatar} />
        ) : (
          <div style={s.avatar}>🌾</div>
        )}
        <div style={{ flex: 1 }}>
          <div style={s.name}>{farmer.name}</div>
          {farmer.location && <div style={s.location}>📍 {farmer.location}</div>}
          {farmer.bio ? (
            <div style={s.bio}>{farmer.bio}</div>
          ) : (
            <div style={{ ...s.bio, color: '#bbb', fontStyle: 'italic' }}>No bio yet.</div>
          )}
          <div style={s.since}>
            Member since{' '}
            {new Date(farmer.created_at).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'long',
            })}
          </div>
        </div>
      </div>

      {/* Active listings */}
      <div style={s.sectionTitle}>🛒 Active Listings ({farmer.listings.length})</div>

      {farmer.listings.length === 0 ? (
        <div style={s.empty}>This farmer has no active listings right now.</div>
      ) : (
        <div style={s.grid}>
          {farmer.listings.map((p) => (
            <div
              key={p.id}
              style={s.card}
              onClick={() => navigate(`/product/${p.id}`)}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = '')}
            >
              {p.image_url ? (
                <img
                  src={p.image_url}
                  alt={p.name}
                  style={{
                    width: '100%',
                    height: 120,
                    objectFit: 'cover',
                    borderRadius: 8,
                    marginBottom: 10,
                  }}
                />
              ) : (
                <div style={{ fontSize: 28, marginBottom: 8 }}>🥬</div>
              )}
              {p.category && p.category !== 'other' && <div style={s.badge}>{p.category}</div>}
              <div style={s.cardName}>{p.name}</div>
              <div style={s.cardDesc}>{p.description || 'Fresh from the farm'}</div>
              <div style={s.cardPrice}>
                {p.price} XLM <span style={{ fontSize: 12, fontWeight: 400 }}>/ {p.unit}</span>
              </div>
              <div style={s.cardQty}>
                {p.quantity} {p.unit} available
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
