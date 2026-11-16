import { useEffect, useRef, useState } from 'react';
import {
  Clock,
  Cloud,
  FileText,
  FolderPlus,
  HardDrive,
  Image,
  Plus,
  Send,
  Settings2,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { NavSection, StorageSummary, TelegramPublicStatus } from '../types/drive';
import { formatBytes } from '../utils/fileHelpers';

interface SidebarProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  onUploadFilesClick: () => void;
  onUploadFolderClick: () => void;
  onNewFolderClick: () => void;
  onOpenTelegramModal: () => void;
  summary: StorageSummary;
  telegram: TelegramPublicStatus;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: typeof HardDrive }> = [
  { id: 'my-drive', label: 'Drive Saya', icon: HardDrive },
  { id: 'recent', label: 'Terbaru', icon: Clock },
  { id: 'starred', label: 'Berbintang', icon: Star },
  { id: 'media', label: 'Foto & Video', icon: Image },
  { id: 'documents', label: 'Dokumen', icon: FileText },
  { id: 'trash', label: 'Sampah', icon: Trash2 },
];

export function Sidebar({
  activeSection,
  onSelectSection,
  onUploadFilesClick,
  onUploadFolderClick,
  onNewFolderClick,
  onOpenTelegramModal,
  summary,
  telegram,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const [newMenuOpen, setNewMenuOpen] = useState(false);
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
        {/* Brand Header */}
        <div className="mb-6 flex items-center justify-between px-2">
          <button
            type="button"
            onClick={() => {
              onSelectSection('my-drive');
              onCloseMobile();
            }}
            className="flex items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 rounded-lg"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
              <Send className="h-4 w-4 -translate-x-0.5 translate-y-0.5" />
            </div>
            <span className="font-display text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap dark:text-slate-100">
              TeleDrive
            </span>
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
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>Baru</span>
          </button>

          {newMenuOpen && (
            <div
              role="menu"
              className="absolute left-0 right-0 top-full z-30 mt-2 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-800 dark:bg-slate-900"
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
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectSection(item.id);
                  onCloseMobile();
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
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

      {/* Storage & Telegram Status Footer */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
          <span>Penyimpanan</span>
          <span className="font-semibold text-blue-600 dark:text-blue-400">Tanpa Batas</span>
        </div>

        <div className="mt-2 flex items-baseline justify-between">
          <span className="font-mono text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {formatBytes(summary.activeBytes)}
          </span>
          <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {summary.fileCount} file · {summary.folderCount} folder
          </span>
        </div>

        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div
            className="h-full rounded-full bg-blue-600 transition-all duration-300"
            style={{ width: summary.activeBytes > 0 ? '18%' : '4%' }}
          />
        </div>

        <div className="mt-3.5 border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-800 truncate dark:text-slate-200">
                {telegram.connected
                  ? `Telegram @${telegram.botUsername || 'Bot'}`
                  : 'Mode Lokal Cepat'}
              </div>
              <div className="text-xs text-slate-500 truncate dark:text-slate-400">
                {telegram.connected
                  ? telegram.chatTitle || `Chat ${telegram.chatId}`
                  : 'Hubungkan Bot untuk sync'}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              onOpenTelegramModal();
              onCloseMobile();
            }}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Settings2 className="h-3.5 w-3.5" />
            <span>{telegram.connected ? 'Pengaturan Telegram' : 'Hubungkan Telegram'}</span>
          </button>
        </div>
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
