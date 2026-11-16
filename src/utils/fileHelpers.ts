import type {
  DriveItem,
  FileCategory,
  NavSection,
  SortDirection,
  SortField,
  StorageSummary,
  TypeFilter,
} from '../types/drive';

export interface BreadcrumbNode {
  id: string | null;
  name: string;
}

export interface ByteSlice {
  index: number;
  start: number;
  end: number;
  size: number;
}

export interface FilterItemsOptions {
  section: NavSection;
  currentFolderId: string | null;
  searchQuery: string;
  typeFilter: TypeFilter;
  sortField: SortField;
  sortDirection: SortDirection;
}

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'svg',
  'avif',
  'bmp',
  'heic',
]);

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'webm',
  'mkv',
  'mov',
  'avi',
  'm4v',
]);

const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'wav',
  'ogg',
  'flac',
  'aac',
  'm4a',
]);

const ARCHIVE_EXTENSIONS = new Set([
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'bz2',
  'xz',
]);

const CODE_EXTENSIONS = new Set([
  'json',
  'ts',
  'tsx',
  'js',
  'jsx',
  'py',
  'go',
  'rs',
  'html',
  'css',
  'yaml',
  'yml',
  'toml',
  'sql',
  'sh',
]);

const DOCUMENT_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'txt',
  'md',
  'csv',
  'rtf',
]);

export function getFileExtension(filename: string): string {
  const clean = filename.trim().toLowerCase();
  const lastDot = clean.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === clean.length - 1) {
    return '';
  }
  return clean.slice(lastDot + 1);
}

export function getFileCategory(mimeType: string, filename: string): FileCategory {
  const mime = (mimeType || '').toLowerCase();
  const ext = getFileExtension(filename);

  if (mime.startsWith('image/') || IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (mime.startsWith('video/') || VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (mime.startsWith('audio/') || AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (ARCHIVE_EXTENSIONS.has(ext) || mime.includes('zip') || mime.includes('compressed') || mime.includes('tar')) {
    return 'archive';
  }
  if (CODE_EXTENSIONS.has(ext) || mime.includes('json') || mime.includes('javascript') || mime.includes('typescript')) {
    return 'code';
  }
  if (
    DOCUMENT_EXTENSIONS.has(ext) ||
    mime.startsWith('text/') ||
    mime.includes('pdf') ||
    mime.includes('word') ||
    mime.includes('sheet') ||
    mime.includes('presentation')
  ) {
    return 'document';
  }
  return 'other';
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  if (exponent === 0) return `${Math.round(value)} B`;
  return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[exponent]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 B/dtk';
  return `${formatBytes(bytesPerSec)}/dtk`;
}

export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Sesaat lagi';
  if (seconds < 60) return `${Math.ceil(seconds)} dtk`;
  const mins = Math.floor(seconds / 60);
  const remSecs = Math.ceil(seconds % 60);
  if (mins < 60) {
    return remSecs > 0 ? `${mins} mnt ${remSecs} dtk` : `${mins} mnt`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours} jam ${remMins} mnt`;
}

export function formatRelativeDateId(isoDate: string, nowMs = Date.now()): string {
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) return isoDate;
  const diffSec = Math.floor((nowMs - parsed) / 1000);
  if (diffSec < 60 && diffSec >= 0) return 'Baru saja';
  if (diffSec < 3600 && diffSec >= 0) return `${Math.floor(diffSec / 60)} mnt lalu`;
  if (diffSec < 86400 && diffSec >= 0) return `${Math.floor(diffSec / 3600)} jam lalu`;
  if (diffSec < 604800 && diffSec >= 0) return `${Math.floor(diffSec / 86400)} hari lalu`;
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(parsed));
}

export function computeByteSlices(totalSize: number, chunkSize: number): ByteSlice[] {
  if (totalSize <= 0) {
    return [{ index: 0, start: 0, end: 0, size: 0 }];
  }
  const safeChunkSize = Math.max(1024, Math.floor(chunkSize));
  const slices: ByteSlice[] = [];
  let offset = 0;
  let index = 0;
  while (offset < totalSize) {
    const end = Math.min(totalSize, offset + safeChunkSize);
    slices.push({
      index,
      start: offset,
      end,
      size: end - offset,
    });
    offset = end;
    index += 1;
  }
  return slices;
}

export function buildBreadcrumbs(folderId: string | null, items: DriveItem[]): BreadcrumbNode[] {
  const root: BreadcrumbNode = { id: null, name: 'Drive Saya' };
  if (!folderId) return [root];

  const byId = new Map<string, DriveItem>();
  for (const item of items) {
    if (item.type === 'folder') {
      byId.set(item.id, item);
    }
  }

  const trail: BreadcrumbNode[] = [];
  const visited = new Set<string>();
  let cursor: string | null = folderId;

  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const folder = byId.get(cursor);
    if (!folder) break;
    trail.unshift({ id: folder.id, name: folder.name });
    cursor = folder.parentId;
  }

  return [root, ...trail];
}

export function isDescendantOrSelf(
  targetFolderId: string | null,
  movingItemId: string,
  items: DriveItem[],
): boolean {
  if (!targetFolderId) return false;
  if (targetFolderId === movingItemId) return true;

  const byId = new Map<string, DriveItem>();
  for (const item of items) {
    if (item.type === 'folder') {
      byId.set(item.id, item);
    }
  }

  const visited = new Set<string>();
  let cursor: string | null = targetFolderId;
  while (cursor && !visited.has(cursor)) {
    if (cursor === movingItemId) return true;
    visited.add(cursor);
    const node = byId.get(cursor);
    cursor = node ? node.parentId : null;
  }
  return false;
}

export function matchesTypeFilter(item: DriveItem, typeFilter: TypeFilter): boolean {
  if (typeFilter === 'all') return true;
  if (item.type === 'folder') return false;
  const cat = getFileCategory(item.mimeType, item.name);
  if (typeFilter === 'document') {
    return cat === 'document' || cat === 'code';
  }
  return cat === typeFilter;
}

export function filterAndSortItems(
  items: DriveItem[],
  options: FilterItemsOptions,
): DriveItem[] {
  const query = options.searchQuery.trim().toLowerCase();

  let filtered = items.filter((item) => {
    if (options.section === 'trash') {
      return item.trashed;
    }
    if (item.trashed) return false;

    if (query) {
      return item.name.toLowerCase().includes(query);
    }

    switch (options.section) {
      case 'my-drive':
        return item.parentId === options.currentFolderId;
      case 'starred':
        return item.starred;
      case 'recent':
        return item.type === 'file';
      case 'media': {
        if (item.type !== 'file') return false;
        const cat = getFileCategory(item.mimeType, item.name);
        return cat === 'image' || cat === 'video' || cat === 'audio';
      }
      case 'documents': {
        if (item.type !== 'file') return false;
        const cat = getFileCategory(item.mimeType, item.name);
        return cat === 'document' || cat === 'code' || cat === 'archive';
      }
      default:
        return true;
    }
  });

  if (options.typeFilter !== 'all') {
    filtered = filtered.filter((item) => matchesTypeFilter(item, options.typeFilter));
  }

  const dir = options.sortDirection === 'asc' ? 1 : -1;

  return [...filtered].sort((a, b) => {
    // Always keep folders before files in My Drive / Search / Trash
    if (a.type !== b.type) {
      return a.type === 'folder' ? -1 : 1;
    }

    if (options.section === 'recent' && options.sortField === 'updatedAt') {
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    }

    switch (options.sortField) {
      case 'size':
        return (a.size - b.size) * dir || a.name.localeCompare(b.name, 'id');
      case 'updatedAt':
        return (Date.parse(a.updatedAt) - Date.parse(b.updatedAt)) * dir;
      case 'name':
      default:
        return a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }) * dir;
    }
  });
}

export function computeStorageSummary(items: DriveItem[]): StorageSummary {
  let activeBytes = 0;
  let trashedBytes = 0;
  let fileCount = 0;
  let folderCount = 0;
  let telegramSyncedCount = 0;
  let telegramSyncedBytes = 0;

  for (const item of items) {
    if (item.type === 'folder') {
      if (!item.trashed) folderCount += 1;
      continue;
    }
    if (item.trashed) {
      trashedBytes += item.size;
    } else {
      activeBytes += item.size;
      fileCount += 1;
    }
    if (item.storageBackend === 'telegram' && !item.trashed) {
      telegramSyncedCount += 1;
      telegramSyncedBytes += item.size;
    }
  }

  return {
    totalBytes: activeBytes + trashedBytes,
    activeBytes,
    trashedBytes,
    fileCount,
    folderCount,
    telegramSyncedCount,
    telegramSyncedBytes,
  };
}

export function isTextPreviewable(mimeType: string, filename: string): boolean {
  const mime = (mimeType || '').toLowerCase();
  const ext = getFileExtension(filename);
  if (mime.startsWith('text/') || mime.includes('json') || mime.includes('xml')) {
    return true;
  }
  return ['md', 'txt', 'csv', 'json', 'ts', 'tsx', 'js', 'jsx', 'py', 'yaml', 'yml', 'toml', 'sql', 'sh', 'html', 'css', 'log', 'env'].includes(ext);
}
