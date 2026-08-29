import { describe, it, expect } from 'vitest';
import { buildSrcSet } from '../utils/imageUtils';

describe('buildSrcSet', () => {
  it('returns undefined for falsy input', () => {
    expect(buildSrcSet('')).toBeUndefined();
    expect(buildSrcSet(null)).toBeUndefined();
  });

  it('generates Cloudinary transforms for upload URLs', () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/sample.jpg';
    const result = buildSrcSet(url);
    expect(result).toContain('w_200,q_auto,f_auto');
    expect(result).toContain('w_400,q_auto,f_auto');
    expect(result).toContain('w_800,q_auto,f_auto');
    expect(result).toContain('200w');
    expect(result).toContain('400w');
    expect(result).toContain('800w');
  });

  it('generates query-param srcset for generic URLs', () => {
    const url = 'https://example.com/images/tomato.jpg';
    const result = buildSrcSet(url);
    expect(result).toContain('?w=200 200w');
    expect(result).toContain('?w=400 400w');
    expect(result).toContain('?w=800 800w');
  });

  it('strips existing query params before appending width', () => {
    const url = 'https://example.com/img.jpg?foo=bar';
    const result = buildSrcSet(url);
    expect(result).toContain('https://example.com/img.jpg?w=200 200w');
  });
});
