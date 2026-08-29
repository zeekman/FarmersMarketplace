const mockRows = new Map();
jest.mock('../db/schema', () => ({ query: jest.fn(async (sql, params) => {
  const key = params[0];
  if (sql.startsWith('SELECT')) return { rows: mockRows.has(key) ? [mockRows.get(key)] : [] };
  if (sql.startsWith('DELETE')) mockRows.delete(key);
  else mockRows.set(key, { response: params[1], expires_at: params[2] });
  return { rows: [] };
}) }));
const { getCachedResponse, cacheResponse } = require('../utils/idempotency');

describe('idempotency cache', () => {
  beforeEach(() => mockRows.clear());

  it('returns the exact stored response and null on a miss', async () => {
    const response = { orderId: 7, success: true };
    await cacheResponse('hit', response, 60);
    await expect(getCachedResponse('hit')).resolves.toEqual(response);
    await expect(getCachedResponse('miss')).resolves.toBeNull();
  });

  it('expires entries at their intended TTL', async () => {
    await cacheResponse('old', { success: true }, -1);
    await expect(getCachedResponse('old')).resolves.toBeNull();
    expect(mockRows.has('old')).toBe(false);
  });

  it('concurrent same-key writes upsert one cache entry, guarding retry races', async () => {
    await Promise.all([cacheResponse('same', { id: 1 }, 60), cacheResponse('same', { id: 1 }, 60)]);
    expect(mockRows.size).toBe(1);
    const results = await Promise.all([getCachedResponse('same'), getCachedResponse('same')]);
    expect(results).toEqual([{ id: 1 }, { id: 1 }]);
  });
});
