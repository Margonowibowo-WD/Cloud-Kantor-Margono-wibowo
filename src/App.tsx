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
  TypeFilter,
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
  addDismissedTelegramMessageIds,
  deleteLocalBlob,
  getLocalBlob,
  loadDismissedTelegramMessageIds,
  loadStoredItems,
  loadStoredTelegramConfig,
  saveStoredItems,
  saveStoredTelegramConfig,
} from './utils/localVault';
import {
  DIRECT_TELEGRAM_MAX_BYTES,
  UPLOAD_CONCURRENCY,
  checkTelegramMessageExists,
  deleteTelegramMessageDirect,
  fetchChannelMediaUpdates,
  pullIndexFromTelegramPinnedMessage,
  pushIndexToTelegramPinnedMessage,
  toPublicStatus,
  uploadFileDirectToTelegram,
} from './utils/telegramDirect';
import { mergeDriveItems, reconcileRemoteDriveItems } from './utils/telegramIndex';
import { isVaultConfigured } from './utils/cryptoVault';
import { startDirectDownload, startDirectUpload } from './utils/uploadClient';
import { Sidebar } from './components/Sidebar';
import { type ThemeMode, TopBar } from './components/TopBar';
import { Toolbar } from './components/Toolbar';
import { FileGrid } from './components/FileGrid';
import { FileTable } from './components/FileTable';
import { ContextMenu, type ContextMenuState } from './components/ContextMenu';
import { type AppNotification, TopRightNotifications } from './components/TopRightNotifications';
import { PreviewModal } from './components/PreviewModal';
import { RightPreviewPane } from './components/RightPreviewPane';
import { TelegramModal } from './components/TelegramModal';
import { VaultUnlockModal } from './components/VaultUnlockModal';
import { ConfirmDeleteModal, FolderNameModal } from './components/ActionModals';

const DEFAULT_TELEGRAM_VAULT =
  'TDVAULT1:wIxIsTjutAMZac4LmnW4fw.YR-haJJvsPu4fl1-.IQil19h6ECXpwU1XufaUy_jvptzX6edLgPLrSezQD69Uef1Y2mA4hO6_TtpACJpfSdPD0uqYBjr0n_DgZR5nqIXFpBxhJ9ksf2tuTnIwDFVZWzlbGHlumExEYw';

const ENV_TELEGRAM_VAULT =
  ((import.meta.env.VITE_TELEGRAM_VAULT as string | undefined) || '').trim() ||
  DEFAULT_TELEGRAM_VAULT;

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
  const [items, setItems] = useState<DriveItem[]>(() => loadStoredItems());
  const [tgConfig, setTgConfig] = useState<TelegramConfigState>(() => loadStoredTelegramConfig());

  const [section, setSection] = useState<NavSection>('my-drive');
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
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
  const [vaultModalOpen, setVaultModalOpen] = useState(
    () => isVaultConfigured(ENV_TELEGRAM_VAULT) && !loadStoredTelegramConfig().connected,
  );
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
  const didAutoSyncRef = useRef(false);
  const lastSyncMsRef = useRef(0);
  const lastSelectedIdRef = useRef<string | null>(null);
  const itemsRef = useRef<DriveItem[]>(items);
  itemsRef.current = items;
  const mainRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  const [cloudPushTick, setCloudPushTick] = useState(0);

  // Persist items cleanly & push index to Telegram pinned message outside React state updaters
  const commitItems = useCallback((updater: (prev: DriveItem[]) => DriveItem[]) => {
    setItems((prev) => {
      const next = updater(prev);
      saveStoredItems(next);
      return next;
    });
    setCloudPushTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (cloudPushTick === 0) return;
    if (!tgConfig.connected || !tgConfig.botToken || !tgConfig.chatId) return;

    let active = true;
    const timer = window.setTimeout(() => {
      void pushIndexToTelegramPinnedMessage(
        tgConfig.botToken,
        tgConfig.chatId,
        itemsRef.current,
        tgConfig.pinnedIndexMessageId,
      ).then((pinId) => {
        if (active && pinId && pinId !== tgConfig.pinnedIndexMessageId) {
          setTgConfig((curr) => {
            const updatedCfg = { ...curr, pinnedIndexMessageId: pinId };
            saveStoredTelegramConfig(updatedCfg);
            return updatedCfg;
          });
        }
      });
    }, 600);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [cloudPushTick, tgConfig.connected, tgConfig.botToken, tgConfig.chatId, tgConfig.pinnedIndexMessageId]);

  // Two-way sync: pull Pinned Index, import new channel uploads, and prune messages deleted in Telegram
  const syncFromTelegram = useCallback(
    async (silent = false) => {
      if (!tgConfig.connected || !tgConfig.botToken || !tgConfig.chatId) return;
      const syncStartedAtMs = Date.now();
      lastSyncMsRef.current = syncStartedAtMs;
      setSyncingTelegram(true);
      try {
        const res = await pullIndexFromTelegramPinnedMessage(tgConfig.botToken, tgConfig.chatId);
        if (!res.error) {
          const knownMsgIds = new Set<number>();
          for (const item of itemsRef.current) {
            for (const c of item.chunks) {
              if (c.telegramMessageId) knownMsgIds.add(c.telegramMessageId);
            }
          }
          for (const item of res.items) {
            for (const c of item.chunks) {
              if (c.telegramMessageId) knownMsgIds.add(c.telegramMessageId);
            }
          }

          const dismissedIds = loadDismissedTelegramMessageIds();
          const channelMedia = await fetchChannelMediaUpdates(
            tgConfig.botToken,
            tgConfig.chatId,
            knownMsgIds,
            dismissedIds,
          );

          // Probe recent Telegram-backed files to detect direct deletions inside Telegram channel
          const probeCandidates = [...res.items, ...itemsRef.current]
            .filter(
              (i, idx, arr) =>
                i.type === 'file' &&
                i.storageBackend === 'telegram' &&
                Boolean(i.chunks[0]?.telegramMessageId) &&
                arr.findIndex((x) => x.id === i.id) === idx,
            )
            .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
            .slice(0, 25);

          const deletedInTelegramItemIds = new Set<string>();
          const deletedInTelegramMsgIds: number[] = [];
          for (const candidate of probeCandidates) {
            const msgId = candidate.chunks[0]?.telegramMessageId;
            if (!msgId) continue;
            const status = await checkTelegramMessageExists(
              tgConfig.botToken,
              tgConfig.chatId,
              msgId,
            );
            if (status === 'deleted') {
              deletedInTelegramItemIds.add(candidate.id);
              deletedInTelegramMsgIds.push(msgId);
            }
          }

          if (deletedInTelegramMsgIds.length > 0) {
            addDismissedTelegramMessageIds(deletedInTelegramMsgIds);
          }

          const isCompleteAuthoritativeIndex = res.hasIndex && res.rawLength < 3600;
          const pinnedWithoutDeleted = res.items.filter((i) => !deletedInTelegramItemIds.has(i.id));
          let nextPinnedId = res.pinnedMessageId ?? tgConfig.pinnedIndexMessageId;

          const reconciled = reconcileRemoteDriveItems(
            itemsRef.current,
            pinnedWithoutDeleted,
            channelMedia,
            isCompleteAuthoritativeIndex,
            syncStartedAtMs,
          ).filter((i) => !deletedInTelegramItemIds.has(i.id));

          saveStoredItems(reconciled);
          setItems(reconciled);

          if (channelMedia.length > 0 || deletedInTelegramItemIds.size > 0) {
            const pushedPin = await pushIndexToTelegramPinnedMessage(
              tgConfig.botToken,
              tgConfig.chatId,
              reconciled,
              nextPinnedId,
            );
            if (pushedPin) nextPinnedId = pushedPin;
          }

          setTgConfig((curr) => {
            const updatedCfg: TelegramConfigState = {
              ...curr,
              pinnedIndexMessageId: nextPinnedId ?? curr.pinnedIndexMessageId,
              lastSyncedAt: new Date().toISOString(),
            };
            saveStoredTelegramConfig(updatedCfg);
            return updatedCfg;
          });

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
                  : res.items.length > 0
                    ? `${res.items.length} item tersinkron dari @${tgConfig.botUsername || 'Bot'}.`
                    : `Terhubung ke @${tgConfig.botUsername || 'Bot'}.`,
            });
          }
        } else if (!silent) {
          pushNotification({
            kind: 'error',
            title: 'Sinkronisasi gagal',
            detail: res.error,
          });
        }
      } finally {
        setSyncingTelegram(false);
      }
    },
    [
      tgConfig.connected,
      tgConfig.botToken,
      tgConfig.chatId,
      tgConfig.botUsername,
      tgConfig.pinnedIndexMessageId,
      pushNotification,
    ],
  );

  // Automatically sync on startup & whenever user returns to the tab
  useEffect(() => {
    if (!tgConfig.connected || !tgConfig.botToken || !tgConfig.chatId) return;

    if (!didAutoSyncRef.current) {
      didAutoSyncRef.current = true;
      void syncFromTelegram(true);
    }

    const onVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastSyncMsRef.current > 15_000) {
        void syncFromTelegram(true);
      }
    };

    window.addEventListener('focus', onVisibilityOrFocus);
    document.addEventListener('visibilitychange', onVisibilityOrFocus);
    return () => {
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
        typeFilter,
        sortField,
        sortDirection,
      }),
    [items, section, currentFolderId, searchQuery, typeFilter, sortField, sortDirection],
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

  const handleSortChange = (field: SortField) => {
    if (field === sortField) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'updatedAt' ? 'desc' : 'asc');
    }
  };

  const updateTransferTask = useCallback((id: string, patch: Partial<TransferTask>) => {
    setTransfers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    if (
      patch.status === 'completed' ||
      patch.status === 'error' ||
      patch.status === 'cancelled'
    ) {
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
      updateTransferTask(nextJob.taskId, { status: 'active' });

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
          commitItems((prev) => [createdItem, ...prev.filter((i) => i.id !== createdItem.id)]);
          if (nextJob.isBatch) {
            batchSuccessCountRef.current += 1;
          } else {
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
          updateTransferTask(nextJob.taskId, {
            status: msg === 'Dibatalkan' ? 'cancelled' : 'error',
            errorMessage: msg,
          });
          if (msg !== 'Dibatalkan') {
            pushNotification({
              kind: 'error',
              title: `Gagal mengunggah ${nextJob.file.name}`,
              detail: msg,
            });
          }
        })
        .finally(() => {
          activeUploadCountRef.current = Math.max(0, activeUploadCountRef.current - 1);
          if (
            nextJob.isBatch &&
            activeUploadCountRef.current === 0 &&
            uploadQueueRef.current.length === 0 &&
            batchSuccessCountRef.current > 0
          ) {
            const count = batchSuccessCountRef.current;
            batchSuccessCountRef.current = 0;
            pushNotification({
              kind: 'success',
              title: `${count} file selesai diunggah`,
              detail: 'Semua file tersimpan di Cloud Telegram & tersinkron.',
            });
          }
          pumpUploadQueue();
        });
    }
  }, [commitItems, pushNotification, updateTransferTask]);

  const enqueueFilesUpload = useCallback(
    (fileList: FileList | File[], overrideParentId?: string | null) => {
      const allFiles = Array.from(fileList).filter((f) => f.name);
      if (allFiles.length === 0) return;

      if (!tgConfig.connected || !tgConfig.botToken || !tgConfig.chatId) {
        pushNotification({
          kind: 'error',
          title: 'Cloud Telegram belum terhubung',
          detail: 'Masukkan PIN Brankas untuk mengunggah ke Cloud.',
        });
        setVaultModalOpen(true);
        return;
      }

      const oversized = allFiles.filter((f) => f.size > DIRECT_TELEGRAM_MAX_BYTES);
      const files = allFiles.filter((f) => f.size <= DIRECT_TELEGRAM_MAX_BYTES);

      if (oversized.length > 0) {
        pushNotification({
          kind: 'error',
          title: 'Upload ditolak: File harus di bawah 20 MB',
          detail:
            oversized.length === 1
              ? `"${oversized[0].name}" (${formatBytes(oversized[0].size)}) melebihi batas maksimal 20 MB/file.`
              : `${oversized.length} file melebihi batas 20 MB/file (${oversized[0].name}, ...).`,
        });
      }

      if (files.length === 0) return;

      const targetParent =
        overrideParentId !== undefined
          ? overrideParentId
          : section === 'my-drive'
            ? currentFolderId
            : null;
      const destLabel = targetParent
        ? itemsRef.current.find((i) => i.id === targetParent)?.name || 'Folder tujuan'
        : 'Drive Saya';

      const isBatch = files.length > 1;
      if (!isBatch) {
        pushNotification({
          kind: 'info',
          title: `Mengunggah ${files[0].name}`,
          detail: `Dikirim cepat ke ${destLabel} (Cloud Telegram).`,
        });
      } else {
        pushNotification({
          kind: 'info',
          title: `Mengantrekan ${files.length} file ke ${destLabel}`,
          detail: `Diproses ${UPLOAD_CONCURRENCY} file paralel dengan auto-retry anti-limit Telegram.`,
        });
      }

      const createdTasks: TransferTask[] = [];
      for (const file of files) {
        const taskId = `tr-${crypto.randomUUID()}`;
        createdTasks.push({
          id: taskId,
          kind: 'upload',
          filename: file.name,
          totalBytes: file.size,
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
          file,
          targetParent,
          tgSnapshot: tgConfig,
          isBatch,
        });

        transferCancelMap.current.set(taskId, () => {
          uploadQueueRef.current = uploadQueueRef.current.filter((job) => job.taskId !== taskId);
        });
      }

      setTransfers((prev) => [...createdTasks.reverse(), ...prev].slice(0, 200));
      pumpUploadQueue();
    },
    [currentFolderId, section, tgConfig, pumpUploadQueue, pushNotification],
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
        .then(() => {
          transferCancelMap.current.delete(taskId);
          pushNotification({
            kind: 'success',
            title: `Unduhan dimulai: ${item.name}`,
          });
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

  const handleSyncTelegram = async (item: DriveItem) => {
    if (!tgConfig.connected || !tgConfig.botToken || !tgConfig.chatId) {
      throw new Error('Hubungkan Telegram terlebih dahulu.');
    }

    let fileBlob: Blob | null = null;
    if (item.localBlobKey) {
      fileBlob = await getLocalBlob(item.localBlobKey);
    } else if (item.demoTextContent !== undefined) {
      fileBlob = new Blob([item.demoTextContent], { type: item.mimeType || 'text/plain' });
    } else if (item.thumbnailUrl) {
      const res = await fetch(item.thumbnailUrl);
      if (res.ok) fileBlob = await res.blob();
    }

    if (!fileBlob) {
      throw new Error('Data file lokal tidak tersedia untuk disinkronkan.');
    }

    const op = uploadFileDirectToTelegram(
      tgConfig.botToken,
      tgConfig.chatId,
      fileBlob,
      item.name,
      () => undefined,
    );
    const uploaded = await op.promise;
    const now = new Date().toISOString();

    const updatedItem: DriveItem = {
      ...item,
      storageBackend: 'telegram',
      updatedAt: now,
      chunks: [
        {
          index: 0,
          size: fileBlob.size,
          telegramFileId: uploaded.fileId,
          telegramUniqueId: uploaded.fileUniqueId,
          telegramMessageId: uploaded.messageId,
        },
      ],
    };

    commitItems((prev) => prev.map((i) => (i.id === item.id ? updatedItem : i)));
    setPreviewItem(updatedItem);
    pushNotification({
      kind: 'success',
      title: `Tersinkron ke Telegram: ${item.name}`,
    });
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

  const handleToggleSelectAll = () => {
    const allSelected = visibleItems.length > 0 && visibleItems.every((i) => selectedIds.has(i.id));
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(visibleItems.map((i) => i.id)));
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

  const selectedArray = Array.from(selectedIds);
  const selectedItemsList = useMemo(
    () => items.filter((i) => selectedIds.has(i.id)),
    [items, selectedIds],
  );
  const allVisibleSelected =
    visibleItems.length > 0 && visibleItems.every((i) => selectedIds.has(i.id));
  const isTrashView = section === 'trash';

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
        if (e.dataTransfer.files?.length) {
          e.preventDefault();
          setIsDraggingExternalFiles(false);
          enqueueFilesUpload(e.dataTransfer.files);
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
        onDropExternalFilesToRoot={(files) => {
          setIsDraggingExternalFiles(false);
          enqueueFilesUpload(files, null);
        }}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          themeMode={themeMode}
          effectiveDark={effectiveDark}
          onCycleThemeMode={handleCycleThemeMode}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onQuickUploadClick={() => fileInputRef.current?.click()}
          searchInputRef={searchInputRef}
          telegram={telegramStatus}
          syncingTelegram={syncingTelegram}
          vaultAvailable={isVaultConfigured(ENV_TELEGRAM_VAULT)}
          onSyncNow={() => void syncFromTelegram(false)}
          onOpenTelegramModal={() => setTelegramModalOpen(true)}
          onOpenVaultUnlock={() => setVaultModalOpen(true)}
        />

        <Toolbar
          section={section}
          breadcrumbs={breadcrumbs}
          onNavigateFolder={handleNavigateFolder}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          sortField={sortField}
          sortDirection={sortDirection}
          onSortChange={handleSortChange}
          visibleCount={visibleItems.length}
          selectedCount={selectedIds.size}
          allSelected={allVisibleSelected}
          onToggleSelectAll={handleToggleSelectAll}
          onClearSelection={() => setSelectedIds(new Set())}
          onBulkDownload={() => {
            for (const id of selectedArray) {
              const found = items.find((i) => i.id === id && i.type === 'file');
              if (found) handleDownloadItem(found);
            }
          }}
          onBulkStar={() => {
            const now = new Date().toISOString();
            const set = new Set(selectedArray);
            commitItems((prev) =>
              prev.map((i) => (set.has(i.id) ? { ...i, starred: true, updatedAt: now } : i)),
            );
            setSelectedIds(new Set());
            pushNotification({
              kind: 'info',
              title: `${selectedArray.length} item dibintangi`,
            });
          }}
          onBulkCopy={() => {
            handleCopyIds(selectedArray);
            setSelectedIds(new Set());
          }}
          onBulkTrash={() => openTrashConfirmation(selectedItemsList)}
          onBulkRestore={() => handleTrashOrRestore(selectedArray, false)}
          onBulkDeletePermanent={() => openPermanentDeleteConfirmation(selectedItemsList)}
          clipboardCount={clipboardIds.length}
          onPasteItems={handlePasteItems}
          onClearClipboard={() => setClipboardIds([])}
          onDropMoveToFolder={(ids, targetId) => handleDropMoveToFolder(ids, targetId)}
          onDropExternalFilesToFolder={(files, targetFolderId) => {
            setIsDraggingExternalFiles(false);
            enqueueFilesUpload(files, targetFolderId);
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
                              : 'Folder ini masih kosong'}
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {searchQuery
                    ? 'Coba kata kunci lain atau ubah filter tipe file di atas.'
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
                tgConfig={tgConfig}
                folderCounts={folderCounts}
                selectedIds={selectedIds}
                draggingIds={draggingIds}
                onDragStartIds={setDraggingIds}
                onDragEndIds={() => setDraggingIds([])}
                onDropMoveToFolder={(ids, targetFolderId) =>
                  handleDropMoveToFolder(ids, targetFolderId)
                }
                onDropExternalFilesToFolder={(files, targetFolderId) => {
                  setIsDraggingExternalFiles(false);
                  enqueueFilesUpload(files, targetFolderId);
                }}
                onToggleSelect={handleToggleSelect}
                onContextMenuItem={handleContextMenuItem}
                onOpenItem={handleOpenItem}
                onDoubleClickItem={handleDoubleClickItem}
                onDownloadItem={handleDownloadItem}
                onCopyItem={(item) => handleCopyIds([item.id])}
                onToggleStar={handleToggleStar}
                onRenameItem={(item) =>
                  setNameModal({ open: true, mode: 'rename', targetItem: item })
                }
                onTrashItem={(item) => openTrashConfirmation([item])}
                onRestoreItem={(item) => handleTrashOrRestore([item.id], false)}
                onDeletePermanent={(item) => openPermanentDeleteConfirmation([item])}
                isTrashView={isTrashView}
              />
            ) : (
              <FileTable
                items={visibleItems}
                selectedIds={selectedIds}
                draggingIds={draggingIds}
                onDragStartIds={setDraggingIds}
                onDragEndIds={() => setDraggingIds([])}
                onDropMoveToFolder={(ids, targetFolderId) =>
                  handleDropMoveToFolder(ids, targetFolderId)
                }
                onDropExternalFilesToFolder={(files, targetFolderId) => {
                  setIsDraggingExternalFiles(false);
                  enqueueFilesUpload(files, targetFolderId);
                }}
                onToggleSelect={handleToggleSelect}
                onContextMenuItem={handleContextMenuItem}
                onOpenItem={handleOpenItem}
                onDoubleClickItem={handleDoubleClickItem}
                onDownloadItem={handleDownloadItem}
                onCopyItem={(item) => handleCopyIds([item.id])}
                onToggleStar={handleToggleStar}
                onRenameItem={(item) =>
                  setNameModal({ open: true, mode: 'rename', targetItem: item })
                }
                onTrashItem={(item) => openTrashConfirmation([item])}
                onRestoreItem={(item) => handleTrashOrRestore([item.id], false)}
                onDeletePermanent={(item) => openPermanentDeleteConfirmation([item])}
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
            onExpandModal={(item) => setPreviewItem(item)}
            onDownload={handleDownloadItem}
            onToggleStar={handleToggleStar}
            onCopyItems={(targetItems) => handleCopyIds(targetItems.map((i) => i.id))}
            onTrashItems={(targetItems) => openTrashConfirmation(targetItems)}
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
                Lepas file untuk unggah ke{' '}
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
        onClearCompletedTasks={() =>
          setTransfers((prev) => prev.filter((t) => t.status === 'active' || t.status === 'queued'))
        }
      />

      {/* Modals */}
      <PreviewModal
        item={previewItem}
        tgConfig={tgConfig}
        onClose={() => setPreviewItem(null)}
        onDownload={handleDownloadItem}
        onToggleStar={handleToggleStar}
        onSyncTelegram={handleSyncTelegram}
      />

      <TelegramModal
        open={telegramModalOpen}
        config={tgConfig}
        vaultAvailable={isVaultConfigured(ENV_TELEGRAM_VAULT)}
        onOpenVaultUnlock={() => setVaultModalOpen(true)}
        onClose={() => setTelegramModalOpen(false)}
        onSaveConfig={(nextCfg, pulledItems) => {
          setTgConfig(nextCfg);
          saveStoredTelegramConfig(nextCfg);
          if (pulledItems && pulledItems.length > 0) {
            setItems((prev) => {
              const merged = mergeDriveItems(prev, pulledItems);
              saveStoredItems(merged);
              return merged;
            });
          }
          pushNotification({
            kind: 'success',
            title: nextCfg.connected
              ? `Terhubung ke @${nextCfg.botUsername}`
              : 'Koneksi Telegram diputuskan',
          });
        }}
        onPullRemoteItems={(pulledItems, pinnedMsgId) => {
          if (pinnedMsgId) {
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
            pushNotification({
              kind: 'success',
              title: `${pulledItems.length} item dimuat dari Telegram`,
            });
          }
        }}
      />

      <VaultUnlockModal
        open={vaultModalOpen}
        vaultString={ENV_TELEGRAM_VAULT}
        onUnlockSuccess={(nextCfg, pulledItems) => {
          setTgConfig(nextCfg);
          saveStoredTelegramConfig(nextCfg);
          didAutoSyncRef.current = true;
          lastSyncMsRef.current = Date.now();
          if (pulledItems.length > 0) {
            setItems((prev) => {
              const merged = mergeDriveItems(prev, pulledItems);
              saveStoredItems(merged);
              return merged;
            });
          }
          setVaultModalOpen(false);
          pushNotification({
            kind: 'success',
            title: `Terhubung ke @${nextCfg.botUsername || 'Bot'}`,
            detail:
              pulledItems.length > 0
                ? `${pulledItems.length} item otomatis disinkronkan.`
                : 'Cloud Kantor Margono siap digunakan.',
          });
        }}
        onDismiss={() => setVaultModalOpen(false)}
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
