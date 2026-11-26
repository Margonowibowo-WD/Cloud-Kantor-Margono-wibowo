import type { DriveItem, TelegramConfigState } from '../types/drive';
import { replaceAllDriveItemsIdb, wipeIndexedCatalog } from './indexedCatalog';
import type { CloudViewPrefs } from './telegramIndex';

const ITEMS_KEY = 'teledrive_items_v2';
const TG_CONFIG_KEY = 'teledrive_tg_config_v2';
const DISMISSED_TG_MSGS_KEY = 'teledrive_dismissed_tg_msgs_v1';
const TOMBSTONES_KEY = 'teledrive_tombstones_v1';
const VIEW_PREFS_KEY = 'teledrive_view_prefs_v1';
const LOCAL_VAULT_KEY = 'teledrive_encrypted_vault_v1';
const SHARD_CACHE_KEY = 'teledrive_shard_cache_v1';
const OBSOLETE_MIDS_KEY = 'teledrive_obsolete_mids_v1';
const OFFLINE_PINS_KEY = 'teledrive_offline_pins_v1';
const OFFLINE_QUEUE_KEY = 'teledrive_offline_queue_v1';
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

export interface OfflineUploadJob {
  taskId: string;
  itemId: string;
  parentId: string | null;
  blobKey: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: number;
}

export function loadOfflinePinnedItemIds(): string[] {
  try {
    const raw = localStorage.getItem(OFFLINE_PINS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string' && Boolean(x)) : [];
  } catch {
    return [];
  }
}

export function saveOfflinePinnedItemIds(ids: string[]): string[] {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  try {
    if (unique.length === 0) {
      localStorage.removeItem(OFFLINE_PINS_KEY);
    } else {
      localStorage.setItem(OFFLINE_PINS_KEY, JSON.stringify(unique));
    }
  } catch {
    // ignore storage errors
  }
  return unique;
}

export function loadOfflineUploadQueue(): OfflineUploadJob[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OfflineUploadJob[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (j) => Boolean(j && typeof j.taskId === 'string' && typeof j.blobKey === 'string' && typeof j.filename === 'string'),
    );
  } catch {
    return [];
  }
}

export function saveOfflineUploadQueue(jobs: OfflineUploadJob[]): void {
  try {
    if (jobs.length === 0) {
      localStorage.removeItem(OFFLINE_QUEUE_KEY);
    } else {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(jobs));
    }
  } catch {
    // ignore
  }
}

export function enqueueOfflineUploadJobs(newJobs: OfflineUploadJob[]): OfflineUploadJob[] {
  if (newJobs.length === 0) return loadOfflineUploadQueue();
  const current = loadOfflineUploadQueue();
  const existingTaskIds = new Set(current.map((j) => j.taskId));
  const merged = [...current];
  for (const job of newJobs) {
    if (!existingTaskIds.has(job.taskId)) {
      merged.push(job);
      existingTaskIds.add(job.taskId);
    }
  }
  saveOfflineUploadQueue(merged);
  return merged;
}

export function removeOfflineUploadJob(taskId: string): OfflineUploadJob[] {
  const next = loadOfflineUploadQueue().filter((j) => j.taskId !== taskId);
  saveOfflineUploadQueue(next);
  return next;
}

export function getProtectedOfflineBlobKeys(): Set<string> {
  const protectedKeys = new Set<string>();
  for (const id of loadOfflinePinnedItemIds()) {
    protectedKeys.add(`blob-${id}`);
  }
  for (const job of loadOfflineUploadQueue()) {
    if (job.blobKey) protectedKeys.add(job.blobKey);
  }
  return protectedKeys;
}

export function planBlobCacheEviction(
  manifest: Record<string, BlobCacheEntryMeta>,
  protectedKey: string,
  maxBytes = MAX_LOCAL_BLOB_CACHE_BYTES,
  extraProtectedKeys?: Set<string>,
): { keysToEvict: string[]; nextManifest: Record<string, BlobCacheEntryMeta>; totalBytesAfter: number } {
  const nextManifest: Record<string, BlobCacheEntryMeta> = { ...manifest };
  let totalBytes = Object.values(nextManifest).reduce((acc, m) => acc + (m.size || 0), 0);
  const keysToEvict: string[] = [];

  if (totalBytes <= maxBytes) {
    return { keysToEvict, nextManifest, totalBytesAfter: totalBytes };
  }

  const candidates = Object.entries(nextManifest)
    .filter(([k]) => k !== protectedKey && !extraProtectedKeys?.has(k))
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
    const plan = planBlobCacheEviction(
      manifest,
      key,
      MAX_LOCAL_BLOB_CACHE_BYTES,
      getProtectedOfflineBlobKeys(),
    );
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

export async function hasLocalBlob(key: string): Promise<boolean> {
  try {
    const db = await openBlobDb();
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).count(key);
      req.onsuccess = () => resolve((req.result || 0) > 0);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
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
  void replaceAllDriveItemsIdb(items);
  try {
    // Keep localStorage fast-paint seed only when dataset is small (< ~2,500 items);
    // larger libraries live safely in IndexedDB without hitting the 5 MB localStorage ceiling.
    if (items.length > 2500) {
      localStorage.removeItem(ITEMS_KEY);
      return;
    }
    const serialized = JSON.stringify(items);
    if (serialized.length > 1_500_000) {
      localStorage.removeItem(ITEMS_KEY);
      return;
    }
    localStorage.setItem(ITEMS_KEY, serialized);
  } catch {
    try {
      localStorage.removeItem(ITEMS_KEY);
    } catch {
      // ignore storage quota errors
    }
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

export function loadDeletedTombstones(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TOMBSTONES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && typeof v === 'string') {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveDeletedTombstones(tombstones: Record<string, string>): void {
  try {
    const entries = Object.entries(tombstones);
    entries.sort(([, a], [, b]) => Date.parse(b) - Date.parse(a));
    localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, 500))));
  } catch {
    // ignore
  }
}

export function addDeletedTombstones(
  ids: string[],
  deletedAtIso = new Date().toISOString(),
): Record<string, string> {
  const current = loadDeletedTombstones();
  for (const id of ids) {
    if (id) current[id] = deletedAtIso;
  }
  saveDeletedTombstones(current);
  return current;
}

export function loadLocalEncryptedVault(): string {
  try {
    return (localStorage.getItem(LOCAL_VAULT_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function saveLocalEncryptedVault(vaultCode: string): void {
  try {
    localStorage.setItem(LOCAL_VAULT_KEY, vaultCode.trim());
  } catch {
    // ignore storage errors
  }
}

export function clearLocalEncryptedVault(): void {
  try {
    localStorage.removeItem(LOCAL_VAULT_KEY);
  } catch {
    // ignore
  }
}

export function isSessionOnlyLogin(): boolean {
  try {
    return Boolean(sessionStorage.getItem(TG_CONFIG_KEY));
  } catch {
    return false;
  }
}

const ENV_CORS_PROXY_URL = ((import.meta.env?.VITE_CORS_PROXY_URL as string | undefined) || '').trim() || undefined;

export function loadStoredTelegramConfig(): TelegramConfigState {
  try {
    const raw = sessionStorage.getItem(TG_CONFIG_KEY) || localStorage.getItem(TG_CONFIG_KEY);
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
        corsProxyUrl: parsed.corsProxyUrl || loadStoredViewPrefs().px || ENV_CORS_PROXY_URL,
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
    corsProxyUrl: ENV_CORS_PROXY_URL,
  };
}

export function saveStoredTelegramConfig(
  cfg: TelegramConfigState,
  sessionOnly?: boolean,
): void {
  try {
    if (!cfg.connected || !cfg.botToken || !cfg.chatId) {
      sessionStorage.removeItem(TG_CONFIG_KEY);
      localStorage.removeItem(TG_CONFIG_KEY);
      return;
    }
    const useSession = sessionOnly ?? isSessionOnlyLogin();
    const serialized = JSON.stringify(cfg);
    if (useSession) {
      sessionStorage.setItem(TG_CONFIG_KEY, serialized);
      localStorage.removeItem(TG_CONFIG_KEY);
    } else {
      localStorage.setItem(TG_CONFIG_KEY, serialized);
      sessionStorage.removeItem(TG_CONFIG_KEY);
    }
  } catch {
    // ignore
  }
}

export function wipeUnlockedSessionData(options?: { clearLocalVault?: boolean }): void {
  void wipeIndexedCatalog();
  try {
    sessionStorage.removeItem(TG_CONFIG_KEY);
    localStorage.removeItem(TG_CONFIG_KEY);
    localStorage.removeItem(ITEMS_KEY);
    localStorage.removeItem(TOMBSTONES_KEY);
    localStorage.removeItem(DISMISSED_TG_MSGS_KEY);
    localStorage.removeItem(VIEW_PREFS_KEY);
    localStorage.removeItem(SHARD_CACHE_KEY);
    localStorage.removeItem(OBSOLETE_MIDS_KEY);
    localStorage.removeItem(OFFLINE_PINS_KEY);
    localStorage.removeItem(OFFLINE_QUEUE_KEY);
    if (options?.clearLocalVault) {
      localStorage.removeItem(LOCAL_VAULT_KEY);
    }
  } catch {
    // ignore
  }
}

export function loadStoredViewPrefs(): CloudViewPrefs {
  try {
    const raw = localStorage.getItem(VIEW_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CloudViewPrefs;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveStoredViewPrefs(prefs: CloudViewPrefs): void {
  try {
    localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export interface ObsoleteTelegramMsg {
  mid: number;
  label: string;
  recordedAt: string;
  lastError?: string;
}

export function loadObsoleteTelegramMsgs(): ObsoleteTelegramMsg[] {
  try {
    const raw = localStorage.getItem(OBSOLETE_MIDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ObsoleteTelegramMsg[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m) => m && typeof m.mid === 'number' && m.mid > 0);
  } catch {
    return [];
  }
}

export function saveObsoleteTelegramMsgs(list: ObsoleteTelegramMsg[]): void {
  try {
    const dedup = new Map<number, ObsoleteTelegramMsg>();
    for (const item of list) {
      if (item && typeof item.mid === 'number' && item.mid > 0) {
        dedup.set(item.mid, item);
      }
    }
    const sorted = Array.from(dedup.values())
      .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))
      .slice(0, 400);
    if (sorted.length === 0) {
      localStorage.removeItem(OBSOLETE_MIDS_KEY);
    } else {
      localStorage.setItem(OBSOLETE_MIDS_KEY, JSON.stringify(sorted));
    }
  } catch {
    // ignore
  }
}

export function addObsoleteTelegramMsgs(items: ObsoleteTelegramMsg[]): ObsoleteTelegramMsg[] {
  if (items.length === 0) return loadObsoleteTelegramMsgs();
  const map = new Map<number, ObsoleteTelegramMsg>();
  for (const prev of loadObsoleteTelegramMsgs()) {
    map.set(prev.mid, prev);
  }
  for (const next of items) {
    if (next && typeof next.mid === 'number' && next.mid > 0) {
      map.set(next.mid, next);
    }
  }
  const merged = Array.from(map.values());
  saveObsoleteTelegramMsgs(merged);
  return loadObsoleteTelegramMsgs();
}

