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
  buildBreadcrumbs,
  computeStorageSummary,
  filterAndSortItems,
} from './utils/fileHelpers';
import {
  deleteLocalBlob,
  getLocalBlob,
  loadStoredItems,
  loadStoredTelegramConfig,
  saveStoredItems,
  saveStoredTelegramConfig,
} from './utils/localVault';
import {
  deleteTelegramMessageDirect,
  pushIndexToTelegramPinnedMessage,
  toPublicStatus,
  uploadFileDirectToTelegram,
} from './utils/telegramDirect';
import { mergeDriveItems } from './utils/telegramIndex';
import { startDirectDownload, startDirectUpload } from './utils/uploadClient';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Toolbar } from './components/Toolbar';
import { FileGrid } from './components/FileGrid';
import { FileTable } from './components/FileTable';
import { TransferManager } from './components/TransferManager';
import { PreviewModal } from './components/PreviewModal';
import { TelegramModal } from './components/TelegramModal';
import { ConfirmDeleteModal, FolderNameModal, MoveModal } from './components/ActionModals';

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
  const [darkMode, setDarkMode] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const [previewItem, setPreviewItem] = useState<DriveItem | null>(null);
  const [telegramModalOpen, setTelegramModalOpen] = useState(false);
  const [nameModal, setNameModal] = useState<{
    open: boolean;
    mode: 'create' | 'rename';
    targetItem?: DriveItem;
  }>({ open: false, mode: 'create' });
  const [moveModalIds, setMoveModalIds] = useState<string[] | null>(null);
  const [deleteModal, setDeleteModal] = useState<{
    open: boolean;
    ids: string[];
    label?: string;
  }>({ open: false, ids: [] });

  const [transfers, setTransfers] = useState<TransferTask[]>([]);
  const transferCancelMap = useRef<Map<string, () => void>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const telegramStatus: TelegramPublicStatus = useMemo(() => toPublicStatus(tgConfig), [tgConfig]);

  // Persist items & sync index to Telegram pinned message in background when connected
  const commitItems = useCallback(
    (updater: (prev: DriveItem[]) => DriveItem[]) => {
      setItems((prev) => {
        const next = updater(prev);
        saveStoredItems(next);

        if (tgConfig.connected && tgConfig.botToken && tgConfig.chatId) {
          pushIndexToTelegramPinnedMessage(
            tgConfig.botToken,
            tgConfig.chatId,
            next,
            tgConfig.pinnedIndexMessageId,
          ).then((pinId) => {
            if (pinId && pinId !== tgConfig.pinnedIndexMessageId) {
              setTgConfig((curr) => {
                const updatedCfg = { ...curr, pinnedIndexMessageId: pinId };
                saveStoredTelegramConfig(updatedCfg);
                return updatedCfg;
              });
            }
          });
        }
        return next;
      });
    },
    [tgConfig.connected, tgConfig.botToken, tgConfig.chatId, tgConfig.pinnedIndexMessageId],
  );

  // Sync dark mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'Escape') {
        setPreviewItem(null);
        setTelegramModalOpen(false);
        setNameModal((prev) => ({ ...prev, open: false }));
        setMoveModalIds(null);
        setDeleteModal({ open: false, ids: [] });
        setSelectedIds(new Set());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const summary: StorageSummary = useMemo(() => computeStorageSummary(items), [items]);
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
  }, []);

  const enqueueFilesUpload = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList).filter((f) => f.name);
      if (files.length === 0) return;

      const targetParent = section === 'my-drive' ? currentFolderId : null;

      for (const file of files) {
        const taskId = `tr-${crypto.randomUUID()}`;
        const initialTask: TransferTask = {
          id: taskId,
          kind: 'upload',
          filename: file.name,
          totalBytes: file.size,
          loadedBytes: 0,
          speedBytesPerSec: 0,
          etaSeconds: 0,
          completedChunks: 0,
          totalChunks: 1,
          status: 'active',
          createdAt: Date.now(),
        };

        setTransfers((prev) => [initialTask, ...prev].slice(0, 20));

        const ctrl = startDirectUpload(file, targetParent, tgConfig, (progress) => {
          updateTransferTask(taskId, progress);
        });
        transferCancelMap.current.set(taskId, ctrl.cancel);

        ctrl.promise
          .then((createdItem) => {
            transferCancelMap.current.delete(taskId);
            commitItems((prev) => [createdItem, ...prev.filter((i) => i.id !== createdItem.id)]);
          })
          .catch((err) => {
            transferCancelMap.current.delete(taskId);
            const msg = err instanceof Error ? err.message : 'Unggahan gagal.';
            updateTransferTask(taskId, {
              status: msg === 'Dibatalkan' ? 'cancelled' : 'error',
              errorMessage: msg,
            });
          });
      }
    },
    [currentFolderId, section, tgConfig, updateTransferTask, commitItems],
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
      setTransfers((prev) => [downloadTask, ...prev].slice(0, 20));

      const ctrl = startDirectDownload(item, tgConfig, (progress) => {
        updateTransferTask(taskId, progress);
      });
      transferCancelMap.current.set(taskId, ctrl.cancel);

      ctrl.promise
        .then(() => {
          transferCancelMap.current.delete(taskId);
        })
        .catch((err) => {
          transferCancelMap.current.delete(taskId);
          updateTransferTask(taskId, {
            status: 'error',
            errorMessage: err instanceof Error ? err.message : 'Unduhan gagal.',
          });
        });
    },
    [tgConfig, updateTransferTask],
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
  };

  const handleCreateOrRename = async (name: string) => {
    const now = new Date().toISOString();
    if (nameModal.mode === 'create') {
      const targetParent = section === 'my-drive' ? currentFolderId : null;
      const folder: DriveItem = {
        id: `fld-${crypto.randomUUID()}`,
        name: name.slice(0, 120),
        type: 'folder',
        parentId: targetParent,
        size: 0,
        mimeType: 'inode/directory',
        starred: false,
        trashed: false,
        createdAt: now,
        updatedAt: now,
        storageBackend: 'local',
        chunks: [],
      };
      commitItems((prev) => [folder, ...prev]);
    } else if (nameModal.targetItem) {
      const targetId = nameModal.targetItem.id;
      commitItems((prev) =>
        prev.map((i) =>
          i.id === targetId ? { ...i, name: name.slice(0, 180), updatedAt: now } : i,
        ),
      );
    }
  };

  const handleMove = async (targetParentId: string | null) => {
    if (!moveModalIds?.length) return;
    const now = new Date().toISOString();
    const moveSet = new Set(moveModalIds);
    commitItems((prev) =>
      prev.map((i) =>
        moveSet.has(i.id) && i.id !== targetParentId
          ? { ...i, parentId: targetParentId, updatedAt: now }
          : i,
      ),
    );
    setSelectedIds(new Set());
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

    for (const item of items) {
      if (!expanded.has(item.id)) continue;
      if (item.localBlobKey) {
        await deleteLocalBlob(item.localBlobKey);
      }
      if (item.storageBackend === 'telegram' && tgConfig.botToken && tgConfig.chatId) {
        for (const chunk of item.chunks) {
          if (chunk.telegramMessageId) {
            await deleteTelegramMessageDirect(
              tgConfig.botToken,
              tgConfig.chatId,
              chunk.telegramMessageId,
            );
          }
        }
      }
    }

    commitItems((prev) => prev.filter((i) => !expanded.has(i.id)));
    setSelectedIds(new Set());
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
  };

  const handleToggleSelect = (id: string) => {
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

  const selectedArray = Array.from(selectedIds);
  const isTrashView = section === 'trash';

  return (
    <div
      className="flex h-screen overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setIsDraggingOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDraggingOver(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingOver(false);
        if (e.dataTransfer.files?.length) {
          enqueueFilesUpload(e.dataTransfer.files);
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
        onOpenTelegramModal={() => setTelegramModalOpen(true)}
        summary={summary}
        telegram={telegramStatus}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode((d) => !d)}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onQuickUploadClick={() => fileInputRef.current?.click()}
          searchInputRef={searchInputRef}
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
          selectedCount={selectedIds.size}
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
          }}
          onBulkMove={() => setMoveModalIds(selectedArray)}
          onBulkTrash={() => handleTrashOrRestore(selectedArray, true)}
          onBulkRestore={() => handleTrashOrRestore(selectedArray, false)}
          onBulkDeletePermanent={() => setDeleteModal({ open: true, ids: selectedArray })}
          searchQuery={searchQuery}
        />

        {/* Main Workspace Scroll Area */}
        <main className="relative flex-1 overflow-y-auto px-4 pt-5 pb-24 sm:px-6">
          {isTrashView && visibleItems.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              <span>Item di Sampah dapat dipulihkan kapan saja atau dihapus permanen.</span>
              <button
                type="button"
                onClick={() =>
                  setDeleteModal({
                    open: true,
                    ids: visibleItems.map((i) => i.id),
                  })
                }
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
                    : 'Folder ini masih kosong'}
              </h2>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {searchQuery
                  ? 'Coba kata kunci lain atau ubah filter tipe file di atas.'
                  : isTrashView
                    ? 'File atau folder yang Anda buang akan muncul di sini sebelum dihapus permanen.'
                    : 'Seret dan lepas file ke area ini atau gunakan tombol di bawah untuk mengunggah.'}
              </p>

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
              items={visibleItems}
              tgConfig={tgConfig}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onOpenItem={handleOpenItem}
              onDownloadItem={handleDownloadItem}
              onToggleStar={handleToggleStar}
              onRenameItem={(item) =>
                setNameModal({ open: true, mode: 'rename', targetItem: item })
              }
              onMoveItem={(item) => setMoveModalIds([item.id])}
              onTrashItem={(item) => handleTrashOrRestore([item.id], true)}
              onRestoreItem={(item) => handleTrashOrRestore([item.id], false)}
              onDeletePermanent={(item) =>
                setDeleteModal({ open: true, ids: [item.id], label: item.name })
              }
              isTrashView={isTrashView}
            />
          ) : (
            <FileTable
              items={visibleItems}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onToggleSelectAll={handleToggleSelectAll}
              onOpenItem={handleOpenItem}
              onDownloadItem={handleDownloadItem}
              onToggleStar={handleToggleStar}
              onRenameItem={(item) =>
                setNameModal({ open: true, mode: 'rename', targetItem: item })
              }
              onMoveItem={(item) => setMoveModalIds([item.id])}
              onTrashItem={(item) => handleTrashOrRestore([item.id], true)}
              onRestoreItem={(item) => handleTrashOrRestore([item.id], false)}
              onDeletePermanent={(item) =>
                setDeleteModal({ open: true, ids: [item.id], label: item.name })
              }
              isTrashView={isTrashView}
            />
          )}
        </main>
      </div>

      {/* Drag & Drop Overlay */}
      {isDraggingOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-blue-600/15 backdrop-blur-[2px]">
          <div className="rounded-2xl border-2 border-dashed border-blue-600 bg-white/95 px-10 py-8 text-center shadow-2xl dark:bg-slate-900/95">
            <UploadCloud className="mx-auto h-10 w-10 text-blue-600 dark:text-blue-400" />
            <p className="mt-3 font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Lepas file untuk unggah cepat
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {tgConfig.connected
                ? `Langsung dikirim ke Telegram @${tgConfig.botUsername} (maks. 20 MB/file)`
                : 'Tersimpan cepat di brankas browser (IndexedDB)'}
            </p>
          </div>
        </div>
      )}

      {/* Floating Transfer Drawer */}
      <TransferManager
        tasks={transfers}
        onCancelTask={handleCancelTransfer}
        onClearCompleted={() =>
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

      <MoveModal
        open={Boolean(moveModalIds)}
        movingIds={moveModalIds || []}
        items={items}
        onClose={() => setMoveModalIds(null)}
        onMove={handleMove}
      />

      <ConfirmDeleteModal
        open={deleteModal.open}
        count={deleteModal.ids.length}
        label={deleteModal.label}
        onClose={() => setDeleteModal({ open: false, ids: [] })}
        onConfirm={handlePermanentDelete}
      />
    </div>
  );
}
