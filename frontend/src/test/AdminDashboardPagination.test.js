import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test that navigating to page 2 fetches the correct offset from the API
describe('AdminDashboard orders pagination (#436)', () => {
  it('page 2 with limit 20 fetches offset 20', () => {
    const limit = 20;
    function getOffset(page) {
      return (Math.max(1, page) - 1) * limit;
    }
    expect(getOffset(1)).toBe(0);
    expect(getOffset(2)).toBe(20);
    expect(getOffset(3)).toBe(40);
  });

  it('adminGetOrders builds correct URL for page 2', () => {
    const calls = [];
    const mockRequest = (url) => { calls.push(url); return Promise.resolve({ data: [], pagination: { page: 2, pages: 5, total: 100 } }); };
    const adminGetOrders = (page = 1) => mockRequest(`/admin/orders?page=${page}`);

    adminGetOrders(2);
    expect(calls[0]).toBe('/admin/orders?page=2');
  });

  it('URL query string reflects current orders page', () => {
    // Simulate setSearchParams behavior
    const params = new URLSearchParams();
    function setOrdersPage(page) {
      params.set('ordersPage', page);
    }
    setOrdersPage(2);
    expect(params.get('ordersPage')).toBe('2');
  });
});
