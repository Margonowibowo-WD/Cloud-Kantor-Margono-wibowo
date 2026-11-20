import { useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, ShieldCheck, X } from 'lucide-react';
import type { DriveItem, TelegramConfigState } from '../types/drive';
import { decryptTelegramVault } from '../utils/cryptoVault';
import {
  pullIndexFromTelegramPinnedMessage,
  verifyTelegramDirect,
} from '../utils/telegramDirect';

interface VaultUnlockModalProps {
  open: boolean;
  vaultString: string;
  onUnlockSuccess: (config: TelegramConfigState, pulledItems: DriveItem[]) => void;
  onDismiss: () => void;
}

export function VaultUnlockModal({
  open,
  vaultString,
  onUnlockSuccess,
  onDismiss,
}: VaultUnlockModalProps) {
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) {
      setError('Masukkan PIN brankas terlebih dahulu.');
      return;
    }

    setUnlocking(true);
    setError(null);

    try {
      const creds = await decryptTelegramVault(vaultString, pin);
      const verification = await verifyTelegramDirect(creds.botToken, creds.chatId);

      if (!verification.ok) {
        setUnlocking(false);
        setError(verification.error || 'Token berhasil dibuka, tetapi koneksi Telegram gagal.');
        return;
      }

      const pulled = await pullIndexFromTelegramPinnedMessage(
        creds.botToken,
        verification.chatId || creds.chatId,
      );

      const nextConfig: TelegramConfigState = {
        connected: true,
        botToken: creds.botToken,
        chatId: verification.chatId || creds.chatId,
        botUsername: verification.botUsername,
        botName: verification.botName,
        chatTitle: verification.chatTitle,
        chatType: verification.chatType,
        autoSync: true,
        pinnedIndexMessageId: pulled.pinnedMessageId,
        lastSyncedAt: new Date().toISOString(),
      };

      setUnlocking(false);
      setPin('');
      onUnlockSuccess(nextConfig, pulled.items);
    } catch (err) {
      setUnlocking(false);
      setError(err instanceof Error ? err.message : 'Gagal membuka brankas PIN.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="vault-unlock-title"
      className="td-animate-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget && !unlocking) onDismiss();
      }}
    >
      <div className="td-animate-pop w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <h2
                id="vault-unlock-title"
                className="font-display text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                Buka Brankas Telegram
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Masukkan PIN sekali saja di perangkat ini
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onDismiss}
            disabled={unlocking}
            aria-label="Tutup dialog buka brankas"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            Bot Token &amp; Chat ID permanen tersimpan terenkripsi di GitHub Pages. Setelah PIN
            dimasukkan sekali, perangkat ini langsung terhubung &amp; menyinkronkan file otomatis.
          </p>

          <div>
            <label
              htmlFor="vault-unlock-pin"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              PIN Brankas
            </label>
            <div className="relative mt-1.5">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="vault-unlock-pin"
                type={showPin ? 'text' : 'password'}
                autoFocus
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Masukkan PIN Anda..."
                className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-10 font-mono text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={() => setShowPin((s) => !s)}
                aria-label={showPin ? 'Sembunyikan PIN' : 'Tampilkan PIN'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
            >
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onDismiss}
              disabled={unlocking}
              className="h-9 rounded-lg px-3.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Nanti Saja
            </button>
            <button
              type="submit"
              disabled={unlocking}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {unlocking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Buka &amp; Sinkronkan</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
