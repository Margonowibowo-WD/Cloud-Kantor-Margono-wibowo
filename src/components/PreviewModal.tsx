import { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  RotateCw,
  X,
  ZoomIn,
  ZoomOut,
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
import { hasLocalBlob } from '../utils/localVault';
import {
  DIRECT_TELEGRAM_MAX_BYTES,
  MAX_LARGE_PREVIEW_BYTES,
  normalizeCorsProxyUrl,
} from '../utils/telegramDirect';
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
  onHydrateStub?: (item: DriveItem) => Promise<boolean> | void;
  onDownloadItem?: (item: DriveItem) => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
}

export function PreviewModal({
  item,
  tgConfig,
  onClose,
  onOpenTelegramSettings,
  onHydrateStub,
  onDownloadItem,
  hasPrev = false,
  hasNext = false,
  onPrev,
  onNext,
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
  const [largeAuthId, setLargeAuthId] = useState<string | null>(null);
  const [requiresLargeAuth, setRequiresLargeAuth] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  const onHydrateStubRef = useRef(onHydrateStub);
  onHydrateStubRef.current = onHydrateStub;
  const onPrevRef = useRef(onPrev);
  onPrevRef.current = onPrev;
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;
  const latestItemRef = useRef(item);
  latestItemRef.current = item;
  const latestTgConfigRef = useRef(tgConfig);
  latestTgConfigRef.current = tgConfig;
  const lastPreviewIdRef = useRef<string | null>(null);

  const firstChunk = item?.chunks?.[0];
  const chunkCount = item?.chunks?.length || 0;
  const isLargeAuthorized = Boolean(item && largeAuthId === item.id);
  const itemPreviewKey = item
    ? `${item.id}|${item.isCatalogStub ? 'stub' : 'full'}|${chunkCount}|${isLargeAuthorized ? 'auth' : 'noauth'}|${item.name}|${item.mimeType}|${item.size}|${item.localBlobKey || ''}|${firstChunk?.telegramFileId || ''}|${firstChunk?.telegramMessageId || ''}|${item.demoTextContent !== undefined ? 'demo' : ''}`
    : '';
  const tgKey = `${tgConfig.connected ? 1 : 0}|${tgConfig.botToken}|${tgConfig.chatId}|${tgConfig.corsProxyUrl || ''}`;

  // Keyboard ArrowLeft / ArrowRight navigation inside modal
  useEffect(() => {
    if (!item) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && hasPrev) {
        e.preventDefault();
        onPrevRef.current?.();
      } else if (e.key === 'ArrowRight' && hasNext) {
        e.preventDefault();
        onNextRef.current?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [item, hasPrev, hasNext]);

  useEffect(() => {
    const target = latestItemRef.current;
    const cfg = latestTgConfigRef.current;
    if (!target || !itemPreviewKey) {
      lastPreviewIdRef.current = null;
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
      setRequiresLargeAuth(false);
      setZoom(1);
      setRotation(0);
      return;
    }

    let active = true;
    let revokeUrl: string | null = null;
    let stubTimer: number | null = null;

    if (lastPreviewIdRef.current !== target.id) {
      lastPreviewIdRef.current = target.id;
      setMediaUrl(null);
      setTextContent(null);
      setOfficeBuffer(null);
      setPdfBuffer(null);
      setLargeAuthId(null);
      setZoom(1);
      setRotation(0);
    }
    setMediaLoading(false);
    setTextLoading(false);
    setOfficeLoading(false);
    setPdfLoading(false);
    setPreviewError(null);
    setCorsBlocked(false);
    setRequiresLargeAuth(false);

    const loadPreview = async () => {
      const hasCached = await hasLocalBlob(target.localBlobKey || `blob-${target.id}`);
      if (!active) return;

      if (target.isCatalogStub && !hasCached) {
        const category = getFileCategory(target.mimeType, target.name);
        if (isPdfFile(target.mimeType, target.name)) setPdfLoading(true);
        else if (getOfficePreviewType(target.mimeType, target.name)) setOfficeLoading(true);
        else if (isTextPreviewable(target.mimeType, target.name)) setTextLoading(true);
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
        }, 15000);
        try {
          const hydrated = await onHydrateStubRef.current?.(target);
          if (!active) return;
          if (hydrated === false) {
            if (stubTimer !== null) window.clearTimeout(stubTimer);
            setPdfLoading(false);
            setOfficeLoading(false);
            setTextLoading(false);
            setMediaLoading(false);
            setPreviewError(
              typeof navigator !== 'undefined' && navigator.onLine === false
                ? 'Perangkat sedang offline dan file ini belum disimpan ke cache offline.'
                : 'Metadata file belum ditemukan di folder Telegram. Coba Sinkronkan ulang atau aktifkan Proxy Cloudflare Worker.',
            );
          }
        } catch {
          // safety timer handles unexpected failures
        }
        return;
      }

      // Guard large multi-chunk files >20MB so opening preview doesn't auto-download hundreds of MB unexpectedly
      const isMultiChunkRemote = (target.chunks?.length || 0) > 1 && !hasCached;
      if (isMultiChunkRemote && largeAuthId !== target.id) {
        setRequiresLargeAuth(true);
        return;
      }
      if (target.size > DIRECT_TELEGRAM_MAX_BYTES && (target.chunks?.length || 0) <= 1 && !hasCached) {
        return;
      }

      if (isPdfFile(target.mimeType, target.name)) {
        setPdfLoading(true);
        try {
          const buf = await resolveItemArrayBuffer(target, cfg);
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

      const officeType = getOfficePreviewType(target.mimeType, target.name);
      if (officeType && officeType !== 'legacy-office') {
        setOfficeLoading(true);
        try {
          const buf = await resolveItemArrayBuffer(target, cfg);
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

      if (isTextPreviewable(target.mimeType, target.name) && target.size <= 2 * 1024 * 1024) {
        setTextLoading(true);
        try {
          const text = await resolveItemTextContent(target, cfg);
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

      const cat = getFileCategory(target.mimeType, target.name);
      if (cat === 'image' || cat === 'video' || cat === 'audio') {
        setMediaLoading(true);
        try {
          const resolved = await resolveItemPlayableUrl(target, cfg);
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
  }, [itemPreviewKey, tgKey, largeAuthId]);

  if (!item) return null;

  const category = getFileCategory(item.mimeType, item.name);
  const pdfFile = isPdfFile(item.mimeType, item.name);
  const officeType = getOfficePreviewType(item.mimeType, item.name);
  const canPreviewLargeFormat =
    item.size <= MAX_LARGE_PREVIEW_BYTES &&
    (pdfFile ||
      (officeType && officeType !== 'legacy-office') ||
      category === 'image' ||
      category === 'video' ||
      category === 'audio');

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
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 sm:px-5 dark:border-slate-800">
          <div className="flex min-w-0 flex-1 items-center gap-3">
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
                {(item.chunks?.length || 0) > 1 ? ` (${item.chunks.length} bagian)` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {category === 'image' && mediaUrl && !previewError && (
              <div className="mr-1 flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                  aria-label="Perkecil gambar"
                  title="Perkecil"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setZoom(1);
                    setRotation(0);
                  }}
                  title="Reset zoom & rotasi"
                  className="px-1.5 font-mono text-[11px] font-semibold tabular-nums text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
                  aria-label="Perbesar gambar"
                  title="Perbesar"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  aria-label="Putar gambar 90 derajat"
                  title="Putar 90°"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {(hasPrev || hasNext) && (
              <div className="mr-1 flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800">
                <button
                  type="button"
                  disabled={!hasPrev}
                  onClick={onPrev}
                  aria-label="File sebelumnya"
                  title="Sebelumnya (Panah Kiri)"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-white disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={!hasNext}
                  onClick={onNext}
                  aria-label="File berikutnya"
                  title="Berikutnya (Panah Kanan)"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-white disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}

            {onDownloadItem && (
              <button
                type="button"
                onClick={() => onDownloadItem(item)}
                aria-label="Unduh file"
                title="Unduh file"
                className="td-press inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Unduh</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup pratinjau"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Preview Content Surface */}
        <div className="relative flex-1 overflow-auto bg-slate-100 p-4 sm:p-6 dark:bg-slate-950">
          {mediaLoading ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 text-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {(item.chunks?.length || 0) > 1
                  ? `Menggabungkan ${item.chunks.length} bagian file untuk pratinjau...`
                  : 'Memuat pratinjau...'}
              </p>
            </div>
          ) : requiresLargeAuth ? (
            <div className="mx-auto flex max-w-md flex-col items-center rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
              <FileIcon type="file" mimeType={item.mimeType} filename={item.name} size="lg" />
              <p className="mt-4 text-sm font-semibold text-slate-900 dark:text-slate-100">
                File berukuran besar ({formatBytes(item.size)} · {item.chunks.length} bagian)
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {canPreviewLargeFormat
                  ? 'Pratinjau akan mengunduh dan menggabungkan bagian file ke memori browser.'
                  : 'File di atas 120 MB disarankan langsung diunduh agar memori browser tetap ringan.'}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {canPreviewLargeFormat && (
                  <button
                    type="button"
                    onClick={() => setLargeAuthId(item.id)}
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    Muat Pratinjau
                  </button>
                )}
                {onDownloadItem && (
                  <button
                    type="button"
                    onClick={() => onDownloadItem(item)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Unduh File</span>
                  </button>
                )}
              </div>
            </div>
          ) : category === 'image' && mediaUrl && !previewError ? (
            <div className="flex min-h-[300px] items-center justify-center overflow-auto">
              <img
                src={mediaUrl}
                alt={item.name}
                referrerPolicy="no-referrer"
                style={{
                  transform: `scale(${zoom}) rotate(${rotation}deg)`,
                  transition: 'transform 160ms ease',
                }}
                onError={() => {
                  const hasProxy = Boolean(normalizeCorsProxyUrl(tgConfig.corsProxyUrl));
                  setCorsBlocked(!hasProxy);
                  setPreviewError(
                    hasProxy
                      ? 'Gagal memuat gambar melalui proxy. Periksa URL Cloudflare Worker atau koneksi Telegram.'
                      : 'Gambar tidak dapat dimuat langsung oleh browser. Aktifkan Proxy Cloudflare Worker di Pengaturan Telegram.',
                  );
                }}
                className="max-h-[60vh] origin-center rounded-lg object-contain shadow-sm"
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
                    : item.size > DIRECT_TELEGRAM_MAX_BYTES && (item.chunks?.length || 0) <= 1
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
