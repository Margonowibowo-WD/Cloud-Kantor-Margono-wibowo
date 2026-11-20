import { useState } from 'react';
import {
  Copy,
  Download,
  Pencil,
  RotateCcw,
  Star,
  Trash2,
} from 'lucide-react';
import type { DriveItem } from '../types/drive';
import { formatBytes, formatRelativeDateId } from '../utils/fileHelpers';
import { DIRECT_TELEGRAM_MAX_BYTES } from '../utils/telegramDirect';
import { FileIcon } from './FileIcon';

interface FileTableProps {
  items: DriveItem[];
  selectedIds: Set<string>;
  draggingIds: string[];
  onDragStartIds: (ids: string[]) => void;
  onDragEndIds: () => void;
  onDropMoveToFolder: (ids: string[], targetFolderId: string) => void;
  onDropExternalFilesToFolder?: (files: FileList, targetFolderId: string) => void;
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

export function FileTable({
  items,
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
}: FileTableProps) {
  const [dropTargetFolder, setDropTargetFolder] = useState<{
    id: string;
    mode: 'move' | 'upload';
  } | null>(null);

  const buildDragPayload = (itemId: string): string[] =>
    selectedIds.has(itemId) ? Array.from(selectedIds) : [itemId];

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
            <th className="px-4 py-2.5">Nama</th>
            <th className="hidden px-3 py-2.5 sm:table-cell">Penyimpanan</th>
            <th className="hidden px-3 py-2.5 md:table-cell">Diubah</th>
            <th className="px-3 py-2.5 text-right">Ukuran</th>
            <th className="w-40 px-4 py-2.5 text-right">Aksi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((item) => {
            const selected = selectedIds.has(item.id);
            const isFolder = item.type === 'folder';
            const isDropHighlight = isFolder && dropTargetFolder?.id === item.id;
            const isExternalUploadDrop =
              isFolder && dropTargetFolder?.id === item.id && dropTargetFolder.mode === 'upload';

            return (
              <tr
                key={item.id}
                data-drive-item={item.id}
                draggable={!isTrashView}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onContextMenuItem(e, item);
                }}
                onDragStart={(e) => {
                  if (isTrashView) return;
                  const ids = buildDragPayload(item.id);
                  e.dataTransfer.setData('application/x-teledrive-ids', JSON.stringify(ids));
                  e.dataTransfer.effectAllowed = 'move';
                  onDragStartIds(ids);
                }}
                onDragEnd={() => {
                  setDropTargetFolder(null);
                  onDragEndIds();
                }}
                onDragOver={
                  isFolder && !isTrashView
                    ? (e) => {
                        if (
                          e.dataTransfer.types.includes('application/x-teledrive-ids') &&
                          !draggingIds.includes(item.id)
                        ) {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          setDropTargetFolder({ id: item.id, mode: 'move' });
                        } else if (
                          e.dataTransfer.types.includes('Files') &&
                          !e.dataTransfer.types.includes('application/x-teledrive-ids')
                        ) {
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = 'copy';
                          setDropTargetFolder({ id: item.id, mode: 'upload' });
                        }
                      }
                    : undefined
                }
                onDragLeave={
                  isFolder
                    ? (e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                          setDropTargetFolder((prev) => (prev?.id === item.id ? null : prev));
                        }
                      }
                    : undefined
                }
                onDrop={
                  isFolder && !isTrashView
                    ? (e) => {
                        setDropTargetFolder(null);
                        const raw = e.dataTransfer.getData('application/x-teledrive-ids');
                        if (raw) {
                          e.preventDefault();
                          e.stopPropagation();
                          try {
                            const ids = JSON.parse(raw) as string[];
                            if (Array.isArray(ids) && ids.length > 0 && !ids.includes(item.id)) {
                              onDropMoveToFolder(ids, item.id);
                            }
                          } catch {
                            // ignore malformed drag payload
                          }
                          return;
                        }
                        if (e.dataTransfer.files?.length && onDropExternalFilesToFolder) {
                          e.preventDefault();
                          e.stopPropagation();
                          onDropExternalFilesToFolder(e.dataTransfer.files, item.id);
                        }
                      }
                    : undefined
                }
                className={`group h-10 transition-colors ${
                  isDropHighlight
                    ? 'bg-blue-100/80 ring-2 ring-inset ring-blue-500 dark:bg-blue-950/60'
                    : selected
                      ? 'bg-blue-50/80 dark:bg-blue-950/40'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <td className="max-w-xs px-4 py-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey || e.shiftKey) {
                        onToggleSelect(item.id, e.shiftKey);
                      } else {
                        onOpenItem(item);
                      }
                    }}
                    onDoubleClick={() => {
                      if (item.type === 'file') onDoubleClickItem?.(item);
                    }}
                    className="flex w-full items-center gap-2.5 rounded text-left focus-visible:outline-2 focus-visible:outline-blue-600"
                  >
                    <FileIcon
                      type={item.type}
                      mimeType={item.mimeType}
                      filename={item.name}
                      size="sm"
                    />
                    <span className="truncate font-medium text-slate-900 dark:text-slate-100">
                      {item.name}
                    </span>
                  </button>
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-xs text-slate-500 sm:table-cell dark:text-slate-400">
                  {isExternalUploadDrop ? (
                    <span className="font-semibold text-blue-600 dark:text-blue-400">
                      Lepas untuk unggah ke folder
                    </span>
                  ) : isFolder ? (
                    'Folder Cloud'
                  ) : item.size > DIRECT_TELEGRAM_MAX_BYTES ? (
                    <span className="font-medium text-amber-600 dark:text-amber-400">
                      Telegram (&gt;20 MB)
                    </span>
                  ) : (
                    <span className="font-medium text-blue-600 dark:text-blue-400">
                      Cloud Telegram
                    </span>
                  )}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-xs tabular-nums text-slate-500 md:table-cell dark:text-slate-400">
                  {formatRelativeDateId(item.updatedAt)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
                  {isFolder ? '—' : formatBytes(item.size)}
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-end gap-0.5">
                    {!isTrashView ? (
                      <>
                        {item.type === 'file' && (
                          <button
                            type="button"
                            onClick={() => onDownloadItem(item)}
                            aria-label={`Unduh ${item.name}`}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200/70 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-blue-400"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onCopyItem(item)}
                          aria-label={`Salin ${item.name}`}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleStar(item)}
                          aria-label={
                            item.starred ? `Hapus bintang ${item.name}` : `Bintangi ${item.name}`
                          }
                          className={`flex h-7 w-7 items-center justify-center rounded-md hover:bg-slate-200/70 dark:hover:bg-slate-700 ${
                            item.starred
                              ? 'text-amber-500'
                              : 'text-slate-400 hover:text-slate-700 dark:text-slate-400'
                          }`}
                        >
                          <Star className={`h-3.5 w-3.5 ${item.starred ? 'fill-amber-400' : ''}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRenameItem(item)}
                          aria-label={`Ubah nama ${item.name}`}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onTrashItem(item)}
                          aria-label={`Buang ${item.name}`}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-rose-100 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-rose-950/50 dark:hover:text-rose-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onRestoreItem(item)}
                          aria-label={`Pulihkan ${item.name}`}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-950/50"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeletePermanent(item)}
                          aria-label={`Hapus permanen ${item.name}`}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-rose-600 hover:bg-rose-100 dark:text-rose-400 dark:hover:bg-rose-950/50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
