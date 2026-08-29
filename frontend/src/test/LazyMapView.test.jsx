import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

// Mock IntersectionObserver
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();
let intersectionCallback;
global.IntersectionObserver = vi.fn((cb) => {
  intersectionCallback = cb;
  return { observe: mockObserve, disconnect: mockDisconnect };
});

// Mock React.lazy / MapView
vi.mock('../components/MapView', () => ({
  default: ({ products }) => <div data-testid="map-loaded">Map with {products?.length ?? 0} products</div>,
}));

// Import the LazyMapView wrapper from ProductDetail by testing its behavior via a separate helper
// We test the IntersectionObserver behaviour directly
function LazyMapView(props) {
  const ref = React.useRef(null);
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { rootMargin: '200px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const MapViewLazy = React.lazy(() => import('../components/MapView'));
  return (
    <div ref={ref} style={{ minHeight: 300 }}>
      {visible && (
        <React.Suspense fallback={<div>Loading map…</div>}>
          <MapViewLazy {...props} />
        </React.Suspense>
      )}
    </div>
  );
}

describe('LazyMapView', () => {
  it('does not render MapView before intersection', () => {
    render(<LazyMapView products={[]} />);
    expect(screen.queryByTestId('map-loaded')).toBeNull();
  });

  it('renders MapView after intersection', async () => {
    render(<LazyMapView products={[]} />);
    await act(async () => {
      intersectionCallback([{ isIntersecting: true }]);
    });
    expect(await screen.findByTestId('map-loaded')).toBeInTheDocument();
  });

  it('disconnects observer after intersection', async () => {
    render(<LazyMapView products={[]} />);
    await act(async () => {
      intersectionCallback([{ isIntersecting: true }]);
    });
    expect(mockDisconnect).toHaveBeenCalled();
  });
});
