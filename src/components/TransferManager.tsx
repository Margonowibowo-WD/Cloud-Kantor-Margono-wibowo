import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react';
import type { TransferTask } from '../types/drive';
import { formatBytes, formatEta, formatSpeed } from '../utils/fileHelpers';

interface TransferManagerProps {
  tasks: TransferTask[];
  onCancelTask: (id: string) => void;
  onRetryTask?: (id: string) => void;
  onRetryAllFailed?: () => void;
  onClearCompleted: () => void;
}

const MAX_VISIBLE_TASKS = 50;

export function TransferManager({
  tasks,
  onCancelTask,
  onRetryTask,
  onRetryAllFailed,
  onClearCompleted,
}: TransferManagerProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (tasks.length === 0) return null;

  const totalCount = tasks.length;
  const activeRunningCount = tasks.filter((t) => t.status === 'active').length;
  const queuedCount = tasks.filter((t) => t.status === 'queued').length;
  const activeCount = activeRunningCount + queuedCount;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const errorCount = tasks.filter((t) => t.status === 'error').length;
  const retryableCount = tasks.filter((t) => t.status === 'error' && t.canRetry).length;

  const activeTasks = tasks.filter((t) => t.status === 'active');
  const errorTasks = tasks.filter((t) => t.status === 'error');
  const queuedTasks = tasks.filter((t) => t.status === 'queued');
  const finishedTasks = tasks.filter((t) => t.status === 'completed' || t.status === 'cancelled');
  const visibleTasks = [...activeTasks, ...errorTasks, ...queuedTasks, ...finishedTasks].slice(
    0,
    MAX_VISIBLE_TASKS,
  );
  const hiddenCount = Math.max(0, totalCount - visibleTasks.length);

  return (
    <aside
      aria-label="Manajer transfer file"
      className="w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-800/80">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-slate-900 tabular-nums dark:text-slate-100">
            {activeCount > 0
              ? queuedCount > 0
                ? `${activeRunningCount} aktif · ${queuedCount.toLocaleString('id-ID')} antrean (${completedCount.toLocaleString('id-ID')}/${totalCount.toLocaleString('id-ID')})`
                : `Memproses ${activeRunningCount} transfer (${completedCount.toLocaleString('id-ID')}/${totalCount.toLocaleString('id-ID')})`
              : errorCount > 0
                ? completedCount > 0
                  ? `${completedCount.toLocaleString('id-ID')} selesai · ${errorCount.toLocaleString('id-ID')} gagal (dari ${totalCount.toLocaleString('id-ID')})`
                  : `${errorCount.toLocaleString('id-ID')} transfer gagal`
                : `${completedCount.toLocaleString('id-ID')} dari ${totalCount.toLocaleString('id-ID')} transfer selesai`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {retryableCount > 0 && activeCount === 0 && onRetryAllFailed && (
            <button
              type="button"
              onClick={onRetryAllFailed}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50 whitespace-nowrap dark:text-blue-400 dark:hover:bg-blue-950/50"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Coba Ulang ({retryableCount.toLocaleString('id-ID')})</span>
            </button>
          )}
          {(completedCount > 0 || errorCount > 0) && activeCount === 0 && (
            <button
              type="button"
              onClick={onClearCompleted}
              className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200/70 whitespace-nowrap dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Bersihkan
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Perluas daftar transfer' : 'Perkecil daftar transfer'}
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200/70 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
          {visibleTasks.map((task) => {
            const pct =
              task.totalBytes > 0
                ? Math.min(100, Math.round((task.loadedBytes / task.totalBytes) * 100))
                : task.status === 'completed'
                  ? 100
                  : 0;

            const chunkHint =
              task.statusLabel ||
              (task.totalChunks > 1
                ? `Bagian ${Math.min(task.totalChunks, task.completedChunks + 1)}/${task.totalChunks}`
                : undefined);

            const formatDuration = (sec?: number): string | null => {
              if (sec === undefined || !Number.isFinite(sec) || sec <= 0) return null;
              if (sec < 1) return '<1 dtk';
              return formatEta(sec);
            };

            const completedDuration = formatDuration(task.elapsedSeconds);

            return (
              <div key={task.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {task.kind === 'upload' ? (
                      <Upload className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <Download className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    )}
                    <span
                      title={task.filename}
                      className="truncate text-xs font-medium text-slate-900 dark:text-slate-100"
                    >
                      {task.filename}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {task.status === 'active' && chunkHint && (
                      <span className="font-mono text-[11px] tabular-nums text-slate-500 whitespace-nowrap dark:text-slate-400">
                        {chunkHint}
                      </span>
                    )}

                    {task.status === 'active' || task.status === 'queued' ? (
                      <button
                        type="button"
                        onClick={() => onCancelTask(task.id)}
                        aria-label={`Batalkan transfer ${task.filename}`}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : task.status === 'completed' ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    ) : task.status === 'error' && task.canRetry && onRetryTask ? (
                      <button
                        type="button"
                        onClick={() => onRetryTask(task.id)}
                        aria-label={`Coba ulang unggahan ${task.filename}`}
                        title="Coba ulang"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/60"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                    )}
                  </div>
                </div>

                {task.status === 'active' && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={`h-full rounded-full transition-all duration-150 ${
                        task.kind === 'upload' ? 'bg-blue-600' : 'bg-emerald-600'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}

                <div className="mt-1.5 flex items-center justify-between gap-3 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                  {task.status === 'queued' ? (
                    <>
                      <span className="min-w-0 truncate">
                        {formatBytes(task.totalBytes)}
                        {task.totalChunks > 1 ? ` · ${task.totalChunks} bagian` : ''}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 font-sans text-slate-500 whitespace-nowrap dark:text-slate-400">
                        <Clock className="h-3 w-3" />
                        <span>Menunggu antrean...</span>
                      </span>
                    </>
                  ) : task.status === 'active' ? (
                    <>
                      <span className="min-w-0 truncate">
                        {formatBytes(task.loadedBytes)} / {formatBytes(task.totalBytes)} ({pct}%)
                      </span>
                      <span className="shrink-0 text-slate-700 whitespace-nowrap dark:text-slate-300">
                        {task.speedBytesPerSec > 0 ? (
                          <>
                            {formatSpeed(task.speedBytesPerSec)}
                            {task.etaSeconds > 0 ? ` · ${formatEta(task.etaSeconds)}` : ''}
                          </>
                        ) : (
                          'Menghitung...'
                        )}
                      </span>
                    </>
                  ) : task.status === 'completed' ? (
                    <>
                      <span className="min-w-0 truncate">
                        {formatBytes(task.totalBytes)}
                        {task.totalChunks > 1 ? ` · ${task.totalChunks} bagian` : ''}
                      </span>
                      <span className="shrink-0 text-emerald-600 whitespace-nowrap dark:text-emerald-400">
                        {task.speedBytesPerSec > 0
                          ? `${formatSpeed(task.speedBytesPerSec)}${completedDuration ? ` · ${completedDuration}` : ''}`
                          : completedDuration
                            ? `Selesai (${completedDuration})`
                            : 'Selesai'}
                      </span>
                    </>
                  ) : (
                    <span className="min-w-0 truncate font-sans text-rose-600 dark:text-rose-400">
                      {task.errorMessage || 'Dibatalkan'}
                    </span>
                  )}
                </div>

                {task.status === 'active' && task.errorMessage && (
                  <p className="mt-1 truncate font-sans text-[11px] text-amber-600 dark:text-amber-400">
                    {task.errorMessage}
                  </p>
                )}
              </div>
            );
          })}
          {hiddenCount > 0 && (
            <div className="bg-slate-50/70 px-4 py-2 text-[11px] font-medium text-slate-500 tabular-nums dark:bg-slate-800/40 dark:text-slate-400">
              Menampilkan {visibleTasks.length} dari {totalCount.toLocaleString('id-ID')} item ·{' '}
              {completedCount.toLocaleString('id-ID')} selesai ·{' '}
              {queuedCount.toLocaleString('id-ID')} menunggu antrean
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
