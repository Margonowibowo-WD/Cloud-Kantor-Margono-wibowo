import type { DriveItem, TelegramConfigState } from '../types/drive';

const ITEMS_KEY = 'teledrive_items_v2';
const TG_CONFIG_KEY = 'teledrive_tg_config_v2';
const DISMISSED_TG_MSGS_KEY = 'teledrive_dismissed_tg_msgs_v1';
const IDB_NAME = 'TeleDriveBlobVault';
const IDB_STORE = 'blobs';

const LEGACY_DEMO_IDS = new Set([
  'folder-desain',
  'folder-dokumen',
  'folder-arsip',
  'file-studio-img',
  'file-speaker-img',
  'file-mountain-img',
  'file-panduan-txt',
  'file-roadmap-md',
  'file-config-json',
  'file-brief-md',
  'file-benchmark-csv',
]);

function openBlobDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const BLOB_LRU_KEY = 'teledrive_blob_lru_v1';
export const MAX_LOCAL_BLOB_CACHE_BYTES = 350 * 1024 * 1024; // 350 MB local preview cache cap

export interface BlobCacheEntryMeta {
  size: number;
  lastAccessedAt: number;
}

export function planBlobCacheEviction(
  manifest: Record<string, BlobCacheEntryMeta>,
  protectedKey: string,
  maxBytes = MAX_LOCAL_BLOB_CACHE_BYTES,
): { keysToEvict: string[]; nextManifest: Record<string, BlobCacheEntryMeta>; totalBytesAfter: number } {
  const nextManifest: Record<string, BlobCacheEntryMeta> = { ...manifest };
  let totalBytes = Object.values(nextManifest).reduce((acc, m) => acc + (m.size || 0), 0);
  const keysToEvict: string[] = [];

  if (totalBytes <= maxBytes) {
    return { keysToEvict, nextManifest, totalBytesAfter: totalBytes };
  }

  const candidates = Object.entries(nextManifest)
    .filter(([k]) => k !== protectedKey)
    .sort(([, a], [, b]) => a.lastAccessedAt - b.lastAccessedAt);

  for (const [key, meta] of candidates) {
    if (totalBytes <= maxBytes) break;
    keysToEvict.push(key);
    totalBytes = Math.max(0, totalBytes - (meta.size || 0));
    delete nextManifest[key];
  }

  return { keysToEvict, nextManifest, totalBytesAfter: totalBytes };
}

function loadBlobLruManifest(): Record<string, BlobCacheEntryMeta> {
  try {
    const raw = localStorage.getItem(BLOB_LRU_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, BlobCacheEntryMeta>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveBlobLruManifest(manifest: Record<string, BlobCacheEntryMeta>): void {
  try {
    localStorage.setItem(BLOB_LRU_KEY, JSON.stringify(manifest));
  } catch {
    // ignore quota error
  }
}

export function getLocalBlobCacheStats(): { fileCount: number; totalBytes: number; maxBytes: number } {
  const manifest = loadBlobLruManifest();
  const entries = Object.values(manifest);
  return {
    fileCount: entries.length,
    totalBytes: entries.reduce((acc, m) => acc + (m.size || 0), 0),
    maxBytes: MAX_LOCAL_BLOB_CACHE_BYTES,
  };
}

export async function saveLocalBlob(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openBlobDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    const manifest = loadBlobLruManifest();
    manifest[key] = { size: blob.size, lastAccessedAt: Date.now() };
    const plan = planBlobCacheEviction(manifest, key, MAX_LOCAL_BLOB_CACHE_BYTES);
    saveBlobLruManifest(plan.nextManifest);

    if (plan.keysToEvict.length > 0) {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        for (const evictKey of plan.keysToEvict) {
          store.delete(evictKey);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
  } catch {
    // IndexedDB unavailable
  }
}

export async function getLocalBlob(key: string): Promise<Blob | null> {
  try {
    const db = await openBlobDb();
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as Blob) || null);
      req.onerror = () => reject(req.error);
    });
    if (blob) {
      const manifest = loadBlobLruManifest();
      manifest[key] = { size: blob.size, lastAccessedAt: Date.now() };
      saveBlobLruManifest(manifest);
    }
    return blob;
  } catch {
    return null;
  }
}

export async function deleteLocalBlob(key: string): Promise<void> {
  try {
    const db = await openBlobDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const manifest = loadBlobLruManifest();
    if (key in manifest) {
      delete manifest[key];
      saveBlobLruManifest(manifest);
    }
  } catch {
    // ignore
  }
}

export function loadStoredItems(): DriveItem[] {
  try {
    const raw = localStorage.getItem(ITEMS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as DriveItem[];
    if (!Array.isArray(parsed)) return [];

    // Cloud-only cleanup: drop legacy demo items and local-only files
    const cloudOnly = parsed
      .filter((item) => {
        if (LEGACY_DEMO_IDS.has(item.id)) return false;
        if (item.type === 'file' && item.storageBackend !== 'telegram') return false;
        return true;
      })
      .map((item) =>
        item.type === 'folder' && item.storageBackend !== 'telegram'
          ? { ...item, storageBackend: 'telegram' as const }
          : item,
      );

    if (cloudOnly.length !== parsed.length) {
      saveStoredItems(cloudOnly);
    }
    return cloudOnly;
  } catch {
    return [];
  }
}

export function saveStoredItems(items: DriveItem[]): void {
  try {
    localStorage.setItem(ITEMS_KEY, JSON.stringify(items));
  } catch {
    // ignore storage quota errors
  }
}

export function loadDismissedTelegramMessageIds(): Set<number> {
  try {
    const raw = localStorage.getItem(DISMISSED_TG_MSGS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as number[];
    return Array.isArray(parsed) ? new Set(parsed.filter((n) => typeof n === 'number')) : new Set();
  } catch {
    return new Set();
  }
}

export function addDismissedTelegramMessageIds(messageIds: number[]): void {
  if (messageIds.length === 0) return;
  try {
    const current = loadDismissedTelegramMessageIds();
    for (const id of messageIds) current.add(id);
    const trimmed = Array.from(current).slice(-500);
    localStorage.setItem(DISMISSED_TG_MSGS_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore
  }
}

export function loadStoredTelegramConfig(): TelegramConfigState {
  try {
    const raw = localStorage.getItem(TG_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TelegramConfigState>;
      return {
        connected: Boolean(parsed.connected && parsed.botToken && parsed.chatId),
        botToken: parsed.botToken || '',
        chatId: parsed.chatId || '',
        botUsername: parsed.botUsername,
        botName: parsed.botName,
        chatTitle: parsed.chatTitle,
        chatType: parsed.chatType,
        autoSync: parsed.autoSync ?? true,
        pinnedIndexMessageId: parsed.pinnedIndexMessageId,
        lastSyncedAt: parsed.lastSyncedAt,
      };
    }
  } catch {
    // fall through
  }

  return {
    connected: false,
    botToken: '',
    chatId: '',
    autoSync: true,
  };
}

export function saveStoredTelegramConfig(cfg: TelegramConfigState): void {
  try {
    localStorage.setItem(TG_CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    // ignore
  }
}
