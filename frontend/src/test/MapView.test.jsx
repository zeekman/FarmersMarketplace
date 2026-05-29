import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock react-leaflet and leaflet to avoid DOM/canvas issues in jsdom
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }) => <div>{children}</div>,
  Popup: ({ children }) => <div>{children}</div>,
  useMap: () => ({ setView: vi.fn(), getZoom: () => 7 }),
}));
vi.mock('leaflet', () => ({
  default: { Icon: { Default: { prototype: {}, mergeOptions: vi.fn() } } },
  Icon: { Default: { prototype: {}, mergeOptions: vi.fn() } },
}));
vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

import MapView from '../components/MapView';

const products = [{ id: 1, name: 'Apples', price: '2', unit: 'kg', farmer_name: 'Bob', farmer_lat: 1.0, farmer_lng: 1.0 }];

describe('MapView geolocation error handling (#439)', () => {
  let originalGeo;

  beforeEach(() => { originalGeo = navigator.geolocation; });
  afterEach(() => { Object.defineProperty(navigator, 'geolocation', { value: originalGeo, configurable: true }); });

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
