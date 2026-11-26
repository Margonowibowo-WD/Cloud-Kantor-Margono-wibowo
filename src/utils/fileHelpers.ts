import type {
  DriveItem,
  FileCategory,
  NavSection,
  SearchScope,
  SearchSizeFilter,
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
  searchScope?: SearchScope;
  sizeFilter?: SearchSizeFilter;
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

export function getFileTypeLabel(
  item: Pick<DriveItem, 'type' | 'name' | 'mimeType'>,
): string {
  if (item.type === 'folder') return 'Folder';
  const ext = getFileExtension(item.name);
  const mime = (item.mimeType || '').toLowerCase();

  if (
    ext === 'doc' ||
    ext === 'docx' ||
    ext === 'odt' ||
    ext === 'rtf' ||
    mime.includes('wordprocessingml') ||
    mime === 'application/msword'
  ) {
    return 'Word';
  }
  if (
    ext === 'xls' ||
    ext === 'xlsx' ||
    ext === 'xlsm' ||
    ext === 'ods' ||
    mime.includes('spreadsheetml') ||
    mime.includes('ms-excel')
  ) {
    return 'Excel';
  }
  if (
    ext === 'ppt' ||
    ext === 'pptx' ||
    ext === 'odp' ||
    mime.includes('presentationml') ||
    mime.includes('ms-powerpoint')
  ) {
    return 'PowerPoint';
  }
  if (ext === 'pdf' || mime === 'application/pdf') {
    return 'PDF';
  }
  if (ext) {
    return ext.toUpperCase();
  }
  if (mime.startsWith('image/')) return 'Gambar';
  if (mime.startsWith('video/')) return 'Video';
  if (mime.startsWith('audio/')) return 'Audio';
  if (mime.startsWith('text/')) return 'Teks';
  return 'File';
}

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  ts: 'text/typescript',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  heic: 'image/heic',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  m4v: 'video/x-m4v',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  apk: 'application/vnd.android.package-archive',
};

const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'application/zip': 'zip',
  'text/plain': 'txt',
};

export function resolveMimeTypeForFilename(filename: string, fallbackMime?: string): string {
  const ext = getFileExtension(filename);
  if (ext && MIME_BY_EXTENSION[ext]) {
    return MIME_BY_EXTENSION[ext];
  }
  const cleanFallback = (fallbackMime || '').split(';')[0].trim().toLowerCase();
  if (cleanFallback && cleanFallback !== 'application/octet-stream') {
    return cleanFallback;
  }
  return 'application/octet-stream';
}

export function sanitizeDownloadFilename(filename: string, mimeType?: string): string {
  const cleaned = filename
    .replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '_')
    .trim();
  const base = cleaned || 'TeleDrive_File';
  const existingExt = getFileExtension(base);
  if (existingExt) return base;
  const cleanMime = (mimeType || '').split(';')[0].trim().toLowerCase();
  const inferredExt = EXTENSION_BY_MIME[cleanMime];
  return inferredExt ? `${base}.${inferredExt}` : base;
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

export function getItemLocationPath(item: DriveItem, allItems: DriveItem[]): string {
  const path = buildBreadcrumbs(item.parentId, allItems)
    .map((node) => node.name)
    .join(' / ');
  return item.trashed ? `Sampah · ${path}` : path;
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
  if (typeFilter === 'folder') return item.type === 'folder';
  if (item.type === 'folder') return false;
  const cat = getFileCategory(item.mimeType, item.name);
  if (typeFilter === 'document') {
    return cat === 'document' || cat === 'code';
  }
  return cat === typeFilter;
}

function matchesSizeFilter(item: DriveItem, sizeFilter: SearchSizeFilter): boolean {
  if (sizeFilter === 'all') return true;
  if (item.type === 'folder') return false;
  const ONE_MB = 1024 * 1024;
  const TEN_MB = 10 * ONE_MB;
  if (sizeFilter === 'small') return item.size < ONE_MB;
  if (sizeFilter === 'medium') return item.size >= ONE_MB && item.size <= TEN_MB;
  if (sizeFilter === 'large') return item.size > TEN_MB;
  return true;
}

function parseEverythingSearch(rawQuery: string): {
  terms: string[];
  extSet: Set<string> | null;
} {
  const tokens = rawQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const terms: string[] = [];
  let extSet: Set<string> | null = null;

  for (const token of tokens) {
    if (token.startsWith('ext:') && token.length > 4) {
      const exts = token
        .slice(4)
        .split(',')
        .map((e) => e.replace(/^\./, '').trim())
        .filter(Boolean);
      if (exts.length > 0) {
        if (!extSet) extSet = new Set<string>();
        for (const e of exts) extSet.add(e);
      }
      continue;
    }
    terms.push(token);
  }
  return { terms, extSet };
}

function collectSubtreeFolderIds(rootFolderId: string, items: DriveItem[]): Set<string> {
  const result = new Set<string>([rootFolderId]);
  const childrenMap = new Map<string, string[]>();
  for (const item of items) {
    if (item.type === 'folder' && !item.trashed && item.parentId) {
      const list = childrenMap.get(item.parentId);
      if (list) list.push(item.id);
      else childrenMap.set(item.parentId, [item.id]);
    }
  }
  const stack = [rootFolderId];
  while (stack.length > 0) {
    const curr = stack.pop()!;
    const children = childrenMap.get(curr);
    if (!children) continue;
    for (const childId of children) {
      if (!result.has(childId)) {
        result.add(childId);
        stack.push(childId);
      }
    }
  }
  return result;
}

export function filterAndSortItems(
  items: DriveItem[],
  options: FilterItemsOptions,
): DriveItem[] {
  const query = options.searchQuery.trim().toLowerCase();
  const parsedSearch = query ? parseEverythingSearch(query) : null;
  const scopedFolderIds =
    query && options.searchScope === 'folder' && options.currentFolderId
      ? collectSubtreeFolderIds(options.currentFolderId, items)
      : null;

  let filtered = items.filter((item) => {
    if (options.section === 'trash') {
      if (!item.trashed) return false;
      if (parsedSearch) {
        const lowerName = item.name.toLowerCase();
        if (parsedSearch.terms.some((t) => !lowerName.includes(t))) return false;
        if (parsedSearch.extSet) {
          if (item.type === 'folder') return false;
          if (!parsedSearch.extSet.has(getFileExtension(item.name))) return false;
        }
      }
      return true;
    }
    if (item.trashed) return false;

    if (parsedSearch) {
      if (scopedFolderIds && (!item.parentId || !scopedFolderIds.has(item.parentId))) {
        return false;
      }
      if (parsedSearch.extSet) {
        if (item.type === 'folder') return false;
        if (!parsedSearch.extSet.has(getFileExtension(item.name))) return false;
      }
      const lowerName = item.name.toLowerCase();
      for (const term of parsedSearch.terms) {
        if (!lowerName.includes(term)) return false;
      }
      return true;
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
        return cat === 'document' || cat === 'code';
      }
      case 'archives': {
        if (item.type !== 'file') return false;
        return getFileCategory(item.mimeType, item.name) === 'archive';
      }
      case 'others': {
        if (item.type !== 'file') return false;
        return getFileCategory(item.mimeType, item.name) === 'other';
      }
      default:
        return true;
    }
  });

  if (options.typeFilter !== 'all') {
    filtered = filtered.filter((item) => matchesTypeFilter(item, options.typeFilter));
  }

  if (options.sizeFilter && options.sizeFilter !== 'all') {
    filtered = filtered.filter((item) => matchesSizeFilter(item, options.sizeFilter!));
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
      case 'type': {
        const typeA = getFileTypeLabel(a);
        const typeB = getFileTypeLabel(b);
        return (
          typeA.localeCompare(typeB, 'id', { sensitivity: 'base' }) * dir ||
          a.name.localeCompare(b.name, 'id', { sensitivity: 'base' })
        );
      }
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

  const categories: StorageSummary['categories'] = {
    image: { bytes: 0, count: 0 },
    video: { bytes: 0, count: 0 },
    document: { bytes: 0, count: 0 },
    audio: { bytes: 0, count: 0 },
    other: { bytes: 0, count: 0 },
  };

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
      const cat = getFileCategory(item.mimeType, item.name);
      if (cat === 'image') {
        categories.image.bytes += item.size;
        categories.image.count += 1;
      } else if (cat === 'video') {
        categories.video.bytes += item.size;
        categories.video.count += 1;
      } else if (cat === 'document' || cat === 'code') {
        categories.document.bytes += item.size;
        categories.document.count += 1;
      } else if (cat === 'audio') {
        categories.audio.bytes += item.size;
        categories.audio.count += 1;
      } else {
        categories.other.bytes += item.size;
        categories.other.count += 1;
      }
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
    categories,
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

export interface DuplicateGroup {
  key: string;
  filename: string;
  size: number;
  wastedBytes: number;
  items: DriveItem[];
}

export function findCrossFolderDuplicates(items: DriveItem[]): {
  groups: DuplicateGroup[];
  totalDuplicateFiles: number;
  totalWastedBytes: number;
} {
  const buckets = new Map<string, DriveItem[]>();
  for (const item of items) {
    if (item.type !== 'file' || item.trashed) continue;
    const normalizedName = item.name.trim().toLowerCase();
    if (!normalizedName) continue;
    const key = `${normalizedName}::${Number(item.size) || 0}`;
    const list = buckets.get(key);
    if (list) list.push(item);
    else buckets.set(key, [item]);
  }

  const groups: DuplicateGroup[] = [];
  let totalDuplicateFiles = 0;
  let totalWastedBytes = 0;

  for (const [key, list] of buckets.entries()) {
    if (list.length < 2) continue;
    // Order primary candidate first: starred -> non-stub -> oldest created/updated
    const sorted = [...list].sort((a, b) => {
      if (a.starred !== b.starred) return a.starred ? -1 : 1;
      if (Boolean(a.isCatalogStub) !== Boolean(b.isCatalogStub)) {
        return a.isCatalogStub ? 1 : -1;
      }
      return (Date.parse(a.createdAt || a.updatedAt) || 0) - (Date.parse(b.createdAt || b.updatedAt) || 0);
    });
    const size = Number(sorted[0].size) || 0;
    const extraCount = sorted.length - 1;
    const wastedBytes = size * extraCount;
    totalDuplicateFiles += extraCount;
    totalWastedBytes += wastedBytes;
    groups.push({
      key,
      filename: sorted[0].name,
      size,
      wastedBytes,
      items: sorted,
    });
  }

  groups.sort((a, b) => {
    if (b.wastedBytes !== a.wastedBytes) return b.wastedBytes - a.wastedBytes;
    return a.filename.localeCompare(b.filename, 'id', { sensitivity: 'base' });
  });

  return { groups, totalDuplicateFiles, totalWastedBytes };
}

