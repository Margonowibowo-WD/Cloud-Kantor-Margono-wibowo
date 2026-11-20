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
      case 'photos': {
        if (item.type !== 'file') return false;
        return getFileCategory(item.mimeType, item.name) === 'image';
      }
      case 'videos': {
        if (item.type !== 'file') return false;
        return getFileCategory(item.mimeType, item.name) === 'video';
      }
      case 'music': {
        if (item.type !== 'file') return false;
        return getFileCategory(item.mimeType, item.name) === 'audio';
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

export function isPdfFile(mimeType: string, filename: string): boolean {
  const mime = (mimeType || '').toLowerCase();
  return mime === 'application/pdf' || mime.includes('pdf') || getFileExtension(filename) === 'pdf';
}

export type OfficePreviewType = 'docx' | 'excel' | 'pptx' | 'legacy-office' | null;

export function getOfficePreviewType(mimeType: string, filename: string): OfficePreviewType {
  const mime = (mimeType || '').toLowerCase();
  const ext = getFileExtension(filename);

  if (ext === 'docx' || mime.includes('wordprocessingml')) {
    return 'docx';
  }
  if (
    ext === 'xlsx' ||
    ext === 'xls' ||
    ext === 'xlsm' ||
    ext === 'ods' ||
    mime.includes('spreadsheetml') ||
    mime.includes('ms-excel')
  ) {
    return 'excel';
  }
  if (ext === 'pptx' || mime.includes('presentationml')) {
    return 'pptx';
  }
  if (ext === 'doc' || ext === 'ppt' || mime === 'application/msword' || mime === 'application/vnd.ms-powerpoint') {
    return 'legacy-office';
  }
  return null;
}

export function makeUniqueCopyName(
  baseName: string,
  isFolder: boolean,
  siblingNames: Set<string>,
): string {
  if (!siblingNames.has(baseName)) {
    return baseName;
  }

  let stem = baseName;
  let ext = '';
  if (!isFolder) {
    const dotIdx = baseName.lastIndexOf('.');
    if (dotIdx > 0 && dotIdx < baseName.length - 1) {
      stem = baseName.slice(0, dotIdx);
      ext = baseName.slice(dotIdx);
    }
  }

  let counter = 1;
  while (counter < 500) {
    const suffix = counter === 1 ? ' (Salinan)' : ` (Salinan ${counter})`;
    const candidate = `${stem}${suffix}${ext}`;
    if (!siblingNames.has(candidate)) {
      return candidate;
    }
    counter += 1;
  }
  return `${stem} (${Date.now()})${ext}`;
}

export function cloneDriveItemsForPaste(
  sourceIds: string[],
  allItems: DriveItem[],
  targetParentId: string | null,
  nowIso: string,
  makeId: (type: 'file' | 'folder') => string,
): DriveItem[] {
  const byId = new Map<string, DriveItem>();
  for (const item of allItems) {
    if (!item.trashed) byId.set(item.id, item);
  }

  const selectedSet = new Set(sourceIds.filter((id) => byId.has(id)));
  if (selectedSet.size === 0) return [];

  // Exclude items whose ancestor is also selected so nested selections aren't duplicated
  const topLevelSources: DriveItem[] = [];
  for (const id of selectedSet) {
    const item = byId.get(id)!;
    let hasSelectedAncestor = false;
    let cursor = item.parentId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (selectedSet.has(cursor)) {
        hasSelectedAncestor = true;
        break;
      }
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    if (!hasSelectedAncestor) {
      topLevelSources.push(item);
    }
  }

  // Track existing names at target folder to prevent collisions
  const targetSiblingNames = new Set(
    allItems
      .filter((i) => !i.trashed && i.parentId === targetParentId)
      .map((i) => i.name),
  );

  const created: DriveItem[] = [];

  const cloneRecursive = (src: DriveItem, newParentId: string | null, isTopLevel: boolean) => {
    const newId = makeId(src.type);
    const clonedName = isTopLevel
      ? makeUniqueCopyName(src.name, src.type === 'folder', targetSiblingNames)
      : src.name;
    if (isTopLevel) {
      targetSiblingNames.add(clonedName);
    }

    created.push({
      ...src,
      id: newId,
      name: clonedName,
      parentId: newParentId,
      trashed: false,
      trashedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      chunks: src.chunks.map((c) => ({ ...c })),
    });

    if (src.type === 'folder') {
      const children = allItems.filter((i) => !i.trashed && i.parentId === src.id);
      for (const child of children) {
        cloneRecursive(child, newId, false);
      }
    }
  };

  for (const root of topLevelSources) {
    // Prevent pasting a folder directly inside itself or its descendant
    if (root.type === 'folder' && isDescendantOrSelf(targetParentId, root.id, allItems)) {
      continue;
    }
    cloneRecursive(root, targetParentId, true);
  }

  return created;
}

export function canMoveItemsToFolder(
  movingIds: string[],
  targetFolderId: string | null,
  allItems: DriveItem[],
): boolean {
  if (movingIds.length === 0) return false;
  const byId = new Map(allItems.map((i) => [i.id, i]));
  let anyMovable = false;

  for (const id of movingIds) {
    const item = byId.get(id);
    if (!item || item.trashed) continue;
    if (item.type === 'folder' && isDescendantOrSelf(targetFolderId, item.id, allItems)) {
      return false;
    }
    if (item.parentId !== targetFolderId) {
      anyMovable = true;
    }
  }
  return anyMovable;
}

export function applyMoveItems(
  movingIds: string[],
  targetFolderId: string | null,
  allItems: DriveItem[],
  nowIso: string,
): { nextItems: DriveItem[]; movedCount: number } {
  if (!canMoveItemsToFolder(movingIds, targetFolderId, allItems)) {
    return { nextItems: allItems, movedCount: 0 };
  }

  const moveSet = new Set(movingIds);
  let movedCount = 0;
  const nextItems = allItems.map((item) => {
    if (!moveSet.has(item.id) || item.trashed) return item;
    if (item.type === 'folder' && isDescendantOrSelf(targetFolderId, item.id, allItems)) {
      return item;
    }
    if (item.parentId === targetFolderId) return item;
    movedCount += 1;
    return { ...item, parentId: targetFolderId, updatedAt: nowIso };
  });

  return { nextItems, movedCount };
}
