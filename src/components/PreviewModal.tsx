import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { DriveItem, TelegramConfigState } from '../types/drive';
import {
  formatBytes,
  formatRelativeDateId,
  getFileCategory,
  getOfficePreviewType,
  isPdfFile,
  isTextPreviewable,
} from '../utils/fileHelpers';
import { DIRECT_TELEGRAM_MAX_BYTES, normalizeCorsProxyUrl } from '../utils/telegramDirect';
import {
  PreviewCorsBlockedError,
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
  onOpenTelegramSettings?: () => void;
  onHydrateStub?: (item: DriveItem) => void;
}

export function PreviewModal({
  item,
  tgConfig,
  onClose,
  onOpenTelegramSettings,
  onHydrateStub,
}: PreviewModalProps) {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const [officeBuffer, setOfficeBuffer] = useState<ArrayBuffer | null>(null);
  const [officeLoading, setOfficeLoading] = useState(false);
  const [pdfBuffer, setPdfBuffer] = useState<ArrayBuffer | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [corsBlocked, setCorsBlocked] = useState(false);
  const onHydrateStubRef = useRef(onHydrateStub);
  onHydrateStubRef.current = onHydrateStub;

  useEffect(() => {
    if (!item) return;
    let active = true;
    let revokeUrl: string | null = null;
    let stubTimer: number | null = null;

    setMediaUrl(null);
    setMediaLoading(false);
    setTextContent(null);
    setTextLoading(false);
    setOfficeBuffer(null);
    setOfficeLoading(false);
    setPdfBuffer(null);
    setPdfLoading(false);
    setPreviewError(null);
    setCorsBlocked(false);

    const loadPreview = async () => {
      if (item.isCatalogStub) {
        onHydrateStubRef.current?.(item);
        const category = getFileCategory(item.mimeType, item.name);
        if (isPdfFile(item.mimeType, item.name)) setPdfLoading(true);
        else if (getOfficePreviewType(item.mimeType, item.name)) setOfficeLoading(true);
        else if (isTextPreviewable(item.mimeType, item.name)) setTextLoading(true);
        else if (category === 'image' || category === 'video' || category === 'audio') {
          setMediaLoading(true);
        }
        stubTimer = window.setTimeout(() => {
          if (!active) return;
          setPdfLoading(false);
          setOfficeLoading(false);
          setTextLoading(false);
          setMediaLoading(false);
          setPreviewError(
            'Metadata file belum termuat dari Telegram. Pastikan Proxy Cloudflare Worker aktif dan coba Sinkronkan ulang.',
          );
        }, 12000);
        return;
      }
      if (isPdfFile(item.mimeType, item.name)) {
        setPdfLoading(true);
        try {
          const buf = await resolveItemArrayBuffer(item, tgConfig);
          if (active) setPdfBuffer(buf);
        } catch (err) {
          if (active) {
            setCorsBlocked(err instanceof PreviewCorsBlockedError);
            setPreviewError(err instanceof Error ? err.message : 'Gagal memuat pratinjau PDF.');
          }
        } finally {
          if (active) setPdfLoading(false);
        }
        return;
      }

      const officeType = getOfficePreviewType(item.mimeType, item.name);
      if (officeType && officeType !== 'legacy-office') {
        setOfficeLoading(true);
        try {
          const buf = await resolveItemArrayBuffer(item, tgConfig);
          if (active) setOfficeBuffer(buf);
        } catch (err) {
          if (active) {
            setCorsBlocked(err instanceof PreviewCorsBlockedError);
            setPreviewError(err instanceof Error ? err.message : 'Gagal memuat pratinjau Office.');
          }
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
        } catch (err) {
          if (active) {
            setCorsBlocked(err instanceof PreviewCorsBlockedError);
            setPreviewError(err instanceof Error ? err.message : 'Gagal memuat pratinjau teks.');
          }
        } finally {
          if (active) setTextLoading(false);
        }
        return;
      }

      const cat = getFileCategory(item.mimeType, item.name);
      if (cat === 'image' || cat === 'video' || cat === 'audio') {
        setMediaLoading(true);
        try {
          const resolved = await resolveItemPlayableUrl(item, tgConfig);
          if (resolved && active) {
            if (resolved.isObjectUrl) revokeUrl = resolved.url;
            setMediaUrl(resolved.url);
          }
        } catch (err) {
          if (active) {
            setCorsBlocked(err instanceof PreviewCorsBlockedError);
            setPreviewError(err instanceof Error ? err.message : 'Gagal memuat pratinjau file.');
          }
        } finally {
          if (active) setMediaLoading(false);
        }
      }
    };

    void loadPreview();

    return () => {
      active = false;
      if (stubTimer !== null) window.clearTimeout(stubTimer);
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

          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup pratinjau"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Preview Content Surface */}
        <div className="flex-1 overflow-auto bg-slate-100 p-4 sm:p-6 dark:bg-slate-950">
          {mediaLoading ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 text-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              <p className="text-xs text-slate-500 dark:text-slate-400">Memuat pratinjau...</p>
            </div>
          ) : category === 'image' && mediaUrl && !previewError ? (
            <div className="flex min-h-[300px] items-center justify-center">
              <img
                src={mediaUrl}
                alt={item.name}
                referrerPolicy="no-referrer"
                onError={() => {
                  const hasProxy = Boolean(normalizeCorsProxyUrl(tgConfig.corsProxyUrl));
                  setCorsBlocked(!hasProxy);
                  setPreviewError(
                    hasProxy
                      ? 'Gagal memuat gambar melalui proxy. Periksa URL Cloudflare Worker atau koneksi Telegram.'
                      : 'Gambar tidak dapat dimuat langsung oleh browser. Aktifkan Proxy Cloudflare Worker di Pengaturan Telegram.',
                  );
                }}
                className="max-h-[60vh] rounded-lg object-contain shadow-sm"
              />
            </div>
          ) : category === 'video' && mediaUrl && !previewError ? (
            <div className="flex items-center justify-center">
              <video
                src={mediaUrl}
                controls
                preload="metadata"
                onError={() => {
                  const hasProxy = Boolean(normalizeCorsProxyUrl(tgConfig.corsProxyUrl));
                  setCorsBlocked(!hasProxy);
                  setPreviewError(
                    hasProxy
                      ? 'Gagal memutar video melalui proxy Telegram.'
                      : 'Video tidak dapat dimuat langsung oleh browser. Aktifkan Proxy Cloudflare Worker di Pengaturan Telegram.',
                  );
                }}
                className="max-h-[60vh] w-full rounded-lg bg-black"
              />
            </div>
          ) : category === 'audio' && mediaUrl && !previewError ? (
            <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
              <FileIcon type="file" mimeType={item.mimeType} filename={item.name} size="lg" />
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{item.name}</p>
              <audio
                src={mediaUrl}
                controls
                onError={() => {
                  const hasProxy = Boolean(normalizeCorsProxyUrl(tgConfig.corsProxyUrl));
                  setCorsBlocked(!hasProxy);
                  setPreviewError(
                    hasProxy
                      ? 'Gagal memutar audio melalui proxy Telegram.'
                      : 'Audio tidak dapat dimuat langsung oleh browser. Aktifkan Proxy Cloudflare Worker di Pengaturan Telegram.',
                  );
                }}
                className="w-full"
              />
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
          ) : pdfFile && (pdfLoading || pdfBuffer) ? (
            <div className="h-[62vh]">
              {pdfLoading || !pdfBuffer ? (
                <div className="flex h-full items-center justify-center text-xs text-slate-500 dark:text-slate-400">
                  Memuat pratinjau PDF...
                </div>
              ) : (
                <PdfCanvasPreview buffer={pdfBuffer} filename={item.name} />
              )}
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
                {previewError
                  ? previewError
                  : officeType === 'legacy-office'
                    ? 'Format Office lama (.doc/.ppt) belum didukung pratinjau langsung. Gunakan .docx atau .pptx.'
                    : item.size > DIRECT_TELEGRAM_MAX_BYTES
                      ? 'File di atas 20 MB tersimpan di Channel Telegram'
                      : 'Pratinjau langsung tidak tersedia untuk format ini'}
              </p>
              <p className="mt-1 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                Tipe MIME: {item.mimeType} · {formatBytes(item.size)}
              </p>
              {corsBlocked && onOpenTelegramSettings && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenTelegramSettings();
                  }}
                  className="mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  Aktifkan Proxy Pratinjau (Gratis)
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
