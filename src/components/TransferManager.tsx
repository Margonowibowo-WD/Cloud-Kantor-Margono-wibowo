import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  Upload,
  X,
} from 'lucide-react';
import type { TransferTask } from '../types/drive';
import { formatBytes, formatEta, formatSpeed } from '../utils/fileHelpers';

interface TransferManagerProps {
  tasks: TransferTask[];
  onCancelTask: (id: string) => void;
  onClearCompleted: () => void;
}

export function TransferManager({
  tasks,
  onCancelTask,
  onClearCompleted,
}: TransferManagerProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (tasks.length === 0) return null;

  const activeRunningCount = tasks.filter((t) => t.status === 'active').length;
  const queuedCount = tasks.filter((t) => t.status === 'queued').length;
  const activeCount = activeRunningCount + queuedCount;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;

  return (
    <aside
      aria-label="Manajer transfer file"
      className="w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-800/80">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-900 truncate dark:text-slate-100">
            {activeCount > 0
              ? queuedCount > 0
                ? `Memproses ${activeRunningCount} aktif · ${queuedCount} antrean`
                : `Memproses ${activeRunningCount} transfer paralel`
              : `${completedCount} transfer selesai`}
          </p>
        </div>

        <div className="flex items-center gap-1">
          {completedCount > 0 && activeCount === 0 && (
            <button
              type="button"
              onClick={onClearCompleted}
              className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-700"
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
        <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
          {tasks.map((task) => {
            const pct =
              task.totalBytes > 0
                ? Math.min(100, Math.round((task.loadedBytes / task.totalBytes) * 100))
                : task.status === 'completed'
                  ? 100
                  : 0;

            return (
              <div key={task.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {task.kind === 'upload' ? (
                      <Upload className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <Download className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    )}
                    <span className="truncate text-xs font-medium text-slate-900 dark:text-slate-100">
                      {task.filename}
                    </span>
                  </div>

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
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                  )}
                </div>

                {task.status === 'active' && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-blue-600 transition-all duration-150"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}

                <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                  {task.status === 'queued' ? (
                    <>
                      <span>{formatBytes(task.totalBytes)}</span>
                      <span className="inline-flex items-center gap-1 font-sans text-slate-500 dark:text-slate-400">
                        <Clock className="h-3 w-3" />
                        <span>Menunggu antrean...</span>
                      </span>
                    </>
                  ) : task.status === 'active' ? (
                    task.errorMessage ? (
                      <span className="font-sans text-amber-600 dark:text-amber-400">
                        {task.errorMessage}
                      </span>
                    ) : (
                      <>
                        <span>
                          {formatBytes(task.loadedBytes)} / {formatBytes(task.totalBytes)} ({pct}%)
                        </span>
                        <span>
                          {formatSpeed(task.speedBytesPerSec)} · {formatEta(task.etaSeconds)}
                        </span>
                      </>
                    )
                  ) : task.status === 'completed' ? (
                    <>
                      <span>
                        {formatBytes(task.totalBytes)} · {task.totalChunks} bagian
                      </span>
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {task.speedBytesPerSec > 0 ? formatSpeed(task.speedBytesPerSec) : 'Selesai'}
                      </span>
                    </>
                  ) : (
                    <span className="text-rose-600 dark:text-rose-400">
                      {task.errorMessage || 'Dibatalkan'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
