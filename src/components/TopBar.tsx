import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  LayoutGrid,
  List,
  Menu,
  Moon,
  RefreshCw,
  Search,
  Settings2,
  Sun,
  SunMoon,
  Upload,
  User,
  X,
} from 'lucide-react';
import type { TelegramPublicStatus, ViewMode } from '../types/drive';

export type ThemeMode = 'auto' | 'light' | 'dark';
export type CloudSyncState = 'syncing' | 'synced' | 'error' | 'disconnected';

interface TopBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  themeMode: ThemeMode;
  effectiveDark: boolean;
  onCycleThemeMode: () => void;
  onOpenMobileMenu: () => void;
  onQuickUploadClick: () => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  telegram: TelegramPublicStatus;
  syncingTelegram?: boolean;
  syncState?: CloudSyncState;
  vaultAvailable?: boolean;
  onSyncNow: () => void;
  onOpenTelegramModal: () => void;
  onOpenVaultUnlock?: () => void;
}

export function TopBar({
  searchQuery,
  onSearchChange,
  viewMode,
  onViewModeChange,
  themeMode,
  effectiveDark,
  onCycleThemeMode,
  onOpenMobileMenu,
  onQuickUploadClick,
  searchInputRef,
  telegram,
  syncingTelegram = false,
  syncState,
  vaultAvailable = false,
  onSyncNow,
  onOpenTelegramModal,
  onOpenVaultUnlock,
}: TopBarProps) {
  const localRef = useRef<HTMLInputElement>(null);
  const inputRef = searchInputRef ?? localRef;
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const effectiveSyncState: CloudSyncState =
    syncState ||
    (syncingTelegram ? 'syncing' : telegram.connected ? 'synced' : 'disconnected');

  const lastSyncedLabel = telegram.lastCheckedAt
    ? new Date(telegram.lastCheckedAt).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null;

  const syncTitle =
    effectiveSyncState === 'syncing'
      ? 'Sedang menyinkronkan dengan Cloud Telegram...'
      : effectiveSyncState === 'synced'
        ? `Tersinkron permanen (${telegram.botUsername ? `@${telegram.botUsername}` : 'Cloud Telegram'})${
            lastSyncedLabel ? ` · Terakhir: ${lastSyncedLabel}` : ''
          }. Klik untuk sinkronkan sekarang.`
        : effectiveSyncState === 'error'
          ? 'Sinkronisasi tertunda. Klik untuk sinkronkan ulang sekarang.'
          : 'Menghubungkan sinkronisasi Cloud...';

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 sm:gap-4 sm:px-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Buka menu navigasi"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="relative w-full max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            ref={inputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Cari file atau folder..."
            aria-label="Cari file atau folder"
            className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-8 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-blue-500 focus:bg-white focus:outline-none sm:h-10 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500 dark:focus:bg-slate-800"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Hapus pencarian"
              className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
        {/* Segmented View Switcher */}
        <div
          role="group"
          aria-label="Mode tampilan"
          className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800"
        >
          <button
            type="button"
            onClick={() => onViewModeChange('grid')}
            aria-label="Tampilan Grid"
            aria-pressed={viewMode === 'grid'}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
              viewMode === 'grid'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('list')}
            aria-label="Tampilan Daftar"
            aria-pressed={viewMode === 'list'}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
              viewMode === 'list'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <List className="h-4 w-4" />
          </button>
        </div>

        {/* Theme Mode Switch (Auto Siang/Malam -> Terang -> Gelap) */}
        <button
          type="button"
          onClick={onCycleThemeMode}
          aria-label={
            themeMode === 'auto'
              ? `Tema otomatis (${effectiveDark ? 'malam gelap' : 'siang terang'})`
              : themeMode === 'light'
                ? 'Tema terang aktif (klik untuk mode gelap)'
                : 'Tema gelap aktif (klik untuk mode otomatis)'
          }
          title={
            themeMode === 'auto'
              ? `Otomatis Siang/Malam (${effectiveDark ? 'Malam: Gelap' : 'Siang: Terang'})`
              : themeMode === 'light'
                ? 'Mode Terang'
                : 'Mode Gelap'
          }
          className="td-press flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          {themeMode === 'auto' ? (
            <SunMoon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          ) : themeMode === 'dark' ? (
            <Moon className="h-4 w-4" />
          ) : (
            <Sun className="h-4 w-4" />
          )}
        </button>

        {/* Quick Upload Primary Action */}
        <button
          type="button"
          onClick={onQuickUploadClick}
          className="td-press flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700 whitespace-nowrap shrink-0 sm:px-3.5"
        >
          <Upload className="h-4 w-4" />
          <span className="hidden sm:inline">Unggah Cepat</span>
        </button>

        {/* Permanent Top-Right Cloud Sync Indicator */}
        <button
          type="button"
          onClick={onSyncNow}
          disabled={effectiveSyncState === 'syncing'}
          title={syncTitle}
          aria-label={
            effectiveSyncState === 'syncing'
              ? 'Menyinkronkan Cloud'
              : effectiveSyncState === 'synced'
                ? 'Cloud Tersinkron'
                : 'Sinkronisasi Cloud tertunda'
          }
          className={`td-press flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors whitespace-nowrap disabled:opacity-80 ${
            effectiveSyncState === 'synced'
              ? 'border-emerald-200 bg-emerald-50/90 text-emerald-700 hover:bg-emerald-100/80 dark:border-emerald-900/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-950/80'
              : effectiveSyncState === 'syncing'
                ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/50 dark:text-blue-300'
                : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100/80 dark:border-amber-900/70 dark:bg-amber-950/50 dark:text-amber-300'
          }`}
        >
          {effectiveSyncState === 'syncing' ? (
            <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : effectiveSyncState === 'synced' ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          )}
          <span className="hidden md:inline">
            {effectiveSyncState === 'syncing'
              ? 'Menyinkronkan...'
              : effectiveSyncState === 'synced'
                ? 'Tersinkron'
                : 'Belum Sinkron'}
          </span>
        </button>

        {/* Profile Menu (Discreet Telegram Connection & Sync Controls) */}
        <div className="relative" ref={profileRef}>
          <button
            type="button"
            onClick={() => setProfileOpen((v) => !v)}
            aria-label="Profil Kantor Margono"
            aria-expanded={profileOpen}
            className="td-press flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-xs font-bold text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {telegram.connected ? 'KM' : <User className="h-4 w-4" />}
          </button>

          {profileOpen && (
            <div
              role="menu"
              aria-label="Menu profil dan koneksi"
              className="td-animate-pop absolute right-0 top-full z-40 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="border-b border-slate-100 px-2.5 py-2 dark:border-slate-800">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Cloud Kantor Margono
                </p>
                <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                  {telegram.connected
                    ? `Tersinkron permanen · @${telegram.botUsername || 'Bot'}`
                    : 'Menghubungkan otomatis...'}
                </p>
              </div>

              <div className="mt-1.5 space-y-1">
                {telegram.connected && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={syncingTelegram}
                    onClick={() => {
                      setProfileOpen(false);
                      onSyncNow();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${syncingTelegram ? 'animate-spin' : ''}`} />
                    <span>{syncingTelegram ? 'Menyinkronkan...' : 'Sinkronkan Sekarang'}</span>
                  </button>
                )}

                {!telegram.connected && vaultAvailable && onOpenVaultUnlock && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setProfileOpen(false);
                      onOpenVaultUnlock();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/50"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    <span>Buka Pakai PIN Brankas</span>
                  </button>
                )}

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setProfileOpen(false);
                    onOpenTelegramModal();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  <span>Pengaturan Koneksi</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
