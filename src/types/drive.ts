export type ItemType = 'folder' | 'file';

export type FileCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'archive'
  | 'code'
  | 'other';

export type StorageBackend = 'telegram' | 'local';

export interface FileChunk {
  index: number;
  size: number;
  telegramFileId?: string;
  telegramUniqueId?: string;
  telegramMessageId?: number;
  localPath?: string;
}

export interface DriveItem {
  id: string;
  name: string;
  type: ItemType;
  parentId: string | null;
  size: number;
  mimeType: string;
  starred: boolean;
  trashed: boolean;
  trashedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  storageBackend: StorageBackend;
  thumbnailUrl?: string;
  demoTextContent?: string;
  localBlobKey?: string;
  chunks: FileChunk[];
  description?: string;
  folderIdx?: {
    mid: number;
    fid: string;
    h: string;
  };
  isCatalogStub?: boolean;
  pendingOfflineUpload?: boolean;
}

export interface TelegramConfigState {
  connected: boolean;
  botToken: string;
  chatId: string;
  botUsername?: string;
  botName?: string;
  chatTitle?: string;
  chatType?: string;
  autoSync: boolean;
  pinnedIndexMessageId?: number;
  lastSyncedAt?: string;
  corsProxyUrl?: string;
}

export interface TelegramPublicStatus {
  connected: boolean;
  botUsername?: string;
  botName?: string;
  chatId?: string;
  chatTitle?: string;
  chatType?: string;
  maskedToken?: string;
  chunkSizeMb: number;
  concurrency: number;
  autoSync: boolean;
  pinnedIndexMessageId?: number;
  lastCheckedAt?: string;
  hasCorsProxy?: boolean;
}

export interface StorageCategoryStats {
  bytes: number;
  count: number;
}

export interface StorageSummary {
  totalBytes: number;
  activeBytes: number;
  trashedBytes: number;
  fileCount: number;
  folderCount: number;
  telegramSyncedCount: number;
  telegramSyncedBytes: number;
  categories: {
    image: StorageCategoryStats;
    video: StorageCategoryStats;
    document: StorageCategoryStats;
    audio: StorageCategoryStats;
    other: StorageCategoryStats;
  };
}

export type NavSection =
  | 'my-drive'
  | 'recent'
  | 'starred'
  | 'photos'
  | 'videos'
  | 'music'
  | 'documents'
  | 'archives'
  | 'others'
  | 'trash';

export type TypeFilter =
  | 'all'
  | 'folder'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'archive'
  | 'other';

export type SearchSizeFilter = 'all' | 'small' | 'medium' | 'large';
export type SearchScope = 'all' | 'folder';

export type SortField = 'name' | 'updatedAt' | 'size' | 'type';
export type SortDirection = 'asc' | 'desc';
export type ViewMode = 'grid' | 'list';

export interface TransferTask {
  id: string;
  kind: 'upload' | 'download';
  filename: string;
  totalBytes: number;
  loadedBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  elapsedSeconds?: number;
  completedChunks: number;
  totalChunks: number;
  status: 'queued' | 'active' | 'completed' | 'error' | 'cancelled';
  statusLabel?: string;
  errorMessage?: string;
  canRetry?: boolean;
  targetBackend?: StorageBackend;
  createdAt: number;
}
