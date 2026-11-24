import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap, useMapEvents } from 'react-leaflet';
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

const DEFAULT_CENTER = [0, 0];
// Cluster radius in degrees of lat/lng, scaled by zoom level
const BASE_CLUSTER_RADIUS = 2.0;

// Dark-mode tile filter applied to the tile layer only (markers unaffected).
const DARK_TILE_FILTER = 'invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9)';

function isDarkTheme() {
  if (typeof document === 'undefined') return false;
  const root = document.documentElement;
  if (root.classList.contains('dark') || root.dataset.theme === 'dark') return true;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
}

function useDarkTheme() {
  const [dark, setDark] = useState(isDarkTheme);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDark(isDarkTheme());
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return dark;
}

function formatDistance(km) {
  if (km == null || Number.isNaN(km)) return null;
  return `${km.toFixed(1)} km away`;
}

const s = {
  popup: { minWidth: 180 },
  name: { fontWeight: 700, fontSize: 14, color: '#2d6a4f', marginBottom: 4 },
  price: { fontWeight: 600, color: '#333', fontSize: 13, marginBottom: 4 },
  farmer: { fontSize: 12, color: '#595959', marginBottom: 8 },
  address: { fontSize: 11, color: '#595959', marginBottom: 8 },
  listAlt: { marginTop: 12, background: '#fff', border: '1px solid #ddd', borderRadius: 10, padding: '10px 14px' },
  listAltSummary: { cursor: 'pointer', fontWeight: 600, color: '#2d6a4f', fontSize: 14 },
  listAltItem: { padding: '8px 0', borderTop: '1px solid #eee' },
  listAltFarmBtn: { background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textDecoration: 'underline' },
  btn: {
    display: 'inline-block', background: '#2d6a4f', color: '#fff',
    border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer',
    fontSize: 12, fontWeight: 600, textDecoration: 'none',
  },
  toast: {
    position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
    background: '#333', color: '#fff', padding: '8px 16px', borderRadius: 8,
    fontSize: 13, zIndex: 1000, pointerEvents: 'none',
  },
  userMarkerIcon: {
    background: '#2d6a4f',
    border: '3px solid #fff',
    borderRadius: '50%',
    width: 16,
    height: 16,
    boxShadow: '0 0 0 3px rgba(45,106,79,0.4)',
  },
  geoFallback: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    background: '#fff7e6', border: '1px solid #ffd591', color: '#8a5a00',
    borderRadius: 8, padding: '10px 14px', marginBottom: 10, fontSize: 13,
  },
  geoFallbackBtn: {
    background: '#8a5a00', color: '#fff', border: 'none', borderRadius: 6,
    padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
  },
  srOnly: {
    position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
    overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
  },
};

function groupByFarmer(products) {
  const map = new Map();
  for (const p of products) {
    if (p.farmer_lat == null || p.farmer_lng == null) continue;
    const key = `${p.farmer_lat},${p.farmer_lng}`;
    if (!map.has(key)) map.set(key, { lat: p.farmer_lat, lng: p.farmer_lng, farmerName: p.farmer_name, products: [] });
    map.get(key).products.push(p);
  }
  return Array.from(map.values());
}

// Farm location groups are keyed by coordinates, which are unique per group.
function clusterItemKey(group) {
  return `${group.lat},${group.lng}`;
}

/**
 * Groups farm location pins into spatial clusters at the given zoom level.
 * Returns an array of items, each either a single group ({ type: 'pin', ...group })
 * or a merged cluster ({ type: 'cluster', lat, lng, count, groups: [...] }).
 */
function buildClusters(groups, zoom) {
  // Radius shrinks as zoom increases — more spread out at higher zoom
  const radius = BASE_CLUSTER_RADIUS / Math.pow(2, Math.max(0, zoom - 5));
  const assigned = new Array(groups.length).fill(false);
  const clusters = [];

  for (let i = 0; i < groups.length; i++) {
    if (assigned[i]) continue;
    const members = [groups[i]];
    assigned[i] = true;

    for (let j = i + 1; j < groups.length; j++) {
      if (assigned[j]) continue;
      const dLat = groups[i].lat - groups[j].lat;
      const dLng = groups[i].lng - groups[j].lng;
      if (Math.abs(dLat) <= radius && Math.abs(dLng) <= radius) {
        members.push(groups[j]);
        assigned[j] = true;
      }
    }

    if (members.length === 1) {
      clusters.push({ type: 'pin', ...members[0] });
    } else {
      const lat = members.reduce((s, m) => s + m.lat, 0) / members.length;
      const lng = members.reduce((s, m) => s + m.lng, 0) / members.length;
      clusters.push({ type: 'cluster', lat, lng, count: members.length, groups: members });
    }
  }
  return clusters;
}

function clusterIcon(count) {
  return L.divIcon({
    className: '',
    html: `<div tabindex="0" role="button" aria-label="${count} farms clustered" style="
      background:#2d6a4f;color:#fff;border-radius:50%;width:40px;height:40px;
      display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;
      border:3px solid #d8f3dc;box-shadow:0 2px 6px rgba(0,0,0,0.3);cursor:pointer;
    ">${count}</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

function farmMarkerIcon(label) {
  return L.divIcon({
    className: '',
    html: `<div tabindex="0" role="button" aria-label="${label}" style="
      background:#2d6a4f;color:#fff;border-radius:50%;width:28px;height:28px;
      display:flex;align-items:center;justify-content:center;font-size:14px;
      border:3px solid #d8f3dc;box-shadow:0 2px 6px rgba(0,0,0,0.3);cursor:pointer;
    ">🌾</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function RecenterMap({ center }) {
  const map = useMap();
  useEffect(() => { map.setView(center, map.getZoom()); }, [center, map]);
  return null;
}

function ZoomTracker({ onZoom }) {
  useMapEvents({ zoomend: (e) => onZoom(e.target.getZoom()) });
  return null;
}

function ClusterLayer({ groups, onFarmerClick }) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  const navigate = useNavigate();
  const clusters = buildClusters(groups, zoom);

  return (
    <>
      <ZoomTracker onZoom={setZoom} />
      {clusters.map((item) => {
        if (item.type === 'cluster') {
          return (
            <Marker
              key={`cluster-${item.groups.map(clusterItemKey).join('|')}`}
              position={[item.lat, item.lng]}
              icon={clusterIcon(item.count)}
              eventHandlers={{
                click: () => map.setView([item.lat, item.lng], zoom + 2),
                keypress: (e) => { if (e.originalEvent.key === 'Enter') map.setView([item.lat, item.lng], zoom + 2); },
              }}
            >
              <Popup>
                <div style={s.popup}>
                  <div style={s.name}>{item.count} farms in this area</div>
                  <button style={s.btn} onClick={() => map.setView([item.lat, item.lng], zoom + 2)}>
                    Zoom in to see farms
                  </button>
                </div>
              </Popup>
            </Marker>
          );
        }

        const group = item;
        const farmName = group.farmerName ?? group.products[0]?.farmer_name ?? 'Farm';
        const distance = formatDistance(group.products[0]?.distance_km);
        const markerLabel = distance ? `Farm: ${farmName}, ${distance}` : `Farm: ${farmName}`;
        return (
          <React.Fragment key={`pin-${clusterItemKey(group)}`}>
            <Marker
              position={[group.lat, group.lng]}
              icon={farmMarkerIcon(markerLabel)}
              eventHandlers={{
                ...(onFarmerClick ? {
                  click: () => onFarmerClick(farmName),
                } : {}),
                keypress: (e) => {
                  if (e.originalEvent.key === 'Enter') {
                    e.target.openPopup();
                  }
                },
              }}
            >
              <Popup>
                <div style={s.popup}>
                  {group.products.length > 0 ? (
                    group.products.map(p => (
                      <div
                        key={p.id}
                        style={{
                          marginBottom: group.products.length > 1 ? 12 : 0,
                          paddingBottom: group.products.length > 1 ? 12 : 0,
                          borderBottom: group.products.length > 1 ? '1px solid #eee' : 'none',
                        }}
                      >
                        <div style={s.name}>{p.name}</div>
                        <div style={s.price}>{p.price} XLM / {p.unit}</div>
                        <div style={s.farmer}>🌾 {p.farmer_name}</div>
                        {p.farmer_farm_address && <div style={s.address}>📍 {p.farmer_farm_address}</div>}
                        <button style={s.btn} onClick={() => navigate(`/products/${p.id}`)}>View &amp; Buy</button>
                      </div>
                    ))
                  ) : (
                    <div>
                      <div style={s.name}>{group.farmerName || 'Farm location'}</div>
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          </React.Fragment>
        );
      })}
    </>
  );
}

function MapView({ products = [], center, onFarmerClick, userLocation }) {
  const dark = useDarkTheme();
  const groups = groupByFarmer(products);
  const mapCenter = center || (userLocation ? [userLocation.lat, userLocation.lng] : DEFAULT_CENTER);

  return (
    <div>
      <MapContainer center={mapCenter} zoom={5} style={{ height: 400, width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          className={dark ? 'map-tiles-dark' : undefined}
          style={dark ? { filter: DARK_TILE_FILTER } : undefined}
        />
        {center && <RecenterMap center={center} />}
        {userLocation && (
          <Circle
            center={[userLocation.lat, userLocation.lng]}
            radius={200}
            pathOptions={{ color: '#2d6a4f', fillColor: '#2d6a4f', fillOpacity: 0.2 }}
          />
        )}
        <ClusterLayer groups={groups} onFarmerClick={onFarmerClick} />
      </MapContainer>
      <div style={s.srOnly} aria-live="polite">
        {groups.length > 0 && (
          <ul>
            {groups.map((g) => {
              const name = g.farmerName ?? g.products[0]?.farmer_name ?? 'Farm';
              const address = g.products[0]?.farmer_farm_address;
              const distance = formatDistance(g.products[0]?.distance_km);
              return (
                <li key={clusterItemKey(g)}>
                  Farm: {name}
                  {address ? `, ${address}` : ''}
                  {distance ? `, ${distance}` : ''}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default MapView;
