import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default marker icons broken by webpack/vite bundling
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const s = {
  popup: { minWidth: 180 },
  name: { fontWeight: 700, fontSize: 14, color: '#2d6a4f', marginBottom: 4 },
  price: { fontWeight: 600, color: '#333', fontSize: 13, marginBottom: 4 },
  farmer: { fontSize: 12, color: '#888', marginBottom: 8 },
  address: { fontSize: 11, color: '#aaa', marginBottom: 8 },
  btn: {
    display: 'inline-block', background: '#2d6a4f', color: '#fff',
    border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer',
    fontSize: 12, fontWeight: 600, textDecoration: 'none',
  },
};

// Group products by farmer to avoid stacking markers
function groupByFarmer(products) {
  const map = new Map();
  for (const p of products) {
    if (p.farmer_lat == null || p.farmer_lng == null) continue;
    const key = `${p.farmer_lat},${p.farmer_lng}`;
    if (!map.has(key)) map.set(key, { lat: p.farmer_lat, lng: p.farmer_lng, products: [] });
    map.get(key).products.push(p);
  }
  return Array.from(map.values());
}

export default function MapView({ products, onBuy }) {
  const navigate = useNavigate();
  const groups = groupByFarmer(products);

  if (groups.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: '#888' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🗺️</div>
        <div>No products with location data yet.</div>
        <div style={{ fontSize: 13, marginTop: 6 }}>Farmers can add their location in profile settings.</div>
      </div>
    );
  }

  // Center map on average of all markers
  const avgLat = groups.reduce((s, g) => s + g.lat, 0) / groups.length;
  const avgLng = groups.reduce((s, g) => s + g.lng, 0) / groups.length;

  return (
    <MapContainer
      center={[avgLat, avgLng]}
      zoom={7}
      style={{ height: 520, width: '100%', borderRadius: 12, zIndex: 0 }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {groups.map((group, i) => (
        <Marker key={i} position={[group.lat, group.lng]}>
          <Popup>
            <div style={s.popup}>
              {group.products.map(p => (
                <div key={p.id} style={{ marginBottom: group.products.length > 1 ? 12 : 0, paddingBottom: group.products.length > 1 ? 12 : 0, borderBottom: group.products.length > 1 ? '1px solid #eee' : 'none' }}>
                  <div style={s.name}>{p.name}</div>
                  <div style={s.price}>{p.price} XLM / {p.unit}</div>
                  <div style={s.farmer}>🌾 {p.farmer_name}</div>
                  {p.farmer_farm_address && <div style={s.address}>📍 {p.farmer_farm_address}</div>}
                  <button style={s.btn} onClick={() => navigate(`/products/${p.id}`)}>View &amp; Buy</button>
                </div>
              ))}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
