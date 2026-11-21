const { redactLogValue, REDACTED } = require('../utils/logRedaction');

describe('log redaction', () => {
  test('redacts Stellar secret seeds anywhere in nested values', () => {
    const value = redactLogValue({ nested: [{ secret: 'S' + 'A'.repeat(55) }] });
    expect(value.nested[0].secret).toBe(REDACTED);
  });

  test('redacts 12- and 24-word mnemonic-looking sequences', () => {
    const twelve = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima';
    const twentyFour = `${twelve} mike november oscar papa quebec romeo sierra tango uniform victor whiskey`;
    expect(redactLogValue({ message: twelve })).toEqual({ message: REDACTED });
    expect(redactLogValue({ message: twentyFour })).toEqual({ message: REDACTED });
  });

  test('redacts sensitive key names at any depth and error stacks', () => {
    const error = new Error('secret key=S' + 'A'.repeat(55));
    const result = redactLogValue({ outer: { private_key: 'do-not-log', error } });
    expect(result.outer.private_key).toBe(REDACTED);
    expect(result.outer.error.stack).not.toContain('S' + 'A'.repeat(55));
  });
});
