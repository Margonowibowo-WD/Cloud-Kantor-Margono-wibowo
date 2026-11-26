import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  Clock,
  Cloud,
  FileText,
  Files,
  Film,
  FolderPlus,
  HardDrive,
  Image,
  Music,
  Plus,
  SearchCheck,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { NavSection, StorageSummary } from '../types/drive';
import {
  type CapturedDropPayload,
  captureDropEntriesSync,
} from '../utils/dropUploadHelpers';
import { formatBytes } from '../utils/fileHelpers';

interface SidebarProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  onUploadFilesClick: () => void;
  onUploadFolderClick: () => void;
  onNewFolderClick: () => void;
  summary: StorageSummary;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  canDropOnRoot?: boolean;
  onDropOnRoot?: (ids: string[]) => void;
  onDropExternalFilesToRoot?: (payload: CapturedDropPayload) => void;
  onOpenDuplicateFinder?: () => void;
}

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: typeof HardDrive }> = [
  { id: 'my-drive', label: 'Drive Saya', icon: HardDrive },
  { id: 'recent', label: 'Terbaru', icon: Clock },
  { id: 'starred', label: 'Berbintang', icon: Star },
  { id: 'photos', label: 'Foto', icon: Image },
  { id: 'videos', label: 'Video', icon: Film },
  { id: 'music', label: 'Musik', icon: Music },
  { id: 'documents', label: 'Dokumen', icon: FileText },
  { id: 'archives', label: 'Arsip', icon: Archive },
  { id: 'others', label: 'File Lainnya', icon: Files },
  { id: 'trash', label: 'Sampah', icon: Trash2 },
];

export function Sidebar({
  activeSection,
  onSelectSection,
  onUploadFilesClick,
  onUploadFolderClick,
  onNewFolderClick,
  summary,
  mobileOpen,
  onCloseMobile,
  canDropOnRoot = false,
  onDropOnRoot,
  onDropExternalFilesToRoot,
  onOpenDuplicateFinder,
}: SidebarProps) {
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [rootDragOver, setRootDragOver] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setNewMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const content = (
    <div className="flex h-full flex-col justify-between overflow-y-auto bg-slate-50 px-4 py-5 dark:bg-slate-950">
      <div>
        {/* Modern Executive Brand Header */}
        <div className="mb-6 flex items-center justify-between gap-2 px-0.5">
          <button
            type="button"
            onClick={() => {
              onSelectSection('my-drive');
              onCloseMobile();
            }}
            className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-900 via-blue-700 to-cyan-500 text-white shadow-md shadow-blue-600/20 ring-1 ring-white/20 transition-transform duration-150 group-hover:scale-[1.03] dark:from-blue-600 dark:via-indigo-600 dark:to-cyan-500">
              <svg
                viewBox="0 0 28 28"
                fill="none"
                aria-hidden="true"
                className="h-6 w-6"
              >
                <path
                  d="M14 3.5 23.5 9v10L14 24.5 4.5 19V9L14 3.5Z"
                  fill="currentColor"
                  fillOpacity="0.16"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <path
                  d="M20.2 10.2 9.4 14.3l3.6 1.6 1.5 3.8 5.7-9.5Z"
                  fill="currentColor"
                />
                <path
                  d="m13 15.9 7.2-5.7"
                  stroke="#0f172a"
                  strokeOpacity="0.28"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-display text-[22px] font-extrabold leading-none tracking-[-0.035em] whitespace-nowrap text-slate-950 dark:text-white">
                Tele
                <span className="bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent dark:from-blue-400 dark:to-cyan-300">
                  Drive
                </span>
              </div>
              <div className="mt-1.5 font-display text-[12.5px] font-bold tracking-[0.03em] whitespace-nowrap text-slate-700 dark:text-slate-200">
                Kantor Margono
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Tutup menu samping"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200/70 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* + Baru CTA with Dropdown */}
        <div className="relative mb-5" ref={menuRef}>
          <button
            type="button"
            onClick={() => setNewMenuOpen((v) => !v)}
            aria-expanded={newMenuOpen}
            className="td-press flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>Baru</span>
          </button>

          {newMenuOpen && (
            <div
              role="menu"
              className="td-animate-pop absolute left-0 right-0 top-full z-30 mt-2 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-800 dark:bg-slate-900"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setNewMenuOpen(false);
                  onNewFolderClick();
                  onCloseMobile();
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <FolderPlus className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                <span>Folder Baru</span>
              </button>
              <div className="my-1 h-px bg-slate-100 dark:bg-slate-800" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setNewMenuOpen(false);
                  onUploadFilesClick();
                  onCloseMobile();
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Upload className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span>Unggah File</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setNewMenuOpen(false);
                  onUploadFolderClick();
                  onCloseMobile();
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Cloud className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                <span>Unggah Folder</span>
              </button>
            </div>
          )}
        </div>

        {/* Navigation Links */}
        <nav aria-label="Navigasi penyimpanan" className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            const isRootDrop = item.id === 'my-drive' && Boolean(onDropOnRoot);

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectSection(item.id);
                  onCloseMobile();
                }}
                onDragOver={
                  isRootDrop
                    ? (e) => {
                        const isInternal =
                          canDropOnRoot && e.dataTransfer.types.includes('application/x-teledrive-ids');
                        const isExternal =
                          Boolean(onDropExternalFilesToRoot) &&
                          e.dataTransfer.types.includes('Files') &&
                          !e.dataTransfer.types.includes('application/x-teledrive-ids');
                        if (isInternal || isExternal) {
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = isInternal ? 'move' : 'copy';
                          setRootDragOver(true);
                        }
                      }
                    : undefined
                }
                onDragLeave={isRootDrop ? () => setRootDragOver(false) : undefined}
                onDrop={
                  isRootDrop
                    ? (e) => {
                        setRootDragOver(false);
                        const raw = e.dataTransfer.getData('application/x-teledrive-ids');
                        if (raw && onDropOnRoot) {
                          e.preventDefault();
                          e.stopPropagation();
                          try {
                            const ids = JSON.parse(raw) as string[];
                            if (Array.isArray(ids) && ids.length > 0) {
                              onDropOnRoot(ids);
                            }
                          } catch {
                            // ignore malformed drag payload
                          }
                          return;
                        }
                        if (
                          (e.dataTransfer.files?.length || e.dataTransfer.items?.length) &&
                          onDropExternalFilesToRoot
                        ) {
                          e.preventDefault();
                          e.stopPropagation();
                          onDropExternalFilesToRoot(captureDropEntriesSync(e.dataTransfer));
                        }
                      }
                    : undefined
                }
                className={`td-press flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap ${
                  rootDragOver && isRootDrop
                    ? 'bg-blue-100 text-blue-800 ring-2 ring-blue-500 dark:bg-blue-950 dark:text-blue-200'
                    : active
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                      : 'text-slate-700 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800/70'
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    active ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'
                  }`}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {onOpenDuplicateFinder && (
          <div className="mt-3 border-t border-slate-200/80 pt-3 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                onOpenDuplicateFinder();
                onCloseMobile();
              }}
              className="td-press flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200/60 whitespace-nowrap dark:text-slate-300 dark:hover:bg-slate-800/70"
            >
              <SearchCheck className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>Cari Duplikat</span>
            </button>
          </div>
        )}
      </div>

      {/* Detailed Multi-Color Cloud Storage Summary Card */}
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/70 dark:text-blue-400">
              <Cloud className="h-3.5 w-3.5" />
            </div>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              Penyimpanan
            </span>
          </div>
          <span className="text-[11px] font-semibold text-blue-600 whitespace-nowrap dark:text-blue-400">
            Tanpa Batas
          </span>
        </div>

        <div className="mt-3 flex items-baseline justify-between gap-2">
          <span className="font-display text-xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
            {formatBytes(summary.totalBytes)}
          </span>
          <span className="text-[11px] font-medium tabular-nums text-slate-500 whitespace-nowrap dark:text-slate-400">
            {summary.fileCount} file · {summary.folderCount} folder
          </span>
        </div>

        {(() => {
          const segments = [
            {
              key: 'image',
              label: 'Foto',
              bytes: summary.categories.image.bytes,
              count: summary.categories.image.count,
              colorClass: 'bg-sky-500',
            },
            {
              key: 'video',
              label: 'Video',
              bytes: summary.categories.video.bytes,
              count: summary.categories.video.count,
              colorClass: 'bg-indigo-500',
            },
            {
              key: 'document',
              label: 'Dokumen',
              bytes: summary.categories.document.bytes,
              count: summary.categories.document.count,
              colorClass: 'bg-emerald-500',
            },
            {
              key: 'audio',
              label: 'Musik',
              bytes: summary.categories.audio.bytes,
              count: summary.categories.audio.count,
              colorClass: 'bg-amber-500',
            },
            {
              key: 'other',
              label: 'Arsip & Lainnya',
              bytes: summary.categories.other.bytes,
              count: summary.categories.other.count,
              colorClass: 'bg-slate-400 dark:bg-slate-500',
            },
            {
              key: 'trash',
              label: 'Sampah',
              bytes: summary.trashedBytes,
              count: null as number | null,
              colorClass: 'bg-rose-500',
            },
          ];

          const grandTotal = summary.totalBytes;
          const nonZeroSegments = segments.filter((s) => s.bytes > 0);
          // Give small non-zero categories a minimum visual slice while normalizing to 100%
          const rawWeights = nonZeroSegments.map((s) =>
            grandTotal > 0 ? Math.max(4, (s.bytes / grandTotal) * 100) : 0,
          );
          const weightSum = rawWeights.reduce((acc, w) => acc + w, 0);

          return (
            <>
              <div
                aria-label="Rincian ukuran penyimpanan berdasarkan tipe file"
                className="mt-3 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100 p-0.5 dark:bg-slate-800"
              >
                {nonZeroSegments.map((seg, idx) => {
                  const widthPct = weightSum > 0 ? (rawWeights[idx] / weightSum) * 100 : 0;
                  return (
                    <div
                      key={seg.key}
                      title={`${seg.label}: ${formatBytes(seg.bytes)}`}
                      className={`h-full first:rounded-l-full last:rounded-r-full transition-all duration-300 ${seg.colorClass}`}
                      style={{ width: `${widthPct}%` }}
                    />
                  );
                })}
              </div>

              <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-2.5 text-[11px] dark:border-slate-800">
                {segments.map((seg) => (
                  <div key={seg.key} className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5 text-slate-600 dark:text-slate-300">
                      <span className={`h-2 w-2 shrink-0 rounded-xs ${seg.colorClass}`} />
                      <span className="truncate">{seg.label}</span>
                      {seg.count !== null && seg.count > 0 && (
                        <span className="shrink-0 tabular-nums text-[10px] text-slate-400 dark:text-slate-500">
                          ({seg.count})
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 font-mono font-medium tabular-nums text-slate-800 whitespace-nowrap dark:text-slate-200">
                      {formatBytes(seg.bytes)}
                    </span>
                  </div>
                ))}

                <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5 font-semibold dark:border-slate-800">
                  <span className="text-slate-700 dark:text-slate-200">Total</span>
                  <span className="font-mono tabular-nums text-slate-900 whitespace-nowrap dark:text-white">
                    {formatBytes(grandTotal)}
                  </span>
                </div>
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 lg:block dark:border-slate-800">
        {content}
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-72 max-w-[85vw] border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
            {content}
          </aside>
        </div>
      )}
    </>
  );
}
