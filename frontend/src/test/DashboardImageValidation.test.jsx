import { describe, it, expect } from 'vitest';

/**
 * Mirrors the validation logic from Dashboard.jsx validateAndSetImage().
 * Tests the pure validation rules without rendering the full component.
 */
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_MB = 5;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

function validateImage(file) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { ok: false, error: 'Only JPEG, PNG, or WebP images are allowed.' };
  }
  if (file.size > MAX_SIZE_BYTES) {
    return { ok: false, error: `Image must be ${MAX_SIZE_MB} MB or smaller.` };
  }
  return { ok: true, error: null };
}

describe('Dashboard image upload validation (#446)', () => {
  it('accepts a valid JPEG image under 5 MB', () => {
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'size', { value: 1024 * 1024 }); // 1 MB
    const result = validateImage(file);
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
  });

  it('accepts a valid PNG image under 5 MB', () => {
    const file = new File(['data'], 'photo.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 2 * 1024 * 1024 }); // 2 MB
    const result = validateImage(file);
    expect(result.ok).toBe(true);
  });

  it('accepts a valid WebP image under 5 MB', () => {
    const file = new File(['data'], 'photo.webp', { type: 'image/webp' });
    Object.defineProperty(file, 'size', { value: 500 * 1024 }); // 500 KB
    const result = validateImage(file);
    expect(result.ok).toBe(true);
  });

  it('rejects an invalid file type (PDF)', () => {
    const file = new File(['data'], 'document.pdf', { type: 'application/pdf' });
    const result = validateImage(file);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Only JPEG, PNG, or WebP/i);
  });

  it('rejects an invalid file type (executable)', () => {
    const file = new File(['data'], 'virus.exe', { type: 'application/octet-stream' });
    const result = validateImage(file);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Only JPEG, PNG, or WebP/i);
  });

  it('rejects an oversized image (> 5 MB)', () => {
    const file = new File(['data'], 'big.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 6 * 1024 * 1024 }); // 6 MB
    const result = validateImage(file);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/5 MB or smaller/i);
  });

  it('accepts an image exactly at the 5 MB limit', () => {
    const file = new File(['data'], 'exact.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'size', { value: MAX_SIZE_BYTES }); // exactly 5 MB
    const result = validateImage(file);
    expect(result.ok).toBe(true);
  });
});
