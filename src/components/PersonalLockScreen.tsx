import { useEffect, useState } from 'react';
import {
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Radar,
  Send,
  ShieldCheck,
} from 'lucide-react';
import type { DriveItem, TelegramConfigState } from '../types/drive';
import {
  decryptTelegramVault,
  encryptTelegramVault,
  isVaultConfigured,
} from '../utils/cryptoVault';
import {
  type DetectedChat,
  detectTelegramChatsDirect,
  normalizeCorsProxyUrl,
  verifyTelegramDirect,
} from '../utils/telegramDirect';
import type { CloudViewPrefs } from '../utils/telegramIndex';
import { pullCloudStateFromTelegram } from '../utils/telegramV4';

interface PersonalLockScreenProps {
  vaultString: string;
  onUnlockSuccess: (
    config: TelegramConfigState,
    pulledItems: DriveItem[],
    options?: {
      sessionOnly?: boolean;
      savedLocalVault?: string;
      pulledPrefs?: CloudViewPrefs;
    },
  ) => void;
}

const MAX_PIN_ATTEMPTS = 5;
const COOLDOWN_SECONDS = 30;

export function PersonalLockScreen({
  vaultString,
  onUnlockSuccess,
}: PersonalLockScreenProps) {
  const hasVault = isVaultConfigured(vaultString);
  const [mode, setMode] = useState<'pin' | 'manual'>(hasVault ? 'pin' : 'manual');

  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [cooldownUntilMs, setCooldownUntilMs] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [setupPin, setSetupPin] = useState('');
  const [showSetupPin, setShowSetupPin] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectedChats, setDetectedChats] = useState<DetectedChat[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasVault && mode === 'pin') {
      setMode('manual');
    }
  }, [hasVault, mode]);

  useEffect(() => {
    if (!cooldownUntilMs) {
      setCooldownRemaining(0);
      return;
    }
    const update = () => {
      const rem = Math.max(0, Math.ceil((cooldownUntilMs - Date.now()) / 1000));
      setCooldownRemaining(rem);
      if (rem === 0) {
        setCooldownUntilMs(0);
        setFailedAttempts(0);
      }
    };
    update();
    const id = window.setInterval(update, 500);
    return () => window.clearInterval(id);
  }, [cooldownUntilMs]);

  const handlePinUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cooldownRemaining > 0) return;
    if (!pin.trim()) {
      setError('Masukkan PIN pribadi Anda terlebih dahulu.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const creds = await decryptTelegramVault(vaultString, pin);
      const verification = await verifyTelegramDirect(creds.botToken, creds.chatId);
      if (!verification.ok) {
        setSubmitting(false);
        setError(verification.error || 'PIN benar, tetapi koneksi ke Telegram gagal.');
        return;
      }

      const pulled = await pullCloudStateFromTelegram(
        creds.botToken,
        verification.chatId || creds.chatId,
        {
          corsProxyUrl: creds.corsProxyUrl,
          skipVerifyGetMe: true,
          prefetchedPinnedText: verification.pinnedIndexText,
          prefetchedPinnedMessageId: verification.pinnedMessageId,
        },
      );

      const nextCfg: TelegramConfigState = {
        connected: true,
        botToken: creds.botToken,
        chatId: verification.chatId || creds.chatId,
        botUsername: verification.botUsername,
        botName: verification.botName,
        chatTitle: verification.chatTitle,
        chatType: verification.chatType,
        autoSync: true,
        pinnedIndexMessageId: pulled.pinnedMessageId ?? verification.pinnedMessageId,
        lastSyncedAt: new Date().toISOString(),
        corsProxyUrl: normalizeCorsProxyUrl(creds.corsProxyUrl || pulled.prefs?.px),
      };

      setSubmitting(false);
      setPin('');
      setFailedAttempts(0);
      onUnlockSuccess(nextCfg, pulled.items, {
        sessionOnly: !rememberDevice,
        pulledPrefs: pulled.prefs,
      });
    } catch (err) {
      setSubmitting(false);
      const nextAttempts = failedAttempts + 1;
      setFailedAttempts(nextAttempts);
      if (nextAttempts >= MAX_PIN_ATTEMPTS) {
        setCooldownUntilMs(Date.now() + COOLDOWN_SECONDS * 1000);
        setError(`Terlalu banyak percobaan salah. Tunggu ${COOLDOWN_SECONDS} detik.`);
      } else {
        setError(
          err instanceof Error
            ? `${err.message} (${nextAttempts}/${MAX_PIN_ATTEMPTS})`
            : 'PIN salah.',
        );
      }
    }
  };

  const handleDetectChats = async () => {
    if (!botToken.trim()) {
      setError('Masukkan Bot Token terlebih dahulu sebelum mendeteksi Chat ID.');
      return;
    }
    setDetecting(true);
    setError(null);
    const res = await detectTelegramChatsDirect(botToken);
    setDetecting(false);

    if (!res.ok) {
      setError(res.error || 'Gagal mendeteksi chat Telegram.');
      return;
    }
    setDetectedChats(res.chats);
    if (res.chats.length === 0) {
      setError(
        'Belum ada pesan baru yang diterima bot. Kirim 1 pesan ke channel/bot lalu coba Deteksi lagi.',
      );
    } else {
      setChatId(res.chats[0].id);
    }
  };

  const handleManualConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanToken = botToken.trim();
    const cleanChat = chatId.trim();
    if (!cleanToken || !cleanChat) {
      setError('Bot Token dan Chat ID wajib diisi.');
      return;
    }
    if (setupPin.trim() && setupPin.trim().length < 4) {
      setError('PIN pengunci minimal 4 karakter/angka (atau kosongkan jika tidak ingin pasang PIN).');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const verification = await verifyTelegramDirect(cleanToken, cleanChat);
      if (!verification.ok) {
        setSubmitting(false);
        setError(verification.error || 'Gagal memverifikasi Bot Telegram.');
        return;
      }

      const resolvedChat = verification.chatId || cleanChat;
      const pulled = await pullCloudStateFromTelegram(cleanToken, resolvedChat, {
        skipVerifyGetMe: true,
        prefetchedPinnedText: verification.pinnedIndexText,
        prefetchedPinnedMessageId: verification.pinnedMessageId,
      });

      const resolvedProxy = normalizeCorsProxyUrl(pulled.prefs?.px);
      let savedLocalVault: string | undefined;
      if (setupPin.trim()) {
        savedLocalVault = await encryptTelegramVault(
          {
            botToken: cleanToken,
            chatId: resolvedChat,
            corsProxyUrl: resolvedProxy,
          },
          setupPin.trim(),
        );
      }

      const nextCfg: TelegramConfigState = {
        connected: true,
        botToken: cleanToken,
        chatId: resolvedChat,
        botUsername: verification.botUsername,
        botName: verification.botName,
        chatTitle: verification.chatTitle,
        chatType: verification.chatType,
        autoSync: true,
        pinnedIndexMessageId: pulled.pinnedMessageId ?? verification.pinnedMessageId,
        lastSyncedAt: new Date().toISOString(),
        corsProxyUrl: resolvedProxy,
      };

      setSubmitting(false);
      onUnlockSuccess(nextCfg, pulled.items, {
        sessionOnly: !rememberDevice,
        savedLocalVault,
        pulledPrefs: pulled.prefs,
      });
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : 'Gagal menghubungkan ke Telegram.');
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-slate-50 px-4 py-8 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900 sm:p-7">
        {/* Brand & Lock Header */}
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-sm">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white">
              TeleDrive Pribadi Terkunci
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              File hanya bisa dibuka oleh pemilik yang memiliki kunci
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-3.5 py-2.5 text-xs leading-relaxed text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>
            Orang lain yang membuka halaman ini tidak dapat melihat daftar folder, file, maupun
            koneksi Telegram Anda sebelum kunci dibuka.
          </span>
        </div>

        {mode === 'pin' && hasVault ? (
          <form onSubmit={handlePinUnlock} className="mt-5 space-y-4">
            <div>
              <label
                htmlFor="lock-pin-input"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                PIN / Password Pribadi
              </label>
              <div className="relative mt-1.5">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="lock-pin-input"
                  type={showPin ? 'text' : 'password'}
                  autoFocus
                  autoComplete="current-password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  disabled={submitting || cooldownRemaining > 0}
                  placeholder="Masukkan PIN Anda..."
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-10 font-mono text-sm text-slate-900 focus:border-blue-500 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
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

            <label className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                Ingat di perangkat ini (hilangkan centang jika membuka dari komputer umum/orang lain)
              </span>
            </label>

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || cooldownRemaining > 0}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>
                {cooldownRemaining > 0
                  ? `Tunggu ${cooldownRemaining} detik...`
                  : 'Buka Kunci & Masuk Drive'}
              </span>
            </button>

            <div className="pt-1 text-center">
              <button
                type="button"
                onClick={() => {
                  setMode('manual');
                  setError(null);
                }}
                className="text-[11px] font-medium text-slate-400 transition-colors hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
              >
                Ganti kunci atau atur ulang koneksi?
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleManualConnect} className="mt-5 space-y-4">
            {hasVault && (
              <div className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Atur Ulang Koneksi
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setMode('pin');
                    setError(null);
                  }}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
                >
                  ← Kembali ke PIN
                </button>
              </div>
            )}
            <div>
              <label
                htmlFor="lock-bot-token"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Telegram Bot Token Anda
              </label>
              <div className="relative mt-1.5">
                <Send className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="lock-bot-token"
                  type={showToken ? 'text' : 'password'}
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder="Contoh: 7123456789:AAHxxxxx..."
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-10 font-mono text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((s) => !s)}
                  aria-label={showToken ? 'Sembunyikan token' : 'Tampilkan token'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label
                  htmlFor="lock-chat-id"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Channel / Chat ID
                </label>
                <button
                  type="button"
                  onClick={handleDetectChats}
                  disabled={detecting}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50 dark:text-blue-400"
                >
                  {detecting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Radar className="h-3.5 w-3.5" />
                  )}
                  <span>Deteksi Otomatis</span>
                </button>
              </div>
              <input
                id="lock-chat-id"
                type="text"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                placeholder="Contoh: -1001234567890"
                className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3.5 font-mono text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              {detectedChats.length > 0 && (
                <div className="mt-2 space-y-1">
                  {detectedChats.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setChatId(c.id)}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-1.5 text-left text-xs ${
                        chatId === c.id
                          ? 'border-blue-500 bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200'
                          : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="font-medium">{c.title}</span>
                      <span className="font-mono text-[11px] text-slate-500">{c.id}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label
                htmlFor="lock-setup-pin"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Buat PIN Kunci Web (Disarankan, min. 4 karakter)
              </label>
              <div className="relative mt-1.5">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="lock-setup-pin"
                  type={showSetupPin ? 'text' : 'password'}
                  value={setupPin}
                  onChange={(e) => setSetupPin(e.target.value)}
                  placeholder="Isi PIN agar nanti tinggal ketik PIN saat kunci dibuka"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-10 font-mono text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={() => setShowSetupPin((s) => !s)}
                  aria-label={showSetupPin ? 'Sembunyikan PIN' : 'Tampilkan PIN'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  {showSetupPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <label className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                Ingat di perangkat ini (hilangkan centang jika membuka dari komputer umum/orang lain)
              </span>
            </label>

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>Hubungkan &amp; Masuk Drive</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
