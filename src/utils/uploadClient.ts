import type { DriveItem, StorageBackend, TelegramConfigState } from '../types/drive';
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
  status?: 'queued' | 'active' | 'completed' | 'error' | 'cancelled';
  errorMessage?: string;
  targetBackend?: StorageBackend;
}

export interface UploadController {
  cancel: () => void;
  promise: Promise<DriveItem>;
}

const MAX_RATE_LIMIT_RETRIES = 3;

function waitWithCancel(ms: number, isCancelled: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isCancelled()) {
      reject(new Error('Dibatalkan'));
      return;
    }
    const checkStep = 200;
    let remaining = ms;
    const timer = window.setInterval(() => {
      if (isCancelled()) {
        window.clearInterval(timer);
        reject(new Error('Dibatalkan'));
        return;
      }
      remaining -= checkStep;
      if (remaining <= 0) {
        window.clearInterval(timer);
        resolve();
      }
    }, checkStep);
  });
}

export function startDirectUpload(
  file: File,
  parentId: string | null,
  tgConfig: TelegramConfigState,
  onProgress: (update: TransferProgressUpdate) => void,
): UploadController {
  let cancelled = false;
  let tgCancel: (() => void) | null = null;

  const cancel = () => {
    cancelled = true;
    tgCancel?.();
  };

  const promise = (async (): Promise<DriveItem> => {
    if (!tgConfig.connected || !tgConfig.botToken || !tgConfig.chatId) {
      throw new Error('Cloud Telegram belum terhubung. Buka PIN Brankas terlebih dahulu.');
    }

    if (file.size > DIRECT_TELEGRAM_MAX_BYTES) {
      throw new Error('Ukuran file harus di bawah 20 MB per file untuk unggah dari browser.');
    }

    const id = `file-${crypto.randomUUID()}`;
    const blobKey = `blob-${id}`;
    const now = new Date().toISOString();
    const mimeType = file.type || 'application/octet-stream';

    if (cancelled) {
      throw new Error('Dibatalkan');
    }

    let uploaded: { fileId: string; fileUniqueId: string; messageId: number } | null = null;
    let startedAt = performance.now();

    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
      if (cancelled) {
        throw new Error('Dibatalkan');
      }
      startedAt = performance.now();

      try {
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
              errorMessage: undefined,
              targetBackend: 'telegram',
            });
          },
        );
        tgCancel = uploadOp.cancel;
        uploaded = await uploadOp.promise;
        break;
      } catch (err) {
        const retryAfter = (err as Error & { retryAfterSeconds?: number })?.retryAfterSeconds;
        if (!cancelled && retryAfter && attempt < MAX_RATE_LIMIT_RETRIES) {
          const waitSec = Math.min(30, Math.max(1, retryAfter));
          onProgress({
            loadedBytes: 0,
            speedBytesPerSec: 0,
            etaSeconds: waitSec,
            completedChunks: 0,
            totalChunks: 1,
            status: 'active',
            errorMessage: `Menunggu batas Telegram (${waitSec} dtk)...`,
            targetBackend: 'telegram',
          });
          await waitWithCancel(waitSec * 1000, () => cancelled);
          continue;
        }
        throw err;
      }
    }

    if (!uploaded) {
      throw new Error('Unggahan gagal setelah mencoba ulang.');
    }

    // Cache small preview blob for instant offline thumbnail/preview
    await saveLocalBlob(blobKey, file);

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
      errorMessage: undefined,
      targetBackend: 'telegram',
    });
    return item;
  })();

  return { cancel, promise };
}

async function getCachedBlobForItem(item: DriveItem): Promise<Blob | null> {
  if (item.localBlobKey) {
    const direct = await getLocalBlob(item.localBlobKey);
    if (direct) return direct;
  }
  return getLocalBlob(`blob-${item.id}`);
}

export async function resolveItemPlayableUrl(
  item: DriveItem,
  tgConfig: TelegramConfigState,
  options?: { forceTypedBlob?: boolean; mimeOverride?: string },
): Promise<{ url: string; isObjectUrl: boolean } | null> {
  const effectiveMime = options?.mimeOverride || item.mimeType || 'application/octet-stream';

  const cachedBlob = await getCachedBlobForItem(item);
  if (cachedBlob) {
    const typed =
      options?.mimeOverride && cachedBlob.type !== options.mimeOverride
        ? new Blob([cachedBlob], { type: effectiveMime })
        : cachedBlob;
    return { url: URL.createObjectURL(typed), isObjectUrl: true };
  }

  if (item.size > DIRECT_TELEGRAM_MAX_BYTES) {
    throw new Error('File di atas 20 MB hanya bisa dibuka langsung di aplikasi Telegram.');
  }
  const tgFileId = item.chunks[0]?.telegramFileId;
  if (tgFileId && tgConfig.botToken) {
    const tgUrl = await resolveTelegramFileUrl(tgConfig.botToken, tgFileId);
    if (options?.forceTypedBlob) {
      const res = await fetch(tgUrl);
      if (res.ok) {
        const rawBlob = await res.blob();
        await saveLocalBlob(`blob-${item.id}`, rawBlob);
        const typedBlob = new Blob([rawBlob], { type: effectiveMime });
        return { url: URL.createObjectURL(typedBlob), isObjectUrl: true };
      }
    }
    return { url: tgUrl, isObjectUrl: false };
  }
  return null;
}

export async function resolveItemArrayBuffer(
  item: DriveItem,
  tgConfig: TelegramConfigState,
): Promise<ArrayBuffer | null> {
  const cachedBlob = await getCachedBlobForItem(item);
  if (cachedBlob) {
    return cachedBlob.arrayBuffer();
  }
  if (item.size > DIRECT_TELEGRAM_MAX_BYTES) {
    throw new Error('File di atas 20 MB hanya bisa dibuka langsung di aplikasi Telegram.');
  }
  const tgFileId = item.chunks[0]?.telegramFileId;
  if (tgFileId && tgConfig.botToken) {
    const tgUrl = await resolveTelegramFileUrl(tgConfig.botToken, tgFileId);
    const res = await fetch(tgUrl);
    if (!res.ok) {
      throw new Error('Gagal mengunduh file dari Cloud Telegram untuk pratinjau.');
    }
    const rawBlob = await res.blob();
    await saveLocalBlob(`blob-${item.id}`, rawBlob);
    return rawBlob.arrayBuffer();
  }
  return null;
}

export async function resolveItemTextContent(
  item: DriveItem,
  tgConfig: TelegramConfigState,
): Promise<string | null> {
  if (item.demoTextContent !== undefined) {
    return item.demoTextContent;
  }
  const cachedBlob = await getCachedBlobForItem(item);
  if (cachedBlob) {
    return cachedBlob.text();
  }
  if (item.size > DIRECT_TELEGRAM_MAX_BYTES) {
    return null;
  }
  const tgFileId = item.chunks[0]?.telegramFileId;
  if (tgFileId && tgConfig.botToken) {
    const tgUrl = await resolveTelegramFileUrl(tgConfig.botToken, tgFileId);
    const res = await fetch(tgUrl);
    if (res.ok) {
      const text = await res.text();
      await saveLocalBlob(`blob-${item.id}`, new Blob([text], { type: item.mimeType || 'text/plain' }));
      return text;
    }
  }
  return null;
}

export function startDirectDownload(
  item: DriveItem,
  tgConfig: TelegramConfigState,
  onProgress: (update: TransferProgressUpdate) => void,
): { cancel: () => void; promise: Promise<void> } {
  let cancelled = false;
  let activeXhr: XMLHttpRequest | null = null;

  const cancel = () => {
    cancelled = true;
    activeXhr?.abort();
  };

  const promise = (async () => {
    const startedAt = performance.now();

    const cachedBlob = await getCachedBlobForItem(item);
    if (cachedBlob) {
      triggerBlobDownload(cachedBlob, item.name);
      const elapsed = Math.max(0.02, (performance.now() - startedAt) / 1000);
      onProgress({
        loadedBytes: item.size || cachedBlob.size,
        speedBytesPerSec: (item.size || cachedBlob.size) / elapsed,
        etaSeconds: 0,
        completedChunks: 1,
        totalChunks: 1,
        status: 'completed',
        targetBackend: 'telegram',
      });
      return;
    }

    if (item.size > DIRECT_TELEGRAM_MAX_BYTES) {
      throw new Error(
        'File di atas 20 MB tidak dapat diunduh lewat browser (batas Telegram Bot API). Gunakan tombol Buka di Telegram.',
      );
    }

    const tgFileId = item.chunks[0]?.telegramFileId;
    if (!tgFileId || !tgConfig.botToken) {
      throw new Error('File tidak tersedia di Cloud Telegram.');
    }

    const tgUrl = await resolveTelegramFileUrl(tgConfig.botToken, tgFileId);
    if (cancelled) throw new Error('Dibatalkan');

    // Download via XHR for real-time MB/s progress, ETA, and IndexedDB caching
    try {
      const downloadedBlob = await new Promise<Blob>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        activeXhr = xhr;
        xhr.open('GET', tgUrl, true);
        xhr.responseType = 'blob';

        xhr.onprogress = (ev) => {
          const total = ev.lengthComputable && ev.total > 0 ? ev.total : item.size;
          const elapsed = Math.max(0.05, (performance.now() - startedAt) / 1000);
          const speed = ev.loaded / elapsed;
          const eta = speed > 0 && total > 0 ? Math.max(0, total - ev.loaded) / speed : 0;
          onProgress({
            loadedBytes: ev.loaded,
            speedBytesPerSec: speed,
            etaSeconds: eta,
            completedChunks: 0,
            totalChunks: 1,
            status: 'active',
            targetBackend: 'telegram',
          });
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300 && xhr.response instanceof Blob) {
            resolve(xhr.response);
          } else {
            reject(new Error(`HTTP ${xhr.status || 0}`));
          }
        };

        xhr.onerror = () => reject(new Error('XHR_NETWORK_FALLBACK'));
        xhr.onabort = () => reject(new Error('Dibatalkan'));
        xhr.send();
      });

      await saveLocalBlob(`blob-${item.id}`, downloadedBlob);
      triggerBlobDownload(downloadedBlob, item.name);

      const totalSize = item.size || downloadedBlob.size;
      const elapsed = Math.max(0.05, (performance.now() - startedAt) / 1000);
      onProgress({
        loadedBytes: totalSize,
        speedBytesPerSec: totalSize / elapsed,
        etaSeconds: 0,
        completedChunks: 1,
        totalChunks: 1,
        status: 'completed',
        targetBackend: 'telegram',
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'Dibatalkan') {
        throw err;
      }
      // Graceful fallback to direct browser link download if XHR is blocked
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
    }
  })();

  return { cancel, promise };
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
