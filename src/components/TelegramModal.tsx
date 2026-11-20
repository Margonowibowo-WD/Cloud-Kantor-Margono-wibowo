import { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Radar,
  RefreshCw,
  Send,
  Unlink,
  X,
} from 'lucide-react';
import type { DriveItem, TelegramConfigState } from '../types/drive';
import { encryptTelegramVault } from '../utils/cryptoVault';
import {
  type DetectedChat,
  detectTelegramChatsDirect,
  maskTelegramToken,
  pullIndexFromTelegramPinnedMessage,
  verifyTelegramDirect,
} from '../utils/telegramDirect';

interface TelegramModalProps {
  open: boolean;
  config: TelegramConfigState;
  vaultAvailable?: boolean;
  onOpenVaultUnlock?: () => void;
  onClose: () => void;
  onSaveConfig: (next: TelegramConfigState, pulledItems?: DriveItem[]) => void;
  onPullRemoteItems: (items: DriveItem[], pinnedMessageId?: number) => void;
}

export function TelegramModal({
  open,
  config,
  vaultAvailable = false,
  onOpenVaultUnlock,
  onClose,
  onSaveConfig,
  onPullRemoteItems,
}: TelegramModalProps) {
  const [botToken, setBotToken] = useState(config.botToken || '');
  const [chatId, setChatId] = useState(config.chatId || '');
  const [autoSync, setAutoSync] = useState(config.autoSync ?? true);
  const [showToken, setShowToken] = useState(false);

  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [detectedChats, setDetectedChats] = useState<DetectedChat[]>([]);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const [vaultSectionOpen, setVaultSectionOpen] = useState(false);
  const [vaultPin, setVaultPin] = useState('');
  const [showVaultPin, setShowVaultPin] = useState(false);
  const [generatingVault, setGeneratingVault] = useState(false);
  const [generatedVault, setGeneratedVault] = useState('');
  const [copiedVault, setCopiedVault] = useState(false);

  useEffect(() => {
    if (open) {
      setBotToken(config.botToken || '');
      setChatId(config.chatId || '');
      setAutoSync(config.autoSync ?? true);
      setFeedback(null);
      setGeneratedVault('');
      setCopiedVault(false);
    }
  }, [open, config.botToken, config.chatId, config.autoSync]);

  if (!open) return null;

  const activeToken = botToken.trim() || config.botToken;

  const handleDetectChats = async () => {
    setDetecting(true);
    setFeedback(null);
    const res = await detectTelegramChatsDirect(activeToken);
    setDetecting(false);

    if (!res.ok) {
      setFeedback({ kind: 'error', text: res.error || 'Gagal mendeteksi chat Telegram.' });
      return;
    }

    setDetectedChats(res.chats);
    if (res.chats.length === 0) {
      setFeedback({
        kind: 'error',
        text: 'Belum ada pesan masuk ke bot. Kirim /start ke bot atau posting satu pesan di channel Anda, lalu klik Deteksi lagi.',
      });
    } else {
      setChatId(res.chats[0].id);
      setFeedback({
        kind: 'success',
        text: `Ditemukan ${res.chats.length} chat/channel. Dipilih otomatis: ${res.chats[0].title}`,
      });
    }
  };

  const handlePullIndex = async () => {
    if (!activeToken || !chatId.trim()) {
      setFeedback({ kind: 'error', text: 'Isi Bot Token dan Chat ID terlebih dahulu.' });
      return;
    }
    setPulling(true);
    setFeedback(null);
    const res = await pullIndexFromTelegramPinnedMessage(activeToken, chatId);
    setPulling(false);

    if (res.error) {
      setFeedback({ kind: 'error', text: res.error });
      return;
    }

    onPullRemoteItems(res.items, res.pinnedMessageId);
    setFeedback({
      kind: 'success',
      text:
        res.items.length > 0
          ? `Berhasil memuat ${res.items.length} item dari Pesan Tersemat channel Telegram.`
          : 'Koneksi berhasil, tetapi belum ada daftar indeks TeleDrive yang tersemat di channel ini.',
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeToken || !chatId.trim()) {
      setFeedback({ kind: 'error', text: 'Bot Token dan Chat ID wajib diisi.' });
      return;
    }

    setSaving(true);
    setFeedback(null);
    const verification = await verifyTelegramDirect(activeToken, chatId);
    if (!verification.ok) {
      setSaving(false);
      setFeedback({ kind: 'error', text: verification.error || 'Gagal memverifikasi Bot Telegram.' });
      return;
    }

    const pulled = await pullIndexFromTelegramPinnedMessage(activeToken, verification.chatId || chatId);
    const nextConfig: TelegramConfigState = {
      connected: true,
      botToken: activeToken,
      chatId: verification.chatId || chatId.trim(),
      botUsername: verification.botUsername,
      botName: verification.botName,
      chatTitle: verification.chatTitle,
      chatType: verification.chatType,
      autoSync,
      pinnedIndexMessageId: pulled.pinnedMessageId ?? config.pinnedIndexMessageId,
      lastSyncedAt: new Date().toISOString(),
    };

    onSaveConfig(nextConfig, pulled.items);
    setSaving(false);
    setFeedback({
      kind: 'success',
      text: `Terhubung ke @${verification.botUsername}. Token disimpan aman hanya di browser perangkat ini.`,
    });
  };

  const handleDisconnect = () => {
    const next: TelegramConfigState = {
      connected: false,
      botToken: '',
      chatId: '',
      autoSync: true,
    };
    onSaveConfig(next);
    setBotToken('');
    setChatId('');
    setFeedback({ kind: 'success', text: 'Koneksi Cloud Telegram diputuskan.' });
  };

  const handleGenerateVault = async () => {
    if (!activeToken || !chatId.trim()) {
      setFeedback({
        kind: 'error',
        text: 'Isi Bot Token dan Chat ID terlebih dahulu sebelum membuat kode brankas.',
      });
      return;
    }
    setGeneratingVault(true);
    setFeedback(null);
    setCopiedVault(false);
    try {
      const code = await encryptTelegramVault(
        { botToken: activeToken, chatId: chatId.trim() },
        vaultPin,
      );
      setGeneratedVault(code);
      setFeedback({
        kind: 'success',
        text: 'Kode brankas terenkripsi siap. Salin dan simpan ke GitHub Secret TELEGRAM_VAULT.',
      });
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Gagal membuat kode brankas.',
      });
    } finally {
      setGeneratingVault(false);
    }
  };

  const handleCopyVault = async () => {
    if (!generatedVault) return;
    try {
      await navigator.clipboard.writeText(generatedVault);
      setCopiedVault(true);
      window.setTimeout(() => setCopiedVault(false), 2000);
    } catch {
      setFeedback({
        kind: 'error',
        text: 'Gagal menyalin otomatis. Pilih dan salin teks kode brankas secara manual.',
      });
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tg-modal-title"
      className="td-animate-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="td-animate-pop max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
              <Send className="h-4 w-4" />
            </div>
            <div>
              <h2
                id="tg-modal-title"
                className="font-display text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                Telegram Langsung (Mode GitHub Pages)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {config.connected
                  ? `Terhubung ke @${config.botUsername} (${config.chatTitle || config.chatId})`
                  : 'Terhubung langsung dari browser ke Bot & Channel Telegram tanpa server'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup pengaturan Telegram"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-5 p-6">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
            <p className="font-semibold text-slate-800 dark:text-slate-100">
              Mode Langsung GitHub Pages + Telegram (Rp 0):
            </p>
            <ol className="mt-1.5 list-inside list-decimal space-y-1">
              <li>Bot Token & Chat ID hanya disimpan di browser Anda (tidak ada di kode GitHub).</li>
              <li>Maksimal ukuran file pada mode langsung browser adalah 20 MB per file.</li>
              <li>Daftar file otomatis disinkronkan lewat Pinned Message di Channel Telegram Anda.</li>
            </ol>
          </div>

          {/* Bot Token */}
          <div>
            <label
              htmlFor="tg-bot-token"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              Telegram Bot Token
            </label>
            <div className="relative mt-1.5">
              <input
                id="tg-bot-token"
                type={showToken ? 'text' : 'password'}
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder={
                  config.botToken
                    ? `Token aktif: ${maskTelegramToken(config.botToken)}`
                    : 'Contoh: 7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxx'
                }
                className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-3.5 pr-10 font-mono text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
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

          {/* Chat ID + Auto Detect */}
          <div>
            <div className="flex items-center justify-between">
              <label
                htmlFor="tg-chat-id"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Channel / Chat ID Tujuan
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
                <span>Deteksi Chat ID Otomatis</span>
              </button>
            </div>

            <input
              id="tg-chat-id"
              type="text"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="Contoh: -1001234567890 atau @channel_anda"
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
                    <span className="font-mono text-[11px] text-slate-500">
                      {c.type} · {c.id}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2.5 text-xs font-medium text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={autoSync}
              onChange={(e) => setAutoSync(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span>Otomatis unggah file baru (≤20 MB) langsung ke Telegram & sinkron indeks</span>
          </label>

          {/* Permanent GitHub Secrets Vault Section */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                  Koneksi Permanen Lintas Perangkat (GitHub Secrets)
                </span>
              </div>
              <div className="flex items-center gap-2">
                {vaultAvailable && onOpenVaultUnlock && !config.connected && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenVaultUnlock();
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                  >
                    <KeyRound className="h-3 w-3" />
                    <span>Buka Pakai PIN</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setVaultSectionOpen((v) => !v)}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400"
                >
                  {vaultSectionOpen ? 'Tutup' : 'Buat Kode Brankas'}
                </button>
              </div>
            </div>

            {!vaultSectionOpen ? (
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Enkripsi Token &amp; Chat ID dengan PIN pribadi Anda untuk disimpan di GitHub
                Secret <span className="font-mono font-semibold">TELEGRAM_VAULT</span> agar
                terhubung permanen di semua HP/Laptop dengan aman.
              </p>
            ) : (
              <div className="mt-3 space-y-3 border-t border-slate-200 pt-3 dark:border-slate-700/70">
                <div>
                  <label
                    htmlFor="tg-vault-pin"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Buat PIN Brankas (min. 4 angka/huruf)
                  </label>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    <div className="relative min-w-[180px] flex-1">
                      <input
                        id="tg-vault-pin"
                        type={showVaultPin ? 'text' : 'password'}
                        value={vaultPin}
                        onChange={(e) => setVaultPin(e.target.value)}
                        placeholder="Contoh: 258099"
                        className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-3 pr-9 font-mono text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      />
                      <button
                        type="button"
                        onClick={() => setShowVaultPin((s) => !s)}
                        aria-label={showVaultPin ? 'Sembunyikan PIN brankas' : 'Tampilkan PIN brankas'}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      >
                        {showVaultPin ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleGenerateVault}
                      disabled={generatingVault}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-700"
                    >
                      {generatingVault && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      <span>Enkripsi &amp; Buat Kode</span>
                    </button>
                  </div>
                </div>

                {generatedVault && (
                  <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        Kode Brankas untuk GitHub Secret:
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyVault}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        {copiedVault ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                            <span>Tersalin</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>Salin Kode</span>
                          </>
                        )}
                      </button>
                    </div>
                    <textarea
                      readOnly
                      rows={3}
                      value={generatedVault}
                      aria-label="Kode brankas terenkripsi"
                      className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-800 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    />
                    <ol className="list-inside list-decimal space-y-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                      <li>
                        Buka repo GitHub → <strong className="text-slate-800 dark:text-slate-200">Settings</strong> →{' '}
                        <strong className="text-slate-800 dark:text-slate-200">Secrets and variables</strong> →{' '}
                        <strong className="text-slate-800 dark:text-slate-200">Actions</strong>.
                      </li>
                      <li>
                        Klik <strong className="text-slate-800 dark:text-slate-200">New repository secret</strong>, isi Name:{' '}
                        <code className="font-mono font-semibold text-blue-600 dark:text-blue-400">TELEGRAM_VAULT</code> lalu tempel kode di atas.
                      </li>
                      <li>
                        Jalankan ulang workflow <strong className="text-slate-800 dark:text-slate-200">Actions</strong> (Re-run all jobs). Setelah selesai, buka dari perangkat mana saja cukup masukkan PIN sekali!
                      </li>
                    </ol>
                  </div>
                )}
              </div>
            )}
          </div>

          {feedback && (
            <div
              role="status"
              className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
                feedback.kind === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                  : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200'
              }`}
            >
              {feedback.kind === 'success' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>{feedback.text}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              {config.connected && (
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={saving}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 px-3 text-xs font-medium text-rose-700 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/40"
                >
                  <Unlink className="h-3.5 w-3.5" />
                  <span>Putuskan</span>
                </button>
              )}
              <button
                type="button"
                onClick={handlePullIndex}
                disabled={pulling || saving}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {pulling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                <span>Muat dari Telegram</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-lg px-3.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Simpan & Aktifkan</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
