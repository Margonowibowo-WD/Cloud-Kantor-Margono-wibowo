import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderPlus, Trash2, UploadCloud } from 'lucide-react';
import type {
  DriveItem,
  NavSection,
  SearchScope,
  SearchSizeFilter,
  SortDirection,
  SortField,
  StorageSummary,
  TelegramConfigState,
  TelegramPublicStatus,
  TransferTask,
  TypeFilter,
  ViewMode,
} from './types/drive';
import {
  applyMoveItems,
  buildBreadcrumbs,
  cloneDriveItemsForPaste,
  computeByteSlices,
  computeStorageSummary,
  filterAndSortItems,
  formatBytes,
  resolveMimeTypeForFilename,
} from './utils/fileHelpers';
import {
  type CapturedDropPayload,
  type DroppedTreeResult,
  captureDropEntriesSync,
  extractDroppedTree,
  extractTreeFromFileList,
  filterDuplicateUploadEntries,
  materializeFolderTree,
} from './utils/dropUploadHelpers';
import {
  type ObsoleteTelegramMsg,
  type OfflineUploadJob,
  addDeletedTombstones,
  addDismissedTelegramMessageIds,
  addObsoleteTelegramMsgs,
  deleteLocalBlob,
  enqueueOfflineUploadJobs,
  getLocalBlob,
  hasLocalBlob,
  loadDeletedTombstones,
  loadDismissedTelegramMessageIds,
  loadLocalEncryptedVault,
  loadObsoleteTelegramMsgs,
  loadOfflinePinnedItemIds,
  loadOfflineUploadQueue,
  loadStoredItems,
  loadStoredTelegramConfig,
  loadStoredViewPrefs,
  removeOfflineUploadJob,
  saveDeletedTombstones,
  saveLocalBlob,
  saveLocalEncryptedVault,
  saveObsoleteTelegramMsgs,
  saveOfflinePinnedItemIds,
  saveStoredItems,
  saveStoredTelegramConfig,
  saveStoredViewPrefs,
  wipeUnlockedSessionData,
} from './utils/localVault';
import {
  CHUNK_SIZE_BYTES,
  DIRECT_TELEGRAM_MAX_BYTES,
  MAX_BROWSER_UPLOAD_BYTES,
  UPLOAD_CONCURRENCY,
  checkTelegramMessageExists,
  deleteTelegramMessageDirect,
  fetchChannelMediaUpdates,
  normalizeCorsProxyUrl,
  pushIndexToTelegramPinnedMessage,
  toPublicStatus,
} from './utils/telegramDirect';
import {
  type CloudViewPrefs,
  type TelegramV4Manifest,
  mergeDriveItems,
  reconcileAuthoritativeRemoteItems,
  reconcileConcurrentDriveState,
  toCatalogRecord,
} from './utils/telegramIndex';
import {
  buildOfflineBackupBlob,
  loadIndexedCatalogState,
  parseOfflineBackupFile,
  replaceAllCatalogIdb,
  saveDirtyTrackingIdb,
  saveLoadedFolderRevsIdb,
  saveV4ManifestIdb,
  upsertDriveItemsIdb,
} from './utils/indexedCatalog';
import {
  cleanupObsoleteTelegramMessages,
  loadFolderChildrenV4,
  pullCloudStateFromTelegram,
  pushV4ChangesToTelegram,
} from './utils/telegramV4';
import { isVaultConfigured } from './utils/cryptoVault';
import {
  resolveItemArrayBuffer,
  startDirectDownload,
  startDirectUpload,
} from './utils/uploadClient';
import { buildZipArchiveFilename, startZipDownload } from './utils/zipDownload';
import { Sidebar } from './components/Sidebar';
import { type CloudSyncState, type ThemeMode, TopBar } from './components/TopBar';
import { Toolbar } from './components/Toolbar';
import { FileGrid } from './components/FileGrid';
import { FileTable } from './components/FileTable';
import { ContextMenu, type ContextMenuState } from './components/ContextMenu';
import { type AppNotification, TopRightNotifications } from './components/TopRightNotifications';
import { PreviewModal } from './components/PreviewModal';
import { RightPreviewPane } from './components/RightPreviewPane';
import { TelegramModal } from './components/TelegramModal';
import { PersonalLockScreen } from './components/PersonalLockScreen';
import { ConfirmDeleteModal, FolderNameModal, MoveModal } from './components/ActionModals';
import { DuplicateFinderModal } from './components/DuplicateFinderModal';
import { ActivityHistoryModal } from './components/ActivityHistoryModal';
import { OfflineIndicator } from './components/PWAInstallButton';
import {
  type UploadHistoryEntry,
  clearTodayUploadHistory,
  getLocalDayKey,
  loadTodayUploadHistory,
  pruneUploadHistoryByDay,
  recordUploadHistoryEntry,
  saveTodayUploadHistory,
} from './utils/uploadHistory';

const ENV_TELEGRAM_VAULT = ((import.meta.env.VITE_TELEGRAM_VAULT as string | undefined) || '').trim();

function collectDescendantIds(rootId: string, allItems: DriveItem[]): Set<string> {
  const result = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of allItems) {
      if (item.parentId && result.has(item.parentId) && !result.has(item.id)) {
        result.add(item.id);
        changed = true;
      }
    }
  }
  return result;
}

const THEME_STORAGE_KEY = 'teledrive_theme_mode_v1';
const PREVIEW_WIDTH_KEY = 'teledrive_preview_width_v1';

function loadInitialPreviewWidth(): number {
  try {
    const raw = Number(localStorage.getItem(PREVIEW_WIDTH_KEY));
    if (Number.isFinite(raw) && raw >= 280 && raw <= 740) {
      return raw;
    }
  } catch {
    // ignore
  }
  return 380;
}

function isNightHour(date = new Date()): boolean {
  const hour = date.getHours();
  return hour >= 18 || hour < 6;
}

function loadInitialThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'auto' || saved === 'light' || saved === 'dark') {
      return saved;
    }
  } catch {
    // ignore
  }
  return 'auto';
}

export default function App() {
  const initialViewPrefs = useMemo(() => loadStoredViewPrefs(), []);
  const [items, setItems] = useState<DriveItem[]>(() => loadStoredItems());
  const [tgConfig, setTgConfig] = useState<TelegramConfigState>(() => loadStoredTelegramConfig());

  const [section, setSection] = useState<NavSection>('my-drive');
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [renderLimit, setRenderLimit] = useState(100);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [searchScope, setSearchScope] = useState<SearchScope>('all');
  const [sizeFilter, setSizeFilter] = useState<SearchSizeFilter>('all');
  const [sortField, setSortField] = useState<SortField>(initialViewPrefs.sf || 'name');
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialViewPrefs.sd || 'asc');
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewPrefs.v || 'grid');
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadInitialThemeMode());
  const [isNightNow, setIsNightNow] = useState<boolean>(() => isNightHour());
  const [previewPaneOpen, setPreviewPaneOpen] = useState<boolean>(
    () => typeof window === 'undefined' || window.innerWidth >= 1024,
  );
  const [previewPaneWidth, setPreviewPaneWidth] = useState<number>(() => loadInitialPreviewWidth());

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [clipboardIds, setClipboardIds] = useState<string[]>([]);
  const [draggingIds, setDraggingIds] = useState<string[]>([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isDraggingExternalFiles, setIsDraggingExternalFiles] = useState(false);

  const [previewItem, setPreviewItem] = useState<DriveItem | null>(null);
  const [telegramModalOpen, setTelegramModalOpen] = useState(false);
  const [localVaultString, setLocalVaultString] = useState<string>(() => loadLocalEncryptedVault());
  const activeVaultString = isVaultConfigured(ENV_TELEGRAM_VAULT)
    ? ENV_TELEGRAM_VAULT
    : localVaultString;
  const [nameModal, setNameModal] = useState<{
    open: boolean;
    mode: 'create' | 'rename';
    targetItem?: DriveItem;
  }>({ open: false, mode: 'create' });
  const [deleteModal, setDeleteModal] = useState<{
    open: boolean;
    variant: 'trash' | 'permanent';
    ids: string[];
    label?: string;
  }>({ open: false, variant: 'permanent', ids: [] });
  const [moveModal, setMoveModal] = useState<{ open: boolean; ids: string[] }>({
    open: false,
    ids: [],
  });
  const [duplicatesModalOpen, setDuplicatesModalOpen] = useState(false);
  const [activityModalOpen, setActivityModalOpen] = useState(false);
  const [uploadHistory, setUploadHistory] = useState<UploadHistoryEntry[]>(() =>
    loadTodayUploadHistory(),
  );
  const [obsoleteChannelMsgs, setObsoleteChannelMsgs] = useState<ObsoleteTelegramMsg[]>(() =>
    loadObsoleteTelegramMsgs(),
  );
  const [offlinePinnedIds, setOfflinePinnedIds] = useState<Set<string>>(
    () => new Set(loadOfflinePinnedItemIds()),
  );
  const [offlineQueueCount, setOfflineQueueCount] = useState<number>(
    () => loadOfflineUploadQueue().length,
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [transfers, setTransfers] = useState<TransferTask[]>([]);
  const [syncingTelegram, setSyncingTelegram] = useState(false);
  const [syncState, setSyncState] = useState<CloudSyncState>(() =>
    loadStoredTelegramConfig().connected ? 'synced' : 'disconnected',
  );
  const [marquee, setMarquee] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    active: boolean;
  } | null>(null);
  const [isMarqueeSession, setIsMarqueeSession] = useState(false);
  const marqueeSessionRef = useRef<{
    startX: number;
    startY: number;
    active: boolean;
    baseSelected: Set<string>;
  } | null>(null);
  const transferCancelMap = useRef<Map<string, () => void>>(new Map());
  const transferRemovalTimers = useRef<Map<string, number>>(new Map());
  const uploadQueueRef = useRef<
    Array<{
      taskId: string;
      file: File;
      targetParent: string | null;
      tgSnapshot: TelegramConfigState;
      isBatch: boolean;
    }>
  >([]);
  const activeUploadCountRef = useRef(0);
  const batchSuccessCountRef = useRef(0);
  const batchStartedCountRef = useRef(0);
  const failedUploadJobsRef = useRef<
    Map<string, { file: File; targetParent: string | null; isBatch: boolean }>
  >(new Map());
  const didAutoSyncRef = useRef(false);
  const syncInFlightRef = useRef(false);
  const offlineFlushInFlightRef = useRef(false);
  const initialRetryTimerRef = useRef<number | null>(null);
  const hasSyncedOnceRef = useRef(false);
  const pinBlockedRef = useRef(false);
  const autoCreateIndexAttemptedRef = useRef(false);
  const lastSyncMsRef = useRef(0);
  const lastChannelUpdatesMsRef = useRef(0);
  const lastProbeMsRef = useRef(0);
  const lastSyncedRevRef = useRef<string | undefined>(undefined);
  const lastSelectedIdRef = useRef<string | null>(null);
  const tombstonesRef = useRef<Record<string, string>>(loadDeletedTombstones());
  const viewPrefsRef = useRef<CloudViewPrefs>(initialViewPrefs);
  const v4ManifestRef = useRef<TelegramV4Manifest | undefined>(undefined);
  const loadedFolderRevsRef = useRef<Record<string, string>>({});
  const dirtyFolderIdsRef = useRef<Set<string>>(new Set());
  const dirtyItemIdsRef = useRef<Set<string>>(new Set());
  const obsoleteV3ShardsRef = useRef<number[]>([]);
  const folderHydrationInFlightRef = useRef<Map<string, Promise<void>>>(new Map());
  const itemsRef = useRef<DriveItem[]>(items);
  itemsRef.current = items;
  const mainRef = useRef<HTMLElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const reuploadInputRef = useRef<HTMLInputElement>(null);
  const reuploadParentIdRef = useRef<string | null>(null);
  const uploadHistoryDayRef = useRef<string>(getLocalDayKey());
  const uploadStartedAtRef = useRef<Map<string, number>>(new Map());
  const uploadStatsRef = useRef<
    Map<string, { speedBytesPerSec?: number; elapsedSeconds?: number; totalChunks?: number }>
  >(new Map());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const tabChannelRef = useRef<BroadcastChannel | null>(null);

  const telegramStatus: TelegramPublicStatus = useMemo(() => toPublicStatus(tgConfig), [tgConfig]);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const pushNotification = useCallback(
    (payload: Omit<AppNotification, 'id'>) => {
      const id = `notif-${crypto.randomUUID()}`;
      setNotifications((prev) => [{ ...payload, id }, ...prev].slice(0, 3));
      window.setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
      }, 5000);
    },
    [],
  );

  const recordFailedChannelDeletes = useCallback(
    (failed: Array<{ mid: number; label: string; error?: string }>) => {
      if (!failed || failed.length === 0) return;
      const nowIso = new Date().toISOString();
      const updated = addObsoleteTelegramMsgs(
        failed.map((f) => ({
          mid: f.mid,
          label: f.label,
          recordedAt: nowIso,
          lastError: f.error,
        })),
      );
      setObsoleteChannelMsgs(updated);
    },
    [],
  );

  const broadcastLocalStateToTabs = useCallback(() => {
    try {
      tabChannelRef.current?.postMessage({
        type: 'teledrive-state-updated',
        rev: lastSyncedRevRef.current,
      });
    } catch {
      // ignore BroadcastChannel unavailable
    }
  }, []);

  const applyRemoteViewPrefs = useCallback((remotePrefs?: CloudViewPrefs) => {
    if (!remotePrefs) return;
    const localMs = viewPrefsRef.current.u ? Date.parse(viewPrefsRef.current.u) || 0 : 0;
    const remoteMs = remotePrefs.u ? Date.parse(remotePrefs.u) || 0 : 0;
    const remoteIsNewer = remoteMs > localMs || (!viewPrefsRef.current.u && Boolean(remotePrefs.u));

    if (remoteIsNewer) {
      viewPrefsRef.current = remotePrefs;
      saveStoredViewPrefs(remotePrefs);
      if (remotePrefs.v === 'grid' || remotePrefs.v === 'list') setViewMode(remotePrefs.v);
      if (
        remotePrefs.sf === 'name' ||
        remotePrefs.sf === 'updatedAt' ||
        remotePrefs.sf === 'size' ||
        remotePrefs.sf === 'type'
      ) {
        setSortField(remotePrefs.sf);
      }
      if (remotePrefs.sd === 'asc' || remotePrefs.sd === 'desc') setSortDirection(remotePrefs.sd);
    }

    const shouldAdoptRemoteProxy =
      remotePrefs.px !== undefined &&
      (remoteIsNewer || (!viewPrefsRef.current.px && Boolean(normalizeCorsProxyUrl(remotePrefs.px))));

    if (shouldAdoptRemoteProxy) {
      const syncedProxy = normalizeCorsProxyUrl(remotePrefs.px);
      if (!remoteIsNewer) {
        const patched: CloudViewPrefs = { ...viewPrefsRef.current, px: syncedProxy || '' };
        viewPrefsRef.current = patched;
        saveStoredViewPrefs(patched);
      }
      setTgConfig((curr) => {
        if ((curr.corsProxyUrl || undefined) === syncedProxy) return curr;
        const nextCfg: TelegramConfigState = {
          ...curr,
          corsProxyUrl: syncedProxy,
        };
        saveStoredTelegramConfig(nextCfg);
        return nextCfg;
      });
    }
  }, []);

  const [cloudPushTick, setCloudPushTick] = useState(0);
  const pinnedIndexIdRef = useRef<number | undefined>(tgConfig.pinnedIndexMessageId);
  pinnedIndexIdRef.current = tgConfig.pinnedIndexMessageId;

  const markDirtyScope = useCallback((folderIds: Array<string | null | undefined>, itemIds: string[] = []) => {
    for (const fId of folderIds) {
      dirtyFolderIdsRef.current.add(fId || 'ROOT');
    }
    for (const iId of itemIds) {
      if (iId) dirtyItemIdsRef.current.add(iId);
    }
    void saveDirtyTrackingIdb(
      Array.from(dirtyFolderIdsRef.current),
      Array.from(dirtyItemIdsRef.current),
    );
  }, []);

  // Hydrate full IndexedDB catalog on startup (supports > 2,500 items cleanly without localStorage quota)
  useEffect(() => {
    let active = true;
    void loadIndexedCatalogState().then((idbState) => {
      if (!active || hasSyncedOnceRef.current) return;
      if (idbState.v4Manifest) {
        v4ManifestRef.current = idbState.v4Manifest;
      }
      if (Object.keys(idbState.loadedFolderRevs).length > 0) {
        loadedFolderRevsRef.current = {
          ...idbState.loadedFolderRevs,
          ...loadedFolderRevsRef.current,
        };
      }
      for (const fId of idbState.dirtyFolderIds) dirtyFolderIdsRef.current.add(fId);
      for (const iId of idbState.pendingDeltaIds) dirtyItemIdsRef.current.add(iId);

      if (idbState.items.length > 0 && !hasSyncedOnceRef.current) {
        setItems((prev) => mergeDriveItems(idbState.items, prev));
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // Debounce search query (150ms) so typing feels instant even at 100k–1M catalog entries
  useEffect(() => {
    if (!searchQuery) {
      setDebouncedSearchQuery('');
      return;
    }
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  // Reset paginated render window (100 items/batch) whenever view scope changes
  useEffect(() => {
    setRenderLimit(100);
  }, [
    section,
    currentFolderId,
    debouncedSearchQuery,
    typeFilter,
    searchScope,
    sizeFilter,
    sortField,
    sortDirection,
  ]);

  // Persist items cleanly & push index to Telegram pinned message outside React state updaters
  const commitItems = useCallback(
    (
      updater: (prev: DriveItem[]) => DriveItem[],
      options?: {
        deferIndexPush?: boolean;
        dirtyFolderIds?: Array<string | null | undefined>;
        dirtyItemIds?: string[];
      },
    ) => {
      if (options?.dirtyFolderIds || options?.dirtyItemIds) {
        markDirtyScope(options.dirtyFolderIds || [], options.dirtyItemIds || []);
      }
      setItems((prev) => {
        const next = updater(prev);
        saveStoredItems(next);
        return next;
      });
      broadcastLocalStateToTabs();
      if (!options?.deferIndexPush) {
        setCloudPushTick((t) => t + 1);
      }
    },
    [broadcastLocalStateToTabs, markDirtyScope],
  );

  // Lazy per-folder hydration: walks ancestor chain from Root down and fetches only missing/stale folder docs
  const ensureFolderLoaded = useCallback(
    async (folderId: string | null, cfgOverride?: TelegramConfigState): Promise<void> => {
      if (!folderId) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (!v4ManifestRef.current) {
        const idbState = await loadIndexedCatalogState();
        if (idbState.v4Manifest && !v4ManifestRef.current) {
          v4ManifestRef.current = idbState.v4Manifest;
        }
      }
      const cfg = cfgOverride || tgConfig;
      const proxy = normalizeCorsProxyUrl(cfg.corsProxyUrl || v4ManifestRef.current?.p?.px);
      if (!cfg.connected || !cfg.botToken || !cfg.chatId || !proxy) return;

      const existingPromise = folderHydrationInFlightRef.current.get(folderId);
      if (existingPromise) return existingPromise;

      const mergeFolderChildren = (prev: DriveItem[], fId: string, children: DriveItem[]) => {
        const childIds = new Set(children.map((c) => c.id));
        const pendingOfflineIds = new Set(loadOfflineUploadQueue().map((j) => j.itemId));
        const prunedPrev = prev.filter((item) => {
          if (item.parentId !== fId) return true;
          if (childIds.has(item.id)) return true;
          if (
            dirtyItemIdsRef.current.has(item.id) ||
            pendingOfflineIds.has(item.id) ||
            item.pendingOfflineUpload
          ) {
            return true;
          }
          return false;
        });
        return mergeDriveItems(prunedPrev, children);
      };

      const task = (async () => {
        const chain: string[] = [];
        const visited = new Set<string>();
        let cursor: string | null = folderId;
        while (cursor && !visited.has(cursor)) {
          visited.add(cursor);
          chain.unshift(cursor);
          const node = itemsRef.current.find((i) => i.id === cursor);
          cursor = node?.parentId ?? null;
        }

        for (const fId of chain) {
          const folderObj = itemsRef.current.find((i) => i.id === fId && i.type === 'folder');
          if (!folderObj?.folderIdx?.mid) continue;

          const revMatches = loadedFolderRevsRef.current[fId] === folderObj.folderIdx.h;
          const hasStubChildren = itemsRef.current.some(
            (i) => i.parentId === fId && i.isCatalogStub,
          );
          if (revMatches && !hasStubChildren) continue;

          try {
            const children = await loadFolderChildrenV4(
              cfg.botToken,
              cfg.chatId,
              folderObj,
              proxy,
            );
            loadedFolderRevsRef.current[fId] = folderObj.folderIdx.h;
            void saveLoadedFolderRevsIdb(loadedFolderRevsRef.current);

            const syncMerged = mergeFolderChildren(itemsRef.current, fId, children);
            itemsRef.current = syncMerged;
            saveStoredItems(syncMerged);
            setItems((prev) => mergeFolderChildren(prev, fId, children));
            if (children.length > 0) {
              void upsertDriveItemsIdb(children);
            }
          } catch (err) {
            pushNotification({
              kind: 'error',
              title: `Gagal memuat isi folder ${folderObj.name}`,
              detail: err instanceof Error ? err.message : 'Periksa koneksi atau Proxy Cloudflare Worker.',
            });
          }
        }
      })();

      folderHydrationInFlightRef.current.set(folderId, task);
      try {
        await task;
      } finally {
        folderHydrationInFlightRef.current.delete(folderId);
      }
    },
    [tgConfig, pushNotification],
  );

  const hydrateStubItem = useCallback(
    async (item: DriveItem): Promise<boolean> => {
      const liveExisting = itemsRef.current.find((i) => i.id === item.id);
      if (!item.isCatalogStub || (liveExisting && !liveExisting.isCatalogStub)) {
        return true;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return hasLocalBlob(item.localBlobKey || `blob-${item.id}`);
      }
      if (!v4ManifestRef.current) {
        const idbState = await loadIndexedCatalogState();
        if (idbState.v4Manifest && !v4ManifestRef.current) {
          v4ManifestRef.current = idbState.v4Manifest;
        }
      }

      if (item.parentId) {
        await ensureFolderLoaded(item.parentId);
        if (itemsRef.current.some((i) => i.id === item.id && !i.isCatalogStub)) {
          return true;
        }
        // Fallback: if folderIdx was missing or stale, refresh V4 manifest from Telegram once
        const proxy = normalizeCorsProxyUrl(tgConfig.corsProxyUrl || v4ManifestRef.current?.p?.px);
        if (tgConfig.connected && tgConfig.botToken && tgConfig.chatId && proxy) {
          try {
            const pulled = await pullCloudStateFromTelegram(tgConfig.botToken, tgConfig.chatId, {
              corsProxyUrl: proxy,
              skipVerifyGetMe: true,
            });
            if (!pulled.error && pulled.v4Manifest) {
              v4ManifestRef.current = pulled.v4Manifest;
              void saveV4ManifestIdb(pulled.v4Manifest);
            }
            if (!pulled.error && pulled.items.length > 0) {
              const refreshed = mergeDriveItems(itemsRef.current, pulled.items);
              itemsRef.current = refreshed;
              saveStoredItems(refreshed);
              setItems((prev) => mergeDriveItems(prev, pulled.items));
              await ensureFolderLoaded(item.parentId);
            }
          } catch {
            // ignore fallback refresh error
          }
        }
        if (itemsRef.current.some((i) => i.id === item.id && !i.isCatalogStub)) {
          return true;
        }
        return hasLocalBlob(item.localBlobKey || `blob-${item.id}`);
      }

      let proxy = normalizeCorsProxyUrl(tgConfig.corsProxyUrl || v4ManifestRef.current?.p?.px);
      let rootRef = v4ManifestRef.current?.root;
      if (tgConfig.connected && tgConfig.botToken && tgConfig.chatId && (!proxy || !rootRef?.mid)) {
        try {
          const pulled = await pullCloudStateFromTelegram(tgConfig.botToken, tgConfig.chatId, {
            corsProxyUrl: proxy,
            skipVerifyGetMe: true,
          });
          if (!pulled.error && pulled.v4Manifest) {
            v4ManifestRef.current = pulled.v4Manifest;
            void saveV4ManifestIdb(pulled.v4Manifest);
            rootRef = pulled.v4Manifest.root;
            proxy = normalizeCorsProxyUrl(tgConfig.corsProxyUrl || pulled.v4Manifest.p?.px);
          }
          if (!pulled.error && pulled.items.length > 0) {
            const refreshed = mergeDriveItems(itemsRef.current, pulled.items);
            itemsRef.current = refreshed;
            saveStoredItems(refreshed);
            setItems((prev) => mergeDriveItems(prev, pulled.items));
            if (refreshed.some((i) => i.id === item.id && !i.isCatalogStub)) {
              return true;
            }
          }
        } catch {
          // fall through
        }
      }
      if (!tgConfig.connected || !tgConfig.botToken || !tgConfig.chatId || !proxy || !rootRef?.mid) {
        return hasLocalBlob(item.localBlobKey || `blob-${item.id}`);
      }

      const existing = folderHydrationInFlightRef.current.get('ROOT');
      if (existing) {
        await existing;
        return (
          itemsRef.current.some((i) => i.id === item.id && !i.isCatalogStub) ||
          hasLocalBlob(item.localBlobKey || `blob-${item.id}`)
        );
      }
      const resolvedRootRef = rootRef;
      const resolvedProxy = proxy;
      const task = (async () => {
        try {
          const rootChildren = await loadFolderChildrenV4(
            tgConfig.botToken,
            tgConfig.chatId,
            { ...item, id: 'ROOT', type: 'folder', folderIdx: resolvedRootRef },
            resolvedProxy,
          );
          if (rootChildren.length > 0) {
            const syncMerged = mergeDriveItems(itemsRef.current, rootChildren);
            itemsRef.current = syncMerged;
            saveStoredItems(syncMerged);
            setItems((prev) => mergeDriveItems(prev, rootChildren));
            void upsertDriveItemsIdb(rootChildren);
          }
        } catch {
          // ignore silent root hydration failure; caller inspects hydrated state
        }
      })();
      folderHydrationInFlightRef.current.set('ROOT', task);
      try {
        await task;
      } finally {
        folderHydrationInFlightRef.current.delete('ROOT');
      }
      return (
        itemsRef.current.some((i) => i.id === item.id && !i.isCatalogStub) ||
        hasLocalBlob(item.localBlobKey || `blob-${item.id}`)
      );
    },
    [ensureFolderLoaded, tgConfig],
  );

  useEffect(() => {
    if (cloudPushTick === 0) return;
    if (!tgConfig.connected || !tgConfig.botToken || !tgConfig.chatId) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setSyncState('error');
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      const currentPinId = pinnedIndexIdRef.current;
      const proxyUrl = normalizeCorsProxyUrl(tgConfig.corsProxyUrl || v4ManifestRef.current?.p?.px);
      setSyncState('syncing');

      if (proxyUrl) {
        const snapshotDirtyFolders = new Set(dirtyFolderIdsRef.current);
        const snapshotDirtyItems = new Set(dirtyItemIdsRef.current);
        if (snapshotDirtyFolders.size === 0 && snapshotDirtyItems.size === 0 && !v4ManifestRef.current) {
          snapshotDirtyFolders.add('ALL');
        }
        const obsoleteShards = [...obsoleteV3ShardsRef.current];

        void pushV4ChangesToTelegram({
          botToken: tgConfig.botToken,
          chatId: tgConfig.chatId,
          corsProxyUrl: proxyUrl,
          allItems: itemsRef.current,
          dirtyFolderIds: snapshotDirtyFolders,
          dirtyItemIds: snapshotDirtyItems,
          tombstones: tombstonesRef.current,
          currentManifest: v4ManifestRef.current,
          pinnedMessageId: currentPinId,
          prefs: viewPrefsRef.current,
          obsoleteV3ShardIds: obsoleteShards,
        })
          .then((v4Res) => {
            if (!active) return;
            hasSyncedOnceRef.current = true;
            v4ManifestRef.current = v4Res.manifest;
            void saveV4ManifestIdb(v4Res.manifest);

            for (const f of snapshotDirtyFolders) dirtyFolderIdsRef.current.delete(f);
            for (const id of snapshotDirtyItems) dirtyItemIdsRef.current.delete(id);
            obsoleteV3ShardsRef.current = [];
            void saveDirtyTrackingIdb(
              Array.from(dirtyFolderIdsRef.current),
              Array.from(dirtyItemIdsRef.current),
            );

            // Record updated folder hashes as loaded cleanly
            for (const item of v4Res.updatedItems) {
              if (item.type === 'folder' && item.folderIdx?.h) {
                loadedFolderRevsRef.current[item.id] = item.folderIdx.h;
              }
            }
            void saveLoadedFolderRevsIdb(loadedFolderRevsRef.current);

            if (v4Res.manifest.rev) lastSyncedRevRef.current = v4Res.manifest.rev;
            tombstonesRef.current = v4Res.tombstones;
            saveDeletedTombstones(v4Res.tombstones);
            saveStoredItems(v4Res.updatedItems);
            void replaceAllCatalogIdb(v4Res.catalog);
            setItems(v4Res.updatedItems);
            broadcastLocalStateToTabs();

            const nextPinId = v4Res.pinnedMessageId ?? pinnedIndexIdRef.current;
            if (nextPinId) {
              pinnedIndexIdRef.current = nextPinId;
            }
            const nowIso = new Date().toISOString();
            setTgConfig((curr) => {
              const updatedCfg: TelegramConfigState = {
                ...curr,
                pinnedIndexMessageId: nextPinId,
                lastSyncedAt: nowIso,
              };
              saveStoredTelegramConfig(updatedCfg);
              return updatedCfg;
            });
            if (v4Res.failedDeleteMids.length > 0) {
              recordFailedChannelDeletes(v4Res.failedDeleteMids);
            }
            if (v4Res.pinBlocked && !pinBlockedRef.current) {
              pinBlockedRef.current = true;
              pushNotification({
                kind: 'error',
                title: 'Bot belum diizinkan Pin Pesan di Channel',
                detail:
                  'Buka Info Channel Telegram -> Admin -> aktifkan izin "Pin Messages" & "Edit Messages" untuk Bot agar tidak membuat pesan baru.',
              });
            }
            setSyncState('synced');
          })
          .catch((err) => {
            if (!active) return;
            setSyncState('error');
            pushNotification({
              kind: 'error',
              title: 'Sinkronisasi V4 gagal',
              detail: err instanceof Error ? err.message : 'Gagal memperbarui indeks Telegram.',
            });
          });
        return;
      }

      void pushIndexToTelegramPinnedMessage(
        tgConfig.botToken,
        tgConfig.chatId,
        itemsRef.current,
        currentPinId,
        tombstonesRef.current,
        { prefs: viewPrefsRef.current },
      ).then((pushRes) => {
        if (!active || !pushRes) {
          if (active) setSyncState('error');
          return;
        }
        hasSyncedOnceRef.current = true;
        if (pushRes.rev) lastSyncedRevRef.current = pushRes.rev;
        if (pushRes.syncedPrefs) applyRemoteViewPrefs(pushRes.syncedPrefs);
        tombstonesRef.current = pushRes.syncedTombstones;
        saveDeletedTombstones(pushRes.syncedTombstones);
        saveStoredItems(pushRes.syncedItems);
        setItems(pushRes.syncedItems);
        broadcastLocalStateToTabs();

        const nextPinId = pushRes.pinnedMessageId ?? pinnedIndexIdRef.current;
        if (nextPinId) {
          pinnedIndexIdRef.current = nextPinId;
        }
        const nowIso = new Date().toISOString();
        setTgConfig((curr) => {
          const updatedCfg: TelegramConfigState = {
            ...curr,
            pinnedIndexMessageId: nextPinId,
            lastSyncedAt: nowIso,
          };
          saveStoredTelegramConfig(updatedCfg);
          return updatedCfg;
        });
        if (pushRes.pinBlocked && !pinBlockedRef.current) {
          pinBlockedRef.current = true;
          pushNotification({
            kind: 'error',
            title: 'Bot belum diizinkan Pin Pesan di Channel',
            detail:
              'Buka Info Channel Telegram -> Admin -> aktifkan izin "Pin Messages" & "Edit Messages" untuk Bot agar tidak membuat pesan baru.',
          });
        }
        setSyncState('synced');
      });
    }, 600);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    cloudPushTick,
    tgConfig.connected,
    tgConfig.botToken,
    tgConfig.chatId,
    tgConfig.corsProxyUrl,
    applyRemoteViewPrefs,
    broadcastLocalStateToTabs,
    pushNotification,
  ]);

  const handleLockDrive = useCallback(
    (options?: { broadcast?: boolean; clearLocalVault?: boolean }) => {
      if (initialRetryTimerRef.current) {
        window.clearTimeout(initialRetryTimerRef.current);
        initialRetryTimerRef.current = null;
      }
      for (const cancel of transferCancelMap.current.values()) {
        try {
          cancel();
        } catch {
          // ignore abort errors
        }
      }
      transferCancelMap.current.clear();
      uploadQueueRef.current = [];
      failedUploadJobsRef.current.clear();
      uploadStartedAtRef.current.clear();
      uploadStatsRef.current.clear();
      activeUploadCountRef.current = 0;
      offlineFlushInFlightRef.current = false;

      wipeUnlockedSessionData({ clearLocalVault: options?.clearLocalVault });
      if (options?.clearLocalVault) {
        setLocalVaultString('');
      }

      didAutoSyncRef.current = false;
      hasSyncedOnceRef.current = false;
      lastSyncedRevRef.current = undefined;
      pinnedIndexIdRef.current = undefined;
      v4ManifestRef.current = undefined;
      loadedFolderRevsRef.current = {};
      dirtyFolderIdsRef.current = new Set();
      dirtyItemIdsRef.current = new Set();
      obsoleteV3ShardsRef.current = [];
      tombstonesRef.current = {};

      setItems([]);
      setUploadHistory([]);
      setOfflinePinnedIds(new Set());
      setOfflineQueueCount(0);
      setSearchQuery('');
      setDebouncedSearchQuery('');
      setTypeFilter('all');
      setSearchScope('all');
      setSizeFilter('all');
      setRenderLimit(100);
      setTransfers([]);
      setSelectedIds(new Set());
      setClipboardIds([]);
      setPreviewItem(null);
      setTelegramModalOpen(false);
      setMoveModal({ open: false, ids: [] });
      setDuplicatesModalOpen(false);
      setActivityModalOpen(false);
      setObsoleteChannelMsgs([]);
      setContextMenu(null);
      setSyncState('disconnected');
      setTgConfig({
        connected: false,
        botToken: '',
        chatId: '',
        autoSync: true,
      });

      if (options?.broadcast !== false) {
        try {
          tabChannelRef.current?.postMessage({ type: 'teledrive-locked' });
        } catch {
          // ignore
        }
      }
    },
    [],
  );

  // Two-way Google Drive-grade sync: 1-call revision check in background, no badge flicker
  const syncFromTelegram = useCallback(
    async (
      silent = false,
      configOverride?: TelegramConfigState,
      prefetched?: { pinnedIndexText?: string; pinnedMessageId?: number },
    ) => {
      const cfg = configOverride || tgConfig;
      if (!cfg.connected || !cfg.botToken || !cfg.chatId) return;
      if (syncInFlightRef.current) return;

      syncInFlightRef.current = true;
      const nowMs = Date.now();
      lastSyncMsRef.current = nowMs;

      // Calm Google Drive indicator: do NOT blink "Menyinkronkan..." on routine silent background checks once synced
      const showVisibleSpinner = !silent || !hasSyncedOnceRef.current;
      if (showVisibleSpinner) {
        setSyncingTelegram(true);
        setSyncState('syncing');
      }

      try {
        const res = await pullCloudStateFromTelegram(cfg.botToken, cfg.chatId, {
          corsProxyUrl: cfg.corsProxyUrl,
          skipVerifyGetMe: Boolean(cfg.connected),
          cachedRev: silent && hasSyncedOnceRef.current ? lastSyncedRevRef.current : undefined,
          prefetchedPinnedText: prefetched?.pinnedIndexText,
          prefetchedPinnedMessageId: prefetched?.pinnedMessageId,
        });

        if (res.error) {
          setSyncState('error');
          if (
            !hasSyncedOnceRef.current &&
            !initialRetryTimerRef.current &&
            (typeof navigator === 'undefined' || navigator.onLine !== false)
          ) {
            initialRetryTimerRef.current = window.setTimeout(() => {
              initialRetryTimerRef.current = null;
              void syncFromTelegram(true);
            }, 6000);
          }
          if (!silent || res.needsProxy) {
            pushNotification({
              kind: 'error',
              title: res.needsProxy ? 'Proxy diperlukan untuk indeks V4' : 'Sinkronisasi gagal',
              detail: res.error,
            });
          }
          return;
        }
        if (initialRetryTimerRef.current) {
          window.clearTimeout(initialRetryTimerRef.current);
          initialRetryTimerRef.current = null;
        }

        if (res.isV4 && res.v4Manifest) {
          v4ManifestRef.current = res.v4Manifest;
          void saveV4ManifestIdb(res.v4Manifest);
        } else if (res.v3ShardRefs?.length) {
          obsoleteV3ShardsRef.current = res.v3ShardRefs.map((s) => s.id);
        }

        const shouldScanUpdates =
          !silent ||
          !hasSyncedOnceRef.current ||
          nowMs - lastChannelUpdatesMsRef.current >= 60_000;

        // Ultra-fast Google Drive no-op path: 1 getChat check proved remote index didn't change
        if (res.unchanged && !shouldScanUpdates) {
          hasSyncedOnceRef.current = true;
          setSyncState('synced');
          const nowIso = new Date().toISOString();
          setTgConfig((curr) => {
            const updatedCfg: TelegramConfigState = { ...curr, lastSyncedAt: nowIso };
            saveStoredTelegramConfig(updatedCfg);
            return updatedCfg;
          });
          return;
        }

        const knownMsgIds = new Set<number>();
        for (const item of itemsRef.current) {
          for (const c of item.chunks) {
            if (c.telegramMessageId) knownMsgIds.add(c.telegramMessageId);
          }
        }
        const remoteItemsForScan = res.unchanged ? itemsRef.current : res.items;
        for (const item of remoteItemsForScan) {
          for (const c of item.chunks) {
            if (c.telegramMessageId) knownMsgIds.add(c.telegramMessageId);
          }
        }

        let channelMedia: DriveItem[] = [];
        if (shouldScanUpdates) {
          lastChannelUpdatesMsRef.current = nowMs;
          const dismissedIds = loadDismissedTelegramMessageIds();
          const activeShardIds = new Set((res.v3ShardRefs || []).map((s) => s.id));
          if (res.v4Manifest?.root?.mid) activeShardIds.add(res.v4Manifest.root.mid);
          if (res.v4Manifest?.delta?.mid) activeShardIds.add(res.v4Manifest.delta.mid);
          for (const c of res.v4Manifest?.cat || []) {
            if (c.mid) activeShardIds.add(c.mid);
          }
          channelMedia = await fetchChannelMediaUpdates(
            cfg.botToken,
            cfg.chatId,
            knownMsgIds,
            dismissedIds,
            {
              pinnedMessageId: res.pinnedMessageId ?? cfg.pinnedIndexMessageId,
              shardIds: activeShardIds,
            },
          );
        }

        // Probe Telegram channel deletions only on manual sync or every 5 minutes
        const shouldProbeDeletions = !silent || nowMs - lastProbeMsRef.current >= 300_000;
        const deletedInTelegramItemIds = new Set<string>();
        const deletedInTelegramMsgIds: number[] = [];
        if (shouldProbeDeletions) {
          lastProbeMsRef.current = nowMs;
          const probeCandidates = [...remoteItemsForScan, ...itemsRef.current]
            .filter(
              (i, idx, arr) =>
                !i.isCatalogStub &&
                i.type === 'file' &&
                i.storageBackend === 'telegram' &&
                Boolean(i.chunks[0]?.telegramMessageId) &&
                arr.findIndex((x) => x.id === i.id) === idx,
            )
            .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
            .slice(0, 10);

          for (const candidate of probeCandidates) {
            const msgId = candidate.chunks[0]?.telegramMessageId;
            if (!msgId) continue;
            const status = await checkTelegramMessageExists(cfg.botToken, cfg.chatId, msgId);
            if (status === 'deleted') {
              deletedInTelegramItemIds.add(candidate.id);
              deletedInTelegramMsgIds.push(msgId);
            }
          }

          if (deletedInTelegramMsgIds.length > 0) {
            addDismissedTelegramMessageIds(deletedInTelegramMsgIds);
          }
          if (deletedInTelegramItemIds.size > 0) {
            tombstonesRef.current = addDeletedTombstones(Array.from(deletedInTelegramItemIds));
          }
        }

        const localProxy = normalizeCorsProxyUrl(cfg.corsProxyUrl || res.prefs?.px);
        const needsV4Migration = Boolean(
          localProxy && !res.isV4 && (res.hasIndex || itemsRef.current.length > 0),
        );

        if (
          res.unchanged &&
          channelMedia.length === 0 &&
          deletedInTelegramItemIds.size === 0 &&
          !needsV4Migration
        ) {
          hasSyncedOnceRef.current = true;
          setSyncState('synced');
          if (!silent) {
            pushNotification({
              kind: 'success',
              title: 'Sinkronisasi Cloud selesai',
              detail: `${itemsRef.current.length} item tersinkron dari @${cfg.botUsername || 'Bot'}.`,
            });
          }
          return;
        }

        const effectiveRemoteItems = res.unchanged ? itemsRef.current : res.items;
        const effectiveRemoteTombstones = res.unchanged ? tombstonesRef.current : res.tombstones;

        const reconciled = reconcileConcurrentDriveState(
          itemsRef.current,
          effectiveRemoteItems,
          channelMedia,
          tombstonesRef.current,
          effectiveRemoteTombstones,
        );

        const pendingLocalIds = new Set<string>([
          ...dirtyItemIdsRef.current,
          ...loadOfflineUploadQueue().map((j) => j.itemId),
        ]);
        for (const item of itemsRef.current) {
          if (item.pendingOfflineUpload) pendingLocalIds.add(item.id);
        }
        const authoritativeItems =
          res.hasIndex && !res.unchanged
            ? reconcileAuthoritativeRemoteItems(
                reconciled.items,
                effectiveRemoteItems,
                channelMedia,
                pendingLocalIds,
              )
            : reconciled.items;

        if (!res.unchanged && res.prefs) {
          applyRemoteViewPrefs(res.prefs);
        }

        if (localProxy && viewPrefsRef.current.px === undefined) {
          const seededPrefs: CloudViewPrefs = {
            ...viewPrefsRef.current,
            px: localProxy,
            u: new Date().toISOString(),
          };
          viewPrefsRef.current = seededPrefs;
          saveStoredViewPrefs(seededPrefs);
        }

        tombstonesRef.current = reconciled.tombstones;
        saveDeletedTombstones(reconciled.tombstones);
        saveStoredItems(authoritativeItems);
        if (res.isV4 && !res.unchanged) {
          void replaceAllCatalogIdb(
            res.catalog.length > 0 ? res.catalog : authoritativeItems.map(toCatalogRecord),
          );
        }
        itemsRef.current = authoritativeItems;
        setItems(authoritativeItems);
        broadcastLocalStateToTabs();

        let nextPinnedId = res.pinnedMessageId ?? cfg.pinnedIndexMessageId;
        if (res.rev) {
          lastSyncedRevRef.current = res.rev;
        }

        // Re-check currently opened folder if remote V4 revision changed
        if (res.isV4 && !res.unchanged && currentFolderId) {
          void ensureFolderLoaded(currentFolderId, cfg);
        }

        const needsFormattingUpgrade = Boolean(
          !res.isV4 &&
            res.hasIndex &&
            res.rawPinnedText &&
            !res.rawPinnedText.includes('TeleDrive Cloud'),
        );
        const needsProxyPush = Boolean(
          res.hasIndex &&
            !res.unchanged &&
            viewPrefsRef.current.px &&
            !res.prefs?.px,
        );
        const remoteById = new Map(effectiveRemoteItems.map((i) => [i.id, i]));
        const changedLocalItems = authoritativeItems.filter((item) => {
          if (pendingLocalIds.has(item.id)) return true;
          const r = remoteById.get(item.id);
          if (!r) return false;
          return (Date.parse(item.updatedAt) || 0) > (Date.parse(r.updatedAt) || 0) + 1000;
        });
        const localHasUnpushedChanges =
          !res.hasIndex ||
          needsV4Migration ||
          needsFormattingUpgrade ||
          needsProxyPush ||
          channelMedia.length > 0 ||
          deletedInTelegramItemIds.size > 0 ||
          changedLocalItems.length > 0 ||
          dirtyFolderIdsRef.current.size > 0 ||
          dirtyItemIdsRef.current.size > 0;

        const allowCreateNewIndex = !silent || !autoCreateIndexAttemptedRef.current;
        const shouldPushBack =
          localHasUnpushedChanges &&
          authoritativeItems.length + Object.keys(reconciled.tombstones).length > 0 &&
          !(pinBlockedRef.current && !res.hasIndex) &&
          (res.hasIndex || allowCreateNewIndex);

        if (shouldPushBack) {
          if (!res.hasIndex) {
            autoCreateIndexAttemptedRef.current = true;
          }

          if (localProxy) {
            const pushDirtyFolders = new Set(dirtyFolderIdsRef.current);
            const pushDirtyItems = new Set(dirtyItemIdsRef.current);
            if (!res.isV4 || !res.hasIndex || needsV4Migration) {
              pushDirtyFolders.add('ALL');
            }
            for (const item of [...channelMedia, ...changedLocalItems]) {
              pushDirtyFolders.add(item.parentId || 'ROOT');
              pushDirtyItems.add(item.id);
            }
            for (const delId of deletedInTelegramItemIds) {
              pushDirtyFolders.add('ROOT');
              pushDirtyItems.add(delId);
            }

            const v4Push = await pushV4ChangesToTelegram({
              botToken: cfg.botToken,
              chatId: cfg.chatId,
              corsProxyUrl: localProxy,
              allItems: authoritativeItems,
              dirtyFolderIds: pushDirtyFolders,
              dirtyItemIds: pushDirtyItems,
              tombstones: reconciled.tombstones,
              currentManifest: v4ManifestRef.current,
              pinnedMessageId: nextPinnedId,
              prefs: viewPrefsRef.current,
              obsoleteV3ShardIds: obsoleteV3ShardsRef.current,
            });
            v4ManifestRef.current = v4Push.manifest;
            void saveV4ManifestIdb(v4Push.manifest);
            dirtyFolderIdsRef.current.clear();
            dirtyItemIdsRef.current.clear();
            obsoleteV3ShardsRef.current = [];
            void saveDirtyTrackingIdb([], []);
            for (const item of v4Push.updatedItems) {
              if (item.type === 'folder' && item.folderIdx?.h) {
                loadedFolderRevsRef.current[item.id] = item.folderIdx.h;
              }
            }
            void saveLoadedFolderRevsIdb(loadedFolderRevsRef.current);

            if (v4Push.pinnedMessageId) nextPinnedId = v4Push.pinnedMessageId;
            if (v4Push.manifest.rev) lastSyncedRevRef.current = v4Push.manifest.rev;
            tombstonesRef.current = v4Push.tombstones;
            saveDeletedTombstones(v4Push.tombstones);
            saveStoredItems(v4Push.updatedItems);
            void replaceAllCatalogIdb(v4Push.catalog);
            itemsRef.current = v4Push.updatedItems;
            setItems(v4Push.updatedItems);
            if (v4Push.failedDeleteMids.length > 0) {
              recordFailedChannelDeletes(v4Push.failedDeleteMids);
            }
            if (v4Push.pinBlocked && !pinBlockedRef.current) {
              pinBlockedRef.current = true;
              pushNotification({
                kind: 'error',
                title: 'Bot belum diizinkan Pin Pesan di Channel',
                detail:
                  'Buka Info Channel Telegram -> Admin -> aktifkan izin "Pin Messages" & "Edit Messages" untuk Bot agar tidak membuat pesan baru.',
              });
            }
          } else {
            const pushRes = await pushIndexToTelegramPinnedMessage(
              cfg.botToken,
              cfg.chatId,
              authoritativeItems,
              nextPinnedId,
              reconciled.tombstones,
              {
                skipMergePull: true,
                prefs: viewPrefsRef.current,
                existingPinnedText: res.rawPinnedText,
                existingShardRefs: res.v3ShardRefs,
              },
            );
            if (pushRes?.pinnedMessageId) nextPinnedId = pushRes.pinnedMessageId;
            if (pushRes?.rev) lastSyncedRevRef.current = pushRes.rev;
            if (pushRes?.pinBlocked && !pinBlockedRef.current) {
              pinBlockedRef.current = true;
              pushNotification({
                kind: 'error',
                title: 'Bot belum diizinkan Pin Pesan di Channel',
                detail:
                  'Buka Info Channel Telegram -> Admin -> aktifkan izin "Pin Messages" & "Edit Messages" untuk Bot agar tidak membuat pesan baru.',
              });
            }
          }
        }

        if (nextPinnedId) {
          pinnedIndexIdRef.current = nextPinnedId;
        }

        const nowIso = new Date().toISOString();
        setTgConfig((curr) => {
          const updatedCfg: TelegramConfigState = {
            ...curr,
            pinnedIndexMessageId: nextPinnedId ?? curr.pinnedIndexMessageId,
            lastSyncedAt: nowIso,
          };
          saveStoredTelegramConfig(updatedCfg);
          return updatedCfg;
        });
        hasSyncedOnceRef.current = true;
        setSyncState('synced');

        if (!silent) {
          const notes: string[] = [];
          if (channelMedia.length > 0) {
            notes.push(`${channelMedia.length} file baru dari Telegram ditambahkan`);
          }
          if (deletedInTelegramItemIds.size > 0) {
            notes.push(`${deletedInTelegramItemIds.size} file yang dihapus di Telegram disinkronkan`);
          }
          pushNotification({
            kind: 'success',
            title: 'Sinkronisasi Cloud selesai',
            detail:
              notes.length > 0
                ? `${notes.join(' · ')}.`
                : `${authoritativeItems.length.toLocaleString('id-ID')} item tersinkron dari @${cfg.botUsername || 'Bot'}.`,
          });
        }
      } finally {
        syncInFlightRef.current = false;
        if (showVisibleSpinner) {
          setSyncingTelegram(false);
        }
      }
    },
    [
      tgConfig,
      currentFolderId,
      ensureFolderLoaded,
      pushNotification,
      applyRemoteViewPrefs,
      broadcastLocalStateToTabs,
    ],
  );

  // Instant cross-tab sync within the same browser via BroadcastChannel + storage events
  useEffect(() => {
    const reloadFromLocalStorage = () => {
      const freshItems = loadStoredItems();
      const freshTombstones = loadDeletedTombstones();
      const freshPrefs = loadStoredViewPrefs();
      tombstonesRef.current = freshTombstones;
      if (freshItems.length > 0) {
        setItems(freshItems);
      } else {
        void loadIndexedCatalogState().then((idbState) => {
          if (idbState.items.length > 0) setItems(idbState.items);
        });
      }
      applyRemoteViewPrefs(freshPrefs);
    };

    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel('teledrive_sync_v1');
      tabChannelRef.current = ch;
      ch.onmessage = (ev) => {
        if (ev.data?.type === 'teledrive-locked') {
          handleLockDrive({ broadcast: false });
          return;
        }
        if (ev.data?.type === 'teledrive-state-updated') {
          if (typeof ev.data.rev === 'string') {
            lastSyncedRevRef.current = ev.data.rev;
          }
          reloadFromLocalStorage();
        }
      };
    }

    const onStorage = (e: StorageEvent) => {
      if (
        e.key === 'teledrive_items_v2' ||
        e.key === 'teledrive_tombstones_v1' ||
        e.key === 'teledrive_view_prefs_v1'
      ) {
        reloadFromLocalStorage();
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('storage', onStorage);
      tabChannelRef.current?.close();
      tabChannelRef.current = null;
    };
  }, [applyRemoteViewPrefs, handleLockDrive]);

  const resolveFolderPathLabel = useCallback((parentId: string | null) => {
    if (!parentId) return 'Drive Saya';
    return buildBreadcrumbs(parentId, itemsRef.current)
      .map((node) => node.name)
      .join(' / ');
  }, []);

  const appendUploadHistory = useCallback(
    (
      incoming: Omit<UploadHistoryEntry, 'id' | 'timestamp' | 'dayKey' | 'folderPathLabel'> & {
        folderPathLabel?: string;
      },
    ) => {
      const now = new Date();
      const todayKey = getLocalDayKey(now);
      uploadHistoryDayRef.current = todayKey;
      const folderPathLabel = incoming.folderPathLabel || resolveFolderPathLabel(incoming.parentId);
      setUploadHistory((prev) => {
        const next = recordUploadHistoryEntry(prev, { ...incoming, folderPathLabel }, now);
        saveTodayUploadHistory(next, now);
        return next;
      });
    },
    [resolveFolderPathLabel],
  );

  useEffect(() => {
    const pruneIfDayChanged = () => {
      const todayKey = getLocalDayKey();
      if (uploadHistoryDayRef.current !== todayKey) {
        uploadHistoryDayRef.current = todayKey;
        setUploadHistory((prev) => {
          const pruned = pruneUploadHistoryByDay(prev, todayKey);
          saveTodayUploadHistory(pruned);
          return pruned;
        });
      }
    };
    pruneIfDayChanged();
    window.addEventListener('focus', pruneIfDayChanged);
    return () => window.removeEventListener('focus', pruneIfDayChanged);
  }, [activityModalOpen]);

  const updateTransferTask = useCallback((id: string, patch: Partial<TransferTask>) => {
    if (
      patch.speedBytesPerSec !== undefined ||
      patch.elapsedSeconds !== undefined ||
      patch.totalChunks !== undefined
    ) {
      const prevStats = uploadStatsRef.current.get(id);
      uploadStatsRef.current.set(id, {
        speedBytesPerSec:
          patch.speedBytesPerSec && patch.speedBytesPerSec > 0
            ? patch.speedBytesPerSec
            : prevStats?.speedBytesPerSec,
        elapsedSeconds:
          patch.elapsedSeconds !== undefined ? patch.elapsedSeconds : prevStats?.elapsedSeconds,
        totalChunks: patch.totalChunks ?? prevStats?.totalChunks,
      });
    }
    setTransfers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    if (patch.status === 'completed' || patch.status === 'cancelled') {
      const existingTimer = transferRemovalTimers.current.get(id);
      if (existingTimer) window.clearTimeout(existingTimer);
      const timer = window.setTimeout(() => {
        transferRemovalTimers.current.delete(id);
        setTransfers((prev) => prev.filter((t) => t.id !== id));
      }, 5000);
      transferRemovalTimers.current.set(id, timer);
    }
  }, []);

  const flushOfflineUploadQueue = useCallback(async () => {
    if (offlineFlushInFlightRef.current) return;
    if (!tgConfig.connected || !tgConfig.botToken || !tgConfig.chatId) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    const jobs = loadOfflineUploadQueue();
    setOfflineQueueCount(jobs.length);
    if (jobs.length === 0) return;

    offlineFlushInFlightRef.current = true;
    let uploadedCount = 0;

    try {
      for (const job of jobs) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) break;
        if (tombstonesRef.current[job.itemId]) {
          const remaining = removeOfflineUploadJob(job.taskId);
          setOfflineQueueCount(remaining.length);
          continue;
        }

        const blob = await getLocalBlob(job.blobKey);
        if (!blob) {
          const remaining = removeOfflineUploadJob(job.taskId);
          setOfflineQueueCount(remaining.length);
          continue;
        }

        const liveItem = itemsRef.current.find((i) => i.id === job.itemId);
        const filename = liveItem?.name || job.filename;
        const targetParent = liveItem ? liveItem.parentId : job.parentId;
        const mimeType = job.mimeType || resolveMimeTypeForFilename(filename);
        const file = new File([blob], filename, { type: mimeType });

        setTransfers((prev) => {
          const exists = prev.some((t) => t.id === job.taskId);
          if (exists) {
            return prev.map((t) =>
              t.id === job.taskId
                ? { ...t, status: 'active', errorMessage: undefined, canRetry: false }
                : t,
            );
          }
          const task: TransferTask = {
            id: job.taskId,
            kind: 'upload',
            filename,
            totalBytes: file.size,
            loadedBytes: 0,
            speedBytesPerSec: 0,
            etaSeconds: 0,
            completedChunks: 0,
            totalChunks: 1,
            status: 'active',
            createdAt: Date.now(),
          };
          return [task, ...prev];
        });

        try {
          uploadStartedAtRef.current.set(job.taskId, Date.now());
          const ctrl = startDirectUpload(
            file,
            targetParent,
            tgConfig,
            (progress) => updateTransferTask(job.taskId, progress),
            { itemIdOverride: job.itemId },
          );
          transferCancelMap.current.set(job.taskId, ctrl.cancel);
          const createdItem = await ctrl.promise;
          transferCancelMap.current.delete(job.taskId);
          const startedAt = uploadStartedAtRef.current.get(job.taskId) ?? Date.now();
          const stats = uploadStatsRef.current.get(job.taskId);
          uploadStartedAtRef.current.delete(job.taskId);
          uploadStatsRef.current.delete(job.taskId);

          const remaining = removeOfflineUploadJob(job.taskId);
          setOfflineQueueCount(remaining.length);
          uploadedCount += 1;

          const elapsedSeconds = stats?.elapsedSeconds ?? Math.max(0.1, (Date.now() - startedAt) / 1000);
          const speedBytesPerSec =
            stats?.speedBytesPerSec ?? (elapsedSeconds > 0 ? file.size / elapsedSeconds : undefined);

          appendUploadHistory({
            taskId: job.taskId,
            filename,
            size: file.size,
            parentId: targetParent,
            status: 'success',
            speedBytesPerSec,
            elapsedSeconds,
            totalChunks: createdItem.chunks.length || stats?.totalChunks || 1,
          });

          commitItems(
            (prev) => {
              const existing = prev.find((i) => i.id === job.itemId);
              const finalized: DriveItem = existing
                ? {
                    ...createdItem,
                    id: job.itemId,
                    name: existing.name,
                    parentId: existing.parentId,
                    starred: existing.starred,
                    trashed: existing.trashed,
                    trashedAt: existing.trashedAt,
                    pendingOfflineUpload: undefined,
                  }
                : createdItem;
              return [
                finalized,
                ...prev.filter((i) => i.id !== job.itemId && i.id !== createdItem.id),
              ];
            },
            {
              deferIndexPush: true,
              dirtyFolderIds: [targetParent || 'ROOT'],
              dirtyItemIds: [job.itemId],
            },
          );
        } catch (err) {
          transferCancelMap.current.delete(job.taskId);
          uploadStartedAtRef.current.delete(job.taskId);
          uploadStatsRef.current.delete(job.taskId);
          const msg = err instanceof Error ? err.message : 'Gagal mengunggah antrean offline.';
          updateTransferTask(job.taskId, { status: 'error', errorMessage: msg });
          appendUploadHistory({
            taskId: job.taskId,
            filename,
            size: file.size,
            parentId: targetParent,
            status: msg === 'Dibatalkan' ? 'cancelled' : 'error',
            errorMessage: msg,
          });
        }
      }
    } finally {
      offlineFlushInFlightRef.current = false;
      if (uploadedCount > 0) {
        setCloudPushTick((t) => t + 1);
        pushNotification({
          kind: 'success',
          title: `${uploadedCount} file antrean offline berhasil diunggah`,
          detail: 'Semua perubahan lokal kini tersimpan aman di Cloud Telegram.',
        });
      }
    }
  }, [tgConfig, commitItems, updateTransferTask, pushNotification, appendUploadHistory]);

  // Google Drive calm background sync: startup, tab focus/visibility, online reconnect, and 30s delta check
  useEffect(() => {
    if (!tgConfig.connected || !tgConfig.botToken || !tgConfig.chatId) return;

    if (!didAutoSyncRef.current) {
      didAutoSyncRef.current = true;
      void syncFromTelegram(true);
    }

    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      void flushOfflineUploadQueue();
    }

    const onVisibilityOrFocus = () => {
      if (
        document.visibilityState === 'visible' &&
        activeUploadCountRef.current === 0 &&
        Date.now() - lastSyncMsRef.current > 8_000
      ) {
        void syncFromTelegram(true);
      }
    };

    const onBackOnline = () => {
      pushNotification({
        kind: 'info',
        title: 'Koneksi internet tersambung kembali',
        detail: 'Mengunggah antrean offline & menyinkronkan data terbaru...',
      });
      void flushOfflineUploadQueue().then(() => {
        if (dirtyFolderIdsRef.current.size > 0 || dirtyItemIdsRef.current.size > 0) {
          setCloudPushTick((t) => t + 1);
        }
        void syncFromTelegram(true);
      });
    };

    const intervalId = window.setInterval(() => {
      if (
        document.visibilityState === 'visible' &&
        activeUploadCountRef.current === 0 &&
        Date.now() - lastSyncMsRef.current > 25_000
      ) {
        void syncFromTelegram(true);
      }
    }, 30_000);

    window.addEventListener('focus', onVisibilityOrFocus);
    window.addEventListener('online', onBackOnline);
    document.addEventListener('visibilitychange', onVisibilityOrFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onVisibilityOrFocus);
      window.removeEventListener('online', onBackOnline);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
    };
  }, [
    tgConfig.connected,
    tgConfig.botToken,
    tgConfig.chatId,
    syncFromTelegram,
    flushOfflineUploadQueue,
    pushNotification,
  ]);

  // Automatic day/night clock check (06:00-17:59 Terang, 18:00-05:59 Gelap)
  useEffect(() => {
    const syncClock = () => setIsNightNow(isNightHour());
    syncClock();
    const intervalId = window.setInterval(syncClock, 30_000);
    document.addEventListener('visibilitychange', syncClock);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', syncClock);
    };
  }, []);

  const effectiveDark = themeMode === 'auto' ? isNightNow : themeMode === 'dark';

  // Sync dark mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (effectiveDark) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [effectiveDark]);

  const handleCycleThemeMode = () => {
    const nextMode: ThemeMode =
      themeMode === 'auto' ? 'light' : themeMode === 'light' ? 'dark' : 'auto';
    setThemeMode(nextMode);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextMode);
    } catch {
      // ignore
    }
    pushNotification({
      kind: 'info',
      title:
        nextMode === 'auto'
          ? 'Tema Otomatis aktif'
          : nextMode === 'light'
            ? 'Tema Terang aktif'
            : 'Tema Gelap aktif',
      detail:
        nextMode === 'auto'
          ? 'Terang otomatis pada siang hari (06:00–17:59) & gelap pada malam hari.'
          : undefined,
    });
  };

  const summary: StorageSummary = useMemo(() => computeStorageSummary(items), [items]);
  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      if (!item.trashed && item.parentId) {
        counts[item.parentId] = (counts[item.parentId] || 0) + 1;
      }
    }
    return counts;
  }, [items]);
  const breadcrumbs = useMemo(
    () => buildBreadcrumbs(currentFolderId, items),
    [currentFolderId, items],
  );

  const currentFolderName = useMemo(
    () =>
      currentFolderId
        ? items.find((i) => i.id === currentFolderId && i.type === 'folder')?.name
        : undefined,
    [currentFolderId, items],
  );

  const visibleItems = useMemo(
    () =>
      filterAndSortItems(items, {
        section,
        currentFolderId,
        searchQuery: debouncedSearchQuery,
        searchScope,
        typeFilter,
        sizeFilter,
        sortField,
        sortDirection,
      }),
    [
      items,
      section,
      currentFolderId,
      debouncedSearchQuery,
      searchScope,
      typeFilter,
      sizeFilter,
      sortField,
      sortDirection,
    ],
  );

  const pagedItems = useMemo(
    () => visibleItems.slice(0, renderLimit),
    [visibleItems, renderLimit],
  );

  // Auto-load next 100-item batch as the user scrolls near the bottom of the list
  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || visibleItems.length <= renderLimit) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setRenderLimit((prev) => prev + 100);
        }
      },
      { root: mainRef.current, rootMargin: '240px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleItems.length, renderLimit]);

  const handleCopyIds = useCallback(
    (ids: string[]) => {
      const valid = ids.filter((id) => items.some((i) => i.id === id && !i.trashed));
      if (valid.length === 0) return;
      setClipboardIds(valid);
      const singleName = valid.length === 1 ? items.find((i) => i.id === valid[0])?.name : null;
      pushNotification({
        kind: 'info',
        title: singleName ? `Disalin: ${singleName}` : `${valid.length} item disalin`,
        detail: 'Buka folder tujuan lalu klik Tempel (atau tekan Ctrl+V).',
      });
    },
    [items, pushNotification],
  );

  const handlePasteItems = useCallback(() => {
    if (clipboardIds.length === 0 || section === 'trash') return;
    const targetParentId = section === 'my-drive' ? currentFolderId : null;
    const targetFolderName =
      targetParentId === null
        ? 'Drive Saya'
        : items.find((i) => i.id === targetParentId)?.name || 'Folder tujuan';

    const now = new Date().toISOString();
    let createdItems: DriveItem[] = [];

    commitItems(
      (prev) => {
        createdItems = cloneDriveItemsForPaste(
          clipboardIds,
          prev,
          targetParentId,
          now,
          (type) => `${type === 'folder' ? 'fld' : 'file'}-${crypto.randomUUID()}`,
        );
        return createdItems.length > 0 ? [...createdItems, ...prev] : prev;
      },
      { deferIndexPush: true },
    );

    if (createdItems.length > 0) {
      const dirtyFolders = Array.from(new Set(createdItems.map((c) => c.parentId || 'ROOT')));
      for (const c of createdItems) {
        if (c.type === 'folder') dirtyFolders.push(c.id);
      }
      markDirtyScope(
        dirtyFolders,
        createdItems.map((c) => c.id),
      );
      setCloudPushTick((t) => t + 1);
      pushNotification({
        kind: 'success',
        title: `Berhasil menempel ${createdItems.length} item`,
        detail: `Ditempatkan di ${targetFolderName}.`,
      });
    } else {
      pushNotification({
        kind: 'error',
        title: 'Tidak dapat menempel di sini',
        detail: 'Folder tidak dapat ditempel ke dalam dirinya sendiri.',
      });
    }
  }, [clipboardIds, section, currentFolderId, items, commitItems, markDirtyScope, pushNotification]);

  const handleDropMoveToFolder = useCallback(
    (ids: string[], targetFolderId: string | null) => {
      const now = new Date().toISOString();
      const idSet = new Set(ids);
      const sourceFolders = itemsRef.current
        .filter((i) => idSet.has(i.id))
        .map((i) => i.parentId || 'ROOT');
      let movedCount = 0;

      commitItems(
        (prev) => {
          const result = applyMoveItems(ids, targetFolderId, prev, now);
          movedCount = result.movedCount;
          return result.nextItems;
        },
        {
          dirtyFolderIds: [...sourceFolders, targetFolderId || 'ROOT'],
          dirtyItemIds: ids,
        },
      );

      setDraggingIds([]);
      setSelectedIds(new Set());

      if (movedCount > 0) {
        const destName =
          targetFolderId === null
            ? 'Drive Saya'
            : items.find((i) => i.id === targetFolderId)?.name || 'Folder';
        pushNotification({
          kind: 'success',
          title: `Dipindahkan ke ${destName}`,
          detail: `${movedCount} item berhasil dipindahkan.`,
        });
      }
    },
    [commitItems, items, pushNotification],
  );

  // Complete PC keyboard shortcuts (`/`, `Ctrl+A`, `Ctrl+C`, `Ctrl+V`, `Arrow` nav, `Enter`, `F2`, `Delete`, `Backspace`, `Escape`)
  const shiftAnchorIdRef = useRef<string | null>(null);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditingInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const anyModalOpen = Boolean(
        previewItem ||
          telegramModalOpen ||
          nameModal.open ||
          deleteModal.open ||
          moveModal.open ||
          duplicatesModalOpen ||
          contextMenu,
      );

      if (e.key === 'Escape') {
        if (anyModalOpen) {
          setContextMenu(null);
          setPreviewItem(null);
          setTelegramModalOpen(false);
          setNameModal((prev) => ({ ...prev, open: false }));
          setDeleteModal({ open: false, variant: 'permanent', ids: [] });
          setMoveModal({ open: false, ids: [] });
          setDuplicatesModalOpen(false);
        } else if (selectedIds.size > 0) {
          setSelectedIds(new Set());
        }
        return;
      }

      if (isEditingInput || anyModalOpen) return;

      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        if (visibleItems.length > 0) {
          e.preventDefault();
          setSelectedIds(new Set(visibleItems.map((i) => i.id)));
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (selectedIds.size > 0) {
          e.preventDefault();
          handleCopyIds(Array.from(selectedIds));
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (clipboardIds.length > 0) {
          e.preventDefault();
          handlePasteItems();
        }
      } else if (
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight'
      ) {
        if (pagedItems.length === 0) return;
        e.preventDefault();

        let gridCols = 1;
        if (viewMode === 'grid' && mainRef.current) {
          const cards = Array.from(mainRef.current.querySelectorAll<HTMLElement>('[data-drive-item]'));
          if (cards.length > 1) {
            const firstTop = Math.round(cards[0].getBoundingClientRect().top);
            let cols = 0;
            for (const card of cards) {
              if (Math.abs(Math.round(card.getBoundingClientRect().top) - firstTop) <= 6) {
                cols += 1;
              } else {
                break;
              }
            }
            if (cols > 0) gridCols = cols;
          }
        }

        const step =
          e.key === 'ArrowLeft'
            ? -1
            : e.key === 'ArrowRight'
              ? 1
              : e.key === 'ArrowUp'
                ? -gridCols
                : gridCols;

        const currId = lastSelectedIdRef.current;
        const currIdx = currId ? pagedItems.findIndex((i) => i.id === currId) : -1;
        const nextIdx =
          currIdx === -1
            ? step > 0
              ? 0
              : pagedItems.length - 1
            : Math.max(0, Math.min(pagedItems.length - 1, currIdx + step));
        const nextItem = pagedItems[nextIdx];
        if (!nextItem) return;

        if (e.shiftKey) {
          const anchorIdxRaw = shiftAnchorIdRef.current
            ? pagedItems.findIndex((i) => i.id === shiftAnchorIdRef.current)
            : currIdx;
          const anchorIdx = anchorIdxRaw >= 0 ? anchorIdxRaw : 0;
          if (!shiftAnchorIdRef.current) {
            shiftAnchorIdRef.current = pagedItems[anchorIdx].id;
          }
          const [from, to] = anchorIdx < nextIdx ? [anchorIdx, nextIdx] : [nextIdx, anchorIdx];
          const rangeIds = new Set<string>();
          for (let i = from; i <= to; i += 1) {
            rangeIds.add(pagedItems[i].id);
          }
          setSelectedIds(rangeIds);
        } else {
          shiftAnchorIdRef.current = nextItem.id;
          setSelectedIds(new Set([nextItem.id]));
        }
        lastSelectedIdRef.current = nextItem.id;
        mainRef.current
          ?.querySelector<HTMLElement>(`[data-drive-item="${nextItem.id}"]`)
          ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } else if (e.key === 'Enter' && selectedIds.size === 1) {
        const target = visibleItems.find((i) => selectedIds.has(i.id));
        if (!target) return;
        e.preventDefault();
        if (target.type === 'folder') {
          handleNavigateFolder(target.id);
        } else {
          handleDoubleClickItem(target);
        }
      } else if (e.key === 'F2' && !isTrashView && selectedIds.size === 1) {
        const target = visibleItems.find((i) => selectedIds.has(i.id));
        if (!target) return;
        e.preventDefault();
        setNameModal({ open: true, mode: 'rename', targetItem: target });
      } else if (e.key === 'Delete' && selectedIds.size > 0) {
        e.preventDefault();
        const chosen = visibleItems.filter((i) => selectedIds.has(i.id));
        if (chosen.length === 0) return;
        if (isTrashView) {
          openPermanentDeleteConfirmation(chosen);
        } else {
          openTrashConfirmation(chosen);
        }
      } else if (e.key === 'Backspace' && section === 'my-drive' && currentFolderId) {
        e.preventDefault();
        const currFolder = items.find((i) => i.id === currentFolderId);
        handleNavigateFolder(currFolder?.parentId ?? null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const handleSelectSection = (next: NavSection) => {
    setSection(next);
    setSelectedIds(new Set());
    if (next !== 'my-drive') {
      setCurrentFolderId(null);
      setSearchScope('all');
    }
  };

  const handleNavigateFolder = (folderId: string | null) => {
    setSection('my-drive');
    setSearchQuery('');
    setDebouncedSearchQuery('');
    if (!folderId) {
      setSearchScope('all');
    }
    setRenderLimit(100);
    setCurrentFolderId(folderId);
    setSelectedIds(new Set());
    if (folderId) {
      void ensureFolderLoaded(folderId);
    }
  };

  const handleViewModeChange = (nextMode: ViewMode) => {
    setViewMode(nextMode);
    const updated: CloudViewPrefs = {
      ...viewPrefsRef.current,
      v: nextMode,
      u: new Date().toISOString(),
    };
    viewPrefsRef.current = updated;
    saveStoredViewPrefs(updated);
    broadcastLocalStateToTabs();
    setCloudPushTick((t) => t + 1);
  };

  const handleSortChange = (field: SortField) => {
    const nextDirection: SortDirection =
      field === sortField
        ? sortDirection === 'asc'
          ? 'desc'
          : 'asc'
        : field === 'updatedAt'
          ? 'desc'
          : 'asc';
    setSortField(field);
    setSortDirection(nextDirection);
    const updated: CloudViewPrefs = {
      ...viewPrefsRef.current,
      sf: field,
      sd: nextDirection,
      u: new Date().toISOString(),
    };
    viewPrefsRef.current = updated;
    saveStoredViewPrefs(updated);
    broadcastLocalStateToTabs();
    setCloudPushTick((t) => t + 1);
  };

  const handlePreviewWidthChange = useCallback((nextWidth: number) => {
    const clamped = Math.round(Math.max(280, Math.min(740, nextWidth)));
    setPreviewPaneWidth(clamped);
    try {
      localStorage.setItem(PREVIEW_WIDTH_KEY, String(clamped));
    } catch {
      // ignore
    }
  }, []);

  const pumpUploadQueue = useCallback(() => {
    while (activeUploadCountRef.current < UPLOAD_CONCURRENCY && uploadQueueRef.current.length > 0) {
      const nextJob = uploadQueueRef.current.shift();
      if (!nextJob) break;

      activeUploadCountRef.current += 1;
      batchStartedCountRef.current += 1;
      uploadStartedAtRef.current.set(nextJob.taskId, Date.now());
      updateTransferTask(nextJob.taskId, {
        status: 'active',
        statusLabel: undefined,
        errorMessage: undefined,
        canRetry: false,
      });

      const ctrl = startDirectUpload(
        nextJob.file,
        nextJob.targetParent,
        nextJob.tgSnapshot,
        (progress) => {
          updateTransferTask(nextJob.taskId, progress);
        },
      );
      transferCancelMap.current.set(nextJob.taskId, ctrl.cancel);

      ctrl.promise
        .then((createdItem) => {
          transferCancelMap.current.delete(nextJob.taskId);
          failedUploadJobsRef.current.delete(nextJob.taskId);
          const startedAt = uploadStartedAtRef.current.get(nextJob.taskId) ?? Date.now();
          const stats = uploadStatsRef.current.get(nextJob.taskId);
          uploadStartedAtRef.current.delete(nextJob.taskId);
          uploadStatsRef.current.delete(nextJob.taskId);

          const elapsedSeconds =
            stats?.elapsedSeconds ?? Math.max(0.1, (Date.now() - startedAt) / 1000);
          const speedBytesPerSec =
            stats?.speedBytesPerSec ??
            (elapsedSeconds > 0 ? createdItem.size / elapsedSeconds : undefined);

          appendUploadHistory({
            taskId: nextJob.taskId,
            filename: createdItem.name,
            size: createdItem.size,
            parentId: createdItem.parentId,
            status: 'success',
            speedBytesPerSec,
            elapsedSeconds,
            totalChunks: createdItem.chunks.length || stats?.totalChunks || 1,
          });

          const hasMoreQueued = uploadQueueRef.current.length > 0;
          if (nextJob.isBatch) {
            batchSuccessCountRef.current += 1;
          }
          // Defer pinned index updates while batch queue has remaining items (checkpoint every 15 files)
          const shouldCheckpoint =
            !hasMoreQueued || (nextJob.isBatch && batchSuccessCountRef.current % 15 === 0);
          commitItems(
            (prev) => [createdItem, ...prev.filter((i) => i.id !== createdItem.id)],
            {
              deferIndexPush: !shouldCheckpoint,
              dirtyFolderIds: [createdItem.parentId || 'ROOT'],
              dirtyItemIds: [createdItem.id],
            },
          );
          if (!nextJob.isBatch) {
            pushNotification({
              kind: 'success',
              title: `Unggahan selesai: ${createdItem.name}`,
              detail: 'Tersimpan di Cloud Telegram & tersinkron.',
            });
          }
        })
        .catch((err) => {
          transferCancelMap.current.delete(nextJob.taskId);
          uploadStartedAtRef.current.delete(nextJob.taskId);
          uploadStatsRef.current.delete(nextJob.taskId);
          const msg = err instanceof Error ? err.message : 'Unggahan gagal.';
          const canRetry = msg !== 'Dibatalkan';
          if (canRetry) {
            failedUploadJobsRef.current.set(nextJob.taskId, {
              file: nextJob.file,
              targetParent: nextJob.targetParent,
              isBatch: nextJob.isBatch,
            });
          }
          updateTransferTask(nextJob.taskId, {
            status: canRetry ? 'error' : 'cancelled',
            statusLabel: undefined,
            errorMessage: msg,
            canRetry,
          });
          appendUploadHistory({
            taskId: nextJob.taskId,
            filename: nextJob.file.name,
            size: nextJob.file.size,
            parentId: nextJob.targetParent,
            status: canRetry ? 'error' : 'cancelled',
            errorMessage: msg,
          });
          if (canRetry) {
            pushNotification({
              kind: 'error',
              title: `Gagal mengunggah ${nextJob.file.name}`,
              detail: msg,
            });
          }
        })
        .finally(() => {
          activeUploadCountRef.current = Math.max(0, activeUploadCountRef.current - 1);
          const queueEmpty =
            activeUploadCountRef.current === 0 && uploadQueueRef.current.length === 0;
          if (queueEmpty) {
            const count = batchSuccessCountRef.current;
            batchSuccessCountRef.current = 0;
            batchStartedCountRef.current = 0;
            if (nextJob.isBatch && count > 0) {
              // Ensure final index push runs once at batch completion
              setCloudPushTick((t) => t + 1);
              pushNotification({
                kind: 'success',
                title: `${count} file selesai diunggah`,
                detail: 'Semua file tersimpan di Cloud Telegram & indeks tersinkron.',
              });
            }
            return;
          }

          pumpUploadQueue();
        });
    }
  }, [commitItems, pushNotification, updateTransferTask, appendUploadHistory]);

  const handleRetryFailedTasks = useCallback(
    (taskIds: string[]) => {
      if (!tgConfig.connected || !tgConfig.botToken || !tgConfig.chatId) {
        return;
      }

      let requeuedCount = 0;
      for (const taskId of taskIds) {
        const failed = failedUploadJobsRef.current.get(taskId);
        if (!failed) continue;
        failedUploadJobsRef.current.delete(taskId);

        const existingTimer = transferRemovalTimers.current.get(taskId);
        if (existingTimer) {
          window.clearTimeout(existingTimer);
          transferRemovalTimers.current.delete(taskId);
        }

        updateTransferTask(taskId, {
          status: 'queued',
          loadedBytes: 0,
          speedBytesPerSec: 0,
          etaSeconds: 0,
          statusLabel: undefined,
          errorMessage: undefined,
          canRetry: false,
        });

        uploadQueueRef.current.push({
          taskId,
          file: failed.file,
          targetParent: failed.targetParent,
          tgSnapshot: tgConfig,
          isBatch: taskIds.length > 1 || failed.isBatch,
        });

        transferCancelMap.current.set(taskId, () => {
          uploadQueueRef.current = uploadQueueRef.current.filter((job) => job.taskId !== taskId);
        });
        requeuedCount += 1;
      }

      if (requeuedCount > 0) {
        pumpUploadQueue();
      }
    },
    [tgConfig, updateTransferTask, pumpUploadQueue],
  );

  const enqueueTreeUpload = useCallback(
    (tree: DroppedTreeResult, overrideParentId?: string | null) => {
      const validEntries = tree.files.filter((entry) => entry.file.name);
      const hasEmptyFolders = tree.emptyFolderPaths.length > 0;
      if (validEntries.length === 0 && !hasEmptyFolders) {
        if (tree.skippedUnreadableCount > 0) {
          pushNotification({
            kind: 'error',
            title: 'File/folder tidak dapat dibaca',
            detail: 'Pastikan item tidak terkunci atau dipindahkan sebelum dilepas.',
          });
        }
        return;
      }

      if (!tgConfig.connected || !tgConfig.botToken || !tgConfig.chatId) {
        setTelegramModalOpen(true);
        return;
      }

      const oversized = validEntries.filter((e) => e.file.size > MAX_BROWSER_UPLOAD_BYTES);
      const uploadableEntries = validEntries.filter(
        (e) => e.file.size <= MAX_BROWSER_UPLOAD_BYTES,
      );

      const baseParentId =
        overrideParentId !== undefined
          ? overrideParentId
          : section === 'my-drive'
            ? currentFolderId
            : null;
      const destLabel = baseParentId
        ? itemsRef.current.find((i) => i.id === baseParentId)?.name || 'Folder tujuan'
        : 'Drive Saya';

      if (oversized.length > 0) {
        for (const item of oversized) {
          const folderLabel =
            item.folderPath.length > 0
              ? `${resolveFolderPathLabel(baseParentId)} / ${item.folderPath.join(' / ')}`
              : resolveFolderPathLabel(baseParentId);
          appendUploadHistory({
            filename: item.file.name,
            size: item.file.size,
            parentId: baseParentId,
            folderPathLabel: folderLabel,
            status: 'error',
            errorMessage: 'Melebihi batas aman browser (2 GB/file)',
          });
        }
        pushNotification({
          kind: 'error',
          title: 'Upload ditolak: File melebihi batas aman browser (2 GB)',
          detail:
            oversized.length === 1
              ? `"${oversized[0].file.name}" (${formatBytes(oversized[0].file.size)}) melebihi batas 2 GB/file.`
              : `${oversized.length} file melebihi batas aman 2 GB/file (${oversized[0].file.name}, ...).`,
        });
      }

      // Create folder hierarchy for uploadable files + empty folders
      const allFolderPaths = [
        ...uploadableEntries.map((e) => e.folderPath),
        ...tree.emptyFolderPaths,
      ].filter((p) => p.length > 0);

      let resolveParentId: (path: string[]) => string | null = () => baseParentId;
      let createdFoldersCount = 0;
      const createdFolderIds = new Set<string>();

      if (allFolderPaths.length > 0) {
        const nowIso = new Date().toISOString();
        const materialized = materializeFolderTree(
          itemsRef.current,
          baseParentId,
          allFolderPaths,
          nowIso,
          () => `fld-${crypto.randomUUID()}`,
        );
        resolveParentId = materialized.resolveParentId;
        createdFoldersCount = materialized.createdFolders.length;
        for (const folder of materialized.createdFolders) {
          createdFolderIds.add(folder.id);
        }
        if (createdFoldersCount > 0) {
          const dirtyFolderScope = [
            baseParentId || 'ROOT',
            ...materialized.createdFolders.map((f) => f.parentId || 'ROOT'),
            ...materialized.createdFolders.map((f) => f.id),
          ];
          commitItems((prev) => [...materialized.createdFolders, ...prev], {
            dirtyFolderIds: dirtyFolderScope,
            dirtyItemIds: materialized.createdFolders.map((f) => f.id),
            deferIndexPush: uploadableEntries.length > 0,
          });
        }
      }

      if (uploadableEntries.length === 0) {
        if (createdFoldersCount > 0) {
          pushNotification({
            kind: 'success',
            title: `${createdFoldersCount} folder dibuat di ${destLabel}`,
          });
        }
        return;
      }

      void (async () => {
        // Hydrate any pre-existing target folders in V4 mode so resume skip checks real folder contents
        const existingTargetFolderIds = new Set<string>();
        for (const entry of uploadableEntries) {
          const pId = resolveParentId(entry.folderPath);
          if (pId && !createdFolderIds.has(pId)) {
            existingTargetFolderIds.add(pId);
          }
        }
        for (const fId of existingTargetFolderIds) {
          const folderNode = itemsRef.current.find((i) => i.id === fId && i.type === 'folder');
          if (folderNode?.folderIdx?.mid) {
            await ensureFolderLoaded(fId);
          }
        }

        const { entriesToUpload, skippedDuplicateCount } = filterDuplicateUploadEntries(
          uploadableEntries,
          resolveParentId,
          itemsRef.current,
          uploadQueueRef.current.map((job) => ({
            filename: job.file.name,
            size: job.file.size,
            targetParent: job.targetParent,
          })),
        );

        if (entriesToUpload.length === 0) {
          if (createdFoldersCount > 0) {
            setCloudPushTick((t) => t + 1);
          }
          if (skippedDuplicateCount > 0) {
            pushNotification({
              kind: 'info',
              title: `${skippedDuplicateCount} file sudah ada, dilewati otomatis`,
              detail:
                createdFoldersCount > 0
                  ? `${createdFoldersCount} folder baru dibuat di ${destLabel}; semua file dengan nama & ukuran sama dilewati.`
                  : `Semua file sudah tersimpan di ${destLabel} dengan nama dan ukuran yang sama.`,
            });
          }
          return;
        }

        const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (isOffline) {
          const offlineSkippedLarge = entriesToUpload.filter(
            (e) => e.entry.file.size > DIRECT_TELEGRAM_MAX_BYTES,
          );
          const offlineEntries = entriesToUpload.filter(
            (e) => e.entry.file.size <= DIRECT_TELEGRAM_MAX_BYTES,
          );
          if (offlineSkippedLarge.length > 0) {
            for (const skipped of offlineSkippedLarge) {
              appendUploadHistory({
                filename: skipped.entry.file.name,
                size: skipped.entry.file.size,
                parentId: skipped.targetParent,
                status: 'error',
                errorMessage: 'File > 20 MB hanya bisa diunggah saat online',
              });
            }
            pushNotification({
              kind: 'error',
              title: `${offlineSkippedLarge.length} file > 20 MB perlu diunggah saat online`,
              detail: 'Saat offline, hanya file <= 20 MB yang diantrekan ke memori perangkat agar cache lokal tidak penuh.',
            });
          }
          if (offlineEntries.length === 0) return;

          const nowIso = new Date().toISOString();
          const offlineItems: DriveItem[] = [];
          const offlineJobs: OfflineUploadJob[] = [];
          const queuedTasks: TransferTask[] = [];
          const dirtyFolders = new Set<string>();

          for (const { entry, targetParent } of offlineEntries) {
            const taskId = `tr-${crypto.randomUUID()}`;
            const itemId = `file-${crypto.randomUUID()}`;
            const blobKey = `blob-${itemId}`;
            const mimeType = resolveMimeTypeForFilename(
              entry.file.name,
              entry.file.type || 'application/octet-stream',
            );
            await saveLocalBlob(blobKey, entry.file);

            offlineItems.push({
              id: itemId,
              name: entry.file.name,
              type: 'file',
              parentId: targetParent,
              size: entry.file.size,
              mimeType,
              starred: false,
              trashed: false,
              createdAt: nowIso,
              updatedAt: nowIso,
              storageBackend: 'telegram',
              localBlobKey: blobKey,
              pendingOfflineUpload: true,
              chunks: [],
            });
            offlineJobs.push({
              taskId,
              itemId,
              parentId: targetParent,
              blobKey,
              filename: entry.file.name,
              mimeType,
              size: entry.file.size,
              createdAt: Date.now(),
            });
            queuedTasks.push({
              id: taskId,
              kind: 'upload',
              filename: entry.file.name,
              totalBytes: entry.file.size,
              loadedBytes: 0,
              speedBytesPerSec: 0,
              etaSeconds: 0,
              completedChunks: 0,
              totalChunks: 1,
              status: 'queued',
              errorMessage: 'Menunggu koneksi internet...',
              createdAt: Date.now(),
            });
            dirtyFolders.add(targetParent || 'ROOT');
          }

          const updatedQueue = enqueueOfflineUploadJobs(offlineJobs);
          setOfflineQueueCount(updatedQueue.length);

          commitItems((prev) => [...offlineItems, ...prev], {
            deferIndexPush: true,
            dirtyFolderIds: Array.from(dirtyFolders),
            dirtyItemIds: offlineItems.map((i) => i.id),
          });
          setTransfers((prev) => [...queuedTasks, ...prev]);
          pushNotification({
            kind: 'info',
            title: `${offlineEntries.length} file masuk antrean offline`,
            detail: `Disimpan lokal di perangkat & otomatis diunggah ke ${destLabel} saat internet tersambung.`,
          });
          return;
        }

        const isBatch =
          entriesToUpload.length > 1 || createdFoldersCount > 0 || skippedDuplicateCount > 0;
        const skipNote =
          skippedDuplicateCount > 0 ? ` (${skippedDuplicateCount} duplikat dilewati)` : '';

        if (entriesToUpload.length === 1 && createdFoldersCount === 0 && skippedDuplicateCount === 0) {
          pushNotification({
            kind: 'info',
            title: `Mengunggah ${entriesToUpload[0].entry.file.name}`,
            detail: `Dikirim cepat ke ${destLabel} (Cloud Telegram).`,
          });
        } else {
          const folderNote = createdFoldersCount > 0 ? `${createdFoldersCount} folder & ` : '';
          pushNotification({
            kind: 'info',
            title: `Mengantrekan ${folderNote}${entriesToUpload.length} file ke ${destLabel}${skipNote}`,
            detail:
              skippedDuplicateCount > 0
                ? `${skippedDuplicateCount} file yang sudah ada dilewati otomatis untuk melanjutkan upload.`
                : 'Diproses satu per satu sampai selesai agar upload cepat & koneksi tetap stabil.',
          });
        }

        const createdTasks: TransferTask[] = [];
        for (const { entry, targetParent } of entriesToUpload) {
          const taskId = `tr-${crypto.randomUUID()}`;
          const chunkTotal = computeByteSlices(entry.file.size, CHUNK_SIZE_BYTES).length;
          createdTasks.push({
            id: taskId,
            kind: 'upload',
            filename: entry.file.name,
            totalBytes: entry.file.size,
            loadedBytes: 0,
            speedBytesPerSec: 0,
            etaSeconds: 0,
            completedChunks: 0,
            totalChunks: chunkTotal,
            status: 'queued',
            createdAt: Date.now(),
          });

          uploadQueueRef.current.push({
            taskId,
            file: entry.file,
            targetParent,
            tgSnapshot: tgConfig,
            isBatch,
          });

          transferCancelMap.current.set(taskId, () => {
            uploadQueueRef.current = uploadQueueRef.current.filter((job) => job.taskId !== taskId);
          });
        }

        setTransfers((prev) => [...createdTasks, ...prev]);
        pumpUploadQueue();
      })();
    },
    [
      commitItems,
      currentFolderId,
      ensureFolderLoaded,
      section,
      tgConfig,
      pumpUploadQueue,
      pushNotification,
      appendUploadHistory,
      resolveFolderPathLabel,
    ],
  );

  const enqueueFilesUpload = useCallback(
    (fileList: FileList | File[], overrideParentId?: string | null) => {
      enqueueTreeUpload(extractTreeFromFileList(fileList), overrideParentId);
    },
    [enqueueTreeUpload],
  );

  const handleDropExternalPayload = useCallback(
    (payload: CapturedDropPayload, overrideParentId?: string | null) => {
      void extractDroppedTree(payload).then((tree) => {
        enqueueTreeUpload(tree, overrideParentId);
      });
    },
    [enqueueTreeUpload],
  );

  const handleDownloadItem = useCallback(
    (item: DriveItem) => {
      if (item.type !== 'file') return;

      void (async () => {
        let targetItem = item;
        if (targetItem.isCatalogStub && targetItem.parentId) {
          await ensureFolderLoaded(targetItem.parentId);
          targetItem = itemsRef.current.find((i) => i.id === targetItem.id) || targetItem;
        }

        const taskId = `dl-${crypto.randomUUID()}`;
        const downloadTask: TransferTask = {
          id: taskId,
          kind: 'download',
          filename: targetItem.name,
          totalBytes: targetItem.size,
          loadedBytes: 0,
          speedBytesPerSec: 0,
          etaSeconds: 0,
          completedChunks: 0,
          totalChunks: Math.max(1, targetItem.chunks?.length || 1),
          status: 'active',
          createdAt: Date.now(),
        };
        setTransfers((prev) => [downloadTask, ...prev]);

        const ctrl = startDirectDownload(targetItem, tgConfig, (progress) => {
          updateTransferTask(taskId, progress);
        });
        transferCancelMap.current.set(taskId, ctrl.cancel);

        ctrl.promise
          .then((res) => {
            transferCancelMap.current.delete(taskId);
            if (res?.usedRawFallback) {
              pushNotification({
                kind: 'info',
                title: `Unduhan dialihkan ke Telegram: ${targetItem.name}`,
                detail:
                  'Aktifkan Proxy Cloudflare Worker di Pengaturan Telegram agar HP langsung menyimpan file dengan nama dan format asli.',
              });
            } else {
              pushNotification({
                kind: 'success',
                title: `Unduhan selesai: ${targetItem.name}`,
              });
            }
          })
          .catch((err) => {
            transferCancelMap.current.delete(taskId);
            const msg = err instanceof Error ? err.message : 'Unduhan gagal.';
            const cancelled = msg === 'Dibatalkan';
            updateTransferTask(taskId, {
              status: cancelled ? 'cancelled' : 'error',
              errorMessage: msg,
            });
            if (!cancelled) {
              pushNotification({
                kind: 'error',
                title: `Gagal mengunduh ${targetItem.name}`,
                detail: msg,
              });
            }
          });
      })();
    },
    [tgConfig, ensureFolderLoaded, updateTransferTask, pushNotification],
  );

  const handleDownloadZip = useCallback(
    (targets: DriveItem[]) => {
      const validTargets = targets.filter((t) => !t.trashed);
      if (validTargets.length === 0) return;

      const archiveName = buildZipArchiveFilename(validTargets);
      const taskId = `zip-${crypto.randomUUID()}`;
      const zipTask: TransferTask = {
        id: taskId,
        kind: 'download',
        filename: archiveName,
        totalBytes: validTargets.reduce((acc, i) => acc + (i.type === 'file' ? i.size : 0), 0) || 1,
        loadedBytes: 0,
        speedBytesPerSec: 0,
        etaSeconds: 0,
        elapsedSeconds: 0,
        completedChunks: 0,
        totalChunks: 1,
        status: 'active',
        statusLabel: 'Menyiapkan arsip ZIP...',
        createdAt: Date.now(),
      };
      setTransfers((prev) => [zipTask, ...prev]);

      const ctrl = startZipDownload({
        targets: validTargets,
        getLatestItems: () => itemsRef.current,
        tgConfig,
        ensureFolderLoaded: (folderId) => ensureFolderLoaded(folderId),
        onProgress: (progress) => {
          updateTransferTask(taskId, progress);
        },
      });
      transferCancelMap.current.set(taskId, ctrl.cancel);

      ctrl.promise
        .then(({ fileCount, skippedCount }) => {
          transferCancelMap.current.delete(taskId);
          pushNotification({
            kind: 'success',
            title: `ZIP selesai: ${archiveName}`,
            detail:
              skippedCount > 0
                ? `${fileCount} file berhasil dikemas (${skippedCount} file gagal/dilewati).`
                : `${fileCount} file berhasil dikemas ke dalam arsip ZIP.`,
          });
        })
        .catch((err) => {
          transferCancelMap.current.delete(taskId);
          const msg = err instanceof Error ? err.message : 'Gagal membuat arsip ZIP.';
          const cancelled = msg === 'Dibatalkan';
          updateTransferTask(taskId, {
            status: cancelled ? 'cancelled' : 'error',
            errorMessage: msg,
          });
          if (!cancelled) {
            pushNotification({
              kind: 'error',
              title: `Gagal membuat ZIP ${archiveName}`,
              detail: msg,
            });
          }
        });
    },
    [tgConfig, ensureFolderLoaded, updateTransferTask, pushNotification],
  );

  const handleCancelTransfer = (id: string) => {
    const queuedJob = uploadQueueRef.current.find((job) => job.taskId === id);
    const cancelFn = transferCancelMap.current.get(id);
    if (cancelFn) {
      cancelFn();
      transferCancelMap.current.delete(id);
    }
    if (queuedJob) {
      appendUploadHistory({
        taskId: id,
        filename: queuedJob.file.name,
        size: queuedJob.file.size,
        parentId: queuedJob.targetParent,
        status: 'cancelled',
        errorMessage: 'Dibatalkan pengguna',
      });
    }
    const remainingOffline = removeOfflineUploadJob(id);
    setOfflineQueueCount(remainingOffline.length);
    updateTransferTask(id, { status: 'cancelled', errorMessage: 'Dibatalkan pengguna' });
  };

  const handleOpenItem = (item: DriveItem) => {
    if (item.type === 'folder') {
      handleNavigateFolder(item.id);
    } else {
      lastSelectedIdRef.current = item.id;
      setSelectedIds(new Set([item.id]));
      setPreviewPaneOpen(true);
      if (item.isCatalogStub) {
        void hydrateStubItem(item);
      }
    }
  };

  const handleDoubleClickItem = (item: DriveItem) => {
    if (item.type === 'file') {
      setPreviewItem(item);
      if (item.isCatalogStub) {
        void hydrateStubItem(item);
      }
    }
  };

  const handleToggleStar = (item: DriveItem) => {
    const nextStar = !item.starred;
    const now = new Date().toISOString();
    commitItems(
      (prev) => prev.map((i) => (i.id === item.id ? { ...i, starred: nextStar, updatedAt: now } : i)),
      { dirtyFolderIds: [item.parentId || 'ROOT'], dirtyItemIds: [item.id] },
    );
    if (previewItem?.id === item.id) {
      setPreviewItem({ ...previewItem, starred: nextStar });
    }
    pushNotification({
      kind: 'info',
      title: nextStar ? `Dibintangi: ${item.name}` : `Bintang dihapus: ${item.name}`,
    });
  };

  const handleToggleOfflinePinItems = useCallback(
    async (targetItems: DriveItem[]) => {
      const validTargets = targetItems.filter((i) => !i.trashed);
      if (validTargets.length === 0) return;

      const allPinned = validTargets.every((i) => offlinePinnedIds.has(i.id));
      if (allPinned) {
        const removeIds = new Set<string>();
        for (const item of validTargets) {
          if (item.type === 'folder') {
            for (const d of collectDescendantIds(item.id, itemsRef.current)) {
              removeIds.add(d);
            }
          } else {
            removeIds.add(item.id);
          }
        }
        const nextList = Array.from(offlinePinnedIds).filter((id) => !removeIds.has(id));
        const saved = saveOfflinePinnedItemIds(nextList);
        setOfflinePinnedIds(new Set(saved));
        pushNotification({
          kind: 'info',
          title: 'Dihapus dari simpanan offline',
          detail: `${validTargets.length} item tidak lagi dikunci di memori perangkat.`,
        });
        return;
      }

      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (!isOffline) {
        for (const item of validTargets) {
          if (item.type === 'folder') {
            await ensureFolderLoaded(item.id);
          } else if (item.isCatalogStub) {
            await hydrateStubItem(item);
          }
        }
      }

      const pinIds = new Set<string>(offlinePinnedIds);
      const filesToDownload: DriveItem[] = [];
      for (const target of validTargets) {
        const latest = itemsRef.current.find((i) => i.id === target.id) || target;
        if (latest.type === 'folder') {
          for (const dId of collectDescendantIds(latest.id, itemsRef.current)) {
            const node = itemsRef.current.find((x) => x.id === dId);
            if (!node || node.trashed) continue;
            pinIds.add(node.id);
            if (node.type === 'file') filesToDownload.push(node);
          }
        } else {
          pinIds.add(latest.id);
          filesToDownload.push(latest);
        }
      }

      const savedIds = saveOfflinePinnedItemIds(Array.from(pinIds));
      setOfflinePinnedIds(new Set(savedIds));

      let cachedCount = 0;
      let downloadedCount = 0;
      let skippedTooLargeOrOffline = 0;

      for (const file of filesToDownload) {
        const key = file.localBlobKey || `blob-${file.id}`;
        const alreadyLocal = await hasLocalBlob(key);
        if (alreadyLocal) {
          cachedCount += 1;
          continue;
        }
        if (isOffline || file.size > DIRECT_TELEGRAM_MAX_BYTES) {
          skippedTooLargeOrOffline += 1;
          continue;
        }
        try {
          await resolveItemArrayBuffer(file, tgConfig);
          downloadedCount += 1;
        } catch {
          skippedTooLargeOrOffline += 1;
        }
      }

      const readyCount = cachedCount + downloadedCount;
      pushNotification({
        kind: readyCount > 0 ? 'success' : 'info',
        title:
          downloadedCount > 0
            ? `${downloadedCount} file disimpan untuk akses offline`
            : `${readyCount} file siap dibuka offline`,
        detail:
          skippedTooLargeOrOffline > 0
            ? `${skippedTooLargeOrOffline} file tidak dapat diunduh sekarang (>20 MB atau sedang offline).`
            : 'Tersimpan permanen di perangkat tanpa ikut terhapus cache otomatis.',
      });
    },
    [offlinePinnedIds, tgConfig, ensureFolderLoaded, hydrateStubItem, pushNotification],
  );

  const handleCreateOrRename = async (name: string) => {
    const now = new Date().toISOString();
    if (nameModal.mode === 'create') {
      const targetParent = section === 'my-drive' ? currentFolderId : null;
      const cleanName = name.slice(0, 120);
      const folder: DriveItem = {
        id: `fld-${crypto.randomUUID()}`,
        name: cleanName,
        type: 'folder',
        parentId: targetParent,
        size: 0,
        mimeType: 'inode/directory',
        starred: false,
        trashed: false,
        createdAt: now,
        updatedAt: now,
        storageBackend: 'telegram',
        chunks: [],
      };
      commitItems((prev) => [folder, ...prev], {
        dirtyFolderIds: [targetParent || 'ROOT'],
        dirtyItemIds: [folder.id],
      });
      pushNotification({
        kind: 'success',
        title: `Folder dibuat: ${cleanName}`,
      });
    } else if (nameModal.targetItem) {
      const targetId = nameModal.targetItem.id;
      const cleanName = name.slice(0, 180);
      commitItems(
        (prev) => prev.map((i) => (i.id === targetId ? { ...i, name: cleanName, updatedAt: now } : i)),
        {
          dirtyFolderIds: [nameModal.targetItem.parentId || 'ROOT'],
          dirtyItemIds: [targetId],
        },
      );
      if (previewItem?.id === targetId) {
        setPreviewItem({ ...previewItem, name: cleanName });
      }
      pushNotification({
        kind: 'success',
        title: `Nama diubah menjadi ${cleanName}`,
      });
    }
  };

  const handleTrashOrRestore = (ids: string[], trashed: boolean) => {
    const now = new Date().toISOString();
    const expandedIds = new Set<string>();
    const dirtyFolders = new Set<string>();
    commitItems(
      (prev) => {
        for (const id of ids) {
          const target = prev.find((i) => i.id === id);
          if (!target) continue;
          if (target.type === 'folder') {
            for (const d of collectDescendantIds(target.id, prev)) expandedIds.add(d);
          } else {
            expandedIds.add(target.id);
          }
        }
        return prev.map((i) => {
          if (!expandedIds.has(i.id)) return i;
          dirtyFolders.add(i.parentId || 'ROOT');
          if (i.type === 'folder') dirtyFolders.add(i.id);
          return { ...i, trashed, trashedAt: trashed ? now : null, updatedAt: now };
        });
      },
      { deferIndexPush: true },
    );
    markDirtyScope(Array.from(dirtyFolders), Array.from(expandedIds));
    setCloudPushTick((t) => t + 1);
    setSelectedIds(new Set());
    pushNotification({
      kind: 'info',
      title: trashed
        ? `${ids.length} item dipindahkan ke Sampah`
        : `${ids.length} item dipulihkan`,
    });
  };

  const handlePermanentDelete = async () => {
    if (!deleteModal.ids.length) return;

    // Ensure any deleted folder (and nested stub folders) is hydrated first so Telegram files & folder index docs get deleted
    const initialExpanded = new Set<string>();
    for (const id of deleteModal.ids) {
      const target = itemsRef.current.find((i) => i.id === id);
      if (!target) continue;
      if (target.type === 'folder') {
        for (const d of collectDescendantIds(target.id, itemsRef.current)) initialExpanded.add(d);
      } else {
        initialExpanded.add(target.id);
      }
    }
    const stubFolderIds = itemsRef.current
      .filter((i) => initialExpanded.has(i.id) && i.type === 'folder')
      .map((i) => i.id);
    for (const fId of stubFolderIds) {
      await ensureFolderLoaded(fId);
    }

    const latestItems = itemsRef.current;
    const expanded = new Set<string>();
    const affectedParentFolders = new Set<string>();
    for (const id of deleteModal.ids) {
      const target = latestItems.find((i) => i.id === id);
      if (!target) continue;
      if (target.type === 'folder') {
        for (const d of collectDescendantIds(target.id, latestItems)) expanded.add(d);
      } else {
        expanded.add(target.id);
      }
    }

    const remainingBlobKeys = new Set(
      latestItems
        .filter((i) => !expanded.has(i.id) && i.localBlobKey)
        .map((i) => i.localBlobKey as string),
    );

    const deletedTgMsgIds: number[] = [];
    const failedDeletes: Array<{ mid: number; label: string; error?: string }> = [];
    let tgErrorMsg: string | null = null;
    let tgDeletedCount = 0;

    for (const item of latestItems) {
      if (!expanded.has(item.id)) continue;
      affectedParentFolders.add(item.parentId || 'ROOT');
      if (item.localBlobKey && !remainingBlobKeys.has(item.localBlobKey)) {
        await deleteLocalBlob(item.localBlobKey);
      }
      if (item.storageBackend === 'telegram') {
        if (item.type === 'folder' && item.folderIdx?.mid && tgConfig.botToken && tgConfig.chatId) {
          deletedTgMsgIds.push(item.folderIdx.mid);
          const fldDelRes = await deleteTelegramMessageDirect(
            tgConfig.botToken,
            tgConfig.chatId,
            item.folderIdx.mid,
          );
          if (!fldDelRes.ok) {
            failedDeletes.push({
              mid: item.folderIdx.mid,
              label: `Indeks folder: ${item.name}`,
              error: fldDelRes.error,
            });
          }
        }
        for (const chunk of item.chunks) {
          if (chunk.telegramMessageId) {
            deletedTgMsgIds.push(chunk.telegramMessageId);
            if (tgConfig.botToken && tgConfig.chatId) {
              const delRes = await deleteTelegramMessageDirect(
                tgConfig.botToken,
                tgConfig.chatId,
                chunk.telegramMessageId,
              );
              if (delRes.ok) {
                tgDeletedCount += 1;
              } else {
                if (!tgErrorMsg && delRes.error) {
                  tgErrorMsg = delRes.error;
                }
                failedDeletes.push({
                  mid: chunk.telegramMessageId,
                  label: item.name,
                  error: delRes.error,
                });
              }
            }
          }
        }
      }
    }

    if (failedDeletes.length > 0) {
      recordFailedChannelDeletes(failedDeletes);
    }

    if (deletedTgMsgIds.length > 0) {
      addDismissedTelegramMessageIds(deletedTgMsgIds);
    }

    tombstonesRef.current = addDeletedTombstones(Array.from(expanded));
    const currentPins = loadOfflinePinnedItemIds();
    const nextPins = currentPins.filter((id) => !expanded.has(id));
    if (nextPins.length !== currentPins.length) {
      saveOfflinePinnedItemIds(nextPins);
      setOfflinePinnedIds(new Set(nextPins));
    }
    const queue = loadOfflineUploadQueue();
    for (const job of queue) {
      if (expanded.has(job.itemId)) {
        removeOfflineUploadJob(job.taskId);
      }
    }
    setOfflineQueueCount(loadOfflineUploadQueue().length);
    commitItems((prev) => prev.filter((i) => !expanded.has(i.id)), {
      dirtyFolderIds: Array.from(affectedParentFolders),
      dirtyItemIds: Array.from(expanded),
    });
    setSelectedIds(new Set());

    if (tgErrorMsg) {
      pushNotification({
        kind: 'error',
        title: `${deleteModal.ids.length} item dihapus dari Drive, namun Telegram menolak sebagian`,
        detail: `Pastikan bot menjadi Admin Channel dengan izin Hapus Pesan (${tgErrorMsg}).`,
      });
    } else {
      pushNotification({
        kind: 'success',
        title: `${deleteModal.ids.length} item dihapus permanen`,
        detail:
          tgDeletedCount > 0
            ? `${tgDeletedCount} pesan file ikut dihapus dari channel Telegram.`
            : undefined,
      });
    }
  };

  const handleToggleSelect = (id: string, shiftKey = false) => {
    if (shiftKey && lastSelectedIdRef.current) {
      const startIdx = visibleItems.findIndex((i) => i.id === lastSelectedIdRef.current);
      const endIdx = visibleItems.findIndex((i) => i.id === id);
      if (startIdx !== -1 && endIdx !== -1) {
        const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (let idx = from; idx <= to; idx += 1) {
            next.add(visibleItems[idx].id);
          }
          return next;
        });
        return;
      }
    }

    lastSelectedIdRef.current = id;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openTrashConfirmation = (targetItems: DriveItem[]) => {
    if (targetItems.length === 0) return;
    setDeleteModal({
      open: true,
      variant: 'trash',
      ids: targetItems.map((i) => i.id),
      label: targetItems.length === 1 ? targetItems[0].name : undefined,
    });
  };

  const openPermanentDeleteConfirmation = (targetItems: DriveItem[]) => {
    if (targetItems.length === 0) return;
    setDeleteModal({
      open: true,
      variant: 'permanent',
      ids: targetItems.map((i) => i.id),
      label: targetItems.length === 1 ? targetItems[0].name : undefined,
    });
  };

  const handleContextMenuItem = (e: React.MouseEvent, item: DriveItem) => {
    if (!selectedIds.has(item.id)) {
      lastSelectedIdRef.current = item.id;
      setSelectedIds(new Set([item.id]));
    }
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      targetItem: item,
    });
  };

  const handleWorkspaceMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (
      target?.closest('[data-drive-item], button, a, input, select, [role="menu"], [role="dialog"]')
    ) {
      return;
    }
    setContextMenu(null);
    const baseSelected =
      e.ctrlKey || e.metaKey || e.shiftKey ? new Set(selectedIds) : new Set<string>();
    marqueeSessionRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      baseSelected,
    };
    setMarquee({
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
      active: false,
    });
    setIsMarqueeSession(true);
  };

  useEffect(() => {
    if (!isMarqueeSession) return;

    const onMouseMove = (e: MouseEvent) => {
      const session = marqueeSessionRef.current;
      if (!session) return;
      const dx = e.clientX - session.startX;
      const dy = e.clientY - session.startY;
      const isNowActive = session.active || Math.hypot(dx, dy) > 4;
      session.active = isNowActive;

      setMarquee({
        startX: session.startX,
        startY: session.startY,
        currentX: e.clientX,
        currentY: e.clientY,
        active: isNowActive,
      });

      if (!isNowActive || !mainRef.current) return;

      const left = Math.min(session.startX, e.clientX);
      const right = Math.max(session.startX, e.clientX);
      const top = Math.min(session.startY, e.clientY);
      const bottom = Math.max(session.startY, e.clientY);

      const nodes = mainRef.current.querySelectorAll<HTMLElement>('[data-drive-item]');
      const hitIds = new Set<string>(session.baseSelected);
      nodes.forEach((node) => {
        const id = node.getAttribute('data-drive-item');
        if (!id) return;
        const r = node.getBoundingClientRect();
        const intersects =
          r.right >= left && r.left <= right && r.bottom >= top && r.top <= bottom;
        if (intersects) hitIds.add(id);
      });

      setSelectedIds(hitIds);
    };

    const onMouseUp = (e: MouseEvent) => {
      const session = marqueeSessionRef.current;
      if (session) {
        const dx = e.clientX - session.startX;
        const dy = e.clientY - session.startY;
        const wasActive = session.active || Math.hypot(dx, dy) > 4;
        if (!wasActive && !(e.ctrlKey || e.metaKey || e.shiftKey)) {
          setSelectedIds(new Set());
        }
      }
      marqueeSessionRef.current = null;
      setMarquee(null);
      setIsMarqueeSession(false);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isMarqueeSession]);

  const selectedItemsList = useMemo(
    () => items.filter((i) => selectedIds.has(i.id)),
    [items, selectedIds],
  );
  const previewableFiles = useMemo(
    () => visibleItems.filter((i) => i.type === 'file'),
    [visibleItems],
  );
  const activePreviewItem = previewItem
    ? items.find((i) => i.id === previewItem.id) || previewItem
    : null;
  const activePreviewIndex = activePreviewItem
    ? previewableFiles.findIndex((i) => i.id === activePreviewItem.id)
    : -1;
  const isTrashView = section === 'trash';
  const retryableTaskIds = useMemo(
    () =>
      new Set(
        transfers
          .filter((t) => t.kind === 'upload' && t.status === 'error' && t.canRetry)
          .map((t) => t.id),
      ),
    [transfers],
  );
  const retryingTaskIds = useMemo(
    () =>
      new Set(
        transfers
          .filter(
            (t) =>
              t.kind === 'upload' && (t.status === 'active' || t.status === 'queued'),
          )
          .map((t) => t.id),
      ),
    [transfers],
  );
  const failedHistoryCount = useMemo(
    () => uploadHistory.filter((entry) => entry.status !== 'success').length,
    [uploadHistory],
  );

  if (!tgConfig.connected || !tgConfig.botToken || !tgConfig.chatId) {
    return (
      <PersonalLockScreen
        vaultString={activeVaultString}
        onUnlockSuccess={(nextCfg, pulledItems, opts) => {
          if (opts?.savedLocalVault) {
            saveLocalEncryptedVault(opts.savedLocalVault);
            setLocalVaultString(opts.savedLocalVault);
          }
          setTgConfig(nextCfg);
          saveStoredTelegramConfig(nextCfg, opts?.sessionOnly);
          if (opts?.pulledPrefs) {
            applyRemoteViewPrefs(opts.pulledPrefs);
          }
          pinnedIndexIdRef.current = nextCfg.pinnedIndexMessageId;
          didAutoSyncRef.current = Boolean(opts?.offlineMode);
          hasSyncedOnceRef.current = false;
          lastSyncMsRef.current = 0;
          setOfflinePinnedIds(new Set(loadOfflinePinnedItemIds()));
          setOfflineQueueCount(loadOfflineUploadQueue().length);
          setUploadHistory(loadTodayUploadHistory());
          setSyncState(opts?.offlineMode ? 'error' : 'synced');
          if (pulledItems.length > 0) {
            setItems(pulledItems);
            saveStoredItems(pulledItems);
            void replaceAllCatalogIdb(pulledItems.map(toCatalogRecord));
          }
          pushNotification({
            kind: opts?.offlineMode ? 'info' : 'success',
            title: opts?.offlineMode
              ? 'Mode Offline aktif'
              : `Terhubung ke @${nextCfg.botUsername || 'Bot'}`,
            detail: opts?.offlineMode
              ? 'Membuka data tersimpan lokal. Perubahan baru otomatis disinkronkan saat online.'
              : opts?.savedLocalVault
                ? 'PIN pengunci aktif & file Anda siap diakses.'
                : 'Drive pribadi Anda siap digunakan.',
          });
        }}
      />
    );
  }

  return (
    <div
      className="flex h-screen overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
      onDragOver={(e) => {
        if (
          e.dataTransfer.types.includes('Files') &&
          !e.dataTransfer.types.includes('application/x-teledrive-ids')
        ) {
          e.preventDefault();
          setIsDraggingExternalFiles(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDraggingExternalFiles(false);
        }
      }}
      onDrop={(e) => {
        if (e.dataTransfer.types.includes('application/x-teledrive-ids')) return;
        if (e.dataTransfer.files?.length || e.dataTransfer.items?.length) {
          e.preventDefault();
          setIsDraggingExternalFiles(false);
          handleDropExternalPayload(captureDropEntriesSync(e.dataTransfer));
        } else {
          setIsDraggingExternalFiles(false);
        }
      }}
    >
      {/* Hidden File & Folder Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            enqueueFilesUpload(e.target.files);
            e.target.value = '';
          }
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error webkitdirectory supported across Chromium/WebKit/Firefox
        webkitdirectory=""
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            enqueueFilesUpload(e.target.files);
            e.target.value = '';
          }
        }}
      />

      <input
        ref={reuploadInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            enqueueFilesUpload(e.target.files, reuploadParentIdRef.current);
            e.target.value = '';
            setActivityModalOpen(false);
          }
        }}
      />

      <Sidebar
        activeSection={section}
        onSelectSection={handleSelectSection}
        onUploadFilesClick={() => fileInputRef.current?.click()}
        onUploadFolderClick={() => folderInputRef.current?.click()}
        onNewFolderClick={() => setNameModal({ open: true, mode: 'create' })}
        summary={summary}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        canDropOnRoot={draggingIds.length > 0}
        onDropOnRoot={(ids) => handleDropMoveToFolder(ids, null)}
        onDropExternalFilesToRoot={(payload) => {
          setIsDraggingExternalFiles(false);
          handleDropExternalPayload(payload, null);
        }}
        onOpenDuplicateFinder={() => setDuplicatesModalOpen(true)}
        onOpenActivityHistory={() => setActivityModalOpen(true)}
        failedHistoryCount={failedHistoryCount}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          themeMode={themeMode}
          effectiveDark={effectiveDark}
          onCycleThemeMode={handleCycleThemeMode}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onQuickUploadClick={() => fileInputRef.current?.click()}
          searchInputRef={searchInputRef}
          telegram={telegramStatus}
          syncingTelegram={syncingTelegram}
          syncState={syncState}
          vaultAvailable={isVaultConfigured(activeVaultString)}
          onSyncNow={() => void syncFromTelegram(false)}
          onOpenTelegramModal={() => setTelegramModalOpen(true)}
          onLockDrive={() => handleLockDrive()}
        />

        <Toolbar
          section={section}
          breadcrumbs={breadcrumbs}
          onNavigateFolder={handleNavigateFolder}
          sortField={sortField}
          sortDirection={sortDirection}
          onSortChange={handleSortChange}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          searchScope={searchScope}
          onSearchScopeChange={setSearchScope}
          sizeFilter={sizeFilter}
          onSizeFilterChange={setSizeFilter}
          hasCurrentFolder={section === 'my-drive' && Boolean(currentFolderId)}
          currentFolderName={currentFolderName}
          onResetSearchFilters={() => {
            setTypeFilter('all');
            setSearchScope('all');
            setSizeFilter('all');
          }}
          clipboardCount={clipboardIds.length}
          onPasteItems={handlePasteItems}
          onClearClipboard={() => setClipboardIds([])}
          onDropMoveToFolder={(ids, targetId) => handleDropMoveToFolder(ids, targetId)}
          onDropExternalFilesToFolder={(payload, targetFolderId) => {
            setIsDraggingExternalFiles(false);
            handleDropExternalPayload(payload, targetFolderId);
          }}
          previewOpen={previewPaneOpen}
          onTogglePreviewPane={() => setPreviewPaneOpen((v) => !v)}
          searchQuery={searchQuery}
        />

        {/* Workspace + Right Resizable Preview Split View */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <main
            ref={mainRef}
            onMouseDown={handleWorkspaceMouseDown}
            className={`relative min-w-0 flex-1 overflow-y-auto px-4 pt-5 pb-24 transition-shadow sm:px-6 ${
              marquee?.active ? 'select-none' : ''
            } ${isDraggingExternalFiles ? 'bg-blue-50/40 ring-2 ring-inset ring-blue-500/70 dark:bg-blue-950/20' : ''}`}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY });
            }}
          >
            {isTrashView && visibleItems.length > 0 && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                <span>Item di Sampah dapat dipulihkan kapan saja atau dihapus permanen.</span>
                <button
                  type="button"
                  onClick={() => openPermanentDeleteConfirmation(visibleItems)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Kosongkan Sampah</span>
                </button>
              </div>
            )}

            {visibleItems.length === 0 ? (
              <div className="mx-auto mt-14 flex max-w-md flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
                  <UploadCloud className="h-6 w-6" />
                </div>
                <h2 className="mt-4 font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  {searchQuery
                    ? 'Tidak ada file yang cocok'
                    : isTrashView
                      ? 'Tempat sampah kosong'
                      : section === 'photos'
                        ? 'Belum ada foto'
                        : section === 'videos'
                          ? 'Belum ada video'
                          : section === 'music'
                            ? 'Belum ada musik'
                            : section === 'documents'
                              ? 'Belum ada dokumen'
                              : section === 'archives'
                                ? 'Belum ada arsip'
                                : section === 'others'
                                  ? 'Belum ada file lainnya'
                                  : 'Folder ini masih kosong'}
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {searchQuery || typeFilter !== 'all' || sizeFilter !== 'all'
                    ? 'Coba kata kunci lain atau ubah filter pencarian.'
                    : isTrashView
                      ? 'File atau folder yang Anda buang akan muncul di sini sebelum dihapus permanen.'
                      : 'Seret dan lepas file atau folder ke area ini (mendukung file besar > 20 MB dengan pemecahan otomatis) atau klik Unggah File.'}
                </p>

                {(typeFilter !== 'all' || sizeFilter !== 'all' || searchScope !== 'all') && (
                  <button
                    type="button"
                    onClick={() => {
                      setTypeFilter('all');
                      setSearchScope('all');
                      setSizeFilter('all');
                    }}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <span>Reset Filter</span>
                  </button>
                )}

                {!isTrashView && !searchQuery && (
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                    >
                      <UploadCloud className="h-4 w-4" />
                      <span>Unggah File</span>
                    </button>
                    {section === 'my-drive' && (
                      <button
                        type="button"
                        onClick={() => setNameModal({ open: true, mode: 'create' })}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <FolderPlus className="h-4 w-4" />
                        <span>Folder Baru</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : viewMode === 'grid' ? (
              <FileGrid
                items={pagedItems}
                allItems={items}
                tgConfig={tgConfig}
                folderCounts={folderCounts}
                selectedIds={selectedIds}
                offlinePinnedIds={offlinePinnedIds}
                draggingIds={draggingIds}
                onDragStartIds={setDraggingIds}
                onDragEndIds={() => setDraggingIds([])}
                onDropMoveToFolder={(ids, targetFolderId) =>
                  handleDropMoveToFolder(ids, targetFolderId)
                }
                onDropExternalFilesToFolder={(payload, targetFolderId) => {
                  setIsDraggingExternalFiles(false);
                  handleDropExternalPayload(payload, targetFolderId);
                }}
                onToggleSelect={handleToggleSelect}
                onContextMenuItem={handleContextMenuItem}
                onOpenItem={handleOpenItem}
                onDoubleClickItem={handleDoubleClickItem}
                isTrashView={isTrashView}
              />
            ) : (
              <FileTable
                items={pagedItems}
                allItems={items}
                folderCounts={folderCounts}
                selectedIds={selectedIds}
                offlinePinnedIds={offlinePinnedIds}
                draggingIds={draggingIds}
                onDragStartIds={setDraggingIds}
                onDragEndIds={() => setDraggingIds([])}
                onDropMoveToFolder={(ids, targetFolderId) =>
                  handleDropMoveToFolder(ids, targetFolderId)
                }
                onDropExternalFilesToFolder={(payload, targetFolderId) => {
                  setIsDraggingExternalFiles(false);
                  handleDropExternalPayload(payload, targetFolderId);
                }}
                onToggleSelect={handleToggleSelect}
                onContextMenuItem={handleContextMenuItem}
                onOpenItem={handleOpenItem}
                onDoubleClickItem={handleDoubleClickItem}
                isTrashView={isTrashView}
              />
            )}

            {visibleItems.length > pagedItems.length && (
              <div
                ref={loadMoreSentinelRef}
                className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
              >
                <span>
                  Menampilkan <strong className="font-semibold text-slate-900 dark:text-slate-100">{pagedItems.length.toLocaleString('id-ID')}</strong> dari{' '}
                  <strong className="font-semibold text-slate-900 dark:text-slate-100">{visibleItems.length.toLocaleString('id-ID')}</strong> item
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRenderLimit((prev) => prev + 100)}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-700"
                  >
                    Muat 100 lagi
                  </button>
                  {visibleItems.length <= 1000 && (
                    <button
                      type="button"
                      onClick={() => setRenderLimit(visibleItems.length)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Tampilkan semua
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Mouse Drag Marquee Selection Box */}
            {marquee?.active && (
              <div
                aria-hidden="true"
                className="pointer-events-none fixed z-40 rounded border border-blue-500 bg-blue-500/15 dark:border-blue-400 dark:bg-blue-400/15"
                style={{
                  left: Math.min(marquee.startX, marquee.currentX),
                  top: Math.min(marquee.startY, marquee.currentY),
                  width: Math.abs(marquee.currentX - marquee.startX),
                  height: Math.abs(marquee.currentY - marquee.startY),
                }}
              />
            )}
          </main>

          <RightPreviewPane
            open={previewPaneOpen}
            width={previewPaneWidth}
            onWidthChange={handlePreviewWidthChange}
            onClose={() => setPreviewPaneOpen(false)}
            selectedItems={selectedItemsList}
            allItems={items}
            tgConfig={tgConfig}
            onOpenFolder={(folder) => handleNavigateFolder(folder.id)}
            onOpenTelegramSettings={() => setTelegramModalOpen(true)}
            onHydrateStub={hydrateStubItem}
            onDownloadItem={handleDownloadItem}
            onDownloadZip={handleDownloadZip}
          />
        </div>
      </div>

      {/* Non-obstructing Floating Bottom Drag & Drop Upload Banner (Folder Targets Stay Visible) */}
      {isDraggingExternalFiles && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 w-[min(92vw,30rem)] -translate-x-1/2">
          <div className="td-animate-fade-up flex items-center gap-3.5 rounded-2xl border-2 border-dashed border-blue-600 bg-white/95 px-5 py-3.5 shadow-2xl backdrop-blur-xs dark:bg-slate-900/95">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/70 dark:text-blue-400">
              <UploadCloud className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Lepas file atau folder untuk unggah ke{' '}
                {section === 'my-drive' && currentFolderId
                  ? items.find((i) => i.id === currentFolderId)?.name || 'Folder ini'
                  : 'Drive Saya'}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Atau arahkan &amp; lepas tepat ke atas kartu folder tujuan (file &gt; 20 MB dipecah otomatis)
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Top-Right Unified Notification & Transfer Stack */}
      <TopRightNotifications
        notifications={notifications}
        onDismissNotification={dismissNotification}
        tasks={transfers}
        onCancelTask={handleCancelTransfer}
        onRetryTask={(taskId) => handleRetryFailedTasks([taskId])}
        onRetryAllFailed={() =>
          handleRetryFailedTasks(
            transfers.filter((t) => t.status === 'error' && t.canRetry).map((t) => t.id),
          )
        }
        onClearCompletedTasks={() => {
          setTransfers((prev) => {
            for (const t of prev) {
              if (t.status !== 'active' && t.status !== 'queued') {
                failedUploadJobsRef.current.delete(t.id);
              }
            }
            return prev.filter((t) => t.status === 'active' || t.status === 'queued');
          });
        }}
      />

      {/* Modals */}
      <PreviewModal
        item={activePreviewItem}
        tgConfig={tgConfig}
        onClose={() => setPreviewItem(null)}
        onOpenTelegramSettings={() => setTelegramModalOpen(true)}
        onHydrateStub={hydrateStubItem}
        onDownloadItem={handleDownloadItem}
        hasPrev={activePreviewIndex > 0}
        hasNext={activePreviewIndex >= 0 && activePreviewIndex < previewableFiles.length - 1}
        onPrev={() => {
          if (activePreviewIndex > 0) {
            const target = previewableFiles[activePreviewIndex - 1];
            setPreviewItem(target);
            if (target.isCatalogStub) void hydrateStubItem(target);
          }
        }}
        onNext={() => {
          if (activePreviewIndex >= 0 && activePreviewIndex < previewableFiles.length - 1) {
            const target = previewableFiles[activePreviewIndex + 1];
            setPreviewItem(target);
            if (target.isCatalogStub) void hydrateStubItem(target);
          }
        }}
      />

      <TelegramModal
        open={telegramModalOpen}
        config={tgConfig}
        vaultAvailable={isVaultConfigured(activeVaultString)}
        totalCatalogCount={items.filter((i) => !i.trashed).length}
        isV4Mode={Boolean(normalizeCorsProxyUrl(tgConfig.corsProxyUrl))}
        obsoleteChannelMsgs={obsoleteChannelMsgs}
        onClose={() => setTelegramModalOpen(false)}
        onSaveLocalVault={(vaultCode) => {
          saveLocalEncryptedVault(vaultCode);
          setLocalVaultString(vaultCode);
        }}
        onExportBackup={async () => {
          const blob = await buildOfflineBackupBlob(itemsRef.current, tombstonesRef.current);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const stamp = new Date().toISOString().slice(0, 10);
          a.href = url;
          a.download = `teledrive-backup-${stamp}.json.gz`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.setTimeout(() => URL.revokeObjectURL(url), 4000);
          pushNotification({
            kind: 'success',
            title: 'Cadangan offline diunduh',
            detail: `${itemsRef.current.length.toLocaleString('id-ID')} item disimpan ke file cadangan.`,
          });
        }}
        onImportBackup={async (file) => {
          const restored = await parseOfflineBackupFile(file);
          const reconciled = reconcileConcurrentDriveState(
            itemsRef.current,
            restored.items,
            [],
            tombstonesRef.current,
            restored.tombstones,
          );
          tombstonesRef.current = reconciled.tombstones;
          saveDeletedTombstones(reconciled.tombstones);
          saveStoredItems(reconciled.items);
          void replaceAllCatalogIdb(reconciled.items.map(toCatalogRecord));
          itemsRef.current = reconciled.items;
          setItems(reconciled.items);
          markDirtyScope(['ALL'], reconciled.items.map((i) => i.id));
          setCloudPushTick((t) => t + 1);
          pushNotification({
            kind: 'success',
            title: 'Cadangan berhasil dipulihkan',
            detail: `${restored.items.length.toLocaleString('id-ID')} item dimuat & disinkronkan ke cloud.`,
          });
        }}
        onCompactIndex={async () => {
          const proxyUrl = normalizeCorsProxyUrl(tgConfig.corsProxyUrl || v4ManifestRef.current?.p?.px);
          if (!tgConfig.connected || !tgConfig.botToken || !tgConfig.chatId || !proxyUrl) {
            throw new Error('Aktifkan Proxy Cloudflare Worker & hubungkan Bot terlebih dahulu.');
          }
          setSyncState('syncing');
          try {
            const v4Res = await pushV4ChangesToTelegram({
              botToken: tgConfig.botToken,
              chatId: tgConfig.chatId,
              corsProxyUrl: proxyUrl,
              allItems: itemsRef.current,
              dirtyFolderIds: new Set(['ALL']),
              dirtyItemIds: new Set(),
              tombstones: tombstonesRef.current,
              currentManifest: v4ManifestRef.current,
              pinnedMessageId: pinnedIndexIdRef.current,
              prefs: viewPrefsRef.current,
              forceCompact: true,
              obsoleteV3ShardIds: obsoleteV3ShardsRef.current,
            });
            v4ManifestRef.current = v4Res.manifest;
            void saveV4ManifestIdb(v4Res.manifest);
            dirtyFolderIdsRef.current.clear();
            dirtyItemIdsRef.current.clear();
            obsoleteV3ShardsRef.current = [];
            void saveDirtyTrackingIdb([], []);
            for (const item of v4Res.updatedItems) {
              if (item.type === 'folder' && item.folderIdx?.h) {
                loadedFolderRevsRef.current[item.id] = item.folderIdx.h;
              }
            }
            void saveLoadedFolderRevsIdb(loadedFolderRevsRef.current);
            if (v4Res.manifest.rev) lastSyncedRevRef.current = v4Res.manifest.rev;
            tombstonesRef.current = v4Res.tombstones;
            saveDeletedTombstones(v4Res.tombstones);
            saveStoredItems(v4Res.updatedItems);
            void replaceAllCatalogIdb(v4Res.catalog);
            itemsRef.current = v4Res.updatedItems;
            setItems(v4Res.updatedItems);
            if (v4Res.pinnedMessageId) pinnedIndexIdRef.current = v4Res.pinnedMessageId;
            if (v4Res.failedDeleteMids.length > 0) {
              recordFailedChannelDeletes(v4Res.failedDeleteMids);
            }
            setSyncState('synced');
            pushNotification({
              kind: 'success',
              title: 'Indeks V4 dirapikan',
              detail: `${v4Res.catalog.length.toLocaleString('id-ID')} item terkompaksi rapi di Telegram.`,
            });
          } catch (err) {
            setSyncState('error');
            throw err;
          }
        }}
        onCleanChannel={async () => {
          if (!tgConfig.connected || !tgConfig.botToken || !tgConfig.chatId) {
            throw new Error('Hubungkan Bot & Channel Telegram terlebih dahulu.');
          }
          let totalDeleted = 0;
          const proxyUrl = normalizeCorsProxyUrl(tgConfig.corsProxyUrl || v4ManifestRef.current?.p?.px);
          if (proxyUrl && v4ManifestRef.current) {
            const v4Res = await pushV4ChangesToTelegram({
              botToken: tgConfig.botToken,
              chatId: tgConfig.chatId,
              corsProxyUrl: proxyUrl,
              allItems: itemsRef.current,
              dirtyFolderIds: new Set(['ALL']),
              dirtyItemIds: new Set(),
              tombstones: tombstonesRef.current,
              currentManifest: v4ManifestRef.current,
              pinnedMessageId: pinnedIndexIdRef.current,
              prefs: viewPrefsRef.current,
              forceCompact: true,
              obsoleteV3ShardIds: obsoleteV3ShardsRef.current,
            });
            v4ManifestRef.current = v4Res.manifest;
            void saveV4ManifestIdb(v4Res.manifest);
            dirtyFolderIdsRef.current.clear();
            dirtyItemIdsRef.current.clear();
            obsoleteV3ShardsRef.current = [];
            void saveDirtyTrackingIdb([], []);
            if (v4Res.manifest.rev) lastSyncedRevRef.current = v4Res.manifest.rev;
            if (v4Res.pinnedMessageId) pinnedIndexIdRef.current = v4Res.pinnedMessageId;
            tombstonesRef.current = v4Res.tombstones;
            saveDeletedTombstones(v4Res.tombstones);
            saveStoredItems(v4Res.updatedItems);
            void replaceAllCatalogIdb(v4Res.catalog);
            itemsRef.current = v4Res.updatedItems;
            setItems(v4Res.updatedItems);
            totalDeleted += v4Res.cleanedUpCount;
            if (v4Res.failedDeleteMids.length > 0) {
              recordFailedChannelDeletes(v4Res.failedDeleteMids);
            }
          }

          const latestPending = loadObsoleteTelegramMsgs();
          const cleanupRes = await cleanupObsoleteTelegramMessages(
            tgConfig.botToken,
            tgConfig.chatId,
            latestPending,
          );
          totalDeleted += cleanupRes.deletedCount;
          saveObsoleteTelegramMsgs(cleanupRes.remaining);
          setObsoleteChannelMsgs(cleanupRes.remaining);
          return {
            deletedCount: totalDeleted,
            remainingCount: cleanupRes.remaining.length,
          };
        }}
        onDismissObsoleteMsgs={() => {
          saveObsoleteTelegramMsgs([]);
          setObsoleteChannelMsgs([]);
        }}
        onSaveConfig={(nextCfg, pulledItems) => {
          if (!nextCfg.connected) {
            handleLockDrive({ clearLocalVault: true });
            return;
          }
          setTgConfig(nextCfg);
          saveStoredTelegramConfig(nextCfg);
          const nextProxy = normalizeCorsProxyUrl(nextCfg.corsProxyUrl) || '';
          const updatedPrefs: CloudViewPrefs = {
            ...viewPrefsRef.current,
            px: nextProxy,
            u: new Date().toISOString(),
          };
          viewPrefsRef.current = updatedPrefs;
          saveStoredViewPrefs(updatedPrefs);
          pinnedIndexIdRef.current = nextCfg.pinnedIndexMessageId;
          setSyncState('synced');
          if (pulledItems && pulledItems.length > 0) {
            setItems((prev) => {
              const merged = mergeDriveItems(prev, pulledItems);
              saveStoredItems(merged);
              void replaceAllCatalogIdb(merged.map(toCatalogRecord));
              return merged;
            });
          }
          if (nextProxy && !v4ManifestRef.current) {
            markDirtyScope(['ALL'], []);
          }
          setCloudPushTick((t) => t + 1);
          pushNotification({
            kind: 'success',
            title: `Terhubung ke @${nextCfg.botUsername}`,
          });
        }}
        onPullRemoteItems={(pulledItems, pinnedMsgId) => {
          if (pinnedMsgId) {
            pinnedIndexIdRef.current = pinnedMsgId;
            setTgConfig((curr) => {
              const next = { ...curr, pinnedIndexMessageId: pinnedMsgId };
              saveStoredTelegramConfig(next);
              return next;
            });
          }
          if (pulledItems.length > 0) {
            setItems((prev) => {
              const merged = mergeDriveItems(prev, pulledItems);
              saveStoredItems(merged);
              void replaceAllCatalogIdb(merged.map(toCatalogRecord));
              return merged;
            });
            setSyncState('synced');
            pushNotification({
              kind: 'success',
              title: `${pulledItems.length.toLocaleString('id-ID')} item dimuat dari Telegram`,
            });
          }
        }}
      />

      <FolderNameModal
        open={nameModal.open}
        mode={nameModal.mode}
        initialValue={nameModal.mode === 'rename' ? nameModal.targetItem?.name || '' : ''}
        onClose={() => setNameModal((prev) => ({ ...prev, open: false }))}
        onSubmit={handleCreateOrRename}
      />

      <ConfirmDeleteModal
        open={deleteModal.open}
        variant={deleteModal.variant}
        count={deleteModal.ids.length}
        label={deleteModal.label}
        onClose={() => setDeleteModal({ open: false, variant: 'permanent', ids: [] })}
        onConfirm={async () => {
          if (deleteModal.variant === 'trash') {
            handleTrashOrRestore(deleteModal.ids, true);
          } else {
            await handlePermanentDelete();
          }
        }}
        onConfirmPermanent={handlePermanentDelete}
      />

      <MoveModal
        open={moveModal.open}
        movingIds={moveModal.ids}
        items={items}
        currentFolderId={currentFolderId}
        onClose={() => setMoveModal({ open: false, ids: [] })}
        onMove={async (targetParentId) => {
          handleDropMoveToFolder(moveModal.ids, targetParentId);
        }}
      />

      <DuplicateFinderModal
        open={duplicatesModalOpen}
        items={items}
        onClose={() => setDuplicatesModalOpen(false)}
        onNavigateFolder={handleNavigateFolder}
        onTrashItems={(targetItems) => openTrashConfirmation(targetItems)}
        onDeletePermanentItems={(targetItems) => openPermanentDeleteConfirmation(targetItems)}
      />

      <ActivityHistoryModal
        open={activityModalOpen}
        entries={uploadHistory}
        retryableTaskIds={retryableTaskIds}
        retryingTaskIds={retryingTaskIds}
        onClose={() => setActivityModalOpen(false)}
        onRetryEntry={(entry) => {
          if (entry.taskId) {
            handleRetryFailedTasks([entry.taskId]);
          }
        }}
        onRetryAllFailed={() => {
          const ids = Array.from(retryableTaskIds);
          if (ids.length > 0) {
            handleRetryFailedTasks(ids);
          }
        }}
        onReuploadToFolder={(entry) => {
          reuploadParentIdRef.current = entry.parentId;
          reuploadInputRef.current?.click();
        }}
        onNavigateFolder={handleNavigateFolder}
        onClearHistory={() => {
          clearTodayUploadHistory();
          setUploadHistory([]);
        }}
      />

      <ContextMenu
        menu={contextMenu}
        selectedItems={selectedItemsList}
        isTrashView={isTrashView}
        clipboardCount={clipboardIds.length}
        offlinePinnedIds={offlinePinnedIds}
        onClose={() => setContextMenu(null)}
        onOpenItem={handleOpenItem}
        onDownloadItems={(targetItems) => {
          for (const target of targetItems) {
            if (target.type === 'file') handleDownloadItem(target);
          }
        }}
        onDownloadZip={handleDownloadZip}
        onMoveItems={(targetItems) => {
          setMoveModal({ open: true, ids: targetItems.map((i) => i.id) });
        }}
        onCopyItems={(targetItems) => {
          handleCopyIds(targetItems.map((i) => i.id));
        }}
        onRenameItem={(item) => setNameModal({ open: true, mode: 'rename', targetItem: item })}
        onToggleStarItems={(targetItems) => {
          const allStarred = targetItems.every((i) => i.starred);
          const nextStar = !allStarred;
          const ids = new Set(targetItems.map((i) => i.id));
          const now = new Date().toISOString();
          commitItems(
            (prev) =>
              prev.map((i) => (ids.has(i.id) ? { ...i, starred: nextStar, updatedAt: now } : i)),
            {
              dirtyFolderIds: targetItems.map((t) => t.parentId || 'ROOT'),
              dirtyItemIds: targetItems.map((t) => t.id),
            },
          );
          pushNotification({
            kind: 'info',
            title: nextStar
              ? `${targetItems.length} item dibintangi`
              : `Bintang dihapus dari ${targetItems.length} item`,
          });
        }}
        onToggleOfflinePinItems={(targetItems) => {
          void handleToggleOfflinePinItems(targetItems);
        }}
        onTrashItems={(targetItems) => openTrashConfirmation(targetItems)}
        onRestoreItems={(targetItems) =>
          handleTrashOrRestore(
            targetItems.map((i) => i.id),
            false,
          )
        }
        onDeletePermanentItems={(targetItems) => openPermanentDeleteConfirmation(targetItems)}
        onSelectAll={() => setSelectedIds(new Set(visibleItems.map((i) => i.id)))}
        onNewFolder={() => setNameModal({ open: true, mode: 'create' })}
        onUploadFiles={() => fileInputRef.current?.click()}
        onPaste={handlePasteItems}
      />

      <OfflineIndicator pendingQueueCount={offlineQueueCount} />
    </div>
  );
}

