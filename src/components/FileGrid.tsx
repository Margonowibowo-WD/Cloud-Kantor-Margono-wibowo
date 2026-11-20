import { useEffect, useState } from 'react';
import {
  Copy,
  Download,
  Pencil,
  RotateCcw,
  Star,
  Trash2,
} from 'lucide-react';
import type { DriveItem, TelegramConfigState } from '../types/drive';
import {
  formatBytes,
  formatRelativeDateId,
  getFileCategory,
} from '../utils/fileHelpers';
import { getLocalBlob } from '../utils/localVault';
import {
  type CapturedDropPayload,
  captureDropEntriesSync,
} from '../utils/dropUploadHelpers';
import { DIRECT_TELEGRAM_MAX_BYTES, resolveTelegramFileUrl } from '../utils/telegramDirect';
import { FileIcon } from './FileIcon';

interface FileGridProps {
  items: DriveItem[];
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
  onDownloadItem: (item: DriveItem) => void;
  onCopyItem: (item: DriveItem) => void;
  onToggleStar: (item: DriveItem) => void;
  onRenameItem: (item: DriveItem) => void;
  onTrashItem: (item: DriveItem) => void;
  onRestoreItem: (item: DriveItem) => void;
  onDeletePermanent: (item: DriveItem) => void;
  isTrashView: boolean;
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
      if (item.localBlobKey) {
        const blob = await getLocalBlob(item.localBlobKey);
        if (blob && active) {
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
          return;
        }
      }
      const tgFileId = item.chunks[0]?.telegramFileId;
      if (tgFileId && tgConfig.botToken) {
        try {
          const url = await resolveTelegramFileUrl(tgConfig.botToken, tgFileId);
          if (active) setSrc(url);
        } catch {
          if (active) onBroken();
        }
      }
    })();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item.id, item.thumbnailUrl, item.localBlobKey, item.chunks, tgConfig.botToken, onBroken]);

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
  onDownloadItem,
  onCopyItem,
  onToggleStar,
  onRenameItem,
  onTrashItem,
  onRestoreItem,
  onDeletePermanent,
  isTrashView,
}: FileGridProps) {
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(() => new Set());
  const [dropTargetFolder, setDropTargetFolder] = useState<{
    id: string;
    mode: 'move' | 'upload';
  } | null>(null);

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

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
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
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onContextMenuItem(e, folder);
                  }}
                  onDragStart={(e) => {
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
                  className={`group relative flex items-center justify-between gap-3 rounded-2xl border border-l-4 p-3.5 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md ${
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
                      if (e.ctrlKey || e.metaKey || e.shiftKey) {
                        onToggleSelect(folder.id, e.shiftKey);
                      } else {
                        onOpenItem(folder);
                      }
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3.5 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-blue-600"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-100/90 ring-1 ring-amber-200/80 transition-transform duration-150 group-hover:scale-105 dark:bg-amber-950/70 dark:ring-amber-800/70">
                      <FileIcon
                        type="folder"
                        mimeType={folder.mimeType}
                        filename={folder.name}
                        size="lg"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                        {folder.name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium tabular-nums text-slate-500 whitespace-nowrap dark:text-slate-400">
                        {isExternalUploadDrop ? (
                          <span className="font-semibold text-blue-600 dark:text-blue-400">
                            Lepas untuk unggah ke folder ini
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

                  {!isTrashView && folder.starred && (
                    <Star className="pointer-events-none h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500 group-hover:hidden" />
                  )}

                  <div
                    className={`${
                      isTrashView
                        ? 'flex shrink-0 items-center gap-0.5'
                        : 'flex shrink-0 items-center gap-0.5 rounded-lg p-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100'
                    }`}
                  >
                    {!isTrashView ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onToggleStar(folder)}
                          aria-label={
                            folder.starred
                              ? `Hapus bintang ${folder.name}`
                              : `Bintangi ${folder.name}`
                          }
                          className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
                            folder.starred
                              ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                              : 'text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-700'
                          }`}
                        >
                          <Star className={`h-3 w-3 ${folder.starred ? 'fill-amber-400' : ''}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onCopyItem(folder)}
                          aria-label={`Salin ${folder.name}`}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-700"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRenameItem(folder)}
                          aria-label={`Ubah nama ${folder.name}`}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-700"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onTrashItem(folder)}
                          aria-label={`Buang ${folder.name}`}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-950/50 dark:hover:text-rose-300"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onRestoreItem(folder)}
                          aria-label={`Pulihkan ${folder.name}`}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-950/50"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeletePermanent(folder)}
                          aria-label={`Hapus permanen ${folder.name}`}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-rose-600 hover:bg-rose-100 dark:text-rose-400 dark:hover:bg-rose-950/50"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </>
                    )}
                  </div>
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

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {files.map((file) => {
              const selected = selectedIds.has(file.id);
              const category = getFileCategory(file.mimeType, file.name);
              const isImage = category === 'image' && !brokenThumbs.has(file.id);

              return (
                <article
                  key={file.id}
                  data-drive-item={file.id}
                  draggable={!isTrashView}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onContextMenuItem(e, file);
                  }}
                  onDragStart={(e) => {
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
                  <div className="relative h-24 w-full overflow-hidden border-b border-slate-100 bg-slate-100 dark:border-slate-800 dark:bg-slate-800/70">
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
                            size="md"
                          />
                          <span className="font-mono text-[10px] font-medium text-slate-500 dark:text-slate-400">
                            {file.name.split('.').pop()?.toUpperCase() || 'FILE'}
                          </span>
                        </div>
                      )}
                    </button>

                    {/* Top-right Star toggle */}
                    {!isTrashView && (
                      <button
                        type="button"
                        onClick={() => onToggleStar(file)}
                        aria-label={
                          file.starred ? `Hapus bintang ${file.name}` : `Bintangi ${file.name}`
                        }
                        className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded bg-white/90 text-slate-600 transition-opacity dark:bg-slate-900/90 dark:text-slate-300 ${
                          file.starred
                            ? 'opacity-100 text-amber-500'
                            : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                        }`}
                      >
                        <Star
                          className={`h-3 w-3 ${
                            file.starred ? 'fill-amber-400 text-amber-500' : ''
                          }`}
                        />
                      </button>
                    )}
                  </div>

                  {/* Compact Card Body */}
                  <div className="flex flex-col gap-1 p-2.5">
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
                      <span className="font-medium text-blue-600 dark:text-blue-400">
                        {file.size > DIRECT_TELEGRAM_MAX_BYTES ? 'TG >20MB' : 'Cloud'}
                      </span>
                    </div>

                    {/* Dedicated Action Strip (Zero Metadata Squeezing) */}
                    <div className="mt-1 flex items-center justify-end gap-0.5 border-t border-slate-100 pt-1.5 dark:border-slate-800/80">
                      {!isTrashView ? (
                        <>
                          <button
                            type="button"
                            onClick={() => onDownloadItem(file)}
                            aria-label={`Unduh ${file.name}`}
                            className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-blue-400"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onCopyItem(file)}
                            aria-label={`Salin ${file.name}`}
                            className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onRenameItem(file)}
                            aria-label={`Ubah nama ${file.name}`}
                            className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onTrashItem(file)}
                            aria-label={`Buang ${file.name}`}
                            className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => onRestoreItem(file)}
                            aria-label={`Pulihkan ${file.name}`}
                            className="flex h-6 w-6 items-center justify-center rounded text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeletePermanent(file)}
                            aria-label={`Hapus permanen ${file.name}`}
                            className="flex h-6 w-6 items-center justify-center rounded text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
