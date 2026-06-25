import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock react-leaflet and leaflet to avoid DOM/canvas issues in jsdom
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  Marker: ({ children, position }) => (
    <div data-testid="marker" data-lat={position?.[0]} data-lng={position?.[1]}>
      {children}
    </div>
  ),
  Popup: ({ children }) => <div>{children}</div>,
  Circle: ({ center, radius, pathOptions }) => (
    <div
      data-testid="radius-circle"
      data-center-lat={center?.[0]}
      data-center-lng={center?.[1]}
      data-radius={radius}
      data-fill={pathOptions?.fillColor}
    />
  ),
  useMap: () => ({ setView: vi.fn(), getZoom: () => 7 }),
}));
vi.mock('leaflet', () => ({
  default: {
    Icon: { Default: { prototype: {}, mergeOptions: vi.fn() } },
    divIcon: vi.fn(() => ({})),
  },
  Icon: { Default: { prototype: {}, mergeOptions: vi.fn() } },
  divIcon: vi.fn(() => ({})),
}));
vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

import MapView from '../components/MapView';

const products = [
  {
    id: 1,
    name: 'Apples',
    price: '2',
    unit: 'kg',
    farmer_name: 'Bob',
    farmer_lat: 1.0,
    farmer_lng: 1.0,
  },
];

describe('MapView geolocation error handling', () => {
  let originalGeo;

  beforeEach(() => { originalGeo = navigator.geolocation; });
  afterEach(() => {
    Object.defineProperty(navigator, 'geolocation', { value: originalGeo, configurable: true });
  });

  it('shows toast and renders map when geolocation is denied (code 1)', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: (_success, error) => error({ code: 1, message: 'User denied' }),
      },
      configurable: true,
    });
    render(<MapView products={products} />);
    expect(await screen.findByText('Location access denied. Showing default location.')).toBeInTheDocument();
    expect(screen.getByTestId('map')).toBeInTheDocument();
  });

  it('does not show toast on success', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: (success) => success({ coords: { latitude: 10, longitude: 20 } }),
      },
      configurable: true,
    });
    render(<MapView products={products} />);
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });
});

describe('MapView radius circle (geo-filter)', () => {
  it('renders a Circle when userLat, userLng, and radius are provided', () => {
    render(
      <MapView
        products={products}
        userLat={51.5}
        userLng={-0.1}
        radius={50}
      />
    );
    const circle = screen.getByTestId('radius-circle');
    expect(circle).toBeInTheDocument();
    // radius prop to Leaflet Circle is in metres (50 km = 50000 m)
    expect(circle.getAttribute('data-radius')).toBe('50000');
    expect(circle.getAttribute('data-center-lat')).toBe('51.5');
    expect(circle.getAttribute('data-center-lng')).toBe('-0.1');
    expect(circle.getAttribute('data-fill')).toBe('#d8f3dc');
  });

  it('does not render a Circle when no userLat/userLng', () => {
    render(<MapView products={products} />);
    expect(screen.queryByTestId('radius-circle')).toBeNull();
  });

  it('does not render a Circle when radius is 0', () => {
    render(
      <MapView
        products={products}
        userLat={51.5}
        userLng={-0.1}
        radius={0}
      />
    );
    expect(screen.queryByTestId('radius-circle')).toBeNull();
  });

  it('renders user location marker when userLat/userLng provided', () => {
    render(
      <MapView
        products={products}
        userLat={48.8}
        userLng={2.35}
        radius={25}
      />
    );
    const markers = screen.getAllByTestId('marker');
    const userMarker = markers.find(
      (m) => m.getAttribute('data-lat') === '48.8' && m.getAttribute('data-lng') === '2.35'
    );
    expect(userMarker).toBeTruthy();
  });

  it('shows radius in km in user marker popup when radius is provided', () => {
    render(
      <MapView
        products={products}
        userLat={51.5}
        userLng={-0.1}
        radius={75}
      />
    );
    expect(screen.getByText(/75 km/)).toBeInTheDocument();
  });
});
