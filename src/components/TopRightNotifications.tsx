import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import type { TransferTask } from '../types/drive';
import { TransferManager } from './TransferManager';

export interface AppNotification {
  id: string;
  kind: 'success' | 'error' | 'info';
  title: string;
  detail?: string;
}

interface TopRightNotificationsProps {
  notifications: AppNotification[];
  onDismissNotification: (id: string) => void;
  tasks: TransferTask[];
  onCancelTask: (id: string) => void;
  onClearCompletedTasks: () => void;
}

export function TopRightNotifications({
  notifications,
  onDismissNotification,
  tasks,
  onCancelTask,
  onClearCompletedTasks,
}: TopRightNotificationsProps) {
  if (notifications.length === 0 && tasks.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Notifikasi aktivitas dan transfer"
      className="pointer-events-none fixed right-4 top-36 z-50 flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2.5 sm:top-[8.25rem]"
    >
      {notifications.map((n) => (
        <div
          key={n.id}
          role="status"
          className={`td-animate-slide-right pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-white px-3.5 py-2.5 shadow-lg dark:bg-slate-900 ${
            n.kind === 'error'
              ? 'border-rose-200 dark:border-rose-900/70'
              : n.kind === 'success'
                ? 'border-emerald-200 dark:border-emerald-900/70'
                : 'border-slate-200 dark:border-slate-700'
          }`}
        >
          {n.kind === 'error' ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
          ) : n.kind === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          )}

          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{n.title}</p>
            {n.detail && (
              <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                {n.detail}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => onDismissNotification(n.id)}
            aria-label="Tutup notifikasi"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      {tasks.length > 0 && (
        <div className="pointer-events-auto">
          <TransferManager
            tasks={tasks}
            onCancelTask={onCancelTask}
            onClearCompleted={onClearCompletedTasks}
          />
        </div>
      )}
    </div>
  );
}
