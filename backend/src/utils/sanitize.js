const sanitizeHtml = require('sanitize-html');

// Strip all HTML tags — returns plain text only.
// Use this before storing any user-generated text in the DB.
function sanitizeText(value) {
  if (typeof value !== 'string') return value;
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim();
}

module.exports = { sanitizeText };
