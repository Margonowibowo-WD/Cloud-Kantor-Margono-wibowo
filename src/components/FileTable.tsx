import {
  Check,
  Download,
  FolderInput,
  Pencil,
  RotateCcw,
  Star,
  Trash2,
} from 'lucide-react';
import type { DriveItem } from '../types/drive';
import { formatBytes, formatRelativeDateId } from '../utils/fileHelpers';
import { FileIcon } from './FileIcon';

interface FileTableProps {
  items: DriveItem[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onOpenItem: (item: DriveItem) => void;
  onDownloadItem: (item: DriveItem) => void;
  onToggleStar: (item: DriveItem) => void;
  onRenameItem: (item: DriveItem) => void;
  onMoveItem: (item: DriveItem) => void;
  onTrashItem: (item: DriveItem) => void;
  onRestoreItem: (item: DriveItem) => void;
  onDeletePermanent: (item: DriveItem) => void;
  isTrashView: boolean;
}

export function FileTable({
  items,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onOpenItem,
  onDownloadItem,
  onToggleStar,
  onRenameItem,
  onMoveItem,
  onTrashItem,
  onRestoreItem,
  onDeletePermanent,
  isTrashView,
}: FileTableProps) {
  const allSelected = items.length > 0 && items.every((i) => selectedIds.has(i.id));

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
            <th className="w-10 px-3 py-2.5">
              <button
                type="button"
                onClick={onToggleSelectAll}
                aria-label={allSelected ? 'Batalkan pilih semua' : 'Pilih semua item'}
                aria-pressed={allSelected}
                className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                  allSelected
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-300 bg-white text-transparent hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800'
                }`}
              >
                <Check className="h-3 w-3" />
              </button>
            </th>
            <th className="px-3 py-2.5">Nama</th>
            <th className="hidden px-3 py-2.5 sm:table-cell">Penyimpanan</th>
            <th className="hidden px-3 py-2.5 md:table-cell">Diubah</th>
            <th className="px-3 py-2.5 text-right">Ukuran</th>
            <th className="w-36 px-3 py-2.5 text-right">Aksi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((item) => {
            const selected = selectedIds.has(item.id);
            return (
              <tr
                key={item.id}
                className={`group h-10 transition-colors ${
                  selected
                    ? 'bg-blue-50/60 dark:bg-blue-950/30'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onToggleSelect(item.id)}
                    aria-label={`Pilih ${item.name}`}
                    aria-pressed={selected}
                    className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                      selected
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-slate-300 bg-white text-transparent group-hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800'
                    }`}
                  >
                    <Check className="h-3 w-3" />
                  </button>
                </td>
                <td className="max-w-xs px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onOpenItem(item)}
                    className="flex w-full items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-blue-600 rounded"
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
                  {item.type === 'folder' ? (
                    'Folder'
                  ) : item.storageBackend === 'telegram' ? (
                    <span className="font-medium text-blue-600 dark:text-blue-400">
                      Telegram ({item.chunks.length} bagian)
                    </span>
                  ) : (
                    'Penyimpanan Lokal'
                  )}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-xs tabular-nums text-slate-500 md:table-cell dark:text-slate-400">
                  {formatRelativeDateId(item.updatedAt)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
                  {item.type === 'folder' ? '—' : formatBytes(item.size)}
                </td>
                <td className="px-3 py-2">
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
                          onClick={() => onMoveItem(item)}
                          aria-label={`Pindahkan ${item.name}`}
                          className="hidden h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 sm:flex dark:text-slate-400 dark:hover:bg-slate-700"
                        >
                          <FolderInput className="h-3.5 w-3.5" />
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
