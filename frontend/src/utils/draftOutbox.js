import { api } from '../api/client';
import { toast } from './toast';
import i18n from '../i18n';

// IndexedDB-backed product draft autosave + offline outbox (FE-24).
const DB_NAME = 'fm-offline';
const DB_VERSION = 1;
const DRAFTS = 'drafts';
const OUTBOX = 'outbox';
const CURRENT_DRAFT = 'add-product';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS);
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export const saveDraft = (form) => tx(DRAFTS, 'readwrite', (s) => s.put({ form, savedAt: Date.now() }, CURRENT_DRAFT)).catch(() => {});
export const loadDraft = () => tx(DRAFTS, 'readonly', (s) => s.get(CURRENT_DRAFT)).then((r) => r?.form ?? null).catch(() => null);
export const clearDraft = () => tx(DRAFTS, 'readwrite', (s) => s.delete(CURRENT_DRAFT)).catch(() => {});

export const queueProduct = (body) => tx(OUTBOX, 'readwrite', (s) => s.add({ body, queuedAt: Date.now() }));
const listOutbox = () => tx(OUTBOX, 'readonly', (s) => s.getAll()).catch(() => []);
const removeOutbox = (id) => tx(OUTBOX, 'readwrite', (s) => s.delete(id));

let flushing = false;
/** Submits every queued draft; each success or failure gets its own toast. */
export async function flushOutbox() {
  if (flushing || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
  flushing = true;
  try {
    const items = await listOutbox();
    for (const item of items) {
      try {
        await api.createProduct(item.body);
        await removeOutbox(item.id);
        toast.success(i18n.t('offline.publishedQueued', { name: item.body.name }));
      } catch (e) {
        // Client errors will never succeed, so drop them instead of retrying forever.
        if (e.status >= 400 && e.status < 500) await removeOutbox(item.id);
        toast.error(i18n.t('offline.publishFailed', { name: item.body.name, error: e.message }));
      }
    }
  } finally {
    flushing = false;
  }
}

export function startOutboxSync() {
  if (typeof window === 'undefined') return undefined;
  const onOnline = () => { flushOutbox(); };
  window.addEventListener('online', onOnline);
  flushOutbox();
  return () => window.removeEventListener('online', onOnline);
}
