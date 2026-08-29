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
      {clusters.map((item, i) => {
        if (item.type === 'cluster') {
          return (
            <Marker
              key={`cluster-${i}`}
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
        return (
          <React.Fragment key={`pin-${i}`}>
            <Marker
              position={[group.lat, group.lng]}
              eventHandlers={onFarmerClick ? {
                click: () => onFarmerClick(group.farmerName ?? group.products[0]?.farmer_name),
              } : {}}
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
                      <div style={s.farmer}>🌾 {group.farmerName || 'Farmer'}</div>
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
            {group.products.map(p => {
              if (!p.delivery_radius || p.origin_lat == null || p.origin_lng == null) return null;
              const radiusKm = p.delivery_radius > 1000 ? p.delivery_radius / 1000 : p.delivery_radius;
              return (
                <Circle
                  key={`geo-${p.id}`}
                  center={[p.origin_lat, p.origin_lng]}
                  radius={radiusKm * 1000}
                  pathOptions={{ color: '#2d6a4f', weight: 2, opacity: 0.5, fillColor: '#d8f3dc', fillOpacity: 0.1 }}
                />
              );
            })}
          </React.Fragment>
        );
      })}
    </>
  );
}

// Custom icon for the user's current location marker
const userIcon = L.divIcon({
  className: '',
  html: '<div style="background:#2d6a4f;border:3px solid #fff;border-radius:50%;width:16px;height:16px;box-shadow:0 0 0 3px rgba(45,106,79,0.4)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

// User-facing copy for each way browser geolocation can fail to resolve.
const GEO_FALLBACK_MESSAGES = {
  unsupported: "Your browser doesn't support location services. Showing the default view — you can still search or browse by category.",
  denied: "Location access is turned off, so we can't show distance to nearby farmers. Enable location access in your browser settings to use this feature, or continue browsing without it.",
  timeout: "We couldn't get your location in time. Showing the default view — try again or continue browsing.",
};

/**
 * MapView renders product pins on a Leaflet map.
 *
 * Props:
 *  products      - array of product objects with farmer_lat/farmer_lng
 *  lat, lng      - single fixed location to show (e.g. one farmer's profile); skips clustering
 *  farmerName    - label for the single-location pin
 *  onFarmerClick - callback(farmerName) when a pin is clicked
 *  userLat       - buyer's latitude (from "Near me" geolocation)
 *  userLng       - buyer's longitude
 *  radius        - search radius in km; renders a shaded circle when userLat/userLng are set
 */
export default function MapView({ products = [], lat, lng, farmerName, onFarmerClick, userLat, userLng, radius }) {
  const hasSingleLocation = lat != null && lng != null;
  const groups = hasSingleLocation
    ? [{ lat, lng, farmerName, products: [] }]
    : groupByFarmer(products);
  const [center, setCenter] = useState(null);
  const [toast, setToast] = useState('');
  const [geoStatus, setGeoStatus] = useState(null); // null | 'denied' | 'unsupported' | 'timeout'

  const hasUserLocation = userLat != null && userLng != null;

  const requestBrowserLocation = () => {
    if (!navigator.geolocation) {
      setGeoStatus('unsupported');
      setCenter(DEFAULT_CENTER);
      return;
    }
    setGeoStatus(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoStatus(null);
        setCenter([pos.coords.latitude, pos.coords.longitude]);
      },
      (err) => {
        if (err.code === 1) {
          setGeoStatus('denied');
          setToast('Location access denied. Showing default location.');
          setTimeout(() => setToast(''), 4000);
        } else if (err.code === 3) {
          setGeoStatus('timeout');
        }
        setCenter(DEFAULT_CENTER);
      },
      { timeout: 8000 }
    );
  };

  useEffect(() => {
    // If the parent already has a location to center on (buyer's "Near me"
    // location, or a single farmer's fixed location), use it directly and
    // skip this component's own geolocation request.
    if (hasUserLocation) {
      setCenter([userLat, userLng]);
      return;
    }
    if (hasSingleLocation) {
      setCenter([lat, lng]);
      return;
    }
    requestBrowserLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUserLocation, userLat, userLng, hasSingleLocation, lat, lng]);

  if (groups.length === 0 && !hasUserLocation) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: '#888' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🗺️</div>
        <div>No products with location data yet.</div>
        <div style={{ fontSize: 13, marginTop: 6 }}>Farmers can add their location in profile settings.</div>
      </div>
    );
  }

  const avgLat = groups.length > 0
    ? groups.reduce((sum, g) => sum + g.lat, 0) / groups.length
    : (userLat ?? 0);
  const avgLng = groups.length > 0
    ? groups.reduce((sum, g) => sum + g.lng, 0) / groups.length
    : (userLng ?? 0);
  const mapCenter = center ?? [avgLat, avgLng];
  const geoFallbackMessage = geoStatus ? GEO_FALLBACK_MESSAGES[geoStatus] : null;

  return (
    <div style={{ position: 'relative' }}>
      {toast && <div style={s.toast} role="status">{toast}</div>}
      {geoFallbackMessage && (
        <div style={s.geoFallback} data-testid="geo-fallback">
          <span>📍 {geoFallbackMessage}</span>
          <button type="button" style={s.geoFallbackBtn} onClick={requestBrowserLocation}>
            Try again
          </button>
        </div>
      )}
      <MapContainer
        center={[avgLat, avgLng]}
        zoom={7}
        style={{ height: 520, width: '100%', borderRadius: 12, zIndex: 0 }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {center && <RecenterMap center={mapCenter} />}
        <ClusterLayer groups={groups} onFarmerClick={onFarmerClick} />

        {/* User location marker + radius circle */}
        {hasUserLocation && (
          <>
            <Marker position={[userLat, userLng]} icon={userIcon}>
              <Popup>
                <div style={s.popup}>
                  <div style={{ ...s.name, color: '#2d6a4f' }}>📍 Your location</div>
                  {radius && (
                    <div style={{ fontSize: 12, color: '#888' }}>Showing farms within {radius} km</div>
                  )}
                </div>
              </Popup>
            </Marker>
            {radius && Number(radius) > 0 && (
              <Circle
                center={[userLat, userLng]}
                radius={Number(radius) * 1000}
                pathOptions={{
                  color: '#2d6a4f',
                  weight: 2,
                  opacity: 0.6,
                  fillColor: '#d8f3dc',
                  fillOpacity: 0.15,
                }}
              />
            )}
          </>
        )}
      </MapContainer>
    </div>
  );
}
