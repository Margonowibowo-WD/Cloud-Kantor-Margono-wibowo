import { useEffect, useState } from 'react';
import { Folder, HardDrive, X } from 'lucide-react';
import type { DriveItem } from '../types/drive';
import { isDescendantOrSelf } from '../utils/fileHelpers';

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
  onClose: () => void;
  onMove: (targetParentId: string | null) => Promise<void>;
}

export function MoveModal({ open, movingIds, items, onClose, onMove }: MoveModalProps) {
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const folders = items.filter((i) => {
    if (i.type !== 'folder' || i.trashed) return false;
    return !movingIds.some((mid) => isDescendantOrSelf(i.id, mid, items));
  });

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
      <div className="td-animate-pop w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
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

        <div className="mt-4 max-h-64 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setSelectedFolder(null)}
            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ${
              selectedFolder === null
                ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <HardDrive className="h-4 w-4 shrink-0" />
            <span>Drive Saya (Utama)</span>
          </button>

          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => setSelectedFolder(folder.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ${
                selectedFolder === folder.id
                  ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                  : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <Folder className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
              <span className="truncate">{folder.name}</span>
            </button>
          ))}
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
