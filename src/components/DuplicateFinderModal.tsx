import { useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  FolderOpen,
  SearchCheck,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import type { DriveItem } from '../types/drive';
import {
  findCrossFolderDuplicates,
  formatBytes,
  formatRelativeDateId,
  getItemLocationPath,
} from '../utils/fileHelpers';
import { FileIcon } from './FileIcon';

interface DuplicateFinderModalProps {
  open: boolean;
  items: DriveItem[];
  onClose: () => void;
  onNavigateFolder: (folderId: string | null) => void;
  onTrashItems: (items: DriveItem[]) => void;
  onDeletePermanentItems: (items: DriveItem[]) => void;
}

export function DuplicateFinderModal({
  open,
  items,
  onClose,
  onNavigateFolder,
  onTrashItems,
  onDeletePermanentItems,
}: DuplicateFinderModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [visibleGroupsCount, setVisibleGroupsCount] = useState(40);

  const scanResult = useMemo(
    () => (open ? findCrossFolderDuplicates(items) : { groups: [], totalDuplicateFiles: 0, totalWastedBytes: 0 }),
    [open, items],
  );

  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set());
    setVisibleGroupsCount(40);
  }, [open]);

  if (!open) return null;

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllExtraCopies = () => {
    const next = new Set<string>();
    for (const group of scanResult.groups) {
      // Index 0 is the primary/oldest/starred copy to keep; select index 1..n
      for (let i = 1; i < group.items.length; i += 1) {
        next.add(group.items[i].id);
      }
    }
    setSelectedIds(next);
  };

  const selectedItemsList = items.filter((i) => selectedIds.has(i.id) && !i.trashed);
  const selectedTotalBytes = selectedItemsList.reduce((acc, i) => acc + (i.size || 0), 0);
  const shownGroups = scanResult.groups.slice(0, visibleGroupsCount);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dup-modal-title"
      className="td-animate-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="td-animate-pop flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
              <SearchCheck className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="dup-modal-title"
                className="font-display text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                Pemindai File Duplikat Lintas Folder
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {scanResult.groups.length === 0
                  ? 'Semua file di seluruh Drive bersih tanpa duplikat.'
                  : `${scanResult.groups.length} grup duplikat · ${scanResult.totalDuplicateFiles} salinan berlebih (${formatBytes(scanResult.totalWastedBytes)})`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup pemindai duplikat"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {scanResult.groups.length === 0 ? (
            <div className="mx-auto my-8 max-w-md rounded-xl border border-dashed border-slate-200 p-8 text-center dark:border-slate-800">
              <SearchCheck className="mx-auto h-8 w-8 text-emerald-500" />
              <p className="mt-3 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Tidak ditemukan file duplikat
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Tidak ada dua file aktif dengan nama dan ukuran byte yang sama di seluruh folder Drive Anda.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
                <span className="text-xs text-slate-600 dark:text-slate-300">
                  Urutan pertama tiap grup ditandai sebagai file utama (berbintang / paling awal).
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllExtraCopies}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-900/50"
                  >
                    <CheckSquare className="h-3.5 w-3.5" />
                    <span>Pilih Semua Salinan (Sisakan 1)</span>
                  </button>
                  {selectedIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedIds(new Set())}
                      className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    >
                      Batal Pilih
                    </button>
                  )}
                </div>
              </div>

              {shownGroups.map((group) => (
                <div
                  key={group.key}
                  className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <FileIcon
                        type="file"
                        mimeType={group.items[0].mimeType}
                        filename={group.filename}
                        size="sm"
                      />
                      <span className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {group.filename}
                      </span>
                    </div>
                    <span className="shrink-0 text-[11px] font-medium tabular-nums text-slate-500 dark:text-slate-400">
                      {group.items.length} salinan · {formatBytes(group.size)}/file
                    </span>
                  </div>

                  <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {group.items.map((copy, idx) => {
                      const checked = selectedIds.has(copy.id);
                      const pathLabel = getItemLocationPath(copy, items);
                      return (
                        <div
                          key={copy.id}
                          className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs ${
                            checked ? 'bg-rose-50/50 dark:bg-rose-950/20' : ''
                          }`}
                        >
                          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleItem(copy.id)}
                              className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="truncate font-medium text-slate-800 dark:text-slate-200">
                                  {pathLabel}
                                </span>
                                {idx === 0 && (
                                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                                    Utama
                                  </span>
                                )}
                                {copy.starred && (
                                  <Star className="h-3 w-3 fill-amber-400 text-amber-500" />
                                )}
                              </div>
                              <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                                Diubah {formatRelativeDateId(copy.updatedAt)}
                              </div>
                            </div>
                          </label>

                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onNavigateFolder(copy.parentId);
                            }}
                            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            <FolderOpen className="h-3 w-3" />
                            <span>Buka Folder</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {scanResult.groups.length > shownGroups.length && (
                <div className="flex justify-center pt-1">
                  <button
                    type="button"
                    onClick={() => setVisibleGroupsCount((n) => n + 40)}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Tampilkan lebih banyak ({scanResult.groups.length - shownGroups.length} grup tersisa)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-3.5 dark:border-slate-800">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {selectedItemsList.length > 0
              ? `${selectedItemsList.length} file dipilih (${formatBytes(selectedTotalBytes)})`
              : 'Pilih salinan duplikat yang ingin dibersihkan.'}
          </span>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-lg px-3.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Tutup
            </button>
            <button
              type="button"
              disabled={selectedItemsList.length === 0}
              onClick={() => {
                onTrashItems(selectedItemsList);
                setSelectedIds(new Set());
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Buang ke Sampah ({selectedItemsList.length})</span>
            </button>
            <button
              type="button"
              disabled={selectedItemsList.length === 0}
              onClick={() => {
                onClose();
                onDeletePermanentItems(selectedItemsList);
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-rose-600 px-4 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Hapus Permanen ({selectedItemsList.length})</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
