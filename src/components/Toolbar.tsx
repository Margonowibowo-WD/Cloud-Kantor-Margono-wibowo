import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Download,
  PanelRight,
  RotateCcw,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import type { NavSection, SortDirection, SortField, TypeFilter } from '../types/drive';
import {
  type CapturedDropPayload,
  captureDropEntriesSync,
} from '../utils/dropUploadHelpers';
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
  visibleCount: number;
  selectedCount: number;
  allSelected: boolean;
  onToggleSelectAll: () => void;
  onClearSelection: () => void;
  onBulkDownload: () => void;
  onBulkStar: () => void;
  onBulkCopy: () => void;
  onBulkTrash: () => void;
  onBulkRestore: () => void;
  onBulkDeletePermanent: () => void;
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
  documents: 'Dokumen & Arsip',
  trash: 'Sampah',
};

const TYPE_FILTERS: Array<{ id: TypeFilter; label: string }> = [
  { id: 'all', label: 'Semua' },
  { id: 'image', label: 'Foto' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Musik' },
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
  visibleCount,
  selectedCount,
  allSelected,
  onToggleSelectAll,
  onClearSelection,
  onBulkDownload,
  onBulkStar,
  onBulkCopy,
  onBulkTrash,
  onBulkRestore,
  onBulkDeletePermanent,
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

        {/* Contextual Bulk Action Bar OR Filter, Paste & Sort */}
        {selectedCount > 0 ? (
          <div className="td-animate-pop flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 dark:border-blue-900/70 dark:bg-blue-950/50">
            <span className="text-xs font-semibold tabular-nums text-blue-800 whitespace-nowrap dark:text-blue-200">
              {selectedCount} dipilih
            </span>
            {!allSelected && visibleCount > 0 && (
              <button
                type="button"
                onClick={onToggleSelectAll}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-blue-700 hover:bg-white dark:text-blue-300 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <CheckSquare className="h-3.5 w-3.5" />
                <span>Pilih Semua</span>
              </button>
            )}
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
                  onClick={onBulkCopy}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-white dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>Salin</span>
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
            {/* Select All button visible across Grid & Table views */}
            {visibleCount > 0 && (
              <button
                type="button"
                onClick={onToggleSelectAll}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
              >
                <CheckSquare className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                <span>{allSelected ? 'Batalkan Pilih' : 'Pilih Semua'}</span>
              </button>
            )}

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
        )}
      </div>
    </div>
  );
}
