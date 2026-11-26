import { useEffect, useRef, useState } from 'react';
import { CloudOff, Pin, Star } from 'lucide-react';
import type { DriveItem } from '../types/drive';
import {
  formatBytes,
  formatRelativeDateId,
  getFileTypeLabel,
} from '../utils/fileHelpers';
import {
  type CapturedDropPayload,
  captureDropEntriesSync,
} from '../utils/dropUploadHelpers';
import { FileIcon } from './FileIcon';
import { type HoveredItemAnchor, ItemHoverTooltip } from './ItemHoverTooltip';

interface FileTableProps {
  items: DriveItem[];
  allItems: DriveItem[];
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

export function FileTable({
  items,
  allItems,
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
}: FileTableProps) {
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
    const onScroll = () => clearHoverTooltip();
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  const buildDragPayload = (itemId: string): string[] =>
    selectedIds.has(itemId) ? Array.from(selectedIds) : [itemId];

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
            <th className="px-4 py-2.5">Nama</th>
            <th className="hidden px-3 py-2.5 sm:table-cell">Jenis File</th>
            <th className="hidden px-3 py-2.5 md:table-cell">Diubah</th>
            <th className="px-4 py-2.5 text-right">Ukuran</th>
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
                onPointerEnter={(e) => {
                  if (e.pointerType === 'mouse') {
                    scheduleHoverTooltip(item, e.currentTarget);
                  }
                }}
                onPointerLeave={() => clearHoverTooltip()}
                onContextMenu={(e) => {
                  clearHoverTooltip();
                  e.preventDefault();
                  e.stopPropagation();
                  onContextMenuItem(e, item);
                }}
                onDragStart={(e) => {
                  clearHoverTooltip();
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
                        if (
                          (e.dataTransfer.files?.length || e.dataTransfer.items?.length) &&
                          onDropExternalFilesToFolder
                        ) {
                          e.preventDefault();
                          e.stopPropagation();
                          onDropExternalFilesToFolder(
                            captureDropEntriesSync(e.dataTransfer),
                            item.id,
                          );
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
                      clearHoverTooltip();
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
                    {!isTrashView && item.pendingOfflineUpload && (
                      <span title="Menunggu internet untuk diunggah">
                        <CloudOff className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" />
                      </span>
                    )}
                    {!isTrashView && offlinePinnedIds?.has(item.id) && (
                      <span title="Tersedia Offline">
                        <Pin className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      </span>
                    )}
                    {!isTrashView && item.starred && (
                      <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-500" />
                    )}
                  </button>
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-xs text-slate-500 sm:table-cell dark:text-slate-400">
                  {isExternalUploadDrop ? (
                    <span className="font-semibold text-blue-600 dark:text-blue-400">
                      Lepas untuk unggah ke folder
                    </span>
                  ) : (
                    <span className="font-medium text-slate-600 dark:text-slate-300">
                      {getFileTypeLabel(item)}
                    </span>
                  )}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-xs tabular-nums text-slate-500 md:table-cell dark:text-slate-400">
                  {formatRelativeDateId(item.updatedAt)}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
                  {isFolder ? '—' : formatBytes(item.size)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <ItemHoverTooltip
        anchor={hoverAnchor}
        allItems={allItems}
        folderCounts={folderCounts}
      />
    </div>
  );
}
