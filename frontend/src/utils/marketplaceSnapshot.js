/**
 * Lightweight back-navigation snapshot for the Marketplace page.
 *
 * Only identifiers and view state are persisted — never the product payloads —
 * so the snapshot stays tiny and prices / stock / flash-sale state are always
 * refetched from the API on restore. Every storage access is guarded because
 * `sessionStorage` can throw (QuotaExceededError, SecurityError in private
 * modes or sandboxed iframes).
 */

export const SNAPSHOT_KEY = 'marketplace_scroll';
export const SNAPSHOT_TTL_MS = 2 * 60 * 1000;

function getStorage() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function safeRead() {
  try {
    const raw = getStorage()?.getItem(SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeWrite(value) {
  try {
    getStorage()?.setItem(SNAPSHOT_KEY, JSON.stringify(value));
    return true;
  } catch {
    // Quota exceeded or storage unavailable — back-navigation restore is a
    // nicety, so drop the snapshot rather than breaking the page.
    clearSnapshot();
    return false;
  }
}

/**
 * Persist the current listing state.
 * @param {{ ids: Array<string|number>, startPage: number, page: number, filters: object, scrollY?: number }} state
 */
export function saveSnapshot({ ids, startPage = 1, page, filters, scrollY }) {
  const previous = safeRead();
  return safeWrite({
    ids: Array.isArray(ids) ? ids : [],
    startPage,
    page,
    filters,
    scrollY: typeof scrollY === 'number' ? scrollY : previous?.scrollY ?? 0,
    savedAt: Date.now(),
  });
}

/** Update only the scroll position of an existing snapshot. */
export function saveScrollPosition(scrollY) {
  const previous = safeRead();
  if (!previous) return false;
  return safeWrite({ ...previous, scrollY, savedAt: Date.now() });
}

/**
 * Returns the saved snapshot if it exists, is well-formed and younger than
 * the TTL. Stale or malformed snapshots are cleared and `null` is returned so
 * the caller falls back to a fresh load.
 */
export function readSnapshot(now = Date.now()) {
  const snap = safeRead();
  if (!snap) return null;
  const valid =
    typeof snap.savedAt === 'number' &&
    Number.isInteger(snap.page) && snap.page >= 1 &&
    snap.filters && typeof snap.filters === 'object';
  if (!valid || now - snap.savedAt > SNAPSHOT_TTL_MS) {
    clearSnapshot();
    return null;
  }
  return {
    ...snap,
    startPage: Number.isInteger(snap.startPage) && snap.startPage >= 1 ? snap.startPage : 1,
    scrollY: Number(snap.scrollY) || 0,
  };
}

export function clearSnapshot() {
  try {
    const storage = getStorage();
    storage?.removeItem(SNAPSHOT_KEY);
    // Legacy key from the previous implementation that stored scroll separately.
    storage?.removeItem(`${SNAPSHOT_KEY}_y`);
  } catch {
    /* storage unavailable */
  }
}
