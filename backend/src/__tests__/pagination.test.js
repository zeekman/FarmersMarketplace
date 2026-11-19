const { parsePagination } = require('../utils/pagination');

describe('parsePagination', () => {
  test('returns defaults', () => {
    expect(parsePagination({ query: {} })).toEqual({ page: 1, limit: 20, offset: 0 });
  });

  test('bounds hostile and oversized values', () => {
    expect(parsePagination({ query: { page: '-2', limit: '9999' } })).toEqual({ page: 1, limit: 100, offset: 0 });
  });

  test('calculates a stable offset', () => {
    expect(parsePagination({ query: { page: '3', limit: '25' } })).toEqual({ page: 3, limit: 25, offset: 50 });
  });
});
