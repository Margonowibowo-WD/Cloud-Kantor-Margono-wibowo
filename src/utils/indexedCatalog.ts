import type { DriveItem } from '../types/drive';
import {
  type CatalogRecord,
  type TelegramV4Manifest,
  decodeGzipJson,
  encodeGzipJson,
  fromCatalogRecordStub,
  mergeDriveItems,
  toCatalogRecord,
} from './telegramIndex';

const CATALOG_DB_NAME = 'TeleDriveCatalogV4';
const CATALOG_DB_VERSION = 1;
const STORE_ITEMS = 'drive_items';
const STORE_CATALOG = 'catalog_entries';
const STORE_META = 'kv_meta';

const META_V4_MANIFEST = 'v4_manifest';
const META_LOADED_FOLDERS = 'loaded_folder_revs';
const META_DIRTY_FOLDERS = 'dirty_folder_ids';
const META_PENDING_DELTA_IDS = 'pending_delta_ids';
const META_DOC_CACHE_PREFIX = 'doc_cache:';

let cachedDbPromise: Promise<IDBDatabase> | null = null;

function openCatalogDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }
  if (!cachedDbPromise) {
    cachedDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(CATALOG_DB_NAME, CATALOG_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_ITEMS)) {
          db.createObjectStore(STORE_ITEMS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_CATALOG)) {
          db.createObjectStore(STORE_CATALOG, { keyPath: 'i' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        cachedDbPromise = null;
        reject(req.error);
      };
    });
  }
  return cachedDbPromise;
}

function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  return openCatalogDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
      }),
  );
}

function idbGetAll<T>(storeName: string): Promise<T[]> {
  return openCatalogDb().then(
    (db) =>
      new Promise<T[]>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve((req.result as T[]) || []);
        req.onerror = () => reject(req.error);
      }),
  );
}

function idbPutMeta(key: string, value: unknown): Promise<void> {
  return openCatalogDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_META, 'readwrite');
        tx.objectStore(STORE_META).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export async function replaceAllDriveItemsIdb(items: DriveItem[]): Promise<void> {
  try {
    const db = await openCatalogDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_ITEMS, 'readwrite');
      const store = tx.objectStore(STORE_ITEMS);
      store.clear();
      for (const item of items) {
        // Avoid persisting huge in-memory thumbnail data URLs duplicated unnecessarily; keep essential fields
        store.put(item);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore IndexedDB unavailable
  }
}

export async function upsertDriveItemsIdb(items: DriveItem[]): Promise<void> {
  if (items.length === 0) return;
  try {
    const db = await openCatalogDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_ITEMS, 'readwrite');
      const store = tx.objectStore(STORE_ITEMS);
      for (const item of items) {
        store.put(item);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

export async function deleteDriveItemsIdb(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const db = await openCatalogDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_ITEMS, STORE_CATALOG], 'readwrite');
      const itemStore = tx.objectStore(STORE_ITEMS);
      const catStore = tx.objectStore(STORE_CATALOG);
      for (const id of ids) {
        itemStore.delete(id);
        catStore.delete(id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

export async function replaceAllCatalogIdb(records: CatalogRecord[]): Promise<void> {
  try {
    const db = await openCatalogDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CATALOG, 'readwrite');
      const store = tx.objectStore(STORE_CATALOG);
      store.clear();
      for (const rec of records) {
        store.put(rec);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

export async function upsertCatalogRecordsIdb(records: CatalogRecord[]): Promise<void> {
  if (records.length === 0) return;
  try {
    const db = await openCatalogDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CATALOG, 'readwrite');
      const store = tx.objectStore(STORE_CATALOG);
      for (const rec of records) {
        store.put(rec);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

export async function loadIndexedCatalogState(): Promise<{
  items: DriveItem[];
  catalog: CatalogRecord[];
  v4Manifest?: TelegramV4Manifest;
  loadedFolderRevs: Record<string, string>;
  dirtyFolderIds: string[];
  pendingDeltaIds: string[];
}> {
  try {
    const [rawItems, catalog, v4Manifest, loadedFolderRevs, dirtyFolderIds, pendingDeltaIds] =
      await Promise.all([
        idbGetAll<DriveItem>(STORE_ITEMS),
        idbGetAll<CatalogRecord>(STORE_CATALOG),
        idbGet<TelegramV4Manifest>(STORE_META, META_V4_MANIFEST),
        idbGet<Record<string, string>>(STORE_META, META_LOADED_FOLDERS),
        idbGet<string[]>(STORE_META, META_DIRTY_FOLDERS),
        idbGet<string[]>(STORE_META, META_PENDING_DELTA_IDS),
      ]);

    let items = rawItems;
    if (catalog.length > 0) {
      const stubs = catalog.map(fromCatalogRecordStub);
      items = mergeDriveItems(stubs, rawItems);
    }

    return {
      items,
      catalog,
      v4Manifest,
      loadedFolderRevs: loadedFolderRevs || {},
      dirtyFolderIds: Array.isArray(dirtyFolderIds) ? dirtyFolderIds : [],
      pendingDeltaIds: Array.isArray(pendingDeltaIds) ? pendingDeltaIds : [],
    };
  } catch {
    return {
      items: [],
      catalog: [],
      loadedFolderRevs: {},
      dirtyFolderIds: [],
      pendingDeltaIds: [],
    };
  }
}

export async function saveV4ManifestIdb(manifest: TelegramV4Manifest | undefined): Promise<void> {
  try {
    if (!manifest) return;
    await idbPutMeta(META_V4_MANIFEST, manifest);
  } catch {
    // ignore
  }
}

export async function saveLoadedFolderRevsIdb(revs: Record<string, string>): Promise<void> {
  try {
    await idbPutMeta(META_LOADED_FOLDERS, revs);
  } catch {
    // ignore
  }
}

export async function saveDirtyTrackingIdb(
  dirtyFolderIds: string[],
  pendingDeltaIds: string[],
): Promise<void> {
  try {
    await Promise.all([
      idbPutMeta(META_DIRTY_FOLDERS, dirtyFolderIds),
      idbPutMeta(META_PENDING_DELTA_IDS, pendingDeltaIds),
    ]);
  } catch {
    // ignore
  }
}

export async function getCachedTelegramDocIdb<T>(cacheKey: string): Promise<T | undefined> {
  try {
    return await idbGet<T>(STORE_META, `${META_DOC_CACHE_PREFIX}${cacheKey}`);
  } catch {
    return undefined;
  }
}

export async function setCachedTelegramDocIdb(cacheKey: string, payload: unknown): Promise<void> {
  try {
    await idbPutMeta(`${META_DOC_CACHE_PREFIX}${cacheKey}`, payload);
  } catch {
    // ignore
  }
}

export async function wipeIndexedCatalog(): Promise<void> {
  try {
    const db = await openCatalogDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction([STORE_ITEMS, STORE_CATALOG, STORE_META], 'readwrite');
      tx.objectStore(STORE_ITEMS).clear();
      tx.objectStore(STORE_CATALOG).clear();
      tx.objectStore(STORE_META).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}

export interface OfflineDriveBackupPayload {
  app: 'TeleDrive';
  v: 4;
  exportedAt: string;
  items: DriveItem[];
  catalog: CatalogRecord[];
  tombstones: Record<string, string>;
}

export async function buildOfflineBackupBlob(
  items: DriveItem[],
  tombstones: Record<string, string>,
): Promise<Blob> {
  // Strip purely transient fields (like in-memory thumbnail object URLs) for compact long-term archival
  const cleanItems = items
    .filter((i) => !i.isCatalogStub)
    .map((i) => ({
      ...i,
      thumbnailUrl: undefined,
    }));
  const catalog = items.map(toCatalogRecord);
  const payload: OfflineDriveBackupPayload = {
    app: 'TeleDrive',
    v: 4,
    exportedAt: new Date().toISOString(),
    items: cleanItems,
    catalog,
    tombstones,
  };
  const { bytes } = await encodeGzipJson(payload);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: 'application/gzip' });
}

export async function parseOfflineBackupFile(file: File): Promise<OfflineDriveBackupPayload> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const parsed = await decodeGzipJson<Partial<OfflineDriveBackupPayload>>(buf);
  if (!parsed || parsed.app !== 'TeleDrive' || !Array.isArray(parsed.items)) {
    throw new Error('File cadangan TeleDrive tidak valid atau rusak.');
  }
  return {
    app: 'TeleDrive',
    v: 4,
    exportedAt: parsed.exportedAt || new Date().toISOString(),
    items: parsed.items,
    catalog: Array.isArray(parsed.catalog) ? parsed.catalog : parsed.items.map(toCatalogRecord),
    tombstones: parsed.tombstones && typeof parsed.tombstones === 'object' ? parsed.tombstones : {},
  };
}
