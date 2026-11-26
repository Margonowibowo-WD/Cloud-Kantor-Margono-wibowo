import { useEffect, useRef, useState } from 'react';
import {
  Eye,
  FolderOpen,
  GripVertical,
  Music,
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

interface RightPreviewPaneProps {
  open: boolean;
  width: number;
  onWidthChange: (nextWidth: number) => void;
  onClose: () => void;
  selectedItems: DriveItem[];
  allItems: DriveItem[];
  tgConfig: TelegramConfigState;
  onOpenFolder: (folder: DriveItem) => void;
  onOpenTelegramSettings?: () => void;
  onHydrateStub?: (item: DriveItem) => void;
}

const MIN_WIDTH = 280;
const MAX_WIDTH = 740;

export function RightPreviewPane({
  open,
  width,
  onWidthChange,
  onClose,
  selectedItems,
  allItems,
  tgConfig,
  onOpenFolder,
  onOpenTelegramSettings,
  onHydrateStub,
}: RightPreviewPaneProps) {
  const [isDesktop, setIsDesktop] = useState<boolean>(
    () => typeof window === 'undefined' || window.matchMedia('(min-width: 1024px)').matches,
  );
  const [isResizing, setIsResizing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [officeBuffer, setOfficeBuffer] = useState<ArrayBuffer | null>(null);
  const [pdfBuffer, setPdfBuffer] = useState<ArrayBuffer | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [corsBlocked, setCorsBlocked] = useState(false);
  const onHydrateStubRef = useRef(onHydrateStub);
  onHydrateStubRef.current = onHydrateStub;

  const singleItem = selectedItems.length === 1 ? selectedItems[0] : null;
  const singleFile = singleItem?.type === 'file' ? singleItem : null;

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setIsDesktop(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const onMouseMove = (e: MouseEvent) => {
      const maxAllowed = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - 340));
      const next = Math.round(Math.max(MIN_WIDTH, Math.min(maxAllowed, window.innerWidth - e.clientX)));
      onWidthChange(next);
    };

    const onMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isResizing, onWidthChange]);

  useEffect(() => {
    if (!open || !singleFile) {
      setMediaUrl(null);
      setTextContent(null);
      setOfficeBuffer(null);
      setPdfBuffer(null);
      setPreviewError(null);
      setCorsBlocked(false);
      setLoading(false);
      return;
    }

    let active = true;
    let revokeUrl: string | null = null;
    let stubTimer: number | null = null;

    setMediaUrl(null);
    setTextContent(null);
    setOfficeBuffer(null);
    setPdfBuffer(null);
    setPreviewError(null);
    setCorsBlocked(false);

    const load = async () => {
      if (singleFile.isCatalogStub) {
        setLoading(true);
        onHydrateStubRef.current?.(singleFile);
        stubTimer = window.setTimeout(() => {
          if (!active) return;
          setLoading(false);
          setPreviewError(
            'Metadata file belum termuat dari Telegram. Pastikan Proxy Cloudflare Worker aktif dan coba Sinkronkan ulang.',
          );
        }, 12000);
        return;
      }
      if (singleFile.size > DIRECT_TELEGRAM_MAX_BYTES && !singleFile.localBlobKey) {
        return;
      }

      const officeType = getOfficePreviewType(singleFile.mimeType, singleFile.name);
      const textable = isTextPreviewable(singleFile.mimeType, singleFile.name);
      const pdf = isPdfFile(singleFile.mimeType, singleFile.name);
      const category = getFileCategory(singleFile.mimeType, singleFile.name);

      if (pdf) {
        setLoading(true);
        try {
          const buf = await resolveItemArrayBuffer(singleFile, tgConfig);
          if (active) setPdfBuffer(buf);
        } catch (err) {
          if (active) {
            setCorsBlocked(err instanceof PreviewCorsBlockedError);
            setPreviewError(err instanceof Error ? err.message : 'Gagal memuat pratinjau PDF.');
          }
        } finally {
          if (active) setLoading(false);
        }
        return;
      }

      if (officeType && officeType !== 'legacy-office') {
        setLoading(true);
        try {
          const buf = await resolveItemArrayBuffer(singleFile, tgConfig);
          if (active) setOfficeBuffer(buf);
        } catch (err) {
          if (active) {
            setCorsBlocked(err instanceof PreviewCorsBlockedError);
            setPreviewError(err instanceof Error ? err.message : 'Gagal memuat pratinjau Office.');
          }
        } finally {
          if (active) setLoading(false);
        }
        return;
      }

      if (textable && singleFile.size <= 2 * 1024 * 1024) {
        setLoading(true);
        try {
          const text = await resolveItemTextContent(singleFile, tgConfig);
          if (active) setTextContent(text);
        } catch (err) {
          if (active) {
            setCorsBlocked(err instanceof PreviewCorsBlockedError);
            setPreviewError(err instanceof Error ? err.message : 'Gagal memuat pratinjau teks.');
          }
        } finally {
          if (active) setLoading(false);
        }
        return;
      }

      if (category === 'image' || category === 'video' || category === 'audio') {
        setLoading(true);
        try {
          const resolved = await resolveItemPlayableUrl(singleFile, tgConfig);
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
          if (active) setLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
      if (stubTimer !== null) window.clearTimeout(stubTimer);
      if (revokeUrl) {
        const urlToRevoke = revokeUrl;
        window.setTimeout(() => URL.revokeObjectURL(urlToRevoke), 600);
      }
    };
  }, [open, singleFile, tgConfig]);

  if (!open) return null;

  const renderContent = () => {
    if (selectedItems.length === 0) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
            <Eye className="h-6 w-6" />
          </div>
          <p className="mt-4 font-display text-sm font-semibold text-slate-800 dark:text-slate-200">
            Panel Pratinjau Dinamis
          </p>
          <p className="mt-1.5 max-w-[230px] text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Klik file mana saja untuk melihat pratinjau langsung (PDF, Foto, Video, Musik, Dokumen). Seret tepi kiri panel untuk mengatur ukuran.
          </p>
        </div>
      );
    }

    if (selectedItems.length > 1) {
      const totalSize = selectedItems.reduce((acc, i) => acc + (i.type === 'file' ? i.size : 0), 0);
      const fileCount = selectedItems.filter((i) => i.type === 'file').length;
      const folderCount = selectedItems.length - fileCount;

      return (
        <div className="flex flex-1 flex-col p-5">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-center dark:border-slate-800 dark:bg-slate-900/60">
            <p className="font-display text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {selectedItems.length} Item Dipilih
            </p>
            <p className="mt-1 text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {folderCount > 0 ? `${folderCount} folder` : ''}
              {folderCount > 0 && fileCount > 0 ? ' · ' : ''}
              {fileCount > 0 ? `${fileCount} file (${formatBytes(totalSize)})` : ''}
            </p>
          </div>
        </div>
      );
    }

    if (singleItem && singleItem.type === 'folder') {
      const childCount = allItems.filter((i) => !i.trashed && i.parentId === singleItem.id).length;
      return (
        <div className="flex flex-1 flex-col justify-between p-5">
          <div className="flex flex-col items-center rounded-2xl border border-amber-200/80 bg-amber-50/60 p-6 text-center dark:border-amber-900/50 dark:bg-amber-950/20">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 ring-1 ring-amber-200 dark:bg-amber-950/80 dark:ring-amber-800">
              <FileIcon type="folder" mimeType={singleItem.mimeType} filename={singleItem.name} size="lg" />
            </div>
            <h3 className="mt-3 font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              {singleItem.name}
            </h3>
            <p className="mt-1 text-xs tabular-nums text-slate-500 dark:text-slate-400">
              Folder · {childCount > 0 ? `${childCount} item di dalam` : 'Kosong'} · {formatRelativeDateId(singleItem.updatedAt)}
            </p>
            <button
              type="button"
              onClick={() => onOpenFolder(singleItem)}
              className="td-press mt-4 inline-flex h-9 items-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span>Buka Folder</span>
            </button>
          </div>
        </div>
      );
    }

    if (!singleFile) return null;

    const category = getFileCategory(singleFile.mimeType, singleFile.name);
    const pdfFile = isPdfFile(singleFile.mimeType, singleFile.name);
    const officeType = getOfficePreviewType(singleFile.mimeType, singleFile.name);

    const isFullBleedDoc =
      !loading &&
      !previewError &&
      Boolean(
        (officeType && officeType !== 'legacy-office' && officeBuffer) ||
          (pdfFile && pdfBuffer) ||
          (isTextPreviewable(singleFile.mimeType, singleFile.name) && textContent !== null),
      );

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Live Preview Canvas */}
        <div
          className={`flex min-h-[240px] flex-1 bg-slate-100 p-3 dark:bg-slate-950 ${
            isFullBleedDoc
              ? 'flex-col overflow-hidden'
              : 'items-center justify-center overflow-auto'
          }`}
        >
          {loading ? (
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              <p className="text-xs text-slate-500 dark:text-slate-400">Memuat pratinjau...</p>
            </div>
          ) : officeType && officeType !== 'legacy-office' && officeBuffer ? (
            <OfficePreview
              officeType={officeType}
              buffer={officeBuffer}
              filename={singleFile.name}
            />
          ) : pdfFile && pdfBuffer ? (
            <PdfCanvasPreview buffer={pdfBuffer} filename={singleFile.name} />
          ) : category === 'image' && mediaUrl && !previewError ? (
            <img
              src={mediaUrl}
              alt={singleFile.name}
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
              className="max-h-full max-w-full rounded-xl object-contain shadow-sm"
            />
          ) : category === 'video' && mediaUrl && !previewError ? (
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
              className="max-h-full w-full rounded-xl bg-black"
            />
          ) : category === 'audio' && mediaUrl && !previewError ? (
            <div className="flex w-full max-w-xs flex-col items-center gap-4 rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xs dark:border-slate-800 dark:bg-slate-900">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
                <Music className="h-7 w-7" />
              </div>
              <p className="w-full truncate text-xs font-semibold text-slate-800 dark:text-slate-200">
                {singleFile.name}
              </p>
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
          ) : isTextPreviewable(singleFile.mimeType, singleFile.name) && textContent !== null ? (
            <div className="h-full w-full overflow-auto rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-800 dark:text-slate-200">
                {textContent}
              </pre>
            </div>
          ) : (
            <div className="flex max-w-xs flex-col items-center rounded-2xl border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
              <FileIcon
                type="file"
                mimeType={singleFile.mimeType}
                filename={singleFile.name}
                size="lg"
              />
              <p className="mt-3 text-xs font-semibold text-slate-900 dark:text-slate-100">
                {previewError
                  ? previewError
                  : officeType === 'legacy-office'
                    ? 'Format Office lama (.doc/.ppt) belum didukung pratinjau langsung. Gunakan .docx atau .pptx.'
                    : singleFile.size > DIRECT_TELEGRAM_MAX_BYTES
                      ? 'File > 20 MB tersimpan di Telegram'
                      : 'Pratinjau langsung tidak tersedia'}
              </p>
              <p className="mt-1 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                {formatBytes(singleFile.size)} · {singleFile.mimeType}
              </p>
              {corsBlocked && onOpenTelegramSettings && (
                <button
                  type="button"
                  onClick={onOpenTelegramSettings}
                  className="mt-3 inline-flex h-8 items-center justify-center rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  Aktifkan Proxy Pratinjau (Gratis)
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const headerTitle = singleItem
    ? singleItem.name
    : selectedItems.length > 1
      ? `${selectedItems.length} item dipilih`
      : 'Pratinjau';

  return isDesktop ? (
    /* Desktop Docked Resizable Right Preview Pane */
    <aside
      aria-label="Panel pratinjau kanan"
      style={{ width }}
      className="td-animate-fade relative flex shrink-0 flex-col border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
    >
      {/* Drag-to-resize Left Edge Handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Ubah lebar panel pratinjau"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        onMouseDown={(e) => {
          e.preventDefault();
          setIsResizing(true);
        }}
        className={`group absolute bottom-0 left-0 top-0 z-20 flex w-2 -translate-x-1/2 cursor-col-resize items-center justify-center transition-colors ${
          isResizing ? 'bg-blue-500/30' : 'hover:bg-blue-500/20'
        }`}
      >
        <div
          className={`flex h-9 w-3.5 items-center justify-center rounded-full border shadow-2xs transition-colors ${
            isResizing
              ? 'border-blue-500 bg-blue-600 text-white'
              : 'border-slate-200 bg-white text-slate-400 opacity-0 group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-800'
          }`}
        >
          <GripVertical className="h-3 w-3" />
        </div>
      </div>

      {/* Pane Header */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 dark:border-slate-800">
        <div className="flex min-w-0 items-center gap-2">
          {singleItem && (
            <FileIcon
              type={singleItem.type}
              mimeType={singleItem.mimeType}
              filename={singleItem.name}
              size="sm"
            />
          )}
          <h2 className="truncate font-display text-xs font-bold text-slate-900 dark:text-slate-100">
            {headerTitle}
          </h2>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup panel pratinjau"
          className="td-press flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {renderContent()}
    </aside>
  ) : selectedItems.length > 0 ? (
    /* Mobile / Tablet Slide-over Preview Sheet */
    <div className="fixed inset-0 z-40 flex justify-end">
      <div
        className="td-animate-fade fixed inset-0 bg-slate-950/45 backdrop-blur-xs"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        aria-label="Panel pratinjau"
        className="td-animate-slide-right relative z-10 flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-2">
            {singleItem && (
              <FileIcon
                type={singleItem.type}
                mimeType={singleItem.mimeType}
                filename={singleItem.name}
                size="sm"
              />
            )}
            <h2 className="truncate font-display text-xs font-bold text-slate-900 dark:text-slate-100">
              {headerTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup panel pratinjau"
            className="td-press flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {renderContent()}
      </aside>
    </div>
  ) : null;
}
