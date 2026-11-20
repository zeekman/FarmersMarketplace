import React, { useEffect, useState, useRef, lazy, Suspense } from 'react';

const MapView = lazy(() => import('./MapView'));

/**
 * Lazy-loads MapView when it scrolls into view (intersection observer with 200px margin).
 * Avoids loading Leaflet until the user scrolls near the map section.
 */
export default function LazyMapView(props) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ minHeight: 300 }}>
      {visible && (
        <Suspense
          fallback={
            <div
              style={{
                height: 300,
                background: '#f0faf4',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#888',
              }}
            >
              Loading map…
            </div>
          }
        >
          <MapView {...props} />
        </Suspense>
      )}
    </div>
  );
}
