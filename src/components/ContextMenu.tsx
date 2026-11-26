import { useEffect, useRef } from 'react';
import {
  CheckSquare,
  ClipboardPaste,
  Copy,
  Download,
  Eye,
  FileArchive,
  FolderInput,
  FolderPlus,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import type { DriveItem } from '../types/drive';

export interface ContextMenuState {
  x: number;
  y: number;
  targetItem?: DriveItem;
}

interface ContextMenuProps {
  menu: ContextMenuState | null;
  selectedItems: DriveItem[];
  isTrashView: boolean;
  clipboardCount: number;
  offlinePinnedIds?: Set<string>;
  onClose: () => void;
  onOpenItem: (item: DriveItem) => void;
  onDownloadItems: (items: DriveItem[]) => void;
  onDownloadZip?: (items: DriveItem[]) => void;
  onCopyItems: (items: DriveItem[]) => void;
  onMoveItems: (items: DriveItem[]) => void;
  onRenameItem: (item: DriveItem) => void;
  onToggleStarItems: (items: DriveItem[]) => void;
  onToggleOfflinePinItems?: (items: DriveItem[]) => void;
  onTrashItems: (items: DriveItem[]) => void;
  onRestoreItems: (items: DriveItem[]) => void;
  onDeletePermanentItems: (items: DriveItem[]) => void;
  onSelectAll: () => void;
  onNewFolder: () => void;
  onUploadFiles: () => void;
  onPaste: () => void;
}

export function ContextMenu({
  menu,
  selectedItems,
  isTrashView,
  clipboardCount,
  offlinePinnedIds,
  onClose,
  onOpenItem,
  onDownloadItems,
  onDownloadZip,
  onCopyItems,
  onMoveItems,
  onRenameItem,
  onToggleStarItems,
  onToggleOfflinePinItems,
  onTrashItems,
  onRestoreItems,
  onDeletePermanentItems,
  onSelectAll,
  onNewFolder,
  onUploadFiles,
  onPaste,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const handlePointer = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handlePointer);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      window.removeEventListener('keydown', handleKey);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const menuWidth = 228;
  const estimatedHeight = menu.targetItem ? 290 : 190;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - menuWidth - 8));
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - estimatedHeight - 8));

  const effectiveItems =
    selectedItems.length > 0 ? selectedItems : menu.targetItem ? [menu.targetItem] : [];
  const singleItem = effectiveItems.length === 1 ? effectiveItems[0] : undefined;
  const downloadableFiles = effectiveItems.filter((i) => i.type === 'file');
  const canDownloadZip =
    Boolean(onDownloadZip) &&
    (effectiveItems.length > 1 || effectiveItems.some((i) => i.type === 'folder'));
  const allStarred = effectiveItems.length > 0 && effectiveItems.every((i) => i.starred);
  const allOfflinePinned =
    Boolean(offlinePinnedIds) &&
    effectiveItems.length > 0 &&
    effectiveItems.every((i) => offlinePinnedIds!.has(i.id));

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Menu konteks file"
      style={{ left, top, width: menuWidth }}
      className="td-animate-pop fixed z-50 rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
    >
      {menu.targetItem ? (
        !isTrashView ? (
          <>
            {effectiveItems.length > 1 && (
              <div className="px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {effectiveItems.length} item dipilih
              </div>
            )}
            {singleItem && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onClose();
                  onOpenItem(singleItem);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <span className="flex items-center gap-2.5">
                  <Eye className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                  <span>{singleItem.type === 'folder' ? 'Buka Folder' : 'Pratinjau'}</span>
                </span>
                <span className="font-mono text-[10px] text-slate-400">Enter</span>
              </button>
            )}
            {downloadableFiles.length > 0 && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onClose();
                  onDownloadItems(downloadableFiles);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Download className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                <span>
                  {downloadableFiles.length > 1
                    ? `Unduh (${downloadableFiles.length} file)`
                    : 'Unduh'}
                </span>
              </button>
            )}
            {canDownloadZip && onDownloadZip && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onClose();
                  onDownloadZip(effectiveItems);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <FileArchive className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                <span>Unduh sebagai ZIP</span>
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                onMoveItems(effectiveItems);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <FolderInput className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
              <span>
                {effectiveItems.length > 1
                  ? `Pindah ke... (${effectiveItems.length})`
                  : 'Pindah ke...'}
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                onCopyItems(effectiveItems);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <span className="flex items-center gap-2.5">
                <Copy className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                <span>Salin</span>
              </span>
              <span className="font-mono text-[10px] text-slate-400">Ctrl+C</span>
            </button>
            {singleItem && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onClose();
                  onRenameItem(singleItem);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <span className="flex items-center gap-2.5">
                  <Pencil className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                  <span>Ubah Nama</span>
                </span>
                <span className="font-mono text-[10px] text-slate-400">F2</span>
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                onToggleStarItems(effectiveItems);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Star
                className={`h-3.5 w-3.5 ${
                  allStarred ? 'fill-amber-400 text-amber-500' : 'text-slate-500 dark:text-slate-400'
                }`}
              />
              <span>{allStarred ? 'Hapus Bintang' : 'Tambah Bintang'}</span>
            </button>
            {onToggleOfflinePinItems && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onClose();
                  onToggleOfflinePinItems(effectiveItems);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {allOfflinePinned ? (
                  <PinOff className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Pin className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                )}
                <span>{allOfflinePinned ? 'Hapus dari Offline' : 'Simpan untuk Offline'}</span>
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                onSelectAll();
              }}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <span className="flex items-center gap-2.5">
                <CheckSquare className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                <span>Pilih Semua</span>
              </span>
              <span className="font-mono text-[10px] text-slate-400">Ctrl+A</span>
            </button>
            <div className="my-1 h-px bg-slate-100 dark:bg-slate-800" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                onTrashItems(effectiveItems);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50"
            >
              <span className="flex items-center gap-2.5">
                <Trash2 className="h-3.5 w-3.5" />
                <span>
                  {effectiveItems.length > 1
                    ? `Hapus (${effectiveItems.length} item)`
                    : 'Hapus'}
                </span>
              </span>
              <span className="font-mono text-[10px] opacity-75">Del</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                onRestoreItems(effectiveItems);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Pulihkan</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                onDeletePermanentItems(effectiveItems);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Hapus Permanen</span>
            </button>
          </>
        )
      ) : (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onNewFolder();
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <FolderPlus className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
            <span>Folder Baru</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onUploadFiles();
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Upload className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            <span>Unggah File</span>
          </button>
          {clipboardCount > 0 && !isTrashView && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                onPaste();
              }}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/50"
            >
              <span className="flex items-center gap-2.5">
                <ClipboardPaste className="h-3.5 w-3.5" />
                <span>Tempel ({clipboardCount})</span>
              </span>
              <span className="font-mono text-[10px]">Ctrl+V</span>
            </button>
          )}
          <div className="my-1 h-px bg-slate-100 dark:bg-slate-800" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onSelectAll();
            }}
            className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <span className="flex items-center gap-2.5">
              <CheckSquare className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
              <span>Pilih Semua</span>
            </span>
            <span className="font-mono text-[10px] text-slate-400">Ctrl+A</span>
          </button>
        </>
      )}
    </div>
  );
}
