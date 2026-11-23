import { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfCanvasPreviewProps {
  src?: string | null;
  buffer?: ArrayBuffer | null;
  filename: string;
  maxInitialPages?: number;
}

interface RenderedPage {
  pageNumber: number;
  width: number;
  height: number;
  dataUrl: string;
}

export function PdfCanvasPreview({
  src,
  buffer,
  filename,
  maxInitialPages = 15,
}: PdfCanvasPreviewProps) {
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [renderedCount, setRenderedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pageLimit, setPageLimit] = useState(maxInitialPages);
  const loadingTaskRef = useRef<pdfjsLib.PDFDocumentLoadingTask | null>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const pagesRef = useRef<RenderedPage[]>([]);

  useEffect(() => {
    setPageLimit(maxInitialPages);
    setZoom(1);
  }, [src, buffer, maxInitialPages]);

  useEffect(() => {
    let active = true;
    pagesRef.current = [];
    setPages([]);
    setTotalPages(0);
    setRenderedCount(0);
    setLoading(true);
    setLoadingMore(false);
    setError(null);

    const loadPdfDocument = async () => {
      try {
        let rawBytes: Uint8Array;
        if (buffer) {
          rawBytes = new Uint8Array(buffer.slice(0));
        } else if (src) {
          const res = await fetch(src);
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const fetchedBuffer = await res.arrayBuffer();
          rawBytes = new Uint8Array(fetchedBuffer);
        } else {
          throw new Error('Data PDF tidak tersedia.');
        }

        if (rawBytes.byteLength === 0) {
          throw new Error('File PDF kosong.');
        }

        const loadingTask = pdfjsLib.getDocument({
          data: rawBytes,
        });
        loadingTaskRef.current = loadingTask;
        const pdf = await loadingTask.promise;
        if (!active) {
          void loadingTask.destroy();
          return;
        }
        pdfDocRef.current = pdf;
        setTotalPages(pdf.numPages);

        const targetCount = Math.min(pdf.numPages, maxInitialPages);
        const renderScale = Math.min(2, window.devicePixelRatio || 1.5);

        for (let pageNum = 1; pageNum <= targetCount; pageNum += 1) {
          if (!active) return;
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1.35 * renderScale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;

          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          if (!active) return;

          const nextPage: RenderedPage = {
            pageNumber: pageNum,
            width: viewport.width,
            height: viewport.height,
            dataUrl: canvas.toDataURL('image/png'),
          };
          pagesRef.current = [...pagesRef.current, nextPage];
          setPages(pagesRef.current);
          setRenderedCount(pagesRef.current.length);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Gagal merender dokumen PDF.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadPdfDocument();

    return () => {
      active = false;
      pdfDocRef.current = null;
      if (loadingTaskRef.current) {
        void loadingTaskRef.current.destroy();
        loadingTaskRef.current = null;
      }
    };
  }, [src, buffer, maxInitialPages]);

  useEffect(() => {
    const pdf = pdfDocRef.current;
    if (!pdf || pageLimit <= pagesRef.current.length || pagesRef.current.length >= pdf.numPages) {
      return;
    }

    let active = true;
    setLoadingMore(true);

    const renderMore = async () => {
      try {
        const startPage = pagesRef.current.length + 1;
        const targetCount = Math.min(pdf.numPages, pageLimit);
        const renderScale = Math.min(2, window.devicePixelRatio || 1.5);

        for (let pageNum = startPage; pageNum <= targetCount; pageNum += 1) {
          if (!active) return;
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1.35 * renderScale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;

          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          if (!active) return;

          const nextPage: RenderedPage = {
            pageNumber: pageNum,
            width: viewport.width,
            height: viewport.height,
            dataUrl: canvas.toDataURL('image/png'),
          };
          pagesRef.current = [...pagesRef.current, nextPage];
          setPages(pagesRef.current);
          setRenderedCount(pagesRef.current.length);
        }
      } finally {
        if (active) setLoadingMore(false);
      }
    };

    void renderMore();
    return () => {
      active = false;
    };
  }, [pageLimit]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-rose-200 bg-rose-50/70 p-6 text-center dark:border-rose-900/60 dark:bg-rose-950/30">
        <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">
          Tidak dapat merender pratinjau PDF
        </p>
        <p className="mt-1 text-[11px] text-rose-600/80 dark:text-rose-400/80">{error}</p>
      </div>
    );
  }

  return (
    <div
      data-pdf-preview={filename}
      className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-200/70 dark:border-slate-800 dark:bg-slate-950"
    >
      {/* Compact PDF Toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-3 py-1.5 text-[11px] dark:border-slate-800 dark:bg-slate-900/95">
        <span className="font-medium tabular-nums text-slate-600 dark:text-slate-300">
          {totalPages > 0
            ? `${totalPages} halaman${renderedCount < totalPages ? ` (dimuat ${renderedCount})` : ''}`
            : 'Memuat PDF...'}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.6, Number((z - 0.15).toFixed(2))))}
            aria-label="Perkecil PDF"
            className="flex h-6 w-6 items-center justify-center rounded text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-10 text-center font-mono text-[10px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2.2, Number((z + 0.15).toFixed(2))))}
            aria-label="Perbesar PDF"
            className="flex h-6 w-6 items-center justify-center rounded text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Rendered PDF Pages Scroll Area */}
      <div className="flex-1 space-y-3 overflow-auto p-3">
        {pages.map((page) => (
          <div
            key={page.pageNumber}
            className="mx-auto overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200/80 dark:ring-slate-700"
            style={{ width: `${Math.round(zoom * 100)}%` }}
          >
            <img
              src={page.dataUrl}
              alt={`${filename} — Halaman ${page.pageNumber}`}
              className="block h-auto w-full select-none"
            />
          </div>
        ))}

        {(loading || loadingMore) && (
          <div className="flex items-center justify-center gap-2 py-4 text-xs text-slate-500 dark:text-slate-400">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <span>Merender halaman PDF...</span>
          </div>
        )}

        {!loading && !loadingMore && totalPages > renderedCount && (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={() => setPageLimit((n) => n + 15)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              Muat {Math.min(15, totalPages - renderedCount)} halaman berikutnya
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
