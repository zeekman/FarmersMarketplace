const RECENTLY_VIEWED_KEY = 'recently_viewed';
const MAX_ITEMS = 10;

export function addRecentlyViewed(product) {
  const list = getRecentlyViewed();
  const filtered = list.filter(p => p.id !== product.id);
  const updated = [{ id: product.id, name: product.name, image_url: product.image_url || product.image, price: product.price }, ...filtered].slice(0, MAX_ITEMS);
  localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(updated));
}

export function getRecentlyViewed() {
  try {
    const data = localStorage.getItem(RECENTLY_VIEWED_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function clearRecentlyViewed() {
  localStorage.removeItem(RECENTLY_VIEWED_KEY);
}
