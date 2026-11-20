import { useEffect, useRef, useState } from 'react';
import {
  Clock,
  Cloud,
  FileText,
  Film,
  FolderPlus,
  HardDrive,
  Image,
  Music,
  Plus,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { NavSection, StorageSummary } from '../types/drive';
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
  onDropExternalFilesToRoot?: (files: FileList) => void;
}

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: typeof HardDrive }> = [
  { id: 'my-drive', label: 'Drive Saya', icon: HardDrive },
  { id: 'recent', label: 'Terbaru', icon: Clock },
  { id: 'starred', label: 'Berbintang', icon: Star },
  { id: 'photos', label: 'Foto', icon: Image },
  { id: 'videos', label: 'Video', icon: Film },
  { id: 'music', label: 'Musik', icon: Music },
  { id: 'documents', label: 'Dokumen', icon: FileText },
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
    <div className="flex h-full flex-col justify-between bg-slate-50 px-4 py-5 dark:bg-slate-950">
      <div>
        {/* Modern Brand Header */}
        <div className="mb-6 flex items-center justify-between px-1">
          <button
            type="button"
            onClick={() => {
              onSelectSection('my-drive');
              onCloseMobile();
            }}
            className="group flex items-center gap-3 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 via-blue-600 to-indigo-600 text-white shadow-sm ring-1 ring-blue-700/20 transition-transform duration-150 group-hover:scale-[1.03]">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                className="h-5 w-5"
              >
                <path
                  d="M7.5 18.5h9.25a4.25 4.25 0 0 0 .56-8.46A5.5 5.5 0 0 0 6.57 8.9 3.75 3.75 0 0 0 7.5 18.5Z"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="m10 13.75 5.25-2.25-2 5.25-1.15-2-2.1-1Z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="font-display text-[18px] font-extrabold leading-none tracking-[-0.03em] whitespace-nowrap text-slate-900 dark:text-white">
                Tele<span className="text-blue-600 dark:text-blue-400">Drive</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.01em] text-slate-500 whitespace-nowrap dark:text-slate-400">
                <span>Kantor Margono</span>
                <span aria-hidden="true">·</span>
                <span className="text-slate-400 dark:text-slate-500">Cloud</span>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Tutup menu samping"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200/70 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800"
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
                        if (e.dataTransfer.files?.length && onDropExternalFilesToRoot) {
                          e.preventDefault();
                          e.stopPropagation();
                          onDropExternalFilesToRoot(e.dataTransfer.files);
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
      </div>

      {/* Modern Cloud Storage Summary Card */}
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/70 dark:text-blue-400">
              <Cloud className="h-3.5 w-3.5" />
            </div>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              Cloud Storage
            </span>
          </div>
          <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">
            Tanpa Batas
          </span>
        </div>

        <div className="mt-3 flex items-baseline justify-between gap-2">
          <span className="font-display text-xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
            {formatBytes(summary.activeBytes)}
          </span>
          <span className="text-[11px] font-medium tabular-nums text-slate-500 whitespace-nowrap dark:text-slate-400">
            {summary.fileCount} file · {summary.folderCount} folder
          </span>
        </div>

        {/* Cloud Telegram & Trash Segmented Bar */}
        {(() => {
          const cloudBytes = summary.activeBytes;
          const trashBytes = summary.trashedBytes;
          const totalUsed = cloudBytes + trashBytes;
          const cloudPct =
            totalUsed > 0 ? Math.max(cloudBytes > 0 ? 5 : 0, (cloudBytes / totalUsed) * 100) : 0;
          const trashPct =
            totalUsed > 0 ? Math.max(trashBytes > 0 ? 5 : 0, (trashBytes / totalUsed) * 100) : 0;

          return (
            <>
              <div
                aria-label="Distribusi penggunaan penyimpanan cloud"
                className="mt-3 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100 p-0.5 dark:bg-slate-800"
              >
                {cloudPct > 0 && (
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all duration-300"
                    style={{ width: `${cloudPct}%` }}
                  />
                )}
                {trashPct > 0 && (
                  <div
                    className="h-full rounded-full bg-amber-400 transition-all duration-300"
                    style={{ width: `${trashPct}%` }}
                  />
                )}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2.5 text-[11px] dark:border-slate-800">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
                    <span className="truncate">Cloud Telegram</span>
                  </div>
                  <p className="mt-0.5 truncate font-mono font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                    {formatBytes(cloudBytes)}
                  </p>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                    <span className="truncate">Sampah</span>
                  </div>
                  <p className="mt-0.5 truncate font-mono font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                    {formatBytes(trashBytes)}
                  </p>
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
