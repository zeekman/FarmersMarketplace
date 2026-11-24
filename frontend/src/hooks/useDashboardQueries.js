import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { queryKeys } from '../lib/queryClient';
import { toast } from '../utils/toast';
import { getErrorMessage } from '../utils/errorMessages';

/**
 * Query hooks for Dashboard with React Query.
 * Replaces manual load() functions with cached queries, optimistic updates, and automatic invalidation.
 */

// ============= QUERIES =============

export function useMyProducts(options = {}) {
  return useQuery({
    queryKey: queryKeys.products.mine,
    queryFn: () => api.getMyProducts({ silent: true }),
    ...options,
  });
}

export function useMySales(page = 1, options = {}) {
  return useQuery({
    queryKey: queryKeys.sales.byPage(page),
    queryFn: () => api.getOrders({ role: 'farmer', page, silent: true }),
    ...options,
  });
}

export function useHarvestBatches(options = {}) {
  return useQuery({
    queryKey: queryKeys.harvestBatches,
    queryFn: () => api.getHarvestBatches({ silent: true }),
    ...options,
  });
}

export function useBundles(options = {}) {
  return useQuery({
    queryKey: queryKeys.bundles,
    queryFn: () => api.getBundles({ silent: true }),
    ...options,
  });
}

export function useBundleDiscounts(options = {}) {
  return useQuery({
    queryKey: queryKeys.bundleDiscounts,
    queryFn: () => api.getBundleDiscounts({ silent: true }),
    ...options,
  });
}

export function useFarmerProfile(options = {}) {
  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: () => api.getFarmerProfile({ silent: true }),
    ...options,
  });
}

// ============= MUTATIONS =============

/**
 * Update product with optimistic update and rollback on error.
 */
export function useUpdateProduct() {
  const qc = useQueryClient();
  
  return useMutation({
    mutationFn: ({ productId, updates }) => api.updateProduct(productId, updates),
    onMutate: async ({ productId, updates }) => {
      // Cancel outgoing refetches
      await qc.cancelQueries({ queryKey: queryKeys.products.mine });
      
      // Snapshot previous value
      const previous = qc.getQueryData(queryKeys.products.mine);
      
      // Optimistically update
      qc.setQueryData(queryKeys.products.mine, (old) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((p) =>
            p.id === productId ? { ...p, ...updates } : p
          ),
        };
      });
      
      return { previous };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previous) {
        qc.setQueryData(queryKeys.products.mine, context.previous);
      }
      toast.error(getErrorMessage(err));
    },
    onSuccess: () => {
      toast.success('Product updated');
    },
    onSettled: () => {
      // Always refetch after error or success
      qc.invalidateQueries({ queryKey: queryKeys.products.mine });
    },
  });
}

/**
 * Delete product with optimistic update.
 */
export function useDeleteProduct() {
  const qc = useQueryClient();
  
  return useMutation({
    mutationFn: (productId) => api.deleteProduct(productId),
    onMutate: async (productId) => {
      await qc.cancelQueries({ queryKey: queryKeys.products.mine });
      const previous = qc.getQueryData(queryKeys.products.mine);
      
      // Optimistically remove
      qc.setQueryData(queryKeys.products.mine, (old) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.filter((p) => p.id !== productId),
        };
      });
      
      return { previous };
    },
    onError: (err, variables, context) => {
      if (context?.previous) {
        qc.setQueryData(queryKeys.products.mine, context.previous);
      }
      toast.error(getErrorMessage(err));
    },
    onSuccess: () => {
      toast.success('Product deleted');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.products.mine });
    },
  });
}

/**
 * Update order status (farmer changes order status).
 */
export function useUpdateOrderStatus() {
  const qc = useQueryClient();
  
  return useMutation({
    mutationFn: ({ orderId, status }) => api.updateOrderStatus(orderId, { status }),
    onSuccess: () => {
      // Invalidate all sales pages
      qc.invalidateQueries({ queryKey: queryKeys.sales.all });
      toast.success('Order status updated');
    },
    onError: (err) => {
      toast.error(getErrorMessage(err));
    },
  });
}

/**
 * Restock product with optimistic update.
 */
export function useRestockProduct() {
  const qc = useQueryClient();
  
  return useMutation({
    mutationFn: ({ productId, quantity }) => api.restockProduct(productId, { quantity }),
    onMutate: async ({ productId, quantity }) => {
      await qc.cancelQueries({ queryKey: queryKeys.products.mine });
      const previous = qc.getQueryData(queryKeys.products.mine);
      
      // Optimistically update quantity
      qc.setQueryData(queryKeys.products.mine, (old) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((p) =>
            p.id === productId
              ? { ...p, quantity: (p.quantity || 0) + quantity }
              : p
          ),
        };
      });
      
      return { previous };
    },
    onError: (err, variables, context) => {
      if (context?.previous) {
        qc.setQueryData(queryKeys.products.mine, context.previous);
      }
      toast.error(getErrorMessage(err));
    },
    onSuccess: () => {
      toast.success('Stock updated');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.products.mine });
    },
  });
}

/**
 * Create new product.
 */
export function useCreateProduct() {
  const qc = useQueryClient();
  
  return useMutation({
    mutationFn: (productData) => api.createProduct(productData),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.products.mine });
      toast.success('Product created');
    },
    onError: (err) => {
      toast.error(getErrorMessage(err));
    },
  });
}

/**
 * Invalidate queries after SSE order event.
 * Call this when receiving an order update via Server-Sent Events.
 */
export function useInvalidateSalesOnSSE() {
  const qc = useQueryClient();
  
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.sales.all });
  };
}
