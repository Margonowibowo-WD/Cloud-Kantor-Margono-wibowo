import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderPlus, Trash2, UploadCloud } from 'lucide-react';
import type {
  DriveItem,
  NavSection,
  SortDirection,
  SortField,
  StorageSummary,
  TelegramConfigState,
  TelegramPublicStatus,
  TransferTask,
  ViewMode,
} from './types/drive';
import {
  applyMoveItems,
  buildBreadcrumbs,
  cloneDriveItemsForPaste,
  computeStorageSummary,
  filterAndSortItems,
  formatBytes,
} from './utils/fileHelpers';
import {
  type CapturedDropPayload,
  type DroppedTreeResult,
  captureDropEntriesSync,
  extractDroppedTree,
  extractTreeFromFileList,
  materializeFolderTree,
} from './utils/dropUploadHelpers';
import {
  addDeletedTombstones,
  addDismissedTelegramMessageIds,
  deleteLocalBlob,
  loadDeletedTombstones,
  loadDismissedTelegramMessageIds,
  loadLocalEncryptedVault,
  loadStoredItems,
  loadStoredTelegramConfig,
  loadStoredViewPrefs,
  saveDeletedTombstones,
  saveLocalEncryptedVault,
  saveStoredItems,
  saveStoredTelegramConfig,
  saveStoredViewPrefs,
  wipeUnlockedSessionData,
} from './utils/localVault';
import {
  DIRECT_TELEGRAM_MAX_BYTES,
  UPLOAD_CONCURRENCY,
  checkTelegramMessageExists,
  deleteTelegramMessageDirect,
  fetchChannelMediaUpdates,
  normalizeCorsProxyUrl,
  pullIndexFromTelegramPinnedMessage,
  pushIndexToTelegramPinnedMessage,
  toPublicStatus,
  verifyTelegramDirect,
} from './utils/telegramDirect';
import {
  type CloudViewPrefs,
  mergeDriveItems,
  reconcileConcurrentDriveState,
} from './utils/telegramIndex';
import { isVaultConfigured } from './utils/cryptoVault';
import { startDirectDownload, startDirectUpload } from './utils/uploadClient';
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
import { ConfirmDeleteModal, FolderNameModal } from './components/ActionModals';

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
  const batchPacingTimerRef = useRef<number | null>(null);
  const failedUploadJobsRef = useRef<
    Map<string, { file: File; targetParent: string | null; isBatch: boolean }>
  >(new Map());
  const didAutoSyncRef = useRef(false);
  const syncInFlightRef = useRef(false);
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
  const itemsRef = useRef<DriveItem[]>(items);
  itemsRef.current = items;
  const mainRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
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
      if (remotePrefs.sf === 'name' || remotePrefs.sf === 'updatedAt' || remotePrefs.sf === 'size') {
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

  // Persist items cleanly & push index to Telegram pinned message outside React state updaters
  const commitItems = useCallback(
    (updater: (prev: DriveItem[]) => DriveItem[], options?: { deferIndexPush?: boolean }) => {
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
    [broadcastLocalStateToTabs],
  );

  useEffect(() => {
    if (cloudPushTick === 0) return;
    if (!tgConfig.connected || !tgConfig.botToken || !tgConfig.chatId) return;

    let active = true;
    const timer = window.setTimeout(() => {
      const currentPinId = pinnedIndexIdRef.current;
      setSyncState('syncing');
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
    applyRemoteViewPrefs,
    broadcastLocalStateToTabs,
  ]);

  const handleLockDrive = useCallback(
    (options?: { broadcast?: boolean; clearLocalVault?: boolean }) => {
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
      activeUploadCountRef.current = 0;

      wipeUnlockedSessionData({ clearLocalVault: options?.clearLocalVault });
      if (options?.clearLocalVault) {
        setLocalVaultString('');
      }

      didAutoSyncRef.current = false;
      hasSyncedOnceRef.current = false;
      lastSyncedRevRef.current = undefined;
      pinnedIndexIdRef.current = undefined;
      tombstonesRef.current = {};

      setItems([]);
      setTransfers([]);
      setSelectedIds(new Set());
      setClipboardIds([]);
      setPreviewItem(null);
      setTelegramModalOpen(false);
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
        const res = await pullIndexFromTelegramPinnedMessage(cfg.botToken, cfg.chatId, {
          skipVerifyGetMe: Boolean(cfg.connected),
          cachedRev: silent && hasSyncedOnceRef.current ? lastSyncedRevRef.current : undefined,
          prefetchedPinnedText: prefetched?.pinnedIndexText,
          prefetchedPinnedMessageId: prefetched?.pinnedMessageId,
          prefetchedChatId: cfg.chatId,
        });

        if (res.error) {
          setSyncState('error');
          if (!silent) {
            pushNotification({
              kind: 'error',
              title: 'Sinkronisasi gagal',
              detail: res.error,
            });
          }
          return;
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

        // If remote index changed on another device while silent, gently ensure local view updates
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
          const activeShardIds = new Set((res.shardRefs || []).map((s) => s.id));
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

        // Probe Telegram channel deletions only on manual sync or every 5 minutes (prevents 20-call polling storms)
        const shouldProbeDeletions = !silent || nowMs - lastProbeMsRef.current >= 300_000;
        const deletedInTelegramItemIds = new Set<string>();
        const deletedInTelegramMsgIds: number[] = [];
        if (shouldProbeDeletions) {
          lastProbeMsRef.current = nowMs;
          const probeCandidates = [...remoteItemsForScan, ...itemsRef.current]
            .filter(
              (i, idx, arr) =>
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

        if (res.unchanged && channelMedia.length === 0 && deletedInTelegramItemIds.size === 0) {
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

        if (!res.unchanged && res.prefs) {
          applyRemoteViewPrefs(res.prefs);
        }

        const localProxy = normalizeCorsProxyUrl(cfg.corsProxyUrl);
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
        saveStoredItems(reconciled.items);
        setItems(reconciled.items);
        broadcastLocalStateToTabs();

        let nextPinnedId = res.pinnedMessageId ?? cfg.pinnedIndexMessageId;
        if (res.rev) {
          lastSyncedRevRef.current = res.rev;
        }

        // Push back whenever local had items/updates not yet reflected in the remote index (or raw index needs clean HTML formatting)
        const needsFormattingUpgrade = Boolean(
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
        const localHasUnpushedChanges =
          !res.hasIndex ||
          needsFormattingUpgrade ||
          needsProxyPush ||
          channelMedia.length > 0 ||
          deletedInTelegramItemIds.size > 0 ||
          reconciled.items.some((item) => {
            const r = remoteById.get(item.id);
            return !r || (Date.parse(item.updatedAt) || 0) > (Date.parse(r.updatedAt) || 0);
          });

        const allowCreateNewIndex = !silent || !autoCreateIndexAttemptedRef.current;
        const shouldPushBack =
          localHasUnpushedChanges &&
          reconciled.items.length + Object.keys(reconciled.tombstones).length > 0 &&
          !(pinBlockedRef.current && !res.hasIndex) &&
          (res.hasIndex || allowCreateNewIndex);

        if (shouldPushBack) {
          if (!res.hasIndex) {
            autoCreateIndexAttemptedRef.current = true;
          }
          const pushRes = await pushIndexToTelegramPinnedMessage(
            cfg.botToken,
            cfg.chatId,
            reconciled.items,
            nextPinnedId,
            reconciled.tombstones,
            {
              skipMergePull: true,
              prefs: viewPrefsRef.current,
              existingPinnedText: res.rawPinnedText,
              existingShardRefs: res.shardRefs,
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
                : `${reconciled.items.length} item tersinkron dari @${cfg.botUsername || 'Bot'}.`,
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
      setItems(freshItems);
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

  // Google Drive calm background sync: startup, tab focus/visibility, and gentle 30s delta revision check
  useEffect(() => {
    if (!tgConfig.connected || !tgConfig.botToken || !tgConfig.chatId) return;

    if (!didAutoSyncRef.current) {
      didAutoSyncRef.current = true;
      void syncFromTelegram(true);
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
    document.addEventListener('visibilitychange', onVisibilityOrFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onVisibilityOrFocus);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
    };
  }, [tgConfig.connected, tgConfig.botToken, tgConfig.chatId, syncFromTelegram]);

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

  const visibleItems = useMemo(
    () =>
      filterAndSortItems(items, {
        section,
        currentFolderId,
        searchQuery,
        typeFilter: 'all',
        sortField,
        sortDirection,
      }),
    [items, section, currentFolderId, searchQuery, sortField, sortDirection],
  );

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
    let pastedCount = 0;

    commitItems((prev) => {
      const created = cloneDriveItemsForPaste(
        clipboardIds,
        prev,
        targetParentId,
        now,
        (type) => `${type === 'folder' ? 'fld' : 'file'}-${crypto.randomUUID()}`,
      );
      pastedCount = created.length;
      return created.length > 0 ? [...created, ...prev] : prev;
    });

    if (pastedCount > 0) {
      pushNotification({
        kind: 'success',
        title: `Berhasil menempel ${pastedCount} item`,
        detail: `Ditempatkan di ${targetFolderName}.`,
      });
    } else {
      pushNotification({
        kind: 'error',
        title: 'Tidak dapat menempel di sini',
        detail: 'Folder tidak dapat ditempel ke dalam dirinya sendiri.',
      });
    }
  }, [clipboardIds, section, currentFolderId, items, commitItems, pushNotification]);

  const handleDropMoveToFolder = useCallback(
    (ids: string[], targetFolderId: string | null) => {
      const now = new Date().toISOString();
      let movedCount = 0;

      commitItems((prev) => {
        const result = applyMoveItems(ids, targetFolderId, prev, now);
        movedCount = result.movedCount;
        return result.nextItems;
      });

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

  // Keyboard shortcuts (Search `/`, Select All `Ctrl+A`, Copy `Ctrl+C`, Paste `Ctrl+V`, `Escape`)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditingInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (e.key === '/' && !isEditingInput) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !isEditingInput) {
        if (visibleItems.length > 0) {
          e.preventDefault();
          setSelectedIds(new Set(visibleItems.map((i) => i.id)));
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && !isEditingInput) {
        if (selectedIds.size > 0) {
          e.preventDefault();
          handleCopyIds(Array.from(selectedIds));
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && !isEditingInput) {
        if (clipboardIds.length > 0) {
          e.preventDefault();
          handlePasteItems();
        }
      } else if (e.key === 'Escape') {
        setContextMenu(null);
        setPreviewItem(null);
        setTelegramModalOpen(false);
        setNameModal((prev) => ({ ...prev, open: false }));
        setDeleteModal({ open: false, variant: 'permanent', ids: [] });
        setSelectedIds(new Set());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visibleItems, selectedIds, clipboardIds, handleCopyIds, handlePasteItems]);

  const handleSelectSection = (next: NavSection) => {
    setSection(next);
    setSelectedIds(new Set());
    if (next !== 'my-drive') {
      setCurrentFolderId(null);
    }
  };

  const handleNavigateFolder = (folderId: string | null) => {
    setSection('my-drive');
    setSearchQuery('');
    setCurrentFolderId(folderId);
    setSelectedIds(new Set());
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

  const updateTransferTask = useCallback((id: string, patch: Partial<TransferTask>) => {
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
      updateTransferTask(nextJob.taskId, {
        status: 'active',
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
          const hasMoreQueued = uploadQueueRef.current.length > 0;
          if (nextJob.isBatch) {
            batchSuccessCountRef.current += 1;
          }
          // Defer pinned index updates while batch queue has remaining items (checkpoint every 15 files)
          const shouldCheckpoint =
            !hasMoreQueued || (nextJob.isBatch && batchSuccessCountRef.current % 15 === 0);
          commitItems(
            (prev) => [createdItem, ...prev.filter((i) => i.id !== createdItem.id)],
            { deferIndexPush: !shouldCheckpoint },
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
            errorMessage: msg,
            canRetry,
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

          // Gentle pacing after 5 consecutive files to stay under Telegram channel flood limits
          const needsPacing = nextJob.isBatch && batchStartedCountRef.current >= 5;
          if (needsPacing) {
            if (batchPacingTimerRef.current) {
              window.clearTimeout(batchPacingTimerRef.current);
            }
            batchPacingTimerRef.current = window.setTimeout(() => {
              batchPacingTimerRef.current = null;
              pumpUploadQueue();
            }, 1100);
          } else {
            pumpUploadQueue();
          }
        });
    }
  }, [commitItems, pushNotification, updateTransferTask]);

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

      const oversized = validEntries.filter((e) => e.file.size > DIRECT_TELEGRAM_MAX_BYTES);
      const uploadableEntries = validEntries.filter(
        (e) => e.file.size <= DIRECT_TELEGRAM_MAX_BYTES,
      );

      if (oversized.length > 0) {
        pushNotification({
          kind: 'error',
          title: 'Upload ditolak: File harus di bawah 20 MB',
          detail:
            oversized.length === 1
              ? `"${oversized[0].file.name}" (${formatBytes(oversized[0].file.size)}) melebihi batas maksimal 20 MB/file.`
              : `${oversized.length} file melebihi batas 20 MB/file (${oversized[0].file.name}, ...).`,
        });
      }

      const baseParentId =
        overrideParentId !== undefined
          ? overrideParentId
          : section === 'my-drive'
            ? currentFolderId
            : null;
      const destLabel = baseParentId
        ? itemsRef.current.find((i) => i.id === baseParentId)?.name || 'Folder tujuan'
        : 'Drive Saya';

      // Create folder hierarchy for uploadable files + empty folders
      const allFolderPaths = [
        ...uploadableEntries.map((e) => e.folderPath),
        ...tree.emptyFolderPaths,
      ].filter((p) => p.length > 0);

      let resolveParentId: (path: string[]) => string | null = () => baseParentId;
      let createdFoldersCount = 0;

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
        if (createdFoldersCount > 0) {
          commitItems((prev) => [...materialized.createdFolders, ...prev]);
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

      const isBatch = uploadableEntries.length > 1 || createdFoldersCount > 0;
      if (!isBatch) {
        pushNotification({
          kind: 'info',
          title: `Mengunggah ${uploadableEntries[0].file.name}`,
          detail: `Dikirim cepat ke ${destLabel} (Cloud Telegram).`,
        });
      } else {
        const folderNote = createdFoldersCount > 0 ? `${createdFoldersCount} folder & ` : '';
        pushNotification({
          kind: 'info',
          title: `Mengantrekan ${folderNote}${uploadableEntries.length} file ke ${destLabel}`,
          detail: 'Diproses satu per satu sampai selesai agar upload cepat & koneksi tetap stabil.',
        });
      }

      const createdTasks: TransferTask[] = [];
      for (const entry of uploadableEntries) {
        const taskId = `tr-${crypto.randomUUID()}`;
        const resolvedParent = resolveParentId(entry.folderPath);
        createdTasks.push({
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
          createdAt: Date.now(),
        });

        uploadQueueRef.current.push({
          taskId,
          file: entry.file,
          targetParent: resolvedParent,
          tgSnapshot: tgConfig,
          isBatch,
        });

        transferCancelMap.current.set(taskId, () => {
          uploadQueueRef.current = uploadQueueRef.current.filter((job) => job.taskId !== taskId);
        });
      }

      setTransfers((prev) => [...createdTasks, ...prev].slice(0, 200));
      pumpUploadQueue();
    },
    [commitItems, currentFolderId, section, tgConfig, pumpUploadQueue, pushNotification],
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
      const taskId = `dl-${crypto.randomUUID()}`;
      const downloadTask: TransferTask = {
        id: taskId,
        kind: 'download',
        filename: item.name,
        totalBytes: item.size,
        loadedBytes: 0,
        speedBytesPerSec: 0,
        etaSeconds: 0,
        completedChunks: 0,
        totalChunks: 1,
        status: 'active',
        createdAt: Date.now(),
      };
      setTransfers((prev) => [downloadTask, ...prev].slice(0, 200));

      const ctrl = startDirectDownload(item, tgConfig, (progress) => {
        updateTransferTask(taskId, progress);
      });
      transferCancelMap.current.set(taskId, ctrl.cancel);

      ctrl.promise
        .then((res) => {
          transferCancelMap.current.delete(taskId);
          if (res?.usedRawFallback) {
            pushNotification({
              kind: 'info',
              title: `Unduhan dialihkan ke Telegram: ${item.name}`,
              detail:
                'Aktifkan Proxy Cloudflare Worker di Pengaturan Telegram agar HP langsung menyimpan file dengan nama dan format asli.',
            });
          } else {
            pushNotification({
              kind: 'success',
              title: `Unduhan dimulai: ${item.name}`,
            });
          }
        })
        .catch((err) => {
          transferCancelMap.current.delete(taskId);
          const msg = err instanceof Error ? err.message : 'Unduhan gagal.';
          updateTransferTask(taskId, {
            status: 'error',
            errorMessage: msg,
          });
          pushNotification({
            kind: 'error',
            title: `Gagal mengunduh ${item.name}`,
            detail: msg,
          });
        });
    },
    [tgConfig, updateTransferTask, pushNotification],
  );

  const handleCancelTransfer = (id: string) => {
    const cancelFn = transferCancelMap.current.get(id);
    if (cancelFn) {
      cancelFn();
      transferCancelMap.current.delete(id);
    }
    updateTransferTask(id, { status: 'cancelled', errorMessage: 'Dibatalkan pengguna' });
  };

  const handleOpenItem = (item: DriveItem) => {
    if (item.type === 'folder') {
      handleNavigateFolder(item.id);
    } else {
      lastSelectedIdRef.current = item.id;
      setSelectedIds(new Set([item.id]));
      setPreviewPaneOpen(true);
    }
  };

  const handleDoubleClickItem = (item: DriveItem) => {
    if (item.type === 'file') {
      setPreviewItem(item);
    }
  };

  const handleToggleStar = (item: DriveItem) => {
    const nextStar = !item.starred;
    const now = new Date().toISOString();
    commitItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, starred: nextStar, updatedAt: now } : i)),
    );
    if (previewItem?.id === item.id) {
      setPreviewItem({ ...previewItem, starred: nextStar });
    }
    pushNotification({
      kind: 'info',
      title: nextStar ? `Dibintangi: ${item.name}` : `Bintang dihapus: ${item.name}`,
    });
  };

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
      commitItems((prev) => [folder, ...prev]);
      pushNotification({
        kind: 'success',
        title: `Folder dibuat: ${cleanName}`,
      });
    } else if (nameModal.targetItem) {
      const targetId = nameModal.targetItem.id;
      const cleanName = name.slice(0, 180);
      commitItems((prev) =>
        prev.map((i) => (i.id === targetId ? { ...i, name: cleanName, updatedAt: now } : i)),
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
    commitItems((prev) => {
      const expanded = new Set<string>();
      for (const id of ids) {
        const target = prev.find((i) => i.id === id);
        if (!target) continue;
        if (target.type === 'folder') {
          for (const d of collectDescendantIds(target.id, prev)) expanded.add(d);
        } else {
          expanded.add(target.id);
        }
      }
      return prev.map((i) =>
        expanded.has(i.id)
          ? { ...i, trashed, trashedAt: trashed ? now : null, updatedAt: now }
          : i,
      );
    });
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
    const expanded = new Set<string>();
    for (const id of deleteModal.ids) {
      const target = items.find((i) => i.id === id);
      if (!target) continue;
      if (target.type === 'folder') {
        for (const d of collectDescendantIds(target.id, items)) expanded.add(d);
      } else {
        expanded.add(target.id);
      }
    }

    const remainingBlobKeys = new Set(
      items
        .filter((i) => !expanded.has(i.id) && i.localBlobKey)
        .map((i) => i.localBlobKey as string),
    );

    const deletedTgMsgIds: number[] = [];
    let tgErrorMsg: string | null = null;
    let tgDeletedCount = 0;

    for (const item of items) {
      if (!expanded.has(item.id)) continue;
      if (item.localBlobKey && !remainingBlobKeys.has(item.localBlobKey)) {
        await deleteLocalBlob(item.localBlobKey);
      }
      if (item.storageBackend === 'telegram') {
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
              } else if (!tgErrorMsg && delRes.error) {
                tgErrorMsg = delRes.error;
              }
            }
          }
        }
      }
    }

    if (deletedTgMsgIds.length > 0) {
      addDismissedTelegramMessageIds(deletedTgMsgIds);
    }

    tombstonesRef.current = addDeletedTombstones(Array.from(expanded));
    commitItems((prev) => prev.filter((i) => !expanded.has(i.id)));
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
  const isTrashView = section === 'trash';

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
          pinnedIndexIdRef.current = nextCfg.pinnedIndexMessageId;
          didAutoSyncRef.current = false;
          hasSyncedOnceRef.current = false;
          lastSyncMsRef.current = 0;
          setSyncState('synced');
          if (pulledItems.length > 0) {
            setItems(pulledItems);
            saveStoredItems(pulledItems);
          }
          pushNotification({
            kind: 'success',
            title: `Terhubung ke @${nextCfg.botUsername || 'Bot'}`,
            detail: opts?.savedLocalVault
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
                  {searchQuery
                    ? 'Coba kata kunci lain.'
                    : isTrashView
                      ? 'File atau folder yang Anda buang akan muncul di sini sebelum dihapus permanen.'
                      : 'Seret dan lepas file ke area ini (atau tepat ke atas folder) atau klik Unggah File (maks. 20 MB per file).'}
                </p>

                {!isTrashView && !searchQuery && (
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                    >
                      <UploadCloud className="h-4 w-4" />
                      <span>Unggah File (≤ 20 MB)</span>
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
                items={visibleItems}
                allItems={items}
                tgConfig={tgConfig}
                folderCounts={folderCounts}
                selectedIds={selectedIds}
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
                items={visibleItems}
                allItems={items}
                folderCounts={folderCounts}
                selectedIds={selectedIds}
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
                Atau arahkan &amp; lepas tepat ke atas kartu folder tujuan (maks. 20 MB/file)
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
        item={previewItem}
        tgConfig={tgConfig}
        onClose={() => setPreviewItem(null)}
        onOpenTelegramSettings={() => setTelegramModalOpen(true)}
      />

      <TelegramModal
        open={telegramModalOpen}
        config={tgConfig}
        vaultAvailable={isVaultConfigured(activeVaultString)}
        onClose={() => setTelegramModalOpen(false)}
        onSaveLocalVault={(vaultCode) => {
          saveLocalEncryptedVault(vaultCode);
          setLocalVaultString(vaultCode);
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
              return merged;
            });
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
              return merged;
            });
            setSyncState('synced');
            pushNotification({
              kind: 'success',
              title: `${pulledItems.length} item dimuat dari Telegram`,
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

      <ContextMenu
        menu={contextMenu}
        selectedItems={selectedItemsList}
        isTrashView={isTrashView}
        clipboardCount={clipboardIds.length}
        onClose={() => setContextMenu(null)}
        onOpenItem={handleOpenItem}
        onDownloadItems={(targetItems) => {
          for (const target of targetItems) {
            if (target.type === 'file') handleDownloadItem(target);
          }
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
          commitItems((prev) =>
            prev.map((i) => (ids.has(i.id) ? { ...i, starred: nextStar, updatedAt: now } : i)),
          );
          pushNotification({
            kind: 'info',
            title: nextStar
              ? `${targetItems.length} item dibintangi`
              : `Bintang dihapus dari ${targetItems.length} item`,
          });
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
    </div>
  );
}
