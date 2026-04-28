import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';

const mockProduct = {
  id: 1, name: 'Tomatoes', price: 5, unit: 'kg', quantity: 10,
  description: 'Fresh', farmer_name: 'Bob', farmer_id: 2,
  image_url: null, avg_rating: 0, review_count: 0,
  min_order_quantity: 1, pricing_model: 'fixed', pricing_type: 'unit',
};

let mockImages = [];

vi.mock('../api/client', () => ({
  api: {
    getProduct: vi.fn().mockImplementation(() => Promise.resolve({ data: mockProduct })),
    getProductImages: vi.fn().mockImplementation(() => Promise.resolve({ data: mockImages })),
    getProductReviews: vi.fn().mockResolvedValue({ data: [] }),
    getProductTiers: vi.fn().mockResolvedValue({ data: [] }),
    getPriceHistory: vi.fn().mockResolvedValue({ data: [] }),
    getProductShareMeta: vi.fn().mockResolvedValue({ data: null }),
    getCalendar: vi.fn().mockResolvedValue({ data: [] }),
    getMyAlert: vi.fn().mockResolvedValue({ subscribed: false }),
    getFeePreview: vi.fn().mockResolvedValue({ feePercent: 0, feeAmount: 0, farmerAmount: 5 }),
  },
}));

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../context/FavoritesContext', () => ({ useFavorites: () => ({ isFavorited: () => false, toggleFavorite: vi.fn() }) }));
vi.mock('../utils/useXlmRate', () => ({ useXlmRate: () => ({ usd: () => null }) }));
vi.mock('../components/MapView', () => ({ default: () => <div>Map</div> }));
vi.mock('../components/ShareButtons', () => ({ default: () => null }));
vi.mock('../components/PriceHistoryChart', () => ({ default: () => null }));
vi.mock('../hooks/useReviewForm', () => ({ useReviewForm: () => ({ handleReviewSubmit: vi.fn(), reviewRating: 0, setReviewRating: vi.fn(), reviewComment: '', setReviewComment: vi.fn(), reviewError: '', reviewLoading: false, reviewSuccess: null, reviewOrderId: null, setReviewOrderId: vi.fn() }) }));
vi.mock('../hooks/usePaymentLink', () => ({ usePaymentLink: () => ({ paymentLinkData: null, paymentLinkLoading: false, paymentLinkError: '', generatePaymentLink: vi.fn(), setPaymentLinkError: vi.fn() }) }));
vi.mock('../utils/stellarErrors', () => ({ getStellarErrorMessage: () => null }));
vi.mock('../utils/errorMessages', () => ({ getErrorMessage: (e) => e?.message || 'Error' }));

// Stub EventSource
global.EventSource = class { constructor() {} close() {} set onmessage(_) {} };

import ProductDetail from '../pages/ProductDetail';

function renderProductDetail() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/product/1']}>
        <Routes>
          <Route path="/product/:id" element={<ProductDetail />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>
  );
}

describe('#420 ProductDetail image gallery', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows placeholder emoji when product has 0 images and no image_url', async () => {
    mockImages = [];
    renderProductDetail();
    await waitFor(() => expect(screen.getByText('Tomatoes')).toBeInTheDocument());
    // Emoji placeholder rendered (🥬)
    expect(document.body.textContent).toContain('🥬');
    // No broken img with undefined src
    const imgs = document.querySelectorAll('img[src="undefined"]');
    expect(imgs.length).toBe(0);
  });

  it('shows single image without nav buttons when product has 1 image', async () => {
    mockImages = [{ id: 1, url: 'http://example.com/img1.jpg' }];
    renderProductDetail();
    await waitFor(() => expect(screen.getByText('Tomatoes')).toBeInTheDocument());
    expect(screen.queryByLabelText(/previous image/i)).toBeNull();
    expect(screen.queryByLabelText(/next image/i)).toBeNull();
    expect(document.querySelector('img[src="http://example.com/img1.jpg"]')).not.toBeNull();
  });

  it('shows gallery with nav buttons when product has 3 images', async () => {
    mockImages = [
      { id: 1, url: 'http://example.com/img1.jpg' },
      { id: 2, url: 'http://example.com/img2.jpg' },
      { id: 3, url: 'http://example.com/img3.jpg' },
    ];
    renderProductDetail();
    await waitFor(() => expect(screen.getByText('Tomatoes')).toBeInTheDocument());
    expect(screen.getByLabelText(/previous image/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/next image/i)).toBeInTheDocument();
  });
});
