/**
 * Unit tests for utils/cdn.js — image URL rewriting for CDN
 */

const { rewriteImageUrl } = require('../utils/cdn');

describe('cdn.js — rewriteImageUrl', () => {
  const originalEnv = process.env.CDN_URL;

  afterEach(() => {
    process.env.CDN_URL = originalEnv;
  });

  it('rewrites a relative /uploads/ path when CDN_URL is configured', () => {
    process.env.CDN_URL = 'https://cdn.example.com';
    expect(rewriteImageUrl('/uploads/product.jpg')).toBe('https://cdn.example.com/uploads/product.jpg');
  });

  it('strips trailing slash from CDN_URL to avoid double-slashing', () => {
    process.env.CDN_URL = 'https://cdn.example.com/';
    expect(rewriteImageUrl('/uploads/image.png')).toBe('https://cdn.example.com/uploads/image.png');
  });

  it('leaves an already-absolute http:// URL unchanged', () => {
    process.env.CDN_URL = 'https://cdn.example.com';
    const absolute = 'http://other-domain.com/image.jpg';
    expect(rewriteImageUrl(absolute)).toBe(absolute);
  });

  it('leaves an already-absolute https:// URL unchanged', () => {
    process.env.CDN_URL = 'https://cdn.example.com';
    const absolute = 'https://other-domain.com/image.jpg';
    expect(rewriteImageUrl(absolute)).toBe(absolute);
  });

  it('returns null when input is null', () => {
    process.env.CDN_URL = 'https://cdn.example.com';
    expect(rewriteImageUrl(null)).toBeNull();
  });

  it('returns undefined when input is undefined', () => {
    process.env.CDN_URL = 'https://cdn.example.com';
    expect(rewriteImageUrl(undefined)).toBeUndefined();
  });

  it('returns empty string unchanged when input is empty string', () => {
    process.env.CDN_URL = 'https://cdn.example.com';
    expect(rewriteImageUrl('')).toBe('');
  });

  it('returns the original URL unchanged when CDN_URL is not configured', () => {
    delete process.env.CDN_URL;
    expect(rewriteImageUrl('/uploads/product.jpg')).toBe('/uploads/product.jpg');
  });

  it('returns the original URL unchanged when CDN_URL is empty string', () => {
    process.env.CDN_URL = '';
    expect(rewriteImageUrl('/uploads/product.jpg')).toBe('/uploads/product.jpg');
  });

  it('handles relative paths without leading slash', () => {
    process.env.CDN_URL = 'https://cdn.example.com';
    expect(rewriteImageUrl('uploads/product.jpg')).toBe('https://cdn.example.com/uploads/product.jpg');
  });
});
