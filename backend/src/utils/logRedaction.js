'use strict';

const SENSITIVE_KEY = /(password|passphrase|mnemonic|secret|private.?key|authorization|cookie|token|totp|backup.?code|recovery|seed|envelope|signature|webhook)/i;
const STELLAR_SECRET_SEED = /\bS[A-Z2-7]{55}\b/g;
const MNEMONIC_SEQUENCE = /\b(?:[a-z]{3,})(?:\s+[a-z]{3,}){11}(?:\s+[a-z]{3,})?(?:\s+[a-z]{3,})?(?:\s+[a-z]{3,})?(?:\s+[a-z]{3,})?(?:\s+[a-z]{3,})?(?:\s+[a-z]{3,})?(?:\s+[a-z]{3,})?(?:\s+[a-z]{3,})?(?:\s+[a-z]{3,})?(?:\s+[a-z]{3,})?(?:\s+[a-z]{3,})?\b/gi;
const SENSITIVE_TEXT = /(?:mnemonic|passphrase|private\s*key|secret\s*key|authorization|bearer|access\s*token|refresh\s*token|totp|backup\s*code|transaction\s*envelope)\s*[:=]/i;
const REDACTED = '[REDACTED]';

function redactString(value) {
  if (!value) return value;
  let redacted = String(value).replace(STELLAR_SECRET_SEED, REDACTED);
  redacted = redacted.replace(MNEMONIC_SEQUENCE, REDACTED);
  if (SENSITIVE_TEXT.test(redacted)) {
    redacted = redacted.replace(/(mnemonic|passphrase|private\s*key|secret\s*key|authorization|bearer|access\s*token|refresh\s*token|totp|backup\s*code|transaction\s*envelope)(\s*[:=]\s*)([^\s,;]+)/gi, '$1$2' + REDACTED);
  }
  return redacted;
}

function redactLogValue(value, key = '') {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (value instanceof Error) {
    return {
      name: redactString(value.name),
      message: redactString(value.message),
      stack: redactString(value.stack || ''),
    };
  }
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      redactLogValue(childValue, childKey),
    ]));
  }
  return value;
}

module.exports = { redactLogValue, redactString, REDACTED };
