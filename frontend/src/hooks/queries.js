import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { queryKeys } from '../lib/queryClient';

// Every query passes { silent: true } where the client supports it so cached
// background refetches don't flash the global LoadingContext overlay.

export const useWalletBalance = (options) =>
  useQuery({ queryKey: queryKeys.wallet, queryFn: () => api.getWallet({ silent: true }), ...options });

export const useCurrentUser = (options) =>
  useQuery({ queryKey: queryKeys.currentUser, queryFn: () => api.getCurrentUser({ silent: true }), ...options });

export const useCategories = (options) =>
  useQuery({ queryKey: queryKeys.categories, queryFn: () => api.getCategories({ silent: true }), staleTime: 10 * 60_000, ...options });

export const useRates = (options) =>
  useQuery({ queryKey: queryKeys.rates, queryFn: () => api.getXlmRate({ silent: true }), staleTime: 60_000, ...options });

export const useFavoritesQuery = (options) =>
  useQuery({ queryKey: queryKeys.favorites, queryFn: () => api.getFavorites({}, { silent: true }), ...options });

export const useUnreadCount = (options) =>
  useQuery({ queryKey: queryKeys.unreadCount, queryFn: () => api.getUnreadMessageCount({ silent: true }), refetchInterval: 60_000, ...options });

/** Placing an order changes the buyer's balance and order list. */
export function usePlaceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }) => api.placeOrder(body, idempotencyKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.wallet });
      qc.invalidateQueries({ queryKey: queryKeys.orders });
    },
  });
}

export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, favorite }) => (favorite ? api.addFavorite(productId) : api.removeFavorite(productId)),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.favorites }),
  });
}

/** Unread notification count; the bell and the notifications page both read this key. */
export const useNotificationCount = (options) =>
  useQuery({
    queryKey: queryKeys.notificationCount,
    queryFn: () => api.getUnreadNotificationCount(),
    select: (res) => Number(res?.count ?? res?.data?.count ?? 0) || 0,
    ...options,
  });

/** Mark one notification (pass id) or all (no id) read. Optimistic; rolled back on error. */
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => (id == null ? api.markAllNotificationsRead() : api.markNotificationRead(id)),
    onMutate: async (id) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: queryKeys.notificationCount }),
        qc.cancelQueries({ queryKey: ['notificationList'] }),
      ]);
      const now = new Date().toISOString();
      const prevCount = qc.getQueryData(queryKeys.notificationCount);
      const prevLists = qc.getQueriesData({ queryKey: ['notificationList'] });
      const markItem = (n) => ((id == null || n.id === id) && !n.read_at ? { ...n, read_at: now } : n);
      qc.setQueriesData({ queryKey: ['notificationList'] }, (old) => old && {
        ...old,
        pages: old.pages.map((p) => ({ ...p, data: (p?.data || []).map(markItem) })),
      });
      if (id == null) qc.setQueryData(queryKeys.notificationCount, { count: 0 });
      return { prevCount, prevLists };
    },
    onError: (_err, _id, ctx) => {
      if (!ctx) return;
      qc.setQueryData(queryKeys.notificationCount, ctx.prevCount);
      ctx.prevLists.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.notificationCount });
      qc.invalidateQueries({ queryKey: ['notificationList'] });
    },
  });
}

/** Replaces the `messages:read` window event: mark-read callers invalidate the count. */
export function useInvalidateUnreadCount() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.unreadCount });
}
