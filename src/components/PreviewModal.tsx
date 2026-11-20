import { useEffect, useState } from 'react';
import {
  Check,
  CloudUpload,
  Copy,
  Download,
  ExternalLink,
  Star,
  X,
} from 'lucide-react';
import type { DriveItem, TelegramConfigState } from '../types/drive';
import {
  formatBytes,
  formatRelativeDateId,
  getFileCategory,
  getOfficePreviewType,
  isPdfFile,
  isTextPreviewable,
} from '../utils/fileHelpers';
import { buildTelegramMessageLink, DIRECT_TELEGRAM_MAX_BYTES } from '../utils/telegramDirect';
import {
  resolveItemArrayBuffer,
  resolveItemPlayableUrl,
  resolveItemTextContent,
} from '../utils/uploadClient';
import { FileIcon } from './FileIcon';
import { OfficePreview } from './OfficePreview';
import { PdfCanvasPreview } from './PdfCanvasPreview';

interface PreviewModalProps {
  item: DriveItem | null;
  tgConfig: TelegramConfigState;
  onClose: () => void;
  onDownload: (item: DriveItem) => void;
  onToggleStar: (item: DriveItem) => void;
  onSyncTelegram: (item: DriveItem) => Promise<void>;
}

export function PreviewModal({
  item,
  tgConfig,
  onClose,
  onDownload,
  onToggleStar,
  onSyncTelegram,
}: PreviewModalProps) {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const [officeBuffer, setOfficeBuffer] = useState<ArrayBuffer | null>(null);
  const [officeLoading, setOfficeLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    let active = true;
    let revokeUrl: string | null = null;

    setMediaUrl(null);
    setTextContent(null);
    setOfficeBuffer(null);
    setOfficeLoading(false);
    setSyncError(null);

    const loadPreview = async () => {
      const officeType = getOfficePreviewType(item.mimeType, item.name);
      if (officeType && officeType !== 'legacy-office') {
        setOfficeLoading(true);
        try {
          const buf = await resolveItemArrayBuffer(item, tgConfig);
          if (active) setOfficeBuffer(buf);
        } catch {
          // fallback
        } finally {
          if (active) setOfficeLoading(false);
        }
        return;
      }

      if (isTextPreviewable(item.mimeType, item.name) && item.size <= 2 * 1024 * 1024) {
        setTextLoading(true);
        try {
          const text = await resolveItemTextContent(item, tgConfig);
          if (active && text !== null) {
            setTextContent(text);
          }
        } catch {
          // fallback
        } finally {
          if (active) setTextLoading(false);
        }
        return;
      }

      try {
        const pdf = isPdfFile(item.mimeType, item.name);
        const resolved = await resolveItemPlayableUrl(item, tgConfig, {
          forceTypedBlob: pdf,
          mimeOverride: pdf ? 'application/pdf' : undefined,
        });
        if (resolved && active) {
          if (resolved.isObjectUrl) revokeUrl = resolved.url;
          setMediaUrl(resolved.url);
        }
      } catch {
        // fallback to download card
      }
    };

    loadPreview();

    return () => {
      active = false;
      if (revokeUrl) {
        const urlToRevoke = revokeUrl;
        window.setTimeout(() => URL.revokeObjectURL(urlToRevoke), 600);
      }
    };
  }, [item, tgConfig]);

  if (!item) return null;

  const category = getFileCategory(item.mimeType, item.name);
  const pdfFile = isPdfFile(item.mimeType, item.name);
  const officeType = getOfficePreviewType(item.mimeType, item.name);

  const handleCopyFileId = async () => {
    const val = item.chunks[0]?.telegramFileId || item.name;
    try {
      await navigator.clipboard.writeText(val);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      await onSyncTelegram(item);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Gagal menyinkronkan ke Telegram.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-modal-title"
      className="td-animate-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="td-animate-pop flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        {/* Top Modal Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-3">
            <FileIcon type="file" mimeType={item.mimeType} filename={item.name} />
            <div className="min-w-0">
              <h2
                id="preview-modal-title"
                className="truncate font-display text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                {item.name}
              </h2>
              <p className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {formatBytes(item.size)} · {formatRelativeDateId(item.updatedAt)} · Cloud Telegram
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => onToggleStar(item)}
              aria-label={item.starred ? `Hapus bintang ${item.name}` : `Bintangi ${item.name}`}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Star className={`h-4 w-4 ${item.starred ? 'fill-amber-400 text-amber-500' : ''}`} />
            </button>

            {item.chunks[0]?.telegramFileId && (
              <button
                type="button"
                onClick={handleCopyFileId}
                className="hidden h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:inline-flex dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? 'File ID Disalin' : 'Salin File ID'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onDownload(item)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Unduh Cepat</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup pratinjau"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Preview Content Surface */}
        <div className="flex-1 overflow-auto bg-slate-100 p-4 sm:p-6 dark:bg-slate-950">
          {category === 'image' && mediaUrl ? (
            <div className="flex min-h-[300px] items-center justify-center">
              <img
                src={mediaUrl}
                alt={item.name}
                referrerPolicy="no-referrer"
                className="max-h-[60vh] rounded-lg object-contain shadow-sm"
              />
            </div>
          ) : category === 'video' && mediaUrl ? (
            <div className="flex items-center justify-center">
              <video
                src={mediaUrl}
                controls
                preload="metadata"
                className="max-h-[60vh] w-full rounded-lg bg-black"
              />
            </div>
          ) : category === 'audio' && mediaUrl ? (
            <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
              <FileIcon type="file" mimeType={item.mimeType} filename={item.name} size="lg" />
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{item.name}</p>
              <audio src={mediaUrl} controls className="w-full" />
            </div>
          ) : officeType && officeType !== 'legacy-office' && (officeLoading || officeBuffer) ? (
            <div className="h-[62vh]">
              {officeLoading || !officeBuffer ? (
                <div className="flex h-full items-center justify-center text-xs text-slate-500 dark:text-slate-400">
                  Memuat pratinjau dokumen Office...
                </div>
              ) : (
                <OfficePreview officeType={officeType} buffer={officeBuffer} filename={item.name} />
              )}
            </div>
          ) : pdfFile && mediaUrl ? (
            <div className="h-[62vh]">
              <PdfCanvasPreview src={mediaUrl} filename={item.name} />
            </div>
          ) : isTextPreviewable(item.mimeType, item.name) && (textLoading || textContent !== null) ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
              {textLoading ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Memuat isi file...</p>
              ) : (
                <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-slate-800 dark:text-slate-200">
                  {textContent}
                </pre>
              )}
            </div>
          ) : (
            <div className="mx-auto flex max-w-md flex-col items-center rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
              <FileIcon type="file" mimeType={item.mimeType} filename={item.name} size="lg" />
              <p className="mt-4 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {item.size > DIRECT_TELEGRAM_MAX_BYTES
                  ? 'File di atas 20 MB tersimpan di Channel Telegram'
                  : 'Siap diunduh langsung dari Cloud Telegram'}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Tipe MIME: {item.mimeType} · {formatBytes(item.size)}
              </p>
              {item.size > DIRECT_TELEGRAM_MAX_BYTES &&
              buildTelegramMessageLink(tgConfig.chatId, item.chunks[0]?.telegramMessageId) ? (
                <a
                  href={buildTelegramMessageLink(tgConfig.chatId, item.chunks[0]?.telegramMessageId) || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Buka di Aplikasi Telegram</span>
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => onDownload(item)}
                  className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Unduh File Sekarang</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer Technical Manifest & On-Demand Telegram Sync */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3 text-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center gap-2 text-slate-500 dark:text-slate-400">
            <span className="font-mono">
              {item.size > DIRECT_TELEGRAM_MAX_BYTES
                ? 'Cloud Telegram (> 20 MB · Buka via Aplikasi Telegram)'
                : 'Cloud Telegram (Maks. 20 MB/file)'}
            </span>
            {item.chunks[0]?.telegramFileId && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono truncate max-w-[260px]">
                  TG ID: {item.chunks[0].telegramFileId}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            {syncError && <span className="text-rose-600 dark:text-rose-400">{syncError}</span>}
            {item.storageBackend === 'local' && tgConfig.connected && (
              <button
                type="button"
                disabled={syncing}
                onClick={handleSync}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
              >
                <CloudUpload className="h-3.5 w-3.5" />
                <span>{syncing ? 'Mengunggah...' : 'Unggah ke Telegram'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
