/**
 * Returns a srcset string for a product image URL.
 * Supports Cloudinary-style transformations (w_NNN in URL) and
 * plain image URLs (appends ?w=NNN as a hint for CDN/proxy).
 *
 * Widths: 200w (thumbnail), 400w (card), 800w (carousel/full)
 */
export function buildSrcSet(url) {
  if (!url) return undefined;
  // If the URL already contains Cloudinary transform params (upload/)
  if (url.includes('/upload/')) {
    return [
      url.replace('/upload/', '/upload/w_200,q_auto,f_auto/') + ' 200w',
      url.replace('/upload/', '/upload/w_400,q_auto,f_auto/') + ' 400w',
      url.replace('/upload/', '/upload/w_800,q_auto,f_auto/') + ' 800w',
    ].join(', ');
  }
  // Generic fallback: append width query param
  const base = url.split('?')[0];
  return [
    `${base}?w=200 200w`,
    `${base}?w=400 400w`,
    `${base}?w=800 800w`,
  ].join(', ');
}
