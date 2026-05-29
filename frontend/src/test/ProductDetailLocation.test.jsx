import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import ProductDetail from '../pages/ProductDetail';

if (typeof globalThis.EventSource === 'undefined') {
  globalThis.EventSource = class {
    constructor() {
      this.onmessage = null;
    }
    close() {}
  };
}

vi.mock('../api/client', () => ({
  api: {
    getProduct: vi.fn(),
    getProductReviews: vi.fn().mockResolvedValue({ data: [] }),
    getProductShareMeta: vi.fn().mockResolvedValue({ data: null }),
    getProductImages: vi.fn().mockResolvedValue({ data: [] }),
    getProductTiers: vi.fn().mockResolvedValue({ data: [] }),
    getPriceHistory: vi.fn().mockResolvedValue({ data: [] }),
    getCalendar: vi.fn().mockResolvedValue({ data: [] }),
    getAddresses: vi.fn().mockResolvedValue({ data: [] }),
    getMyAlert: vi.fn().mockResolvedValue({ subscribed: false }),
    getOrders: vi.fn().mockResolvedValue({ data: [] }),
    getWalletAssets: vi.fn().mockResolvedValue({ data: [] }),
    getFeePreview: vi.fn().mockResolvedValue(null),
    getXlmRate: vi.fn().mockResolvedValue({ usd: () => '' }),
    trackShareEvent: vi.fn(),
  },
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'buyer', username: 'testuser' } }),
}));

vi.mock('../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorited: () => false, toggleFavorite: vi.fn() }),
}));

vi.mock('../components/StarRating', () => ({ default: () => null }));
vi.mock('../components/Spinner', () => ({ default: () => <div data-testid="spinner">Loading...</div> }));
vi.mock('../components/FlashSaleCountdown', () => ({ default: () => null }));
vi.mock('../components/ShareButtons', () => ({ default: () => null }));
vi.mock('../components/PriceHistoryChart', () => ({ default: () => null }));
vi.mock('qrcode.react', () => ({ QRCode: () => null, default: () => null }));
vi.mock('../components/MapView', () => ({
  default: ({ lat, lng, farmerName }) => (
    <div data-testid="map-view" data-lat={lat} data-lng={lng} data-farmer-name={farmerName}>
      {lat != null && lng != null ? 'Map' : 'No map'}
    </div>
  ),
}));

import { api } from '../api/client';

function renderProductDetail(id = '1') {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[`/product/${id}`]}>
        <Routes>
          <Route path="/product/:id" element={<ProductDetail />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>
  );
}

describe('ProductDetail – farm location map', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getProductReviews.mockResolvedValue({ data: [] });
    api.getProductShareMeta.mockResolvedValue({ data: null });
    api.getProductImages.mockResolvedValue({ data: [] });
    api.getProductTiers.mockResolvedValue({ data: [] });
    api.getPriceHistory.mockResolvedValue({ data: [] });
    api.getCalendar.mockResolvedValue({ data: [] });
    api.getAddresses.mockResolvedValue({ data: [] });
    api.getMyAlert.mockResolvedValue({ subscribed: false });
    api.getOrders.mockResolvedValue({ data: [] });
    api.getWalletAssets.mockResolvedValue({ data: [] });
    api.getFeePreview.mockResolvedValue(null);
    api.getXlmRate.mockResolvedValue({ usd: () => '' });
  });

  it('renders the map when farm coordinates are provided', async () => {
    api.getProduct.mockResolvedValue({
      id: 1,
      name: 'Herbs',
      price: 3,
      unit: 'bundle',
      quantity: 8,
      farmer_name: 'Farmer Maria',
      description: 'Aromatic herbs',
      farm_lat: 34.123,
      farm_lng: -118.456,
    });

    renderProductDetail();

    await waitFor(() => expect(screen.getByText('Herbs')).toBeInTheDocument());
    const mapView = screen.getByTestId('map-view');

    expect(mapView).toBeInTheDocument();
    expect(mapView).toHaveAttribute('data-lat', '34.123');
    expect(mapView).toHaveAttribute('data-lng', '-118.456');
    expect(mapView).toHaveAttribute('data-farmer-name', 'Farmer Maria');
  });

  it('shows fallback text when farm coordinates are missing', async () => {
    api.getProduct.mockResolvedValue({
      id: 1,
      name: 'Herbs',
      price: 3,
      unit: 'bundle',
      quantity: 8,
      farmer_name: 'Farmer Maria',
      description: 'Aromatic herbs',
      farm_lat: null,
      farm_lng: null,
    });

    renderProductDetail();

    await waitFor(() => expect(screen.getByText('Herbs')).toBeInTheDocument());
    expect(screen.queryByTestId('map-view')).not.toBeInTheDocument();
    expect(screen.getByText('Location not provided')).toBeInTheDocument();
  });
});
