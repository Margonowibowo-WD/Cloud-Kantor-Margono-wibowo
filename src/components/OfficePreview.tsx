import { useEffect, useState } from 'react';
import { FileSpreadsheet, FileText, Presentation } from 'lucide-react';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import type { OfficePreviewType } from '../utils/fileHelpers';

interface OfficePreviewProps {
  officeType: Exclude<OfficePreviewType, null | 'legacy-office'>;
  buffer: ArrayBuffer;
  filename: string;
}

interface ParsedSlide {
  slideNumber: number;
  title: string;
  paragraphs: string[];
  imageUrls: string[];
}

interface ParsedWorkbook {
  sheetNames: string[];
  sheets: Record<string, { rows: string[][]; totalRows: number; truncated: boolean }>;
}

function sanitizeDocxHtml(rawHtml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');
  const forbidden = doc.querySelectorAll('script, iframe, object, embed, link, meta, style');
  forbidden.forEach((el) => el.remove());

  const all = doc.body.querySelectorAll('*');
  all.forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const val = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
      } else if ((name === 'href' || name === 'src') && val.startsWith('javascript:')) {
        el.removeAttribute(attr.name);
      }
    }
  });

  return doc.body.innerHTML;
}

function parseWorkbookBuffer(buffer: ArrayBuffer): ParsedWorkbook {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheets: ParsedWorkbook['sheets'] = {};
  const maxRows = 400;
  const maxCols = 40;

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
    const totalRows = matrix.length;
    const truncated = totalRows > maxRows;
    const sliced = matrix.slice(0, maxRows).map((row) =>
      Array.isArray(row)
        ? row.slice(0, maxCols).map((cell) => (cell === null || cell === undefined ? '' : String(cell)))
        : [String(row ?? '')],
    );
    sheets[name] = { rows: sliced, totalRows, truncated };
  }

  return { sheetNames: wb.SheetNames, sheets };
}

function getMimeFromFilename(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

async function parsePptxBuffer(
  buffer: ArrayBuffer,
): Promise<{ slides: ParsedSlide[]; revokeUrls: string[] }> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .map((path) => {
      const match = /^ppt\/slides\/slide(\d+)\.xml$/i.exec(path);
      return match ? { path, num: Number(match[1]) } : null;
    })
    .filter((x): x is { path: string; num: number } => x !== null)
    .sort((a, b) => a.num - b.num);

  const parser = new DOMParser();
  const revokeUrls: string[] = [];
  const slides: ParsedSlide[] = [];

  for (const entry of slideFiles) {
    const xmlStr = await zip.files[entry.path].async('string');
    const xmlDoc = parser.parseFromString(xmlStr, 'application/xml');

    const pNodes = Array.from(xmlDoc.getElementsByTagNameNS('*', 'p'));
    const lines: string[] = [];
    for (const p of pNodes) {
      const tNodes = Array.from(p.getElementsByTagNameNS('*', 't'));
      const lineText = tNodes
        .map((t) => t.textContent || '')
        .join('')
        .trim();
      if (lineText) lines.push(lineText);
    }

    // Resolve embedded images referenced in slide rels
    const imageUrls: string[] = [];
    const relsPath = `ppt/slides/_rels/slide${entry.num}.xml.rels`;
    const relsFile = zip.files[relsPath];
    if (relsFile) {
      const relsXml = await relsFile.async('string');
      const relsDoc = parser.parseFromString(relsXml, 'application/xml');
      const relNodes = Array.from(relsDoc.getElementsByTagName('Relationship'));
      const seenTargets = new Set<string>();
      for (const rel of relNodes) {
        const target = rel.getAttribute('Target') || '';
        const typeAttr = rel.getAttribute('Type') || '';
        if (!typeAttr.includes('/image')) continue;
        const normalized = target.replace(/^(\.\.\/)+/, 'ppt/');
        const zipPath = normalized.startsWith('ppt/') ? normalized : `ppt/slides/${target}`;
        if (seenTargets.has(zipPath)) continue;
        seenTargets.add(zipPath);

        const mediaFile = zip.files[zipPath];
        if (mediaFile) {
          const mediaBytes = await mediaFile.async('uint8array');
          const copy = new Uint8Array(mediaBytes.byteLength);
          copy.set(mediaBytes);
          const blob = new Blob([copy.buffer], { type: getMimeFromFilename(zipPath) });
          const objUrl = URL.createObjectURL(blob);
          revokeUrls.push(objUrl);
          imageUrls.push(objUrl);
        }
      }
    }

    slides.push({
      slideNumber: entry.num,
      title: lines[0] || `Slide ${entry.num}`,
      paragraphs: lines.slice(1),
      imageUrls,
    });
  }

  return { slides, revokeUrls };
}

export function OfficePreview({ officeType, buffer, filename }: OfficePreviewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [slides, setSlides] = useState<ParsedSlide[]>([]);

  useEffect(() => {
    let active = true;
    let urlsToRevoke: string[] = [];

    setLoading(true);
    setError(null);
    setDocxHtml(null);
    setWorkbook(null);
    setSlides([]);

    const run = async () => {
      try {
        if (officeType === 'docx') {
          const res = await mammoth.convertToHtml({ arrayBuffer: buffer.slice(0) });
          if (!active) return;
          setDocxHtml(sanitizeDocxHtml(res.value || ''));
        } else if (officeType === 'excel') {
          const parsed = parseWorkbookBuffer(buffer.slice(0));
          if (!active) return;
          setWorkbook(parsed);
          setActiveSheet(parsed.sheetNames[0] || '');
        } else if (officeType === 'pptx') {
          const parsed = await parsePptxBuffer(buffer.slice(0));
          urlsToRevoke = parsed.revokeUrls;
          if (!active) {
            urlsToRevoke.forEach((u) => URL.revokeObjectURL(u));
            return;
          }
          setSlides(parsed.slides);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Gagal membaca isi dokumen Office.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void run();

    return () => {
      active = false;
      if (urlsToRevoke.length > 0) {
        const list = [...urlsToRevoke];
        window.setTimeout(() => list.forEach((u) => URL.revokeObjectURL(u)), 500);
      }
    };
  }, [officeType, buffer]);

  if (loading) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 py-12 text-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Memproses pratinjau {filename}...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-6 text-center dark:border-rose-900/60 dark:bg-rose-950/30">
        <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">
          Tidak dapat membuka pratinjau dokumen
        </p>
        <p className="mt-1 text-[11px] text-rose-600/80 dark:text-rose-400/80">{error}</p>
      </div>
    );
  }

  if (officeType === 'docx' && docxHtml !== null) {
    return (
      <div
        data-office-preview="docx"
        className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-blue-700 dark:border-slate-800 dark:bg-slate-800/70 dark:text-blue-400">
          <FileText className="h-3.5 w-3.5" />
          <span>Dokumen Word (.docx)</span>
        </div>
        <div className="flex-1 overflow-auto p-4 sm:p-5">
          {docxHtml.trim() ? (
            <div
              className="prose-sm max-w-none text-xs leading-relaxed text-slate-800 dark:text-slate-200 [&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-bold [&_h2]:mb-1.5 [&_h2]:mt-2.5 [&_h2]:text-sm [&_h2]:font-bold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-xs [&_h3]:font-bold [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-300 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:px-2 [&_th]:py-1 [&_th]:font-semibold [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 dark:[&_td]:border-slate-700 dark:[&_th]:border-slate-700 dark:[&_th]:bg-slate-800"
              dangerouslySetInnerHTML={{ __html: docxHtml }}
            />
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Dokumen tidak memiliki teks yang dapat ditampilkan.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (officeType === 'excel' && workbook) {
    const current = workbook.sheets[activeSheet] || { rows: [], totalRows: 0, truncated: false };
    const colCount = current.rows.reduce((max, r) => Math.max(max, r.length), 0);

    return (
      <div
        data-office-preview="excel"
        className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-800 dark:bg-slate-800/70">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>Spreadsheet ({current.totalRows} baris)</span>
          </span>

          {workbook.sheetNames.length > 1 && (
            <div className="flex flex-wrap items-center gap-1">
              {workbook.sheetNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setActiveSheet(name)}
                  className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    activeSheet === name
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto">
          {current.rows.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
              Sheet ini kosong.
            </p>
          ) : (
            <table className="w-full border-collapse text-left font-mono text-[11px] tabular-nums">
              <tbody>
                {current.rows.map((row, rIdx) => (
                  <tr
                    key={rIdx}
                    className={
                      rIdx === 0
                        ? 'bg-slate-100/90 font-semibold text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                        : 'border-t border-slate-100 text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/40'
                    }
                  >
                    <td className="w-8 select-none border-r border-slate-200 bg-slate-50 px-2 py-1 text-center text-[10px] text-slate-400 dark:border-slate-800 dark:bg-slate-900">
                      {rIdx + 1}
                    </td>
                    {Array.from({ length: Math.max(1, colCount) }).map((_, cIdx) => (
                      <td
                        key={cIdx}
                        className="max-w-[220px] truncate border-r border-slate-100 px-2.5 py-1 dark:border-slate-800"
                        title={row[cIdx] ?? ''}
                      >
                        {row[cIdx] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {current.truncated && (
            <p className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-center text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              Menampilkan 400 baris pertama dari {current.totalRows} baris. Unduh file untuk melihat seluruh data.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (officeType === 'pptx') {
    return (
      <div
        data-office-preview="pptx"
        className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-950"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-orange-700 dark:border-slate-800 dark:bg-slate-900 dark:text-orange-400">
          <span className="inline-flex items-center gap-1.5">
            <Presentation className="h-3.5 w-3.5" />
            <span>Presentasi (.pptx)</span>
          </span>
          <span className="tabular-nums text-slate-500 dark:text-slate-400">
            {slides.length} slide
          </span>
        </div>

        <div className="flex-1 space-y-3 overflow-auto p-3">
          {slides.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              Tidak ditemukan slide di dalam file ini.
            </p>
          ) : (
            slides.map((slide) => (
              <div
                key={slide.slideNumber}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="mb-2 flex items-center justify-between border-b border-slate-100 pb-1.5 dark:border-slate-800">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-orange-600 dark:text-orange-400">
                    Slide {slide.slideNumber}
                  </span>
                </div>
                <h4 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  {slide.title}
                </h4>
                {slide.paragraphs.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                    {slide.paragraphs.map((line, idx) => (
                      <li key={idx}>{line}</li>
                    ))}
                  </ul>
                )}
                {slide.imageUrls.length > 0 && (
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {slide.imageUrls.map((url, idx) => (
                      <img
                        key={idx}
                        src={url}
                        alt={`Slide ${slide.slideNumber} gambar ${idx + 1}`}
                        className="max-h-48 w-full rounded-lg border border-slate-100 object-contain bg-slate-50 dark:border-slate-800 dark:bg-slate-950"
                      />
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  return null;
}
