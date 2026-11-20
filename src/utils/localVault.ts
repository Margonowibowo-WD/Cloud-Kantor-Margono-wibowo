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

export async function saveLocalBlob(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openBlobDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // IndexedDB unavailable
  }
}

export async function getLocalBlob(key: string): Promise<Blob | null> {
  try {
    const db = await openBlobDb();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as Blob) || null);
      req.onerror = () => reject(req.error);
    });
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
