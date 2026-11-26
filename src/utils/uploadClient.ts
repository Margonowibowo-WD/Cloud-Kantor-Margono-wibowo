import type { DriveItem, StorageBackend, TelegramConfigState } from '../types/drive';
import { resolveMimeTypeForFilename, sanitizeDownloadFilename } from './fileHelpers';
import { getLocalBlob, saveLocalBlob } from './localVault';
import {
  DIRECT_TELEGRAM_MAX_BYTES,
  buildProxiedTelegramFileUrl,
  deleteTelegramMessageDirect,
  normalizeCorsProxyUrl,
  resolveTelegramFileUrl,
  tgApi,
  uploadFileDirectToTelegram,
} from './telegramDirect';

export class PreviewCorsBlockedError extends Error {
  readonly isCorsBlocked = true;
  constructor(message: string) {
    super(message);
    this.name = 'PreviewCorsBlockedError';
  }
}

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

const MAX_RATE_LIMIT_RETRIES = 4;
const MAX_TRANSIENT_RETRIES = 2;

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
  options?: { itemIdOverride?: string },
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

    // Ensure the dropped item is a readable file (not a directory handle pseudo-file)
    try {
      await file.slice(0, 1).arrayBuffer();
    } catch {
      throw new Error(`"${file.name}" berupa folder atau tidak dapat dibaca langsung oleh browser.`);
    }

    const id = options?.itemIdOverride || `file-${crypto.randomUUID()}`;
    const blobKey = `blob-${id}`;
    const now = new Date().toISOString();
    const mimeType = file.type || 'application/octet-stream';

    if (cancelled) {
      throw new Error('Dibatalkan');
    }

    let uploaded: { fileId: string; fileUniqueId: string; messageId: number } | null = null;
    let startedAt = performance.now();
    let rateLimitAttempts = 0;
    let transientAttempts = 0;

    while (true) {
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
        const typedErr = err as Error & {
          retryAfterSeconds?: number;
          isTransientNetworkError?: boolean;
        };
        if (!cancelled && typedErr.retryAfterSeconds && rateLimitAttempts < MAX_RATE_LIMIT_RETRIES) {
          rateLimitAttempts += 1;
          const waitSec = Math.min(65, Math.max(1, typedErr.retryAfterSeconds));
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
        if (
          !cancelled &&
          typedErr.isTransientNetworkError &&
          transientAttempts < MAX_TRANSIENT_RETRIES
        ) {
          transientAttempts += 1;
          const waitSec = transientAttempts * 2;
          onProgress({
            loadedBytes: 0,
            speedBytesPerSec: 0,
            etaSeconds: waitSec,
            completedChunks: 0,
            totalChunks: 1,
            status: 'active',
            errorMessage: `Koneksi terganggu, mencoba ulang (${transientAttempts}/${MAX_TRANSIENT_RETRIES})...`,
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

async function fetchTelegramFileResponse(
  tgUrl: string,
  corsProxyUrl?: string,
): Promise<Response> {
  const cleanProxy = normalizeCorsProxyUrl(corsProxyUrl);
  if (cleanProxy) {
    const proxiedUrl = buildProxiedTelegramFileUrl(tgUrl, cleanProxy);
    const res = await fetch(proxiedUrl);
    if (res.ok) return res;
    throw new Error(`Proxy pratinjau mengembalikan status HTTP ${res.status}.`);
  }
  return fetch(tgUrl);
}

async function refreshTelegramFileIdByMessageId(
  botToken: string,
  chatId: string,
  messageId: number,
): Promise<string | null> {
  if (!botToken || !chatId || !messageId) return null;
  try {
    const res = await fetch(tgApi(botToken, 'forwardMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        from_chat_id: chatId.trim(),
        message_id: messageId,
        disable_notification: true,
      }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      result?: {
        message_id: number;
        document?: { file_id: string };
        video?: { file_id: string };
        audio?: { file_id: string };
        photo?: Array<{ file_id: string }>;
      };
    };
    if (!data.ok || !data.result) return null;
    const fileId =
      data.result.document?.file_id ||
      data.result.video?.file_id ||
      data.result.audio?.file_id ||
      (data.result.photo ? data.result.photo[data.result.photo.length - 1]?.file_id : undefined) ||
      null;
    if (data.result.message_id && data.result.message_id !== messageId) {
      void deleteTelegramMessageDirect(botToken, chatId, data.result.message_id);
    }
    return fileId;
  } catch {
    return null;
  }
}

async function resolveEffectiveTelegramFileUrl(
  item: DriveItem,
  tgConfig: TelegramConfigState,
): Promise<string> {
  const firstChunk = item.chunks?.[0];
  const tgFileId = firstChunk?.telegramFileId;
  const tgMsgId = firstChunk?.telegramMessageId;

  if (!tgConfig.botToken) {
    throw new Error('Koneksi Bot Telegram belum tersedia dan file belum tersimpan di perangkat ini.');
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Perangkat sedang offline dan file ini belum disimpan untuk akses offline.');
  }

  if (tgFileId) {
    try {
      return await resolveTelegramFileUrl(tgConfig.botToken, tgFileId);
    } catch (err) {
      if (tgMsgId && tgConfig.chatId) {
        const refreshedId = await refreshTelegramFileIdByMessageId(
          tgConfig.botToken,
          tgConfig.chatId,
          tgMsgId,
        );
        if (refreshedId) {
          return await resolveTelegramFileUrl(tgConfig.botToken, refreshedId);
        }
      }
      throw err;
    }
  }

  if (tgMsgId && tgConfig.chatId) {
    const refreshedId = await refreshTelegramFileIdByMessageId(
      tgConfig.botToken,
      tgConfig.chatId,
      tgMsgId,
    );
    if (refreshedId) {
      return await resolveTelegramFileUrl(tgConfig.botToken, refreshedId);
    }
  }

  throw new Error('File belum memiliki ID Telegram yang valid. Coba sinkronkan ulang atau unggah ulang.');
}

export async function resolveItemPlayableUrl(
  item: DriveItem,
  tgConfig: TelegramConfigState,
  options?: { forceTypedBlob?: boolean; mimeOverride?: string },
): Promise<{ url: string; isObjectUrl: boolean } | null> {
  const effectiveMime = resolveMimeTypeForFilename(
    item.name,
    options?.mimeOverride || item.mimeType || 'application/octet-stream',
  );

  const cachedBlob = await getCachedBlobForItem(item);
  if (cachedBlob) {
    const typed =
      effectiveMime && cachedBlob.type !== effectiveMime
        ? new Blob([cachedBlob], { type: effectiveMime })
        : cachedBlob;
    return { url: URL.createObjectURL(typed), isObjectUrl: true };
  }

  if (item.size > DIRECT_TELEGRAM_MAX_BYTES) {
    throw new Error('File di atas 20 MB hanya bisa dibuka langsung di aplikasi Telegram.');
  }

  const tgUrl = await resolveEffectiveTelegramFileUrl(item, tgConfig);
  const hasProxy = Boolean(normalizeCorsProxyUrl(tgConfig.corsProxyUrl));

  // Whenever CORS proxy is available (or typed blob required), fetch & wrap with the real MIME type
  // because Telegram sendDocument often serves files as application/octet-stream.
  if (hasProxy || options?.forceTypedBlob) {
    try {
      const res = await fetchTelegramFileResponse(tgUrl, tgConfig.corsProxyUrl);
      if (!res.ok) {
        throw new Error(`Server file mengembalikan status HTTP ${res.status}.`);
      }
      const rawBlob = await res.blob();
      const typedBlob =
        rawBlob.type === effectiveMime ? rawBlob : new Blob([rawBlob], { type: effectiveMime });
      await saveLocalBlob(`blob-${item.id}`, typedBlob);
      return { url: URL.createObjectURL(typedBlob), isObjectUrl: true };
    } catch (err) {
      if (!hasProxy) {
        throw new PreviewCorsBlockedError(
          'Pratinjau langsung di browser dibatasi aturan CORS Telegram. Aktifkan Proxy Gratis (Cloudflare Worker) di Pengaturan Telegram.',
        );
      }
      throw err instanceof Error ? err : new Error('Gagal mengunduh file untuk pratinjau.');
    }
  }

  return { url: buildProxiedTelegramFileUrl(tgUrl, tgConfig.corsProxyUrl), isObjectUrl: false };
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

  const tgUrl = await resolveEffectiveTelegramFileUrl(item, tgConfig);
  let res: Response;
  try {
    res = await fetchTelegramFileResponse(tgUrl, tgConfig.corsProxyUrl);
  } catch (err) {
    if (!normalizeCorsProxyUrl(tgConfig.corsProxyUrl)) {
      throw new PreviewCorsBlockedError(
        'Pratinjau langsung file ini di perangkat lain dibatasi aturan CORS browser. Aktifkan Proxy Gratis (Cloudflare Worker) di Pengaturan Telegram.',
      );
    }
    throw err instanceof Error
      ? err
      : new Error('Gagal membaca file dari Cloud Telegram melalui proxy.');
  }
  if (!res.ok) {
    throw new Error('Gagal mengunduh file dari Cloud Telegram untuk pratinjau.');
  }
  const rawBlob = await res.blob();
  const mimeType = resolveMimeTypeForFilename(item.name, item.mimeType || rawBlob.type);
  const typedBlob = rawBlob.type === mimeType ? rawBlob : new Blob([rawBlob], { type: mimeType });
  await saveLocalBlob(`blob-${item.id}`, typedBlob);
  return typedBlob.arrayBuffer();
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
    throw new Error('File teks di atas 20 MB hanya bisa dibuka di Telegram.');
  }

  const tgUrl = await resolveEffectiveTelegramFileUrl(item, tgConfig);
  try {
    const res = await fetchTelegramFileResponse(tgUrl, tgConfig.corsProxyUrl);
    if (!res.ok) {
      throw new Error(`Gagal memuat file teks (HTTP ${res.status}).`);
    }
    const text = await res.text();
    await saveLocalBlob(
      `blob-${item.id}`,
      new Blob([text], { type: resolveMimeTypeForFilename(item.name, item.mimeType || 'text/plain') }),
    );
    return text;
  } catch (err) {
    if (!normalizeCorsProxyUrl(tgConfig.corsProxyUrl)) {
      throw new PreviewCorsBlockedError(
        'Pratinjau file teks di perangkat lain dibatasi aturan CORS browser. Aktifkan Proxy Gratis (Cloudflare Worker) di Pengaturan Telegram.',
      );
    }
    throw err instanceof Error ? err : new Error('Gagal membaca file teks.');
  }
}

function normalizeBlobForDownload(
  blob: Blob,
  filename: string,
  itemMimeType?: string,
): { blob: Blob; filename: string; mimeType: string } {
  const mimeType = resolveMimeTypeForFilename(filename, itemMimeType || blob.type);
  const safeFilename = sanitizeDownloadFilename(filename, mimeType);
  const normalizedBlob = blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });
  return { blob: normalizedBlob, filename: safeFilename, mimeType };
}

export function startDirectDownload(
  item: DriveItem,
  tgConfig: TelegramConfigState,
  onProgress: (update: TransferProgressUpdate) => void,
): { cancel: () => void; promise: Promise<{ usedRawFallback?: boolean }> } {
  let cancelled = false;
  let activeXhr: XMLHttpRequest | null = null;

  const cancel = () => {
    cancelled = true;
    activeXhr?.abort();
  };

  const promise = (async (): Promise<{ usedRawFallback?: boolean }> => {
    const startedAt = performance.now();

    const cachedBlob = await getCachedBlobForItem(item);
    if (cachedBlob) {
      const prepared = normalizeBlobForDownload(cachedBlob, item.name, item.mimeType);
      triggerBlobDownload(prepared.blob, prepared.filename);
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
      return { usedRawFallback: false };
    }

    if (item.size > DIRECT_TELEGRAM_MAX_BYTES) {
      throw new Error(
        'File di atas 20 MB tidak dapat diunduh lewat browser (batas Telegram Bot API). Gunakan tombol Buka di Telegram.',
      );
    }

    const tgFileId = item.chunks?.[0]?.telegramFileId;
    if (!tgFileId || !tgConfig.botToken) {
      throw new Error('File tidak tersedia di Cloud Telegram.');
    }

    const tgUrl = await resolveTelegramFileUrl(tgConfig.botToken, tgFileId);
    const hasProxy = Boolean(normalizeCorsProxyUrl(tgConfig.corsProxyUrl));
    const fetchUrl = buildProxiedTelegramFileUrl(tgUrl, tgConfig.corsProxyUrl);
    if (cancelled) throw new Error('Dibatalkan');

    // Download via XHR for real-time MB/s progress, ETA, and IndexedDB caching
    try {
      const downloadedBlob = await new Promise<Blob>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        activeXhr = xhr;
        xhr.open('GET', fetchUrl, true);
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

      const prepared = normalizeBlobForDownload(downloadedBlob, item.name, item.mimeType);
      await saveLocalBlob(`blob-${item.id}`, prepared.blob);
      triggerBlobDownload(prepared.blob, prepared.filename);

      const totalSize = item.size || prepared.blob.size;
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
      return { usedRawFallback: false };
    } catch (err) {
      if (err instanceof Error && err.message === 'Dibatalkan') {
        throw err;
      }

      const resolvedMime = resolveMimeTypeForFilename(item.name, item.mimeType);
      const safeName = sanitizeDownloadFilename(item.name, resolvedMime);

      if (hasProxy) {
        const directProxyUrl = buildProxiedTelegramFileUrl(tgUrl, tgConfig.corsProxyUrl, {
          filename: safeName,
          mimeType: resolvedMime,
        });
        const a = document.createElement('a');
        a.href = directProxyUrl;
        a.download = safeName;
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        // Without CORS proxy, browsers block XHR and ignore cross-origin a.download filenames
        const a = document.createElement('a');
        a.href = tgUrl;
        a.download = safeName;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }

      onProgress({
        loadedBytes: item.size,
        speedBytesPerSec: 0,
        etaSeconds: 0,
        completedChunks: 1,
        totalChunks: 1,
        status: 'completed',
        targetBackend: 'telegram',
      });
      return { usedRawFallback: !hasProxy };
    }
  })();

  return { cancel, promise };
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = sanitizeDownloadFilename(filename, blob.type);
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
