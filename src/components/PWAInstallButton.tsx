import { useState } from 'react';
import { Download, MonitorSmartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWA';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export function PWAInstallButton({ compact = false }: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        title="Instal TeleDrive sebagai aplikasi Desktop / HP agar bisa dibuka offline"
        className="td-press flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 whitespace-nowrap dark:border-blue-800/80 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-900/60"
      >
        <Download className="h-3.5 w-3.5 shrink-0" />
        <span className={compact ? 'hidden md:inline' : ''}>Instal Aplikasi</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowGuideModal(true)}
          title="Cara instal TeleDrive di iPhone / iPad"
          className="td-press flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <MonitorSmartphone className="h-3.5 w-3.5 shrink-0" />
          <span className={compact ? 'hidden md:inline' : ''}>Instal iOS</span>
        </button>

        {showGuideModal && (
          <div
            role="dialog"
            aria-modal="true"
            className="td-animate-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowGuideModal(false);
            }}
          >
            <div className="td-animate-pop w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  Instal TeleDrive di iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowGuideModal(false)}
                  aria-label="Tutup panduan"
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ol className="mt-3 space-y-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                <li>
                  1. Ketuk tombol <strong className="text-slate-900 dark:text-white">Bagikan (Share)</strong> di bilah bawah/atas Safari.
                </li>
                <li>
                  2. Gulir ke bawah lalu pilih{' '}
                  <strong className="text-slate-900 dark:text-white">Tambahkan ke Layar Utama (Add to Home Screen)</strong>.
                </li>
                <li>
                  3. Ketuk <strong className="text-slate-900 dark:text-white">Tambah</strong> agar TeleDrive bisa dibuka seperti aplikasi dan diakses offline.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="mt-4 h-9 w-full rounded-xl bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Mengerti
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}

interface OfflineIndicatorProps {
  pendingQueueCount?: number;
}

export function OfflineIndicator({ pendingQueueCount = 0 }: OfflineIndicatorProps) {
  const isOnline = useOnlineStatus();

  if (isOnline && pendingQueueCount === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="td-animate-fade-up fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-xl border border-amber-300/80 bg-amber-50/95 px-3 py-2 text-xs font-semibold text-amber-900 shadow-lg backdrop-blur-xs dark:border-amber-800/70 dark:bg-amber-950/90 dark:text-amber-200"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <span>
        {!isOnline
          ? pendingQueueCount > 0
            ? `Mode Offline — ${pendingQueueCount} unggahan menunggu internet`
            : 'Mode Offline — Menampilkan data & file tersimpan lokal'
          : `Menyinkronkan ${pendingQueueCount} unggahan tertunda...`}
      </span>
    </div>
  );
}
