import { describe, it, expect } from 'vitest';
import { validatePassword } from '../utils/validation';

/**
 * Mirrors the canSubmit logic in PasswordChangeForm:
 * strong password + current filled + passwords match → enabled.
 */
function canSubmit(current, newPw, confirm) {
  const issues = validatePassword(newPw);
  const isStrong = newPw.length > 0 && issues.length === 0;
  return isStrong && current.length > 0 && newPw === confirm;
}

describe('Settings password change form strength (#429)', () => {
  it('disables submit for a weak password (too short)', () => {
    expect(canSubmit('old', 'abc', 'abc')).toBe(false);
  });

  it('disables submit when password has no uppercase', () => {
    expect(canSubmit('old', 'password1', 'password1')).toBe(false);
  });

  it('disables submit when password has no number', () => {
    expect(canSubmit('old', 'Password', 'Password')).toBe(false);
  });

  it('disables submit when passwords do not match', () => {
    expect(canSubmit('old', 'Password1', 'Password2')).toBe(false);
  });

  it('disables submit when current password is empty', () => {
    expect(canSubmit('', 'Password1', 'Password1')).toBe(false);
  });

  it('enables submit for a strong password that meets all requirements', () => {
    expect(canSubmit('old', 'Password1', 'Password1')).toBe(true);
  });

  it('enables submit for another valid strong password', () => {
    expect(canSubmit('myOldPw', 'Secure99pass', 'Secure99pass')).toBe(true);
  });
});
