import { QueryClient } from '@tanstack/react-query';

// Shared server-state cache (FE-22). Background refetches go through
// `silent` API calls so they never trigger LoadingContext's global spinner.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

export const queryKeys = {
  wallet: ['wallet'],
  currentUser: ['currentUser'],
  categories: ['categories'],
  rates: ['rates', 'xlm-usd'],
  favorites: ['favorites'],
  unreadCount: ['notifications', 'unreadCount'],
  orders: ['orders'],
  products: {
    all: ['products'],
    mine: ['products', 'mine'],
    detail: (id) => ['products', 'detail', id],
    images: (id) => ['products', id, 'images'],
    tiers: (id) => ['products', id, 'tiers'],
    reviews: (id) => ['products', id, 'reviews'],
  },
  sales: {
    all: ['orders', 'sales'],
    byPage: (page) => ['orders', 'sales', page],
  },
  harvestBatches: ['harvestBatches'],
  bundles: ['bundles'],
  bundleDiscounts: ['bundleDiscounts'],
  coupons: ['coupons'],
  profile: ['profile'],
};
