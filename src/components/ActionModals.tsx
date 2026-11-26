import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, HardDrive, Search, X } from 'lucide-react';
import type { DriveItem } from '../types/drive';
import { getItemLocationPath, isDescendantOrSelf } from '../utils/fileHelpers';

interface FolderNameModalProps {
  open: boolean;
  mode: 'create' | 'rename';
  initialValue: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}

export function FolderNameModal({
  open,
  mode,
  initialValue,
  onClose,
  onSubmit,
}: FolderNameModalProps) {
  const [name, setName] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(initialValue);
      setError(null);
    }
  }, [open, initialValue]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Nama tidak boleh kosong.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="name-modal-title"
      className="td-animate-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="td-animate-pop w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h2
            id="name-modal-title"
            className="font-display text-base font-semibold text-slate-900 dark:text-slate-100"
          >
            {mode === 'create' ? 'Buat Folder Baru' : 'Ubah Nama'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="folder-or-item-name"
              className="block text-xs font-medium text-slate-600 dark:text-slate-400"
            >
              {mode === 'create' ? 'Nama folder' : 'Nama baru'}
            </label>
            <input
              id="folder-or-item-name"
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={mode === 'create' ? 'Contoh: Proyek Klien 2026' : 'Masukkan nama baru'}
              className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            {error && <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-lg px-3.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-9 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Menyimpan...' : mode === 'create' ? 'Buat Folder' : 'Simpan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface MoveModalProps {
  open: boolean;
  movingIds: string[];
  items: DriveItem[];
  currentFolderId?: string | null;
  onClose: () => void;
  onMove: (targetParentId: string | null) => Promise<void>;
}

export function MoveModal({
  open,
  movingIds,
  items,
  currentFolderId = null,
  onClose,
  onMove,
}: MoveModalProps) {
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [submitting, setSubmitting] = useState(false);

  const validFolders = useMemo(
    () =>
      items
        .filter((i) => {
          if (i.type !== 'folder' || i.trashed) return false;
          return !movingIds.some((mid) => isDescendantOrSelf(i.id, mid, items));
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' })),
    [items, movingIds],
  );

  const childrenMap = useMemo(() => {
    const map = new Map<string, DriveItem[]>();
    for (const folder of validFolders) {
      const key = folder.parentId ?? 'ROOT';
      const list = map.get(key);
      if (list) list.push(folder);
      else map.set(key, [folder]);
    }
    return map;
  }, [validFolders]);

  useEffect(() => {
    if (!open) return;
    setSearchQuery('');
    setSelectedFolder(currentFolderId ?? null);
    // Auto-expand ancestor chain of currentFolderId so user starts oriented
    const nextExpanded = new Set<string>();
    const byId = new Map(items.map((i) => [i.id, i]));
    let cursor = currentFolderId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const node = byId.get(cursor);
      if (node?.parentId) nextExpanded.add(node.parentId);
      cursor = node?.parentId ?? null;
    }
    setExpandedIds(nextExpanded);
  }, [open, currentFolderId, items]);

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const filteredSearchFolders = useMemo(() => {
    if (!trimmedQuery) return [];
    return validFolders.filter((f) => f.name.toLowerCase().includes(trimmedQuery)).slice(0, 120);
  }, [validFolders, trimmedQuery]);

  if (!open) return null;

  const toggleExpand = (folderId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const renderTreeNodes = (parentKey: string, depth: number) => {
    const nodes = childrenMap.get(parentKey);
    if (!nodes || nodes.length === 0) return null;

    return (
      <div className={depth > 0 ? 'ml-3.5 border-l border-slate-200 pl-2 dark:border-slate-800' : ''}>
        {nodes.map((folder) => {
          const hasChildren = (childrenMap.get(folder.id)?.length || 0) > 0;
          const isExpanded = expandedIds.has(folder.id);
          const isSelected = selectedFolder === folder.id;

          return (
            <div key={folder.id}>
              <div className="flex items-center gap-0.5">
                {hasChildren ? (
                  <button
                    type="button"
                    onClick={() => toggleExpand(folder.id)}
                    aria-label={isExpanded ? `Tutup cabang ${folder.name}` : `Buka cabang ${folder.name}`}
                    className="flex h-7 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </button>
                ) : (
                  <span className="h-7 w-6 shrink-0" />
                )}

                <button
                  type="button"
                  onClick={() => setSelectedFolder(folder.id)}
                  onDoubleClick={() => {
                    if (hasChildren) toggleExpand(folder.id);
                  }}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${
                    isSelected
                      ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                      : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <Folder className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                  <span className="truncate">{folder.name}</span>
                </button>
              </div>
              {hasChildren && isExpanded && renderTreeNodes(folder.id, depth + 1)}
            </div>
          );
        })}
      </div>
    );
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onMove(selectedFolder);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-modal-title"
      className="td-animate-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="td-animate-pop w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h2
            id="move-modal-title"
            className="font-display text-base font-semibold text-slate-900 dark:text-slate-100"
          >
            Pindahkan {movingIds.length} Item ke Folder
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog pindah"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative mt-3.5">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari nama folder tujuan..."
            aria-label="Cari nama folder tujuan"
            className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8.5 pr-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Hapus pencarian folder"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="mt-3 max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2 dark:border-slate-800">
          {!trimmedQuery ? (
            <>
              <button
                type="button"
                onClick={() => setSelectedFolder(null)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs ${
                  selectedFolder === null
                    ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                    : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <HardDrive className="h-4 w-4 shrink-0" />
                <span>Drive Saya (Utama)</span>
              </button>
              {renderTreeNodes('ROOT', 0)}
              {validFolders.length === 0 && (
                <p className="px-2.5 py-2 text-xs text-slate-400 dark:text-slate-500">
                  Belum ada subfolder lain.
                </p>
              )}
            </>
          ) : filteredSearchFolders.length > 0 ? (
            filteredSearchFolders.map((folder) => {
              const loc = getItemLocationPath(folder, items);
              const isSelected = selectedFolder === folder.id;
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => setSelectedFolder(folder.id)}
                  className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left ${
                    isSelected
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                      : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <Folder className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-xs ${isSelected ? 'font-semibold' : 'font-medium'}`}>
                      {folder.name}
                    </div>
                    <div className="truncate text-[10px] text-slate-400 dark:text-slate-500">
                      {loc}
                    </div>
                  </div>
                </button>
              );
            })
          ) : (
            <p className="px-3 py-4 text-center text-xs text-slate-400 dark:text-slate-500">
              Folder "{searchQuery}" tidak ditemukan.
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg px-3.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="h-9 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Memindahkan...' : 'Pindahkan ke Sini'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConfirmDeleteModalProps {
  open: boolean;
  variant?: 'trash' | 'permanent';
  count: number;
  label?: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  onConfirmPermanent?: () => Promise<void>;
}

export function ConfirmDeleteModal({
  open,
  variant = 'permanent',
  count,
  label,
  onClose,
  onConfirm,
  onConfirmPermanent,
}: ConfirmDeleteModalProps) {
  const [deleting, setDeleting] = useState<'trash' | 'permanent' | null>(null);

  if (!open) return null;

  const isTrashAction = variant === 'trash';

  const handleConfirmTrash = async () => {
    setDeleting('trash');
    try {
      await onConfirm();
      onClose();
    } finally {
      setDeleting(null);
    }
  };

  const handleConfirmPermanent = async () => {
    setDeleting('permanent');
    try {
      if (isTrashAction && onConfirmPermanent) {
        await onConfirmPermanent();
      } else {
        await onConfirm();
      }
      onClose();
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-modal-title"
      className="td-animate-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="td-animate-pop w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <h2
          id="delete-modal-title"
          className="font-display text-base font-semibold text-slate-900 dark:text-slate-100"
        >
          {isTrashAction ? 'Anda yakin ingin menghapus?' : 'Anda yakin hapus permanen?'}
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
          {isTrashAction
            ? label
              ? `Item "${label}" bisa disimpan sementara di Sampah, atau langsung dihapus permanen dari Cloud & channel Telegram.`
              : `${count} item terpilih bisa disimpan sementara di Sampah, atau langsung dihapus permanen dari Cloud & channel Telegram.`
            : label
              ? `Item "${label}" akan dihapus permanen dari Drive dan channel Telegram, dan tidak dapat dipulihkan.`
              : `${count} item terpilih akan dihapus permanen dari Drive dan channel Telegram, dan tidak dapat dipulihkan.`}
        </p>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting !== null}
            className="td-press h-9 rounded-lg px-3.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Batal
          </button>
          {isTrashAction && (
            <button
              type="button"
              onClick={handleConfirmTrash}
              disabled={deleting !== null}
              className="td-press h-9 rounded-lg border border-slate-200 bg-slate-50 px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {deleting === 'trash' ? 'Memindahkan...' : 'Ke Sampah'}
            </button>
          )}
          <button
            type="button"
            onClick={handleConfirmPermanent}
            disabled={deleting !== null}
            className="td-press h-9 rounded-lg bg-rose-600 px-4 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {deleting === 'permanent'
              ? 'Menghapus...'
              : isTrashAction
                ? 'Hapus Permanen (+ Telegram)'
                : 'Ya, Hapus Permanen'}
          </button>
        </div>
      </div>
    </div>
  );
}
