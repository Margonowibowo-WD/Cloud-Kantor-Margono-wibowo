import type { DriveItem, FileChunk, StorageBackend, TelegramConfigState } from '../types/drive';
import {
  computeByteSlices,
  resolveMimeTypeForFilename,
  sanitizeDownloadFilename,
} from './fileHelpers';
import { getLocalBlob, saveLocalBlob } from './localVault';
import {
  CHUNK_SIZE_BYTES,
  DIRECT_TELEGRAM_MAX_BYTES,
  MAX_BROWSER_UPLOAD_BYTES,
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
  elapsedSeconds?: number;
  completedChunks: number;
  totalChunks: number;
  status?: 'queued' | 'active' | 'completed' | 'error' | 'cancelled';
  statusLabel?: string;
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

    if (file.size > MAX_BROWSER_UPLOAD_BYTES) {
      throw new Error('Ukuran file melebihi batas aman browser (2 GB).');
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
    const mimeType = resolveMimeTypeForFilename(
      file.name,
      file.type || 'application/octet-stream',
    );
    const slices = computeByteSlices(file.size, CHUNK_SIZE_BYTES);
    const totalChunks = slices.length;
    const isMultiChunk = totalChunks > 1;

    if (cancelled) {
      throw new Error('Dibatalkan');
    }

    const uploadedChunks: FileChunk[] = [];
    const uploadStartedAt = performance.now();
    let uploadedBytesBefore = 0;

    try {
      for (const slice of slices) {
        if (cancelled) {
          throw new Error('Dibatalkan');
        }

        const chunkBlob = isMultiChunk ? file.slice(slice.start, slice.end) : file;
        const partFilename = isMultiChunk
          ? `${file.name}.part${String(slice.index + 1).padStart(3, '0')}`
          : file.name;
        const caption = isMultiChunk
          ? `TeleDrive: ${file.name} [Part ${slice.index + 1}/${totalChunks}]`
          : `TeleDrive: ${file.name}`;

        let uploaded: { fileId: string; fileUniqueId: string; messageId: number } | null = null;
        let rateLimitAttempts = 0;
        let transientAttempts = 0;

        while (true) {
          if (cancelled) {
            throw new Error('Dibatalkan');
          }

          try {
            const uploadOp = uploadFileDirectToTelegram(
              tgConfig.botToken,
              tgConfig.chatId,
              chunkBlob,
              partFilename,
              (loaded) => {
                const clampedChunkLoaded = Math.min(slice.size, Math.max(0, loaded));
                const totalLoaded = Math.min(file.size, uploadedBytesBefore + clampedChunkLoaded);
                const elapsed = Math.max(0.05, (performance.now() - uploadStartedAt) / 1000);
                const speed = totalLoaded / elapsed;
                const eta = speed > 0 ? Math.max(0, file.size - totalLoaded) / speed : 0;
                onProgress({
                  loadedBytes: totalLoaded,
                  speedBytesPerSec: speed,
                  etaSeconds: eta,
                  elapsedSeconds: elapsed,
                  completedChunks: slice.index,
                  totalChunks,
                  status: 'active',
                  statusLabel: isMultiChunk
                    ? `Bagian ${slice.index + 1}/${totalChunks}`
                    : undefined,
                  errorMessage: undefined,
                  targetBackend: 'telegram',
                });
              },
              { caption },
            );
            tgCancel = uploadOp.cancel;
            uploaded = await uploadOp.promise;
            tgCancel = null;
            break;
          } catch (err) {
            tgCancel = null;
            const typedErr = err as Error & {
              retryAfterSeconds?: number;
              isTransientNetworkError?: boolean;
            };
            if (!cancelled && typedErr.retryAfterSeconds && rateLimitAttempts < MAX_RATE_LIMIT_RETRIES) {
              rateLimitAttempts += 1;
              const waitSec = Math.min(65, Math.max(1, typedErr.retryAfterSeconds));
              const elapsed = Math.max(0.05, (performance.now() - uploadStartedAt) / 1000);
              onProgress({
                loadedBytes: uploadedBytesBefore,
                speedBytesPerSec: uploadedBytesBefore > 0 ? uploadedBytesBefore / elapsed : 0,
                etaSeconds: waitSec,
                elapsedSeconds: elapsed,
                completedChunks: slice.index,
                totalChunks,
                status: 'active',
                statusLabel: isMultiChunk ? `Bagian ${slice.index + 1}/${totalChunks}` : undefined,
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
              const elapsed = Math.max(0.05, (performance.now() - uploadStartedAt) / 1000);
              onProgress({
                loadedBytes: uploadedBytesBefore,
                speedBytesPerSec: uploadedBytesBefore > 0 ? uploadedBytesBefore / elapsed : 0,
                etaSeconds: waitSec,
                elapsedSeconds: elapsed,
                completedChunks: slice.index,
                totalChunks,
                status: 'active',
                statusLabel: isMultiChunk ? `Bagian ${slice.index + 1}/${totalChunks}` : undefined,
                errorMessage: `Koneksi terganggu, mencoba ulang bagian ${slice.index + 1}/${totalChunks} (${transientAttempts}/${MAX_TRANSIENT_RETRIES})...`,
                targetBackend: 'telegram',
              });
              await waitWithCancel(waitSec * 1000, () => cancelled);
              continue;
            }
            throw err;
          }
        }

        if (!uploaded) {
          throw new Error(`Gagal mengunggah bagian ${slice.index + 1}/${totalChunks}.`);
        }

        uploadedChunks.push({
          index: slice.index,
          size: slice.size,
          telegramFileId: uploaded.fileId,
          telegramUniqueId: uploaded.fileUniqueId,
          telegramMessageId: uploaded.messageId,
        });

        uploadedBytesBefore += slice.size;

        if (isMultiChunk && slice.index + 1 < totalChunks) {
          const elapsedAfterChunk = Math.max(0.05, (performance.now() - uploadStartedAt) / 1000);
          const speedAfterChunk = uploadedBytesBefore / elapsedAfterChunk;
          const etaAfterChunk =
            speedAfterChunk > 0 ? Math.max(0, file.size - uploadedBytesBefore) / speedAfterChunk : 0;
          onProgress({
            loadedBytes: uploadedBytesBefore,
            speedBytesPerSec: speedAfterChunk,
            etaSeconds: etaAfterChunk,
            elapsedSeconds: elapsedAfterChunk,
            completedChunks: slice.index + 1,
            totalChunks,
            status: 'active',
            statusLabel: `Bagian ${slice.index + 2}/${totalChunks}`,
            errorMessage: undefined,
            targetBackend: 'telegram',
          });
          // Gentle pause between chunks to avoid Telegram FloodWait & let UI breathe
          await waitWithCancel(350, () => cancelled);
        }
      }
    } catch (err) {
      // Clean up orphan partial chunks if user cancelled or multi-chunk upload failed mid-way
      if (isMultiChunk && uploadedChunks.length > 0 && tgConfig.botToken && tgConfig.chatId) {
        for (const chunk of uploadedChunks) {
          if (chunk.telegramMessageId) {
            void deleteTelegramMessageDirect(
              tgConfig.botToken,
              tgConfig.chatId,
              chunk.telegramMessageId,
            );
          }
        }
      }
      throw err;
    }

    // Only auto-cache files <= 20 MB locally so large files don't evict the 350 MB preview cache
    const shouldCacheLocally = file.size <= DIRECT_TELEGRAM_MAX_BYTES;
    if (shouldCacheLocally) {
      await saveLocalBlob(blobKey, file);
    }

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
      ...(shouldCacheLocally ? { localBlobKey: blobKey } : {}),
      chunks: uploadedChunks,
    };

    const elapsed = Math.max(0.05, (performance.now() - uploadStartedAt) / 1000);
    onProgress({
      loadedBytes: file.size,
      speedBytesPerSec: file.size / elapsed,
      etaSeconds: 0,
      elapsedSeconds: elapsed,
      completedChunks: totalChunks,
      totalChunks,
      status: 'completed',
      statusLabel: undefined,
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

async function resolveChunkTelegramUrl(
  chunk: FileChunk,
  tgConfig: TelegramConfigState,
): Promise<string> {
  const tgFileId = chunk.telegramFileId;
  const tgMsgId = chunk.telegramMessageId;

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

async function resolveEffectiveTelegramFileUrl(
  item: DriveItem,
  tgConfig: TelegramConfigState,
): Promise<string> {
  const firstChunk = item.chunks?.[0];
  if (!firstChunk) {
    throw new Error('File belum memiliki ID Telegram yang valid. Coba sinkronkan ulang atau unggah ulang.');
  }
  return resolveChunkTelegramUrl(firstChunk, tgConfig);
}

function downloadBlobViaXhr(
  url: string,
  expectedSize: number,
  onProgress: (loadedBytes: number) => void,
  registerCancel: (cancelFn: () => void) => void,
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    registerCancel(() => xhr.abort());
    xhr.open('GET', url, true);
    xhr.responseType = 'blob';

    xhr.onprogress = (ev) => {
      onProgress(Math.min(expectedSize || ev.loaded, ev.loaded));
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
}

async function assembleMultiChunkBlob(
  item: DriveItem,
  tgConfig: TelegramConfigState,
  onProgress?: (update: TransferProgressUpdate) => void,
  isCancelled?: () => boolean,
  registerXhrCancel?: (fn: (() => void) | null) => void,
): Promise<Blob> {
  const chunks = [...(item.chunks || [])].sort((a, b) => a.index - b.index);
  if (chunks.length === 0) {
    throw new Error('Metadata bagian file tidak ditemukan. Coba sinkronkan ulang.');
  }
  const hasProxy = Boolean(normalizeCorsProxyUrl(tgConfig.corsProxyUrl));
  if (!hasProxy) {
    throw new PreviewCorsBlockedError(
      'File di atas 20 MB terdiri dari beberapa bagian dan memerlukan Proxy Cloudflare Worker agar browser bisa menggabungkannya.',
    );
  }

  const startedAt = performance.now();
  const totalChunks = chunks.length;
  const totalSize = item.size || chunks.reduce((acc, c) => acc + (c.size || 0), 0);
  const blobs: Blob[] = [];
  let loadedBefore = 0;

  for (let i = 0; i < chunks.length; i += 1) {
    if (isCancelled?.()) {
      throw new Error('Dibatalkan');
    }
    const chunk = chunks[i];
    if (onProgress) {
      const elapsedStart = Math.max(0.05, (performance.now() - startedAt) / 1000);
      const speedStart = loadedBefore > 0 ? loadedBefore / elapsedStart : 0;
      const etaStart =
        speedStart > 0 && totalSize > 0 ? Math.max(0, totalSize - loadedBefore) / speedStart : 0;
      onProgress({
        loadedBytes: loadedBefore,
        speedBytesPerSec: speedStart,
        etaSeconds: etaStart,
        elapsedSeconds: elapsedStart,
        completedChunks: i,
        totalChunks,
        status: 'active',
        statusLabel: `Bagian ${i + 1}/${totalChunks}`,
        errorMessage: undefined,
        targetBackend: 'telegram',
      });
    }
    const tgUrl = await resolveChunkTelegramUrl(chunk, tgConfig);
    const proxiedUrl = buildProxiedTelegramFileUrl(tgUrl, tgConfig.corsProxyUrl);

    const chunkBlob = await downloadBlobViaXhr(
      proxiedUrl,
      chunk.size || 0,
      (chunkLoaded) => {
        if (!onProgress) return;
        const totalLoaded = Math.min(totalSize || Number.MAX_SAFE_INTEGER, loadedBefore + chunkLoaded);
        const elapsed = Math.max(0.05, (performance.now() - startedAt) / 1000);
        const speed = totalLoaded / elapsed;
        const eta = speed > 0 && totalSize > 0 ? Math.max(0, totalSize - totalLoaded) / speed : 0;
        onProgress({
          loadedBytes: totalLoaded,
          speedBytesPerSec: speed,
          etaSeconds: eta,
          elapsedSeconds: elapsed,
          completedChunks: i,
          totalChunks,
          status: 'active',
          statusLabel: `Bagian ${i + 1}/${totalChunks}`,
          errorMessage: undefined,
          targetBackend: 'telegram',
        });
      },
      (cancelFn) => registerXhrCancel?.(cancelFn),
    );
    registerXhrCancel?.(null);

    blobs.push(chunkBlob);
    loadedBefore += chunkBlob.size || chunk.size || 0;
  }

  const resolvedMime = resolveMimeTypeForFilename(item.name, item.mimeType);
  return new Blob(blobs, { type: resolvedMime });
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

  if ((item.chunks?.length || 0) > 1) {
    const assembled = await assembleMultiChunkBlob(item, tgConfig);
    const typed =
      effectiveMime && assembled.type !== effectiveMime
        ? new Blob([assembled], { type: effectiveMime })
        : assembled;
    return { url: URL.createObjectURL(typed), isObjectUrl: true };
  }

  if (item.size > DIRECT_TELEGRAM_MAX_BYTES) {
    throw new Error('File di atas 20 MB hanya bisa dibuka setelah diunggah sebagai potongan chunk.');
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

  if ((item.chunks?.length || 0) > 1) {
    const assembled = await assembleMultiChunkBlob(item, tgConfig);
    return assembled.arrayBuffer();
  }

  if (item.size > DIRECT_TELEGRAM_MAX_BYTES) {
    throw new Error('File di atas 20 MB belum memiliki data potongan untuk dibaca di browser.');
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
    throw new Error('File teks di atas 20 MB hanya bisa diunduh.');
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
  let activeAbort: (() => void) | null = null;

  const cancel = () => {
    cancelled = true;
    activeAbort?.();
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
        elapsedSeconds: elapsed,
        completedChunks: item.chunks?.length || 1,
        totalChunks: item.chunks?.length || 1,
        status: 'completed',
        statusLabel: undefined,
        errorMessage: undefined,
        targetBackend: 'telegram',
      });
      return { usedRawFallback: false };
    }

    // Multi-chunk file (> 20 MB split into <= 18 MB Telegram parts)
    if ((item.chunks?.length || 0) > 1) {
      const assembled = await assembleMultiChunkBlob(
        item,
        tgConfig,
        onProgress,
        () => cancelled,
        (fn) => {
          activeAbort = fn;
        },
      );
      const prepared = normalizeBlobForDownload(assembled, item.name, item.mimeType);
      triggerBlobDownload(prepared.blob, prepared.filename);
      const totalSize = item.size || prepared.blob.size;
      const elapsed = Math.max(0.05, (performance.now() - startedAt) / 1000);
      onProgress({
        loadedBytes: totalSize,
        speedBytesPerSec: totalSize / elapsed,
        etaSeconds: 0,
        elapsedSeconds: elapsed,
        completedChunks: item.chunks.length,
        totalChunks: item.chunks.length,
        status: 'completed',
        statusLabel: undefined,
        errorMessage: undefined,
        targetBackend: 'telegram',
      });
      return { usedRawFallback: false };
    }

    if (item.size > DIRECT_TELEGRAM_MAX_BYTES) {
      throw new Error(
        'File di atas 20 MB ini tidak memiliki metadata potongan. Gunakan tombol Buka di Telegram.',
      );
    }

    const firstChunk = item.chunks?.[0];
    if (!firstChunk || (!firstChunk.telegramFileId && !firstChunk.telegramMessageId) || !tgConfig.botToken) {
      throw new Error('File tidak tersedia di Cloud Telegram.');
    }

    const tgUrl = await resolveChunkTelegramUrl(firstChunk, tgConfig);
    const hasProxy = Boolean(normalizeCorsProxyUrl(tgConfig.corsProxyUrl));
    const fetchUrl = buildProxiedTelegramFileUrl(tgUrl, tgConfig.corsProxyUrl);
    if (cancelled) throw new Error('Dibatalkan');

    // Download via XHR for real-time MB/s progress, ETA, and IndexedDB caching
    try {
      const downloadedBlob = await downloadBlobViaXhr(
        fetchUrl,
        item.size,
        (loaded) => {
          const total = item.size || loaded;
          const elapsed = Math.max(0.05, (performance.now() - startedAt) / 1000);
          const speed = loaded / elapsed;
          const eta = speed > 0 && total > 0 ? Math.max(0, total - loaded) / speed : 0;
          onProgress({
            loadedBytes: loaded,
            speedBytesPerSec: speed,
            etaSeconds: eta,
            elapsedSeconds: elapsed,
            completedChunks: 0,
            totalChunks: 1,
            status: 'active',
            statusLabel: undefined,
            errorMessage: undefined,
            targetBackend: 'telegram',
          });
        },
        (fn) => {
          activeAbort = fn;
        },
      );

      const prepared = normalizeBlobForDownload(downloadedBlob, item.name, item.mimeType);
      await saveLocalBlob(`blob-${item.id}`, prepared.blob);
      triggerBlobDownload(prepared.blob, prepared.filename);

      const totalSize = item.size || prepared.blob.size;
      const elapsed = Math.max(0.05, (performance.now() - startedAt) / 1000);
      onProgress({
        loadedBytes: totalSize,
        speedBytesPerSec: totalSize / elapsed,
        etaSeconds: 0,
        elapsedSeconds: elapsed,
        completedChunks: 1,
        totalChunks: 1,
        status: 'completed',
        statusLabel: undefined,
        errorMessage: undefined,
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

export function triggerBlobDownload(blob: Blob, filename: string): void {
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
