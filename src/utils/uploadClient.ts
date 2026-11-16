import type { DriveItem, StorageBackend, TelegramConfigState } from '../types/drive';
import { getFileCategory } from './fileHelpers';
import { getLocalBlob, saveLocalBlob } from './localVault';
import {
  DIRECT_TELEGRAM_MAX_BYTES,
  resolveTelegramFileUrl,
  uploadFileDirectToTelegram,
} from './telegramDirect';

export interface TransferProgressUpdate {
  loadedBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  completedChunks: number;
  totalChunks: number;
  status?: 'active' | 'completed' | 'error' | 'cancelled';
  errorMessage?: string;
  targetBackend?: StorageBackend;
}

export interface UploadController {
  cancel: () => void;
  promise: Promise<DriveItem>;
}

export function startDirectUpload(
  file: File,
  parentId: string | null,
  tgConfig: TelegramConfigState,
  onProgress: (update: TransferProgressUpdate) => void,
): UploadController {
  const useTelegram = Boolean(tgConfig.connected && tgConfig.autoSync && tgConfig.botToken && tgConfig.chatId);
  let cancelled = false;
  let tgCancel: (() => void) | null = null;

  const cancel = () => {
    cancelled = true;
    tgCancel?.();
  };

  const promise = (async (): Promise<DriveItem> => {
    const startedAt = performance.now();
    const id = `file-${crypto.randomUUID()}`;
    const blobKey = `blob-${id}`;
    const now = new Date().toISOString();
    const mimeType = file.type || 'application/octet-stream';
    const category = getFileCategory(mimeType, file.name);

    // Save local copy in IndexedDB for instant offline preview & thumbnail
    await saveLocalBlob(blobKey, file);

    if (cancelled) {
      throw new Error('Dibatalkan');
    }

    if (useTelegram) {
      if (file.size > DIRECT_TELEGRAM_MAX_BYTES) {
        throw new Error(
          'Ukuran file > 20 MB. Mode langsung GitHub Pages + Telegram dibatasi 20 MB/file.',
        );
      }

      const uploadOp = uploadFileDirectToTelegram(
        tgConfig.botToken,
        tgConfig.chatId,
        file,
        file.name,
        (loaded, total) => {
          const elapsed = Math.max(0.05, (performance.now() - startedAt) / 1000);
          const speed = loaded / elapsed;
          const eta = speed > 0 ? Math.max(0, total - loaded) / speed : 0;
          onProgress({
            loadedBytes: loaded,
            speedBytesPerSec: speed,
            etaSeconds: eta,
            completedChunks: 0,
            totalChunks: 1,
            status: 'active',
            targetBackend: 'telegram',
          });
        },
      );
      tgCancel = uploadOp.cancel;
      const uploaded = await uploadOp.promise;

      const item: DriveItem = {
        id,
        name: file.name,
        type: 'file',
        parentId,
        size: file.size,
        mimeType,
        starred: false,
        trashed: false,
        createdAt: now,
        updatedAt: now,
        storageBackend: 'telegram',
        localBlobKey: blobKey,
        chunks: [
          {
            index: 0,
            size: file.size,
            telegramFileId: uploaded.fileId,
            telegramUniqueId: uploaded.fileUniqueId,
            telegramMessageId: uploaded.messageId,
          },
        ],
      };

      const elapsed = Math.max(0.05, (performance.now() - startedAt) / 1000);
      onProgress({
        loadedBytes: file.size,
        speedBytesPerSec: file.size / elapsed,
        etaSeconds: 0,
        completedChunks: 1,
        totalChunks: 1,
        status: 'completed',
        targetBackend: 'telegram',
      });
      return item;
    }

    // Local IndexedDB fast storage when Telegram isn't connected yet
    const elapsed = Math.max(0.02, (performance.now() - startedAt) / 1000);
    const item: DriveItem = {
      id,
      name: file.name,
      type: 'file',
      parentId,
      size: file.size,
      mimeType,
      starred: false,
      trashed: false,
      createdAt: now,
      updatedAt: now,
      storageBackend: 'local',
      localBlobKey: blobKey,
      thumbnailUrl: category === 'image' ? undefined : undefined,
      chunks: [{ index: 0, size: file.size }],
    };

    onProgress({
      loadedBytes: file.size,
      speedBytesPerSec: file.size / elapsed,
      etaSeconds: 0,
      completedChunks: 1,
      totalChunks: 1,
      status: 'completed',
      targetBackend: 'local',
    });

    return item;
  })();

  return { cancel, promise };
}

export async function resolveItemPlayableUrl(
  item: DriveItem,
  tgConfig: TelegramConfigState,
): Promise<{ url: string; isObjectUrl: boolean } | null> {
  if (item.localBlobKey) {
    const blob = await getLocalBlob(item.localBlobKey);
    if (blob) {
      return { url: URL.createObjectURL(blob), isObjectUrl: true };
    }
  }
  if (item.thumbnailUrl) {
    return { url: item.thumbnailUrl, isObjectUrl: false };
  }
  if (item.demoTextContent !== undefined) {
    const blob = new Blob([item.demoTextContent], { type: item.mimeType || 'text/plain' });
    return { url: URL.createObjectURL(blob), isObjectUrl: true };
  }
  const tgFileId = item.chunks[0]?.telegramFileId;
  if (tgFileId && tgConfig.botToken) {
    const tgUrl = await resolveTelegramFileUrl(tgConfig.botToken, tgFileId);
    return { url: tgUrl, isObjectUrl: false };
  }
  return null;
}

export function startDirectDownload(
  item: DriveItem,
  tgConfig: TelegramConfigState,
  onProgress: (update: TransferProgressUpdate) => void,
): { cancel: () => void; promise: Promise<void> } {
  const promise = (async () => {
    const startedAt = performance.now();

    // 1. Try local IndexedDB blob or demo content first (fastest + clean filename download)
    if (item.localBlobKey) {
      const blob = await getLocalBlob(item.localBlobKey);
      if (blob) {
        triggerBlobDownload(blob, item.name);
        const elapsed = Math.max(0.02, (performance.now() - startedAt) / 1000);
        onProgress({
          loadedBytes: item.size,
          speedBytesPerSec: item.size / elapsed,
          etaSeconds: 0,
          completedChunks: 1,
          totalChunks: 1,
          status: 'completed',
          targetBackend: item.storageBackend,
        });
        return;
      }
    }

    if (item.demoTextContent !== undefined) {
      const blob = new Blob([item.demoTextContent], { type: item.mimeType || 'text/plain' });
      triggerBlobDownload(blob, item.name);
      onProgress({
        loadedBytes: item.size,
        speedBytesPerSec: item.size * 10,
        etaSeconds: 0,
        completedChunks: 1,
        totalChunks: 1,
        status: 'completed',
        targetBackend: 'local',
      });
      return;
    }

    if (item.thumbnailUrl) {
      const res = await fetch(item.thumbnailUrl);
      if (res.ok) {
        const blob = await res.blob();
        triggerBlobDownload(blob, item.name);
        const elapsed = Math.max(0.02, (performance.now() - startedAt) / 1000);
        onProgress({
          loadedBytes: blob.size || item.size,
          speedBytesPerSec: (blob.size || item.size) / elapsed,
          etaSeconds: 0,
          completedChunks: 1,
          totalChunks: 1,
          status: 'completed',
          targetBackend: 'local',
        });
        return;
      }
    }

    // 2. Telegram direct CDN link via getFile (avoids CORS fetch block by using native anchor click)
    const tgFileId = item.chunks[0]?.telegramFileId;
    if (tgFileId && tgConfig.botToken) {
      const tgUrl = await resolveTelegramFileUrl(tgConfig.botToken, tgFileId);
      const a = document.createElement('a');
      a.href = tgUrl;
      a.download = item.name;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();

      onProgress({
        loadedBytes: item.size,
        speedBytesPerSec: 0,
        etaSeconds: 0,
        completedChunks: 1,
        totalChunks: 1,
        status: 'completed',
        targetBackend: 'telegram',
      });
      return;
    }

    throw new Error('File tidak tersedia di penyimpanan lokal maupun Telegram.');
  })();

  return { cancel: () => {}, promise };
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}
