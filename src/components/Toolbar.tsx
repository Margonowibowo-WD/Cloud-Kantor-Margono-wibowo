import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Download,
  FolderInput,
  RotateCcw,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import type { NavSection, SortDirection, SortField, TypeFilter } from '../types/drive';
import type { BreadcrumbNode } from '../utils/fileHelpers';

interface ToolbarProps {
  section: NavSection;
  breadcrumbs: BreadcrumbNode[];
  onNavigateFolder: (folderId: string | null) => void;
  typeFilter: TypeFilter;
  onTypeFilterChange: (filter: TypeFilter) => void;
  sortField: SortField;
  sortDirection: SortDirection;
  onSortChange: (field: SortField) => void;
  selectedCount: number;
  onClearSelection: () => void;
  onBulkDownload: () => void;
  onBulkStar: () => void;
  onBulkMove: () => void;
  onBulkTrash: () => void;
  onBulkRestore: () => void;
  onBulkDeletePermanent: () => void;
  searchQuery: string;
}

const SECTION_TITLES: Record<NavSection, string> = {
  'my-drive': 'Drive Saya',
  recent: 'Terbaru',
  starred: 'Berbintang',
  media: 'Foto & Video',
  documents: 'Dokumen & Arsip',
  trash: 'Sampah',
};

const TYPE_FILTERS: Array<{ id: TypeFilter; label: string }> = [
  { id: 'all', label: 'Semua' },
  { id: 'image', label: 'Gambar' },
  { id: 'video', label: 'Video' },
  { id: 'document', label: 'Dokumen' },
  { id: 'archive', label: 'Arsip' },
];

export function Toolbar({
  section,
  breadcrumbs,
  onNavigateFolder,
  typeFilter,
  onTypeFilterChange,
  sortField,
  sortDirection,
  onSortChange,
  selectedCount,
  onClearSelection,
  onBulkDownload,
  onBulkStar,
  onBulkMove,
  onBulkTrash,
  onBulkRestore,
  onBulkDeletePermanent,
  searchQuery,
}: ToolbarProps) {
  const isTrash = section === 'trash';

  return (
    <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Breadcrumbs or Section Title */}
        {searchQuery.trim() ? (
          <h1 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
            Hasil pencarian: <span className="text-blue-600 dark:text-blue-400">{searchQuery}</span>
          </h1>
        ) : section === 'my-drive' ? (
          <nav aria-label="Jalur folder" className="flex min-w-0 flex-wrap items-center gap-1">
            {breadcrumbs.map((node, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <div key={node.id ?? 'root'} className="flex items-center gap-1">
                  {idx > 0 && (
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  )}
                  <button
                    type="button"
                    onClick={() => onNavigateFolder(node.id)}
                    className={`rounded-lg px-2 py-1 text-sm transition-colors whitespace-nowrap ${
                      isLast
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

        {/* Contextual Bulk Action Bar OR Filter & Sort */}
        {selectedCount > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 dark:border-blue-900/70 dark:bg-blue-950/50">
            <span className="text-xs font-semibold tabular-nums text-blue-800 whitespace-nowrap dark:text-blue-200">
              {selectedCount} dipilih
            </span>
            <div className="h-4 w-px bg-blue-200 dark:bg-blue-800" />

            {!isTrash ? (
              <>
                <button
                  type="button"
                  onClick={onBulkDownload}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-white dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Unduh</span>
                </button>
                <button
                  type="button"
                  onClick={onBulkStar}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-white dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  <Star className="h-3.5 w-3.5" />
                  <span>Bintang</span>
                </button>
                <button
                  type="button"
                  onClick={onBulkMove}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-white dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  <FolderInput className="h-3.5 w-3.5" />
                  <span>Pindah</span>
                </button>
                <button
                  type="button"
                  onClick={onBulkTrash}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100 dark:text-rose-300 dark:hover:bg-rose-950/70 whitespace-nowrap"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Buang</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onBulkRestore}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-white dark:text-blue-300 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Pulihkan</span>
                </button>
                <button
                  type="button"
                  onClick={onBulkDeletePermanent}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100 dark:text-rose-300 dark:hover:bg-rose-950/70 whitespace-nowrap"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Hapus Permanen</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onClearSelection}
              aria-label="Batalkan semua pilihan"
              className="ml-1 flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-white dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {/* Segmented Type Filter */}
            <div
              role="group"
              aria-label="Filter jenis file"
              className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
            >
              {TYPE_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => onTypeFilterChange(f.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    typeFilter === f.id
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

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
          </div>
        )}
      </div>
    </div>
  );
}
