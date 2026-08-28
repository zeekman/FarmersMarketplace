/**
 * Unit tests for sanitize utility (issue #1157)
 * Tests HTML sanitization and text cleaning
 */

const { sanitizeText } = require('../utils/sanitize');

describe('sanitizeText', () => {
  test('strips HTML tags', async () => {
    const input = '<p>Hello <strong>world</strong></p>';
    const result = sanitizeText(input);

    expect(result).toBe('Hello world');
  });

  test('removes script tags and content', async () => {
    const input = 'Safe text <script>alert("XSS")</script> more text';
    const result = sanitizeText(input);

    expect(result).toBe('Safe text  more text');
  });

  test('handles nested HTML tags', async () => {
    const input = '<div><span><b>Bold</b> and <i>italic</i></span></div>';
    const result = sanitizeText(input);

    expect(result).toBe('Bold and italic');
  });

  test('preserves legitimate punctuation', async () => {
    const input = 'Price: $5.99! Special chars: & < > "quotes"';
    const result = sanitizeText(input);

    expect(result).toBe('Price: $5.99! Special chars: &amp; &lt; &gt; "quotes"');
  });

  test('preserves Unicode characters', async () => {
    const input = 'Café ☕ émojis 🌟 中文';
    const result = sanitizeText(input);

    expect(result).toBe('Café ☕ émojis 🌟 中文');
  });

  test('handles empty string', async () => {
    const result = sanitizeText('');

    expect(result).toBe('');
  });

  test('handles string with only whitespace', async () => {
    const result = sanitizeText('   \n  \t  ');

    expect(result).toBe('');
  });

  test('trims leading and trailing whitespace', async () => {
    const input = '  Hello world  ';
    const result = sanitizeText(input);

    expect(result).toBe('Hello world');
  });

  test('removes HTML event handlers', async () => {
    const input = '<div onclick="malicious()">Click me</div>';
    const result = sanitizeText(input);

    expect(result).toBe('Click me');
  });

  test('removes inline styles', async () => {
    const input = '<span style="color:red">Red text</span>';
    const result = sanitizeText(input);

    expect(result).toBe('Red text');
  });

  test('handles self-closing tags', async () => {
    const input = 'Line 1<br/>Line 2<hr/>Line 3';
    const result = sanitizeText(input);

    expect(result).toBe('Line 1Line 2Line 3');
  });

  test('handles mixed content', async () => {
    const input = 'Product description: 5 < 10 items available. <b>Order now!</b>';
    const result = sanitizeText(input);

    expect(result).toBe('Product description: 5 &lt; 10 items available. Order now!');
  });

  test('handles malformed HTML gracefully', async () => {
    const input = '<div>Unclosed <span>tags<div>nested</span>';
    const result = sanitizeText(input);

    expect(result).toBe('Unclosed tagsnested');
  });

  test('returns non-string values unchanged', async () => {
    expect(sanitizeText(null)).toBeNull();
    expect(sanitizeText(undefined)).toBeUndefined();
    expect(sanitizeText(123)).toBe(123);
    expect(sanitizeText(true)).toBe(true);
  });

  test('handles very long strings', async () => {
    const longString = '<p>' + 'a'.repeat(10000) + '</p>';
    const result = sanitizeText(longString);

    expect(result).toBe('a'.repeat(10000));
    expect(result.length).toBe(10000);
  });

  test('handles multiple consecutive spaces', async () => {
    const input = 'Multiple    spaces    preserved';
    const result = sanitizeText(input);

    expect(result).toBe('Multiple    spaces    preserved');
  });

  test('removes comments', async () => {
    const input = 'Text <!-- comment --> more text';
    const result = sanitizeText(input);

    expect(result).toBe('Text  more text');
  });

  test('handles HTML entities', async () => {
    const input = '&lt;div&gt; &amp; &quot;';
    const result = sanitizeText(input);

    expect(result).toBe('&lt;div&gt; &amp; "');
  });
});
