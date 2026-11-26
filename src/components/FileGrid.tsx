import { useEffect, useRef, useState } from 'react';
import { CloudOff, Pin, Star } from 'lucide-react';
import type { DriveItem, TelegramConfigState } from '../types/drive';
import {
  formatBytes,
  formatRelativeDateId,
  getFileCategory,
  isPdfFile,
} from '../utils/fileHelpers';
import { getLocalBlob } from '../utils/localVault';
import {
  type CapturedDropPayload,
  captureDropEntriesSync,
} from '../utils/dropUploadHelpers';
import {
  DIRECT_TELEGRAM_MAX_BYTES,
  buildProxiedTelegramFileUrl,
  resolveTelegramFileUrl,
} from '../utils/telegramDirect';
import { FileIcon } from './FileIcon';
import { type HoveredItemAnchor, ItemHoverTooltip } from './ItemHoverTooltip';

interface FileGridProps {
  items: DriveItem[];
  allItems: DriveItem[];
  tgConfig: TelegramConfigState;
  folderCounts?: Record<string, number>;
  selectedIds: Set<string>;
  draggingIds: string[];
  onDragStartIds: (ids: string[]) => void;
  onDragEndIds: () => void;
  onDropMoveToFolder: (ids: string[], targetFolderId: string) => void;
  onDropExternalFilesToFolder?: (payload: CapturedDropPayload, targetFolderId: string) => void;
  onToggleSelect: (id: string, shiftKey?: boolean) => void;
  onContextMenuItem: (e: React.MouseEvent, item: DriveItem) => void;
  onOpenItem: (item: DriveItem) => void;
  onDoubleClickItem?: (item: DriveItem) => void;
  isTrashView: boolean;
  offlinePinnedIds?: Set<string>;
}

function ImageThumbnail({
  item,
  tgConfig,
  onBroken,
}: {
  item: DriveItem;
  tgConfig: TelegramConfigState;
  onBroken: () => void;
}) {
  const [src, setSrc] = useState<string | null>(item.thumbnailUrl || null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    if (item.thumbnailUrl) {
      setSrc(item.thumbnailUrl);
      return;
    }

    (async () => {
      if (item.isCatalogStub) return;
      const localBlob = await getLocalBlob(item.localBlobKey || `blob-${item.id}`);
      if (localBlob && active) {
        objectUrl = URL.createObjectURL(localBlob);
        setSrc(objectUrl);
        return;
      }
      const tgFileId = item.chunks[0]?.telegramFileId;
      if (tgFileId && tgConfig.botToken) {
        try {
          const url = await resolveTelegramFileUrl(tgConfig.botToken, tgFileId);
          if (active) setSrc(buildProxiedTelegramFileUrl(url, tgConfig.corsProxyUrl));
        } catch {
          if (active) onBroken();
        }
      }
    })();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item.id, item.isCatalogStub, item.thumbnailUrl, item.localBlobKey, item.chunks, tgConfig.botToken, tgConfig.corsProxyUrl, onBroken]);

  if (!src) {
    return (
      <div className="flex flex-col items-center gap-1 px-2 text-center">
        <FileIcon type="file" mimeType={item.mimeType} filename={item.name} size="md" />
        <span className="font-mono text-[10px] font-medium text-slate-500 dark:text-slate-400">
          {item.name.split('.').pop()?.toUpperCase() || 'IMG'}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={item.name}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={onBroken}
      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
    />
  );
}

export function FileGrid({
  items,
  allItems,
  tgConfig,
  folderCounts = {},
  selectedIds,
  draggingIds,
  onDragStartIds,
  onDragEndIds,
  onDropMoveToFolder,
  onDropExternalFilesToFolder,
  onToggleSelect,
  onContextMenuItem,
  onOpenItem,
  onDoubleClickItem,
  isTrashView,
  offlinePinnedIds,
}: FileGridProps) {
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(() => new Set());
  const [dropTargetFolder, setDropTargetFolder] = useState<{
    id: string;
    mode: 'move' | 'upload';
  } | null>(null);
  const [hoverAnchor, setHoverAnchor] = useState<HoveredItemAnchor | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

  const clearHoverTooltip = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoverAnchor(null);
  };

  const scheduleHoverTooltip = (item: DriveItem, el: HTMLElement) => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
    }
    const r = el.getBoundingClientRect();
    const rectSnapshot = {
      top: r.top,
      left: r.left,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    };
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      setHoverAnchor({ item, rect: rectSnapshot });
    }, 1800);
  };

  useEffect(() => {
    const onScrollOrDrag = () => clearHoverTooltip();
    window.addEventListener('scroll', onScrollOrDrag, true);
    return () => {
      window.removeEventListener('scroll', onScrollOrDrag, true);
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  const folders = items.filter((i) => i.type === 'folder');
  const files = items.filter((i) => i.type === 'file');

  const buildDragPayload = (itemId: string): string[] =>
    selectedIds.has(itemId) ? Array.from(selectedIds) : [itemId];

  return (
    <div className="space-y-6">
      {/* Folders Section — Larger, Distinct Warm Amber Folder Cards */}
      {folders.length > 0 && (
        <section aria-labelledby="grid-folders-heading" className="td-animate-fade-up">
          <h2
            id="grid-folders-heading"
            className="mb-3 text-xs font-semibold uppercase tracking-wider text-amber-700/90 dark:text-amber-400/90"
          >
            Folder ({folders.length})
          </h2>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(205px,1fr))] gap-3">
            {folders.map((folder) => {
              const selected = selectedIds.has(folder.id);
              const isDropHighlight = dropTargetFolder?.id === folder.id;
              const isExternalUploadDrop =
                dropTargetFolder?.id === folder.id && dropTargetFolder.mode === 'upload';
              const childCount = folderCounts[folder.id] ?? 0;

              return (
                <div
                  key={folder.id}
                  data-drive-item={folder.id}
                  draggable={!isTrashView}
                  onPointerEnter={(e) => {
                    if (e.pointerType === 'mouse') {
                      scheduleHoverTooltip(folder, e.currentTarget);
                    }
                  }}
                  onPointerLeave={() => clearHoverTooltip()}
                  onContextMenu={(e) => {
                    clearHoverTooltip();
                    e.preventDefault();
                    e.stopPropagation();
                    onContextMenuItem(e, folder);
                  }}
                  onDragStart={(e) => {
                    clearHoverTooltip();
                    if (isTrashView) return;
                    const ids = buildDragPayload(folder.id);
                    e.dataTransfer.setData('application/x-teledrive-ids', JSON.stringify(ids));
                    e.dataTransfer.effectAllowed = 'move';
                    onDragStartIds(ids);
                  }}
                  onDragEnd={() => {
                    setDropTargetFolder(null);
                    onDragEndIds();
                  }}
                  onDragOver={(e) => {
                    if (isTrashView) return;
                    if (
                      e.dataTransfer.types.includes('application/x-teledrive-ids') &&
                      !draggingIds.includes(folder.id)
                    ) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setDropTargetFolder({ id: folder.id, mode: 'move' });
                    } else if (
                      e.dataTransfer.types.includes('Files') &&
                      !e.dataTransfer.types.includes('application/x-teledrive-ids')
                    ) {
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = 'copy';
                      setDropTargetFolder({ id: folder.id, mode: 'upload' });
                    }
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDropTargetFolder((prev) => (prev?.id === folder.id ? null : prev));
                    }
                  }}
                  onDrop={(e) => {
                    setDropTargetFolder(null);
                    if (isTrashView) return;
                    const raw = e.dataTransfer.getData('application/x-teledrive-ids');
                    if (raw) {
                      e.preventDefault();
                      e.stopPropagation();
                      try {
                        const ids = JSON.parse(raw) as string[];
                        if (Array.isArray(ids) && ids.length > 0 && !ids.includes(folder.id)) {
                          onDropMoveToFolder(ids, folder.id);
                        }
                      } catch {
                        // ignore invalid payload
                      }
                      return;
                    }
                    if (
                      (e.dataTransfer.files?.length || e.dataTransfer.items?.length) &&
                      onDropExternalFilesToFolder
                    ) {
                      e.preventDefault();
                      e.stopPropagation();
                      onDropExternalFilesToFolder(captureDropEntriesSync(e.dataTransfer), folder.id);
                    }
                  }}
                  className={`group relative flex flex-col justify-between gap-2 rounded-2xl border border-l-4 p-3 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md ${
                    isDropHighlight
                      ? 'border-blue-500 border-l-blue-600 bg-blue-50 ring-2 ring-blue-500 dark:bg-blue-950/60'
                      : selected
                        ? 'border-blue-500 border-l-blue-600 bg-blue-50/90 ring-1 ring-blue-500/60 dark:border-blue-400 dark:border-l-blue-400 dark:bg-blue-950/50'
                        : 'border-amber-200/90 border-l-amber-400 bg-gradient-to-br from-amber-50/75 via-white to-white hover:border-amber-300 dark:border-amber-900/50 dark:border-l-amber-500 dark:from-amber-950/30 dark:via-slate-900 dark:to-slate-900 dark:hover:border-amber-700/70'
                  }`}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      clearHoverTooltip();
                      if (e.ctrlKey || e.metaKey || e.shiftKey) {
                        onToggleSelect(folder.id, e.shiftKey);
                      } else {
                        onOpenItem(folder);
                      }
                    }}
                    className="flex w-full min-w-0 items-start gap-2.5 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-blue-600"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100/90 ring-1 ring-amber-200/80 transition-transform duration-150 group-hover:scale-105 dark:bg-amber-950/70 dark:ring-amber-800/70">
                      <FileIcon
                        type="folder"
                        mimeType={folder.mimeType}
                        filename={folder.name}
                        size="md"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-1.5">
                        <span className="line-clamp-2 break-words font-display text-[13px] font-bold leading-snug text-slate-900 dark:text-slate-100">
                          {folder.name}
                        </span>
                        <div className="flex shrink-0 items-center gap-1 pt-0.5">
                          {!isTrashView && offlinePinnedIds?.has(folder.id) && (
                            <span title="Tersedia Offline">
                              <Pin className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                            </span>
                          )}
                          {!isTrashView && folder.starred && (
                            <Star className="h-3 w-3 fill-amber-400 text-amber-500" />
                          )}
                        </div>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 text-[10.5px] font-medium tabular-nums text-slate-500 whitespace-nowrap dark:text-slate-400">
                        {isExternalUploadDrop ? (
                          <span className="truncate font-semibold text-blue-600 dark:text-blue-400">
                            Lepas untuk unggah ke folder
                          </span>
                        ) : (
                          <>
                            <span className="font-semibold text-amber-700 dark:text-amber-400">
                              Folder
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{childCount > 0 ? `${childCount} item` : 'Kosong'}</span>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">{formatRelativeDateId(folder.updatedAt)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Compact Files Grid Section */}
      {files.length > 0 && (
        <section aria-labelledby="grid-files-heading" className="td-animate-fade-up">
          <h2
            id="grid-files-heading"
            className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
          >
            File ({files.length})
          </h2>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(175px,1fr))] gap-3">
            {files.map((file) => {
              const selected = selectedIds.has(file.id);
              const category = getFileCategory(file.mimeType, file.name);
              const isImage = category === 'image' && !brokenThumbs.has(file.id);
              const isPdf = isPdfFile(file.mimeType, file.name);

              return (
                <article
                  key={file.id}
                  data-drive-item={file.id}
                  draggable={!isTrashView}
                  onPointerEnter={(e) => {
                    if (e.pointerType === 'mouse') {
                      scheduleHoverTooltip(file, e.currentTarget);
                    }
                  }}
                  onPointerLeave={() => clearHoverTooltip()}
                  onContextMenu={(e) => {
                    clearHoverTooltip();
                    e.preventDefault();
                    e.stopPropagation();
                    onContextMenuItem(e, file);
                  }}
                  onDragStart={(e) => {
                    clearHoverTooltip();
                    if (isTrashView) return;
                    const ids = buildDragPayload(file.id);
                    e.dataTransfer.setData('application/x-teledrive-ids', JSON.stringify(ids));
                    e.dataTransfer.effectAllowed = 'move';
                    onDragStartIds(ids);
                  }}
                  onDragEnd={() => onDragEndIds()}
                  className={`group relative flex flex-col overflow-hidden rounded-xl border transition-all duration-150 hover:-translate-y-0.5 hover:shadow-sm ${
                    selected
                      ? 'border-blue-500 bg-blue-50/80 ring-1 ring-blue-500/60 dark:border-blue-400 dark:bg-blue-950/40'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700'
                  }`}
                >
                  {/* Compact Visual Preview Area */}
                  <div
                    className={`relative h-24 w-full overflow-hidden border-b ${
                      isPdf
                        ? 'border-red-100 bg-red-50/75 dark:border-red-900/40 dark:bg-red-950/25'
                        : 'border-slate-100 bg-slate-100 dark:border-slate-800 dark:bg-slate-800/70'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        if (e.ctrlKey || e.metaKey || e.shiftKey) {
                          onToggleSelect(file.id, e.shiftKey);
                        } else {
                          onOpenItem(file);
                        }
                      }}
                      onDoubleClick={() => onDoubleClickItem?.(file)}
                      aria-label={`Pilih & pratinjau ${file.name}`}
                      className="flex h-full w-full items-center justify-center focus-visible:outline-2 focus-visible:outline-blue-600"
                    >
                      {isImage ? (
                        <ImageThumbnail
                          item={file}
                          tgConfig={tgConfig}
                          onBroken={() =>
                            setBrokenThumbs((prev) => new Set(prev).add(file.id))
                          }
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-1 px-2 text-center">
                          <FileIcon
                            type="file"
                            mimeType={file.mimeType}
                            filename={file.name}
                            size={isPdf ? 'lg' : 'md'}
                          />
                          <span
                            className={`font-mono text-[10px] font-semibold ${
                              isPdf
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {isPdf ? 'PDF' : file.name.split('.').pop()?.toUpperCase() || 'FILE'}
                          </span>
                        </div>
                      )}
                    </button>

                    {!isTrashView && (file.starred || offlinePinnedIds?.has(file.id) || file.pendingOfflineUpload) && (
                      <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1">
                        {file.pendingOfflineUpload && (
                          <span
                            title="Menunggu koneksi internet untuk diunggah"
                            className="flex h-5 w-5 items-center justify-center rounded bg-amber-100/95 text-amber-700 dark:bg-amber-950/90 dark:text-amber-300"
                          >
                            <CloudOff className="h-3 w-3" />
                          </span>
                        )}
                        {offlinePinnedIds?.has(file.id) && (
                          <span
                            title="Tersedia Offline"
                            className="flex h-5 w-5 items-center justify-center rounded bg-white/90 text-emerald-600 dark:bg-slate-900/90 dark:text-emerald-400"
                          >
                            <Pin className="h-3 w-3" />
                          </span>
                        )}
                        {file.starred && (
                          <span
                            aria-label="Berbintang"
                            className="flex h-5 w-5 items-center justify-center rounded bg-white/90 text-amber-500 dark:bg-slate-900/90"
                          >
                            <Star className="h-3 w-3 fill-amber-400 text-amber-500" />
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Clean Card Body (Actions via Right-Click) */}
                  <div className="flex flex-col gap-1 p-2.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        clearHoverTooltip();
                        if (e.ctrlKey || e.metaKey || e.shiftKey) {
                          onToggleSelect(file.id, e.shiftKey);
                        } else {
                          onOpenItem(file);
                        }
                      }}
                      onDoubleClick={() => onDoubleClickItem?.(file)}
                      className="flex w-full items-center gap-1.5 rounded text-left focus-visible:outline-2 focus-visible:outline-blue-600"
                    >
                      <FileIcon
                        type="file"
                        mimeType={file.mimeType}
                        filename={file.name}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {file.name}
                      </span>
                    </button>

                    <div className="flex min-w-0 items-center gap-1 whitespace-nowrap text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                      <span>{formatBytes(file.size)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{formatRelativeDateId(file.updatedAt)}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`font-medium ${
                          file.pendingOfflineUpload
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-blue-600 dark:text-blue-400'
                        }`}
                      >
                        {file.pendingOfflineUpload
                          ? 'Antrean Offline'
                          : file.size > DIRECT_TELEGRAM_MAX_BYTES
                            ? 'TG >20MB'
                            : 'Cloud'}
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
      <ItemHoverTooltip
        anchor={hoverAnchor}
        allItems={allItems}
        folderCounts={folderCounts}
      />
    </div>
  );
}
