import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';

const PAGE_SIZE = 9;

const s = {
  page:       { maxWidth: 900, margin: '0 auto', padding: 24 },
  header:     { background: '#fff', borderRadius: 12, padding: 28, boxShadow: '0 1px 8px #0001', marginBottom: 24, display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' },
  avatar:     { width: 96, height: 96, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, background: '#d8f3dc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 },
  name:       { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 4 },
  location:   { fontSize: 14, color: '#888', marginBottom: 8 },
  bio:        { fontSize: 14, color: '#555', lineHeight: 1.6, maxWidth: 560 },
  since:      { fontSize: 12, color: '#aaa', marginTop: 8 },
  sectionTitle: { fontSize: 18, fontWeight: 700, color: '#2d6a4f', marginBottom: 16 },
  grid:       { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 18 },
  card:       { background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 1px 8px #0001', cursor: 'pointer', transition: 'transform 0.1s' },
  cardName:   { fontWeight: 700, fontSize: 15, marginBottom: 4 },
  cardDesc:   { fontSize: 13, color: '#666', marginBottom: 10, minHeight: 32 },
  cardPrice:  { fontWeight: 700, color: '#2d6a4f', fontSize: 16 },
  cardQty:    { fontSize: 12, color: '#888', marginTop: 3 },
  badge:      { display: 'inline-block', fontSize: 11, background: '#d8f3dc', color: '#2d6a4f', borderRadius: 4, padding: '2px 7px', marginBottom: 6 },
  verifiedBadge: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, background: '#dbeafe', color: '#1e40af', borderRadius: 20, padding: '3px 10px', marginTop: 8 },
  coopBadge:  { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, background: '#fef9c3', color: '#854d0e', border: '1px solid #fde047', borderRadius: 20, padding: '3px 10px', marginTop: 6, marginRight: 6, cursor: 'pointer', background: 'none' },
  coopBadgeInner: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, background: '#fef9c3', color: '#854d0e', border: '1px solid #fde047', borderRadius: 20, padding: '3px 10px', marginTop: 6, marginRight: 6, cursor: 'pointer' },
  coopModal:  { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  coopModalBox: { background: '#fff', borderRadius: 14, padding: 28, maxWidth: 420, width: '90%', boxShadow: '0 4px 24px #0003' },
  coopModalTitle: { fontSize: 18, fontWeight: 700, color: '#2d6a4f', marginBottom: 6 },
  coopModalDesc: { fontSize: 14, color: '#555', marginBottom: 14, lineHeight: 1.6 },
  coopModalMeta: { fontSize: 13, color: '#888', marginBottom: 16 },
  coopModalClose: { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 14, minHeight: 44 },
  timeline:   { marginTop: 8 },
  tlEntry:    { display: 'flex', gap: 14, marginBottom: 20, position: 'relative' },
  tlDot:      { width: 12, height: 12, borderRadius: '50%', background: '#2d6a4f', flexShrink: 0, marginTop: 4 },
  tlLine:     { position: 'absolute', left: 5, top: 16, bottom: -20, width: 2, background: '#d8f3dc' },
  tlBody:     { flex: 1 },
  tlDate:     { fontSize: 12, color: '#888', marginBottom: 2 },
  tlBatch:    { fontWeight: 600, fontSize: 14, color: '#2d6a4f', marginBottom: 2 },
  tlMeta:     { fontSize: 13, color: '#555' },
  certBadge:  { display: 'inline-block', fontSize: 11, background: '#d8f3dc', color: '#2d6a4f', borderRadius: 4, padding: '1px 6px', marginLeft: 6 },
  empty:      { color: '#aaa', fontSize: 14, padding: '32px 0', textAlign: 'center' },
  back:       { fontSize: 13, color: '#2d6a4f', cursor: 'pointer', marginBottom: 16, display: 'inline-block' },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 24 },
  pageBtn:    { padding: '7px 14px', borderRadius: 8, border: '1px solid #ddd', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: '#fff', color: '#2d6a4f' },
  pageBtnActive: { background: '#2d6a4f', color: '#fff', border: '1px solid #2d6a4f' },
  pageBtnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
};

const shimmer = `
  @keyframes shimmer {
    0%   { background-position: -600px 0; }
    100% { background-position: 600px 0; }
  }
`;

const skeletonBase = {
  background: 'linear-gradient(90deg, #e8e8e8 25%, #f5f5f5 50%, #e8e8e8 75%)',
  backgroundSize: '600px 100%',
  animation: 'shimmer 1.4s infinite linear',
  borderRadius: 6,
};

function SkeletonBlock({ width = '100%', height = 16, style = {} }) {
  return <div style={{ ...skeletonBase, width, height, ...style }} />;
}

function ProfileSkeleton() {
  return (
    <div style={s.page} aria-busy="true" aria-label="Loading farmer profile">
      <style>{shimmer}</style>
      <SkeletonBlock width={60} height={13} style={{ marginBottom: 16 }} />
      <div style={s.header}>
        <SkeletonBlock width={96} height={96} style={{ borderRadius: '50%', flexShrink: 0 }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SkeletonBlock width={200} height={24} />
          <SkeletonBlock width={120} height={14} />
          <SkeletonBlock width="80%" height={14} />
          <SkeletonBlock width="60%" height={14} />
          <SkeletonBlock width={100} height={12} />
        </div>
      </div>
      <SkeletonBlock width={180} height={20} style={{ marginBottom: 16 }} />
      <div style={s.grid}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ ...s.card, cursor: 'default' }}>
            <SkeletonBlock width="100%" height={120} style={{ borderRadius: 8, marginBottom: 10 }} />
            <SkeletonBlock width="70%" height={15} style={{ marginBottom: 8 }} />
            <SkeletonBlock width="90%" height={13} style={{ marginBottom: 10 }} />
            <SkeletonBlock width={80} height={16} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Modal that shows cooperative detail (name, description, member count) */
function CoopDetailModal({ coop, onClose }) {
  // Close on backdrop click
  function handleBackdrop(e) {
    if (e.target === e.currentTarget) onClose();
  }
  // Close on Escape key
  React.useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      style={s.coopModal}
      role="dialog"
      aria-modal="true"
      aria-labelledby="coop-modal-title"
      onClick={handleBackdrop}
    >
      <div style={s.coopModalBox}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div id="coop-modal-title" style={s.coopModalTitle}>🤝 {coop.name}</div>
          <button
            onClick={onClose}
            aria-label="Close cooperative detail"
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888', lineHeight: 1, padding: '0 4px' }}
          >
            ×
          </button>
        </div>
        {coop.description && (
          <div style={s.coopModalDesc}>{coop.description}</div>
        )}
        <div style={s.coopModalMeta}>
          {coop.member_count != null && (
            <div>👥 {coop.member_count} member{coop.member_count !== 1 ? 's' : ''}</div>
          )}
          {coop.created_at && (
            <div style={{ marginTop: 4 }}>
              Founded {new Date(coop.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}
            </div>
          )}
        </div>
        <button style={s.coopModalClose} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export default function FarmerProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [farmer, setFarmer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [page, setPage] = useState(1);
  const [cooperatives, setCooperatives] = useState([]);
  const [selectedCoop, setSelectedCoop] = useState(null);
  const [batches, setBatches] = useState([]);
  const [batchesLoading, setBatchesLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setPage(1);
    api.getFarmer(id)
      .then(res => setFarmer(res.data))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));

    setBatchesLoading(true);
    api.getBatchesByFarmer(id)
      .then(res => setBatches((res.data ?? []).sort((a, b) => new Date(b.harvest_date) - new Date(a.harvest_date))))
      .catch(() => setBatches([]))
      .finally(() => setBatchesLoading(false));
  }, [id]);

  // Fetch cooperatives for this farmer separately — non-blocking
  useEffect(() => {
    if (!id) return;
    api.getFarmerCooperatives(id)
      .then(res => setCooperatives(res.data ?? []))
      .catch(() => setCooperatives([]));
  }, [id]);

  const totalPages = farmer ? Math.ceil(farmer.listings.length / PAGE_SIZE) : 1;
  const pagedListings = useMemo(() => {
    if (!farmer) return [];
    const start = (page - 1) * PAGE_SIZE;
    return farmer.listings.slice(start, start + PAGE_SIZE);
  }, [farmer, page]);

  if (loading) return <ProfileSkeleton />;

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

  return (
    <div style={s.page}>
      <span style={s.back} onClick={() => navigate(-1)}>← Back</span>

      {/* Profile header */}
      <div style={s.header}>
        {farmer.avatar_url
          ? <img src={farmer.avatar_url} alt={farmer.name} style={s.avatar} />
          : <div style={s.avatar}>🌾</div>
        }
        <div style={{ flex: 1 }}>
          <div style={s.name}>{farmer.name}</div>
          {farmer.location && <div style={s.location}>📍 {farmer.location}</div>}
          {farmer.bio
            ? <div style={s.bio}>{farmer.bio}</div>
            : <div style={{ ...s.bio, color: '#bbb', fontStyle: 'italic' }}>No bio yet.</div>
          }
          <div style={s.since}>
            Member since {new Date(farmer.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}
          </div>
          {farmer.verified && (
            <div style={s.verifiedBadge}>✔ Verified Farmer</div>
          )}

          {/* Cooperative membership badges */}
          {cooperatives.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {cooperatives.map(coop => (
                <button
                  key={coop.id}
                  style={s.coopBadgeInner}
                  onClick={() => setSelectedCoop(coop)}
                  aria-label={`Member of cooperative: ${coop.name}. Click for details.`}
                  title={`Cooperative: ${coop.name}${coop.description ? ' — ' + coop.description : ''}`}
                >
                  🤝 Member of: {coop.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cooperative detail modal */}
      {selectedCoop && (
        <CoopDetailModal coop={selectedCoop} onClose={() => setSelectedCoop(null)} />
      )}

      {/* Active listings */}
      <div style={s.sectionTitle}>
        🛒 Active Listings ({farmer.listings.length})
      </div>

      {farmer.listings.length === 0 ? (
        <div style={s.empty}>This farmer has no active listings right now.</div>
      ) : (
        <>
          <div style={s.grid}>
            {pagedListings.map(p => (
              <div
                key={p.id}
                style={s.card}
                onClick={() => navigate(`/product/${p.id}`)}
                onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                onMouseLeave={e => e.currentTarget.style.transform = ''}
              >
                {p.image_url
                  ? <img src={p.image_url} alt={p.name} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 8, marginBottom: 10 }} />
                  : <div style={{ fontSize: 28, marginBottom: 8 }}>🥬</div>
                }
                {p.category && p.category !== 'other' && <div style={s.badge}>{p.category}</div>}
                <div style={s.cardName}>{p.name}</div>
                <div style={s.cardDesc}>{p.description || 'Fresh from the farm'}</div>
                <div style={s.cardPrice}>{p.price} XLM <span style={{ fontSize: 12, fontWeight: 400 }}>/ {p.unit}</span></div>
                <div style={s.cardQty}>{p.quantity} {p.unit} available</div>
              </div>
            ))}
          </div>
          {totalPages > 1 && (
            <div style={s.pagination}>
              <button
                style={{ ...s.pageBtn, ...(page === 1 ? s.pageBtnDisabled : {}) }}
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
              >
                ← Prev
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                <button
                  key={n}
                  style={{ ...s.pageBtn, ...(n === page ? s.pageBtnActive : {}) }}
                  onClick={() => setPage(n)}
                >
                  {n}
                </button>
              ))}
              <button
                style={{ ...s.pageBtn, ...(page === totalPages ? s.pageBtnDisabled : {}) }}
                disabled={page === totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      {/* Harvest Batch Timeline */}
      <div style={{ marginTop: 32 }}>
        <h2 style={s.sectionTitle}>🌿 Harvest Traceability</h2>
        {batchesLoading ? (
          <div style={s.grid}>
            {[1,2,3].map(i => <div key={i} style={{ ...s.card, cursor: 'default' }}><SkeletonBlock width="100%" height={60} /></div>)}
          </div>
        ) : batches.length === 0 ? (
          <div style={s.empty}>No harvest batches recorded yet.</div>
        ) : (
          <ol style={{ ...s.timeline, listStyle: 'none', padding: 0, margin: 0 }}>
            {batches.map((b, i) => (
              <li key={b.id} style={s.tlEntry}>
                <div style={{ position: 'relative' }}>
                  <div style={s.tlDot} />
                  {i < batches.length - 1 && <div style={s.tlLine} />}
                </div>
                <div style={s.tlBody}>
                  <div style={s.tlDate}>{new Date(b.harvest_date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</div>
                  <div style={s.tlBatch}>Batch #{b.id} · {b.crop_name}
                    {b.certified && <span style={s.certBadge}>✔ Certified</span>}
                  </div>
                  {b.field_location && <div style={s.tlMeta}>📍 {b.field_location}</div>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
