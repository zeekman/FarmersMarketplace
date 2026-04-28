import { describe, it, expect } from 'vitest';
import { isValidEmail } from '../utils/validation';

describe('utils/validation.js (#443)', () => {
  describe('isValidEmail', () => {
    // Valid RFC 5321 addresses
    it('accepts simple email addresses', () => {
      expect(isValidEmail('user@example.com')).toBe(true);
    });

    it('accepts emails with subdomains', () => {
      expect(isValidEmail('user@mail.example.co.uk')).toBe(true);
      expect(isValidEmail('user@sub.domain.example.com')).toBe(true);
    });

    it('accepts emails with plus-addressing', () => {
      expect(isValidEmail('user+tag@example.com')).toBe(true);
      expect(isValidEmail('user+spam@mail.example.co.uk')).toBe(true);
    });

    it('accepts emails with dots in local part', () => {
      expect(isValidEmail('first.last@example.com')).toBe(true);
    });

    it('accepts emails with special characters in local part', () => {
      expect(isValidEmail('user.name+tag-123@example.com')).toBe(true);
      expect(isValidEmail('user_name@example.com')).toBe(true);
    });

    it('accepts emails with numeric domains', () => {
      expect(isValidEmail('user@123example.com')).toBe(true);
    });

    it('accepts emails with short TLDs', () => {
      expect(isValidEmail('user@example.io')).toBe(true);
    });

    it('accepts emails with long TLDs', () => {
      expect(isValidEmail('user@example.technology')).toBe(true);
    });

    // Invalid addresses
    it('rejects emails without @ symbol', () => {
      expect(isValidEmail('userexample.com')).toBe(false);
    });

    it('rejects emails without TLD', () => {
      expect(isValidEmail('user@example')).toBe(false);
    });

    it('rejects emails with consecutive dots', () => {
      expect(isValidEmail('user@example..com')).toBe(false);
    });

    it('rejects emails with leading dot in domain', () => {
      expect(isValidEmail('user@.example.com')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidEmail('')).toBe(false);
    });

    it('rejects emails with spaces', () => {
      expect(isValidEmail('user @example.com')).toBe(false);
      expect(isValidEmail('user@ example.com')).toBe(false);
    });

    it('rejects emails missing local part', () => {
      expect(isValidEmail('@example.com')).toBe(false);
    });
  });
});
