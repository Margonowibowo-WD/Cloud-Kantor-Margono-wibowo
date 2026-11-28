import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  History,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { formatBytes, formatEta, formatSpeed } from '../utils/fileHelpers';
import type { UploadHistoryEntry } from '../utils/uploadHistory';

interface ActivityHistoryModalProps {
  open: boolean;
  entries: UploadHistoryEntry[];
  retryableTaskIds: Set<string>;
  retryingTaskIds?: Set<string>;
  onClose: () => void;
  onRetryEntry: (entry: UploadHistoryEntry) => void;
  onRetryAllFailed: () => void;
  onReuploadToFolder: (entry: UploadHistoryEntry) => void;
  onNavigateFolder: (folderId: string | null) => void;
  onClearHistory: () => void;
}

type HistoryFilterTab = 'all' | 'success' | 'failed';
const INITIAL_VISIBLE_ROWS = 100;

export function ActivityHistoryModal({
  open,
  entries,
  retryableTaskIds,
  retryingTaskIds,
  onClose,
  onRetryEntry,
  onRetryAllFailed,
  onReuploadToFolder,
  onNavigateFolder,
  onClearHistory,
}: ActivityHistoryModalProps) {
  const [filterTab, setFilterTab] = useState<HistoryFilterTab>('all');
  const [query, setQuery] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_VISIBLE_ROWS);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setVisibleLimit(INITIAL_VISIBLE_ROWS);
    const hasFailures = entries.some((e) => e.status !== 'success');
    setFilterTab(hasFailures ? 'failed' : 'all');
  }, [open]);

  const counts = useMemo(() => {
    let success = 0;
    let failed = 0;
    let retryable = 0;
    for (const entry of entries) {
      if (entry.status === 'success') {
        success += 1;
      } else {
        failed += 1;
        if (entry.taskId && retryableTaskIds.has(entry.taskId)) {
          retryable += 1;
        }
      }
    }
    return { total: entries.length, success, failed, retryable };
  }, [entries, retryableTaskIds]);

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filterTab === 'success' && entry.status !== 'success') return false;
      if (filterTab === 'failed' && entry.status === 'success') return false;
      if (!q) return true;
      return (
        entry.filename.toLowerCase().includes(q) ||
        entry.folderPathLabel.toLowerCase().includes(q) ||
        (entry.errorMessage || '').toLowerCase().includes(q)
      );
    });
  }, [entries, filterTab, query]);

  if (!open) return null;

  const shownEntries = filteredEntries.slice(0, visibleLimit);
  const todayLabel = new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date());

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="activity-modal-title"
      className="td-animate-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="td-animate-pop flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
              <History className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="activity-modal-title"
                className="font-display text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                Aktivitas Upload Hari Ini
              </h2>
              <p className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                {todayLabel} · {counts.success.toLocaleString('id-ID')} berhasil ·{' '}
                {counts.failed.toLocaleString('id-ID')} gagal · Direset otomatis tiap hari
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup aktivitas upload"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Filter Tabs, Search, and Batch Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-6 py-3 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 p-1 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => {
                setFilterTab('all');
                setVisibleLimit(INITIAL_VISIBLE_ROWS);
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium tabular-nums transition-colors whitespace-nowrap shrink-0 ${
                filterTab === 'all'
                  ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              Semua ({counts.total.toLocaleString('id-ID')})
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterTab('success');
                setVisibleLimit(INITIAL_VISIBLE_ROWS);
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium tabular-nums transition-colors whitespace-nowrap shrink-0 ${
                filterTab === 'success'
                  ? 'bg-white text-emerald-700 shadow-2xs dark:bg-slate-700 dark:text-emerald-300'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              Berhasil ({counts.success.toLocaleString('id-ID')})
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterTab('failed');
                setVisibleLimit(INITIAL_VISIBLE_ROWS);
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium tabular-nums transition-colors whitespace-nowrap shrink-0 ${
                filterTab === 'failed'
                  ? 'bg-white text-rose-700 shadow-2xs dark:bg-slate-700 dark:text-rose-300'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              Gagal ({counts.failed.toLocaleString('id-ID')})
            </button>
          </div>

          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari file atau folder..."
                aria-label="Cari aktivitas upload"
                className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>

            {counts.retryable > 0 && (
              <button
                type="button"
                onClick={onRetryAllFailed}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Coba Ulang Semua ({counts.retryable})</span>
              </button>
            )}

            {entries.length > 0 && (
              <button
                type="button"
                onClick={onClearHistory}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Bersihkan</span>
              </button>
            )}
          </div>
        </div>

        {/* List Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {filteredEntries.length === 0 ? (
            <div className="mx-auto my-8 max-w-md rounded-xl border border-dashed border-slate-200 p-8 text-center dark:border-slate-800">
              <History className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {entries.length === 0
                  ? 'Belum ada aktivitas upload hari ini'
                  : filterTab === 'failed' && !query
                    ? 'Semua upload hari ini berhasil'
                    : 'Tidak ada aktivitas yang cocok'}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {entries.length === 0
                  ? 'Setiap file yang Anda unggah hari ini akan tercatat di sini agar mudah dipantau dan diulang jika gagal.'
                  : filterTab === 'failed' && !query
                    ? 'Tidak ada file gagal atau tertunda untuk hari ini.'
                    : 'Coba ubah kata kunci pencarian atau pilih tab filter lain.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {shownEntries.map((entry) => {
                const isSuccess = entry.status === 'success';
                const isRetryingNow =
                  !isSuccess && Boolean(entry.taskId && retryingTaskIds?.has(entry.taskId));
                const canRetryNow =
                  !isSuccess && Boolean(entry.taskId && retryableTaskIds.has(entry.taskId));
                const timeLabel = new Date(entry.timestamp).toLocaleTimeString('id-ID', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                });

                return (
                  <div
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:flex-nowrap"
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      {isSuccess ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                      )}

                      <div className="min-w-0 flex-1">
                        <p
                          title={entry.filename}
                          className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100"
                        >
                          {entry.filename}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                          {formatBytes(entry.size)}
                          <span aria-hidden="true"> · </span>
                          {entry.folderPathLabel}
                          <span aria-hidden="true"> · </span>
                          {timeLabel}
                          {isSuccess && entry.speedBytesPerSec && entry.speedBytesPerSec > 0
                            ? ` · ${formatSpeed(entry.speedBytesPerSec)}`
                            : ''}
                          {isSuccess && entry.elapsedSeconds && entry.elapsedSeconds > 0
                            ? ` · ${entry.elapsedSeconds < 1 ? '<1 dtk' : formatEta(entry.elapsedSeconds)}`
                            : ''}
                        </p>
                        {!isSuccess && entry.errorMessage && (
                          <p className="mt-0.5 truncate text-[11px] text-rose-600 dark:text-rose-400">
                            {entry.errorMessage}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {isSuccess ? (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onNavigateFolder(entry.parentId);
                          }}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <FolderOpen className="h-3.5 w-3.5" />
                          <span>Buka Folder</span>
                        </button>
                      ) : isRetryingNow ? (
                        <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-xs font-medium text-slate-600 whitespace-nowrap shrink-0 dark:bg-slate-800 dark:text-slate-300">
                          <RotateCcw className="h-3.5 w-3.5 animate-spin" />
                          <span>Mengulang...</span>
                        </span>
                      ) : canRetryNow ? (
                        <button
                          type="button"
                          onClick={() => onRetryEntry(entry)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          <span>Coba Ulang</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onReuploadToFolder(entry)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 whitespace-nowrap shrink-0 dark:border-blue-900/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-950"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          <span>Upload Ulang</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {filteredEntries.length > shownEntries.length && (
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500 tabular-nums dark:text-slate-400">
              <span>
                Menampilkan {shownEntries.length.toLocaleString('id-ID')} dari{' '}
                {filteredEntries.length.toLocaleString('id-ID')} aktivitas
              </span>
              <button
                type="button"
                onClick={() => setVisibleLimit((prev) => prev + 100)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Muat 100 lagi
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
