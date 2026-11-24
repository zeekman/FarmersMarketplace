import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api/client';
import { getErrorMessage } from '../utils/errorMessages';
import { toast } from '../utils/toast';

const LOW_STOCK_THRESHOLD = Number(import.meta.env.VITE_LOW_STOCK_THRESHOLD || 5);

/**
 * useDashboardData: Custom hook to manage dashboard data loading and polling
 * Centralizes API calls for products, sales, profile, bundles, and cooperatives
 * Enables better code reuse between Dashboard and other components
 */
export function useDashboardData(userId) {
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [profile, setProfile] = useState({
    bio: '',
    location: '',
    avatar_url: '',
    federation_name: '',
    latitude: '',
    longitude: '',
    farm_address: '',
  });
  const [bundles, setBundles] = useState([]);
  const [cooperatives, setCooperatives] = useState([]);
  const [harvestBatches, setHarvestBatches] = useState([]);
  const [forecastByProduct, setForecastByProduct] = useState({});
  const [waitlistAnalytics, setWaitlistAnalytics] = useState([]);
  const [bundleDiscounts, setBundleDiscounts] = useState([]);
  const [pendingTxs, setPendingTxs] = useState([]);
  const [earnings, setEarnings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const productsRef = useRef([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        productsRes,
        salesRes,
        profileRes,
        bundlesRes,
        coopsRes,
        batchesRes,
        forecastRes,
      ] = await Promise.all([
        api.getMyProducts().catch(() => ({ data: [] })),
        api.getSales().catch(() => ({ data: [] })),
        userId ? api.getFarmer(userId).catch(() => ({})) : Promise.resolve({}),
        api.getBundles().catch(() => ({ data: [] })),
        api.getCooperatives().catch(() => ({ data: [] })),
        api.getHarvestBatches().catch(() => ({ data: [] })),
        api.getForecast().catch(() => ({ data: [] })),
      ]);

      const productsData = productsRes.data ?? productsRes;
      const salesData = salesRes.data ?? salesRes;
      const bundlesData = (bundlesRes.data ?? []).filter((b) => b.farmer_id === userId);
      const coopsData = coopsRes.data ?? [];
      const batchesData = batchesRes?.data ?? [];

      setProducts(productsData);
      setSales(salesData);
      setBundles(bundlesData);
      setHarvestBatches(batchesData);
      setCooperatives(coopsData);
      productsRef.current = productsData;

      // Process forecast
      const forecastMap = {};
      (forecastRes.data ?? []).forEach((item) => {
        forecastMap[item.product_id] = item;
      });
      setForecastByProduct(forecastMap);

      // Waitlist analytics
      const waitlistRes = await api.getWaitlistAnalytics().catch(() => ({ data: [] }));
      setWaitlistAnalytics(waitlistRes.data ?? []);

      // Pending multisig transactions
      const allPending = await Promise.all(
        coopsData.map((c) =>
          api
            .getPendingTxs(c.id)
            .then((r) => (r.data ?? []).map((t) => ({ ...t, coopName: c.name })))
            .catch(() => [])
        )
      );
      setPendingTxs(allPending.flat().filter((t) => t.status === 'pending' && !t.alreadySigned));

      // Bundle discounts
      const bdRes = await api.getBundleDiscounts().catch(() => ({ data: [] }));
      setBundleDiscounts(bdRes.data ?? []);

      // Profile
      if (profileRes.data) {
        const d = profileRes.data;
        setProfile({
          bio: d.bio || '',
          location: d.location || '',
          avatar_url: d.avatar_url || '',
          federation_name: d.federation_name || '',
          latitude: d.latitude ?? '',
          longitude: d.longitude ?? '',
          farm_address: d.farm_address || '',
        });
      }

      // Creator earnings
      if (typeof api.getCreatorEarnings === 'function') {
        api.getCreatorEarnings()
          .then((res) => setEarnings(res.data ?? res))
          .catch(() => {});
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Initial load
  useEffect(() => {
    load();
  }, [userId, load]);

  // Update productsRef whenever products change
  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  // Low stock polling
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await api.getMyProducts();
        const latestProducts = res.data ?? res;
        const previousProducts = productsRef.current;

        latestProducts.forEach((latest) => {
          const prev = previousProducts.find((p) => p.id === latest.id);
          const latestQty = Number(latest.quantity ?? 0);
          const prevQty = prev ? Number(prev.quantity ?? 0) : LOW_STOCK_THRESHOLD + 1;

          if (prev && latestQty <= LOW_STOCK_THRESHOLD && prevQty > LOW_STOCK_THRESHOLD) {
            toast.warning(`Low stock: ${latest.name} has only ${latestQty} left.`, { duration: 8000 });
          }
        });

        setProducts(latestProducts);
      } catch {
        // ignore polling failures
      }
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  return {
    // State
    products,
    sales,
    profile,
    bundles,
    cooperatives,
    harvestBatches,
    forecastByProduct,
    waitlistAnalytics,
    bundleDiscounts,
    pendingTxs,
    earnings,
    loading,
    error,

    // Actions
    setProducts,
    setSales,
    setProfile,
    setBundles,
    setCooperatives,
    setHarvestBatches,
    setForecastByProduct,
    setWaitlistAnalytics,
    setBundleDiscounts,
    setPendingTxs,
    setEarnings,
    load,

    // Refs
    productsRef,
  };
}
