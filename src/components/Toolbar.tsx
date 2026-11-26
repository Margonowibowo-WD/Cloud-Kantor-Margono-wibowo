import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ClipboardPaste,
  PanelRight,
  X,
} from 'lucide-react';
import type {
  NavSection,
  SearchScope,
  SearchSizeFilter,
  SortDirection,
  SortField,
  TypeFilter,
} from '../types/drive';
import {
  type CapturedDropPayload,
  captureDropEntriesSync,
} from '../utils/dropUploadHelpers';
import type { BreadcrumbNode } from '../utils/fileHelpers';

interface ToolbarProps {
  section: NavSection;
  breadcrumbs: BreadcrumbNode[];
  onNavigateFolder: (folderId: string | null) => void;
  sortField: SortField;
  sortDirection: SortDirection;
  onSortChange: (field: SortField) => void;
  typeFilter: TypeFilter;
  onTypeFilterChange: (filter: TypeFilter) => void;
  searchScope: SearchScope;
  onSearchScopeChange: (scope: SearchScope) => void;
  sizeFilter: SearchSizeFilter;
  onSizeFilterChange: (filter: SearchSizeFilter) => void;
  hasCurrentFolder: boolean;
  currentFolderName?: string;
  onResetSearchFilters?: () => void;
  clipboardCount: number;
  onPasteItems: () => void;
  onClearClipboard: () => void;
  onDropMoveToFolder: (ids: string[], targetFolderId: string | null) => void;
  onDropExternalFilesToFolder?: (payload: CapturedDropPayload, targetFolderId: string | null) => void;
  previewOpen?: boolean;
  onTogglePreviewPane?: () => void;
  searchQuery: string;
}

const SECTION_TITLES: Record<NavSection, string> = {
  'my-drive': 'Drive Saya',
  recent: 'Terbaru',
  starred: 'Berbintang',
  photos: 'Foto',
  videos: 'Video',
  music: 'Musik',
  documents: 'Dokumen',
  archives: 'Arsip',
  others: 'File Lainnya',
  trash: 'Sampah',
};

export function Toolbar({
  section,
  breadcrumbs,
  onNavigateFolder,
  sortField,
  sortDirection,
  onSortChange,
  typeFilter,
  onTypeFilterChange,
  searchScope,
  onSearchScopeChange,
  sizeFilter,
  onSizeFilterChange,
  hasCurrentFolder,
  currentFolderName,
  onResetSearchFilters,
  clipboardCount,
  onPasteItems,
  onClearClipboard,
  onDropMoveToFolder,
  onDropExternalFilesToFolder,
  previewOpen = false,
  onTogglePreviewPane,
  searchQuery,
}: ToolbarProps) {
  const isTrash = section === 'trash';
  const [dragOverCrumbKey, setDragOverCrumbKey] = useState<string | null>(null);
  const isSearching = Boolean(searchQuery.trim());
  const hasActiveSearchFilters =
    typeFilter !== 'all' || sizeFilter !== 'all' || searchScope !== 'all';

  return (
    <div className="flex flex-col gap-2.5 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Breadcrumbs or Section Title */}
        {isSearching ? (
          <h1 className="min-w-0 break-words font-display text-base font-semibold text-slate-900 sm:text-lg dark:text-slate-100">
            Hasil pencarian: <span className="break-all text-blue-600 dark:text-blue-400">{searchQuery}</span>
          </h1>
        ) : section === 'my-drive' ? (
          <nav aria-label="Jalur folder" className="flex min-w-0 flex-wrap items-center gap-1">
            {breadcrumbs.map((node, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              const crumbKey = node.id ?? 'root';
              const isDropHighlight = dragOverCrumbKey === crumbKey;
              return (
                <div key={crumbKey} className="flex items-center gap-1">
                  {idx > 0 && (
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  )}
                  <button
                    type="button"
                    onClick={() => onNavigateFolder(node.id)}
                    onDragOver={(e) => {
                      const isInternal = e.dataTransfer.types.includes('application/x-teledrive-ids');
                      const isExternal =
                        Boolean(onDropExternalFilesToFolder) &&
                        e.dataTransfer.types.includes('Files') &&
                        !isInternal;
                      if (isInternal || isExternal) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = isInternal ? 'move' : 'copy';
                        setDragOverCrumbKey(crumbKey);
                      }
                    }}
                    onDragLeave={() => setDragOverCrumbKey((k) => (k === crumbKey ? null : k))}
                    onDrop={(e) => {
                      setDragOverCrumbKey(null);
                      const raw = e.dataTransfer.getData('application/x-teledrive-ids');
                      if (raw) {
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                          const ids = JSON.parse(raw) as string[];
                          if (Array.isArray(ids) && ids.length > 0) {
                            onDropMoveToFolder(ids, node.id);
                          }
                        } catch {
                          // ignore invalid drag payload
                        }
                        return;
                      }
                      if (
                        (e.dataTransfer.files?.length || e.dataTransfer.items?.length) &&
                        onDropExternalFilesToFolder
                      ) {
                        e.preventDefault();
                        e.stopPropagation();
                        onDropExternalFilesToFolder(captureDropEntriesSync(e.dataTransfer), node.id);
                      }
                    }}
                    className={`rounded-lg px-2 py-1 text-sm transition-colors whitespace-nowrap ${
                      isDropHighlight
                        ? 'bg-blue-100 text-blue-800 ring-2 ring-blue-500 dark:bg-blue-950 dark:text-blue-200'
                        : isLast
                          ? 'font-display text-base font-semibold text-slate-900 dark:text-slate-100'
                          : 'font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                    }`}
                  >
                    {node.name}
                  </button>
                </div>
              );
            })}
          </nav>
        ) : (
          <h1 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
            {SECTION_TITLES[section]}
          </h1>
        )}

        {/* Paste, Filter & Sort Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Paste Action when clipboard has copied items */}
          {clipboardCount > 0 && !isTrash && (
              <div className="flex items-center overflow-hidden rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900/70 dark:bg-blue-950/50">
                <button
                  type="button"
                  onClick={onPasteItems}
                  className="inline-flex h-8 items-center gap-1.5 px-2.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900/60 whitespace-nowrap"
                >
                  <ClipboardPaste className="h-3.5 w-3.5" />
                  <span>Tempel ({clipboardCount})</span>
                </button>
                <button
                  type="button"
                  onClick={onClearClipboard}
                  aria-label="Bersihkan papan klip"
                  className="flex h-8 w-7 items-center justify-center border-l border-blue-200 text-blue-600 hover:bg-blue-100 dark:border-blue-900/70 dark:text-blue-300 dark:hover:bg-blue-900/60"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Type Filter */}
            <label htmlFor="type-filter-select" className="sr-only">
              Filter tipe file
            </label>
            <select
              id="type-filter-select"
              value={typeFilter}
              onChange={(e) => onTypeFilterChange(e.target.value as TypeFilter)}
              className={`h-8 rounded-lg border px-2 text-xs font-medium focus:outline-none ${
                typeFilter !== 'all'
                  ? 'border-blue-300 bg-blue-50/70 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300'
                  : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
              }`}
            >
              <option value="all" className="dark:bg-slate-900">Semua Tipe</option>
              <option value="folder" className="dark:bg-slate-900">Folder</option>
              <option value="document" className="dark:bg-slate-900">Dokumen</option>
              <option value="image" className="dark:bg-slate-900">Foto</option>
              <option value="video" className="dark:bg-slate-900">Video</option>
              <option value="audio" className="dark:bg-slate-900">Musik</option>
              <option value="archive" className="dark:bg-slate-900">Arsip</option>
              <option value="other" className="dark:bg-slate-900">Lainnya</option>
            </select>

            {/* Sort Control */}
            <div className="flex items-center rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
              <label htmlFor="sort-field-select" className="sr-only">
                Urutkan berdasarkan
              </label>
              <select
                id="sort-field-select"
                value={sortField}
                onChange={(e) => onSortChange(e.target.value as SortField)}
                className="h-8 rounded-l-lg bg-transparent pl-2.5 pr-1 text-xs font-medium text-slate-700 focus:outline-none dark:text-slate-200"
              >
                <option value="name" className="dark:bg-slate-900">Nama</option>
                <option value="updatedAt" className="dark:bg-slate-900">Diubah</option>
                <option value="size" className="dark:bg-slate-900">Ukuran</option>
                <option value="type" className="dark:bg-slate-900">Tipe File</option>
              </select>
              <button
                type="button"
                onClick={() => onSortChange(sortField)}
                aria-label={
                  sortDirection === 'asc' ? 'Urutkan menurun' : 'Urutkan menaik'
                }
                className="flex h-8 w-8 items-center justify-center border-l border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-700"
              >
                {sortDirection === 'asc' ? (
                  <ArrowUp className="h-3.5 w-3.5" />
                ) : (
                  <ArrowDown className="h-3.5 w-3.5" />
                )}
              </button>
            </div>

            {onTogglePreviewPane && (
              <button
                type="button"
                onClick={onTogglePreviewPane}
                aria-pressed={previewOpen}
                aria-label={previewOpen ? 'Tutup panel pratinjau kanan' : 'Buka panel pratinjau kanan'}
                title={previewOpen ? 'Sembunyikan Panel Pratinjau' : 'Tampilkan Panel Pratinjau'}
                className={`td-press flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                  previewOpen
                    ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                <PanelRight className="h-4 w-4" />
              </button>
            )}
        </div>
      </div>

      {/* Everything-style Advanced Search Filter Row (shown when actively searching) */}
      {isSearching && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 dark:border-slate-800/80">
          {hasCurrentFolder && (
            <div
              role="group"
              aria-label="Cakupan pencarian"
              className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800"
            >
              <button
                type="button"
                onClick={() => onSearchScopeChange('all')}
                aria-pressed={searchScope === 'all'}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  searchScope === 'all'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Semua Drive
              </button>
              <button
                type="button"
                onClick={() => onSearchScopeChange('folder')}
                aria-pressed={searchScope === 'folder'}
                title={`Cari hanya di dalam folder ${currentFolderName || 'ini'} dan subfoldernya`}
                className={`max-w-[180px] truncate rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  searchScope === 'folder'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Folder: {currentFolderName || 'Ini'}
              </button>
            </div>
          )}

          <label htmlFor="size-filter-select" className="sr-only">
            Filter ukuran file
          </label>
          <select
            id="size-filter-select"
            value={sizeFilter}
            onChange={(e) => onSizeFilterChange(e.target.value as SearchSizeFilter)}
            className={`h-7 rounded-lg border px-2 text-xs font-medium focus:outline-none ${
              sizeFilter !== 'all'
                ? 'border-blue-300 bg-blue-50/70 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300'
                : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
            }`}
          >
            <option value="all" className="dark:bg-slate-900">Semua Ukuran</option>
            <option value="small" className="dark:bg-slate-900">&lt; 1 MB</option>
            <option value="medium" className="dark:bg-slate-900">1–10 MB</option>
            <option value="large" className="dark:bg-slate-900">&gt; 10 MB</option>
          </select>

          {hasActiveSearchFilters && onResetSearchFilters && (
            <button
              type="button"
              onClick={onResetSearchFilters}
              className="inline-flex h-7 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <X className="h-3 w-3" />
              <span>Reset Filter</span>
            </button>
          )}

          <span className="ml-auto hidden text-[11px] text-slate-400 md:inline dark:text-slate-500">
            Tip: ketik <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">ext:pdf</code> atau beberapa kata
          </span>
        </div>
      )}
    </div>
  );
}
