import type { DriveItem, TelegramConfigState, TelegramPublicStatus } from '../types/drive';
import {
  type CloudViewPrefs,
  INDEX_SHARD_V3_HEADER,
  INDEX_V3_HEADER,
  type TelegramShardRef,
  buildTelegramV3Plan,
  decodeTelegramIndex,
  decodeTelegramV3Manifest,
  decodeTelegramV3Shard,
  encodeTelegramV3ManifestText,
  extractV3Meta,
  extractV3RawLine,
  formatTelegramIndexHtml,
  formatTelegramShardHtml,
  reconcileConcurrentDriveState,
} from './telegramIndex';

export const DIRECT_TELEGRAM_MAX_BYTES = 20 * 1024 * 1024; // 20 MB Telegram getFile limit
export const CHUNK_SIZE_BYTES = 18 * 1024 * 1024; // 18 MB safe slice size under 20 MB limit
export const MAX_BROWSER_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB browser upload guard
export const MAX_LARGE_PREVIEW_BYTES = 120 * 1024 * 1024; // 120 MB on-demand large preview guard
export const UPLOAD_CONCURRENCY = 3;
export const INDEX_DOCUMENT_FILENAME = 'teledrive-index.json';
export const INDEX_DOCUMENT_CAPTION_PREFIX = 'TELEDRIVE_IDX_V2:';

export interface DetectedChat {
  id: string;
  title: string;
  type: string;
  username?: string;
}

export interface DirectVerifyResult {
  ok: boolean;
  botUsername?: string;
  botName?: string;
  chatId?: string;
  chatTitle?: string;
  chatType?: string;
  pinnedIndexText?: string;
  pinnedIndexDocumentFileId?: string;
  pinnedIndexDocumentName?: string;
  pinnedIndexCaption?: string;
  pinnedMessageId?: number;
  error?: string;
  isNetworkError?: boolean;
}

const fileUrlCache = new Map<string, { url: string; expiresAt: number }>();

export function tgApi(botToken: string, method: string): string {
  return `https://api.telegram.org/bot${botToken.trim()}/${method}`;
}

export function maskTelegramToken(token: string): string | undefined {
  const clean = token.trim();
  if (!clean) return undefined;
  if (clean.length <= 12) return '••••••••';
  return `${clean.slice(0, 7)}••••${clean.slice(-5)}`;
}

export function toPublicStatus(cfg: TelegramConfigState): TelegramPublicStatus {
  return {
    connected: cfg.connected,
    botUsername: cfg.botUsername,
    botName: cfg.botName,
    chatId: cfg.chatId || undefined,
    chatTitle: cfg.chatTitle,
    chatType: cfg.chatType,
    maskedToken: maskTelegramToken(cfg.botToken),
    chunkSizeMb: 20,
    concurrency: UPLOAD_CONCURRENCY,
    autoSync: cfg.autoSync,
    pinnedIndexMessageId: cfg.pinnedIndexMessageId,
    lastCheckedAt: cfg.lastSyncedAt,
    hasCorsProxy: Boolean(cfg.corsProxyUrl?.trim()),
  };
}

export const CLOUDFLARE_WORKER_CORS_SNIPPET = `export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get('url') || '';
    if (!target.startsWith('https://api.telegram.org/file/bot')) {
      return new Response('Forbidden', { status: 403 });
    }
    const upstream = await fetch(target);
    const headers = new Headers(upstream.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    const dl = reqUrl.searchParams.get('dl') === '1';
    const filename = (reqUrl.searchParams.get('filename') || '').replace(/[\\r\\n"]/g, '_').trim();
    const mime = (reqUrl.searchParams.get('mime') || '').trim();
    if (dl && filename) {
      const safeAscii = filename.replace(/[^\\x20-\\x7E]/g, '_');
      headers.set('Content-Disposition', \`attachment; filename="\${safeAscii}"; filename*=UTF-8''\${encodeURIComponent(filename)}\`);
      if (mime) headers.set('Content-Type', mime);
    } else {
      headers.delete('Content-Disposition');
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};`;

export function normalizeCorsProxyUrl(raw?: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

export function buildProxiedTelegramFileUrl(
  tgUrl: string,
  corsProxyUrl?: string,
  downloadOptions?: { filename: string; mimeType?: string },
): string {
  const cleanProxy = normalizeCorsProxyUrl(corsProxyUrl);
  if (!cleanProxy) return tgUrl;
  const sep = cleanProxy.includes('?') ? '&' : '?';
  let result = `${cleanProxy}${sep}url=${encodeURIComponent(tgUrl)}`;
  if (downloadOptions?.filename) {
    result += `&dl=1&filename=${encodeURIComponent(downloadOptions.filename)}`;
    if (downloadOptions.mimeType) {
      result += `&mime=${encodeURIComponent(downloadOptions.mimeType)}`;
    }
  }
  return result;
}

export async function verifyTelegramDirect(
  botToken: string,
  chatId?: string,
): Promise<DirectVerifyResult> {
  const token = botToken.trim();
  if (!token || !token.includes(':')) {
    return {
      ok: false,
      error: 'Format Bot Token tidak valid. Contoh format yang benar: 123456789:AAHdef...',
    };
  }

  try {
    const meRes = await fetch(tgApi(token, 'getMe'), { method: 'POST' });
    const meData = (await meRes.json()) as {
      ok: boolean;
      description?: string;
      result?: { username?: string; first_name?: string };
    };

    if (!meData.ok || !meData.result) {
      return { ok: false, error: meData.description || 'Bot Token ditolak oleh Telegram.' };
    }

    const result: DirectVerifyResult = {
      ok: true,
      botUsername: meData.result.username,
      botName: meData.result.first_name,
    };

    const trimmedChat = chatId?.trim();
    if (trimmedChat) {
      const chatRes = await fetch(tgApi(token, 'getChat'), {
        method: 'POST',
        body: new URLSearchParams({ chat_id: trimmedChat }),
      });
      const chatData = (await chatRes.json()) as {
        ok: boolean;
        description?: string;
        result?: {
          id: number | string;
          title?: string;
          first_name?: string;
          username?: string;
          type?: string;
          pinned_message?: {
            message_id: number;
            text?: string;
            caption?: string;
            document?: {
              file_id: string;
              file_name?: string;
              mime_type?: string;
              file_size?: number;
            };
          };
        };
      };

      if (!chatData.ok || !chatData.result) {
        return {
          ok: false,
          botUsername: result.botUsername,
          botName: result.botName,
          error:
            chatData.description ||
            'Bot valid, tetapi tidak bisa mengakses Chat ID tersebut. Pastikan bot menjadi Admin Channel/Grup atau sudah dikirimi /start.',
        };
      }

      result.chatId = String(chatData.result.id);
      result.chatTitle =
        chatData.result.title ||
        chatData.result.first_name ||
        chatData.result.username ||
        String(chatData.result.id);
      result.chatType = chatData.result.type || 'chat';
      result.pinnedIndexText = chatData.result.pinned_message?.text;
      result.pinnedIndexDocumentFileId = chatData.result.pinned_message?.document?.file_id;
      result.pinnedIndexDocumentName = chatData.result.pinned_message?.document?.file_name;
      result.pinnedIndexCaption = chatData.result.pinned_message?.caption;
      result.pinnedMessageId = chatData.result.pinned_message?.message_id;
    }

    return result;
  } catch (err) {
    return {
      ok: false,
      isNetworkError: true,
      error: err instanceof Error ? err.message : 'Gagal menghubungi server Telegram API.',
    };
  }
}

export async function fetchPinnedChatInfoQuick(
  botToken: string,
  chatId: string,
): Promise<{
  ok: boolean;
  chatId?: string;
  pinnedMessageId?: number;
  pinnedIndexText?: string;
  error?: string;
}> {
  const token = botToken.trim();
  const trimmedChat = chatId.trim();
  if (!token || !trimmedChat) {
    return { ok: false, error: 'Konfigurasi Telegram tidak lengkap.' };
  }
  try {
    const chatRes = await fetch(tgApi(token, 'getChat'), {
      method: 'POST',
      body: new URLSearchParams({ chat_id: trimmedChat }),
    });
    const chatData = (await chatRes.json()) as {
      ok: boolean;
      description?: string;
      result?: {
        id: number | string;
        pinned_message?: {
          message_id: number;
          text?: string;
        };
      };
    };
    if (!chatData.ok || !chatData.result) {
      return {
        ok: false,
        error: chatData.description || 'Gagal membaca pembaruan channel Telegram.',
      };
    }
    return {
      ok: true,
      chatId: String(chatData.result.id),
      pinnedMessageId: chatData.result.pinned_message?.message_id,
      pinnedIndexText: chatData.result.pinned_message?.text,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal menghubungi server Telegram API.',
    };
  }
}

export async function detectTelegramChatsDirect(botToken: string): Promise<{
  ok: boolean;
  chats: DetectedChat[];
  error?: string;
}> {
  const token = botToken.trim();
  if (!token) {
    return { ok: false, chats: [], error: 'Masukkan Bot Token terlebih dahulu.' };
  }

  try {
    const res = await fetch(tgApi(token, 'getUpdates'), {
      method: 'POST',
      body: new URLSearchParams({ limit: '50' }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      description?: string;
      result?: Array<{
        message?: { chat?: { id: number; title?: string; first_name?: string; username?: string; type?: string } };
        channel_post?: { chat?: { id: number; title?: string; first_name?: string; username?: string; type?: string } };
        my_chat_member?: { chat?: { id: number; title?: string; first_name?: string; username?: string; type?: string } };
      }>;
    };

    if (!data.ok) {
      return { ok: false, chats: [], error: data.description || 'Gagal membaca pembaruan Telegram.' };
    }

    const seen = new Map<string, DetectedChat>();
    for (const u of data.result || []) {
      const c = u.message?.chat || u.channel_post?.chat || u.my_chat_member?.chat;
      if (!c) continue;
      const id = String(c.id);
      if (!seen.has(id)) {
        seen.set(id, {
          id,
          title: c.title || c.first_name || c.username || id,
          type: c.type || 'private',
          username: c.username,
        });
      }
    }

    return { ok: true, chats: Array.from(seen.values()) };
  } catch (err) {
    return {
      ok: false,
      chats: [],
      error: err instanceof Error ? err.message : 'Gagal menghubungi Telegram API.',
    };
  }
}

export function uploadFileDirectToTelegram(
  botToken: string,
  chatId: string,
  file: File | Blob,
  filename: string,
  onProgress: (loadedBytes: number, totalBytes: number) => void,
  options?: { caption?: string },
): { cancel: () => void; promise: Promise<{ fileId: string; fileUniqueId: string; messageId: number }> } {
  const xhr = new XMLHttpRequest();

  const promise = new Promise<{ fileId: string; fileUniqueId: string; messageId: number }>(
    (resolve, reject) => {
      if (file.size > DIRECT_TELEGRAM_MAX_BYTES) {
        reject(
          new Error(
            'Ukuran potongan file melebihi 20 MB (batas Telegram Bot API).',
          ),
        );
        return;
      }

      const form = new FormData();
      form.append('chat_id', chatId.trim());
      form.append('caption', options?.caption || `TeleDrive: ${filename}`);
      form.append('document', file, filename);

      xhr.open('POST', tgApi(botToken, 'sendDocument'), true);
      xhr.timeout = 300_000;

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          onProgress(ev.loaded, ev.total);
        }
      };

      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText) as {
            ok: boolean;
            error_code?: number;
            description?: string;
            parameters?: { retry_after?: number };
            result?: {
              message_id: number;
              document?: { file_id: string; file_unique_id: string };
              video?: { file_id: string; file_unique_id: string };
              audio?: { file_id: string; file_unique_id: string };
              photo?: Array<{ file_id: string; file_unique_id: string }>;
            };
          };
          if (xhr.status < 200 || xhr.status >= 300 || !data.ok || !data.result) {
            const err = new Error(data.description || 'Telegram menolak unggahan file ini.') as Error & {
              retryAfterSeconds?: number;
              isTransientNetworkError?: boolean;
            };
            if (xhr.status === 429 || data.error_code === 429) {
              err.retryAfterSeconds = Math.max(1, Number(data.parameters?.retry_after) || 5);
            } else if (xhr.status >= 500 || xhr.status === 0) {
              err.isTransientNetworkError = true;
            }
            reject(err);
            return;
          }
          const doc =
            data.result.document ||
            data.result.video ||
            data.result.audio ||
            (data.result.photo ? data.result.photo[data.result.photo.length - 1] : undefined);
          if (!doc) {
            reject(new Error('Telegram tidak mengembalikan file_id.'));
            return;
          }
          resolve({
            fileId: doc.file_id,
            fileUniqueId: doc.file_unique_id,
            messageId: data.result.message_id,
          });
        } catch {
          const err = new Error('Respons Telegram tidak valid.') as Error & {
            isTransientNetworkError?: boolean;
          };
          if (xhr.status >= 500 || xhr.status === 0) {
            err.isTransientNetworkError = true;
          }
          reject(err);
        }
      };

      xhr.onerror = () => {
        const err = new Error('Koneksi terputus saat mengunggah ke Telegram.') as Error & {
          isTransientNetworkError?: boolean;
        };
        err.isTransientNetworkError = true;
        reject(err);
      };
      xhr.ontimeout = () => {
        const err = new Error('Waktu tunggu habis saat mengunggah ke Telegram.') as Error & {
          isTransientNetworkError?: boolean;
        };
        err.isTransientNetworkError = true;
        reject(err);
      };
      xhr.onabort = () => reject(new Error('Dibatalkan'));
      xhr.send(form);
    },
  );

  return {
    cancel: () => xhr.abort(),
    promise,
  };
}

export async function resolveTelegramFileUrl(botToken: string, fileId: string): Promise<string> {
  const key = `${botToken.slice(0, 12)}:${fileId}`;
  const cached = fileUrlCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  const res = await fetch(tgApi(botToken, 'getFile'), {
    method: 'POST',
    body: new URLSearchParams({ file_id: fileId }),
  });
  const data = (await res.json()) as {
    ok: boolean;
    description?: string;
    result?: { file_path?: string };
  };

  if (!data.ok || !data.result?.file_path) {
    throw new Error(
      data.description || 'Gagal mengambil tautan unduhan dari Telegram (maks 20 MB).',
    );
  }

  const url = `https://api.telegram.org/file/bot${botToken.trim()}/${data.result.file_path}`;
  fileUrlCache.set(key, { url, expiresAt: Date.now() + 30 * 60 * 1000 });
  return url;
}

export async function deleteTelegramMessageDirect(
  botToken: string,
  chatId: string,
  messageId: number,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(tgApi(botToken, 'deleteMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId.trim(), message_id: messageId }),
    });
    const data = (await res.json()) as { ok: boolean; description?: string };
    if (data.ok) return { ok: true };
    const desc = data.description || '';
    if (
      desc.toLowerCase().includes('message to delete not found') ||
      desc.toLowerCase().includes('message_id_invalid')
    ) {
      return { ok: true };
    }
    return { ok: false, error: desc || 'Telegram menolak penghapusan pesan.' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal menghubungi Telegram API.',
    };
  }
}

export async function checkTelegramMessageExists(
  botToken: string,
  chatId: string,
  messageId: number,
): Promise<'exists' | 'deleted' | 'unknown'> {
  try {
    const res = await fetch(tgApi(botToken, 'editMessageReplyMarkup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      }),
    });
    const data = (await res.json()) as { ok: boolean; description?: string; error_code?: number };
    if (data.ok) return 'exists';
    const desc = (data.description || '').toLowerCase();
    if (
      desc.includes('message to edit not found') ||
      desc.includes('message_id_invalid') ||
      desc.includes('message not found')
    ) {
      return 'deleted';
    }
    if (
      desc.includes('message is not modified') ||
      desc.includes("message can't be edited")
    ) {
      return 'exists';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export interface PushIndexResult {
  pinnedMessageId?: number;
  syncedItems: DriveItem[];
  syncedTombstones: Record<string, string>;
  syncedPrefs?: CloudViewPrefs;
  rev?: string;
  pinBlocked?: boolean;
}

const SHARD_CACHE_STORAGE_KEY = 'teledrive_shard_cache_v1';
const shardReadCache = new Map<string, DriveItem[]>();

function loadPersistedShard(cacheKey: string): DriveItem[] | undefined {
  const mem = shardReadCache.get(cacheKey);
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(SHARD_CACHE_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Record<string, DriveItem[]>;
    const found = parsed?.[cacheKey];
    if (Array.isArray(found)) {
      shardReadCache.set(cacheKey, found);
      return found;
    }
  } catch {
    // ignore storage errors
  }
  return undefined;
}

function savePersistedShard(cacheKey: string, items: DriveItem[]): void {
  shardReadCache.set(cacheKey, items);
  try {
    const raw = localStorage.getItem(SHARD_CACHE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, DriveItem[]>) : {};
    const next: Record<string, DriveItem[]> = parsed && typeof parsed === 'object' ? { ...parsed } : {};
    next[cacheKey] = items;
    const keys = Object.keys(next);
    if (keys.length > 40) {
      for (const oldKey of keys.slice(0, keys.length - 40)) {
        delete next[oldKey];
      }
    }
    localStorage.setItem(SHARD_CACHE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage quota errors
  }
}

function mergeNewerPrefs(local?: CloudViewPrefs, remote?: CloudViewPrefs): CloudViewPrefs | undefined {
  if (!local && !remote) return undefined;
  if (!local) return remote;
  if (!remote) return local;
  const localMs = local.u ? Date.parse(local.u) || 0 : 0;
  const remoteMs = remote.u ? Date.parse(remote.u) || 0 : 0;
  const winner = remoteMs > localMs ? remote : local;
  const loser = remoteMs > localMs ? local : remote;
  const px = winner.px !== undefined ? winner.px : loser.px;
  return px !== undefined ? { ...winner, px } : winner;
}

export async function postBotTextMessage(
  botToken: string,
  chatId: string,
  text: string,
  parseMode?: 'HTML',
): Promise<number | undefined> {
  try {
    const res = await fetch(tgApi(botToken, 'sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        text,
        disable_notification: true,
        ...(parseMode ? { parse_mode: parseMode } : {}),
      }),
    });
    const data = (await res.json()) as { ok: boolean; result?: { message_id: number } };
    return data.ok && data.result ? data.result.message_id : undefined;
  } catch {
    return undefined;
  }
}

export async function editBotTextMessage(
  botToken: string,
  chatId: string,
  messageId: number,
  text: string,
  parseMode?: 'HTML',
): Promise<{ ok: boolean; notFound?: boolean; description?: string }> {
  try {
    const res = await fetch(tgApi(botToken, 'editMessageText'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        message_id: messageId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
      }),
    });
    const data = (await res.json()) as { ok: boolean; description?: string };
    const desc = (data.description || '').toLowerCase();
    if (data.ok || desc.includes('message is not modified')) {
      return { ok: true };
    }
    const notFound =
      desc.includes('message to edit not found') ||
      desc.includes('message_id_invalid') ||
      desc.includes("message can't be edited");
    return { ok: false, notFound, description: data.description };
  } catch {
    return { ok: false, notFound: false };
  }
}

async function readBotTextMessageById(
  botToken: string,
  chatId: string,
  messageId: number,
): Promise<string | null> {
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
      result?: { message_id: number; text?: string };
    };
    if (!data.ok || !data.result) return null;
    const text = data.result.text || null;
    if (data.result.message_id && data.result.message_id !== messageId) {
      await deleteTelegramMessageDirect(botToken, chatId, data.result.message_id);
    }
    return text;
  } catch {
    return null;
  }
}

export async function pushIndexToTelegramPinnedMessage(
  botToken: string,
  chatId: string,
  items: DriveItem[],
  existingMessageId?: number,
  tombstones: Record<string, string> = {},
  options?: {
    skipMergePull?: boolean;
    prefs?: CloudViewPrefs;
    existingPinnedText?: string;
    existingShardRefs?: TelegramShardRef[];
  },
): Promise<PushIndexResult | undefined> {
  let mergedItems = items;
  let mergedTombstones = tombstones;
  let mergedPrefs = options?.prefs;
  let targetMessageId = existingMessageId;
  let existingPinnedText: string | undefined = options?.existingPinnedText;
  let existingShardRefs: TelegramShardRef[] = options?.existingShardRefs || [];

  if (!options?.skipMergePull) {
    const remote = await pullIndexFromTelegramPinnedMessage(botToken, chatId, {
      skipVerifyGetMe: true,
    });
    if (!remote.error) {
      if (remote.pinnedMessageId) {
        targetMessageId = remote.pinnedMessageId;
      }
      existingPinnedText = remote.rawPinnedText;
      existingShardRefs = remote.shardRefs || [];
      if (remote.hasIndex) {
        const reconciled = reconcileConcurrentDriveState(
          items,
          remote.items,
          [],
          tombstones,
          remote.tombstones,
        );
        mergedItems = reconciled.items;
        mergedTombstones = reconciled.tombstones;
        mergedPrefs = mergeNewerPrefs(options?.prefs, remote.prefs);
      }
    }
  }

  const plan = await buildTelegramV3Plan(mergedItems, mergedTombstones, mergedPrefs);
  const nextShardRefs: TelegramShardRef[] = [];
  const reusedShardIds = new Set<number>();

  for (let idx = 0; idx < plan.shardBatches.length; idx += 1) {
    const batch = plan.shardBatches[idx];
    const prevRef = existingShardRefs[idx];
    if (prevRef && prevRef.h === batch.hash) {
      nextShardRefs.push(prevRef);
      reusedShardIds.add(prevRef.id);
      continue;
    }
    const formattedShard = formatTelegramShardHtml(batch.text, idx + 1);
    if (prevRef) {
      const editShard = await editBotTextMessage(
        botToken,
        chatId,
        prevRef.id,
        formattedShard,
        'HTML',
      );
      if (editShard.ok) {
        nextShardRefs.push({ id: prevRef.id, h: batch.hash });
        reusedShardIds.add(prevRef.id);
        savePersistedShard(`${chatId.trim()}:${prevRef.id}:${batch.hash}`, batch.items);
        continue;
      }
      if (!editShard.notFound) {
        nextShardRefs.push(prevRef);
        reusedShardIds.add(prevRef.id);
        continue;
      }
    }
    const createdShardId = await postBotTextMessage(botToken, chatId, formattedShard, 'HTML');
    if (createdShardId) {
      nextShardRefs.push({ id: createdShardId, h: batch.hash });
      reusedShardIds.add(createdShardId);
      savePersistedShard(`${chatId.trim()}:${createdShardId}:${batch.hash}`, batch.items);
    }
  }

  // Delete obsolete overflow shard messages cleanly without duplicate requests
  const deletedShardIds = new Set<number>();
  for (const oldRef of existingShardRefs) {
    if (!reusedShardIds.has(oldRef.id) && !deletedShardIds.has(oldRef.id)) {
      deletedShardIds.add(oldRef.id);
      void deleteTelegramMessageDirect(botToken, chatId, oldRef.id);
    }
  }

  const { text: manifestText, rev } = await encodeTelegramV3ManifestText(
    plan.inlineItems,
    plan.cleanedTombstones,
    nextShardRefs,
    mergedPrefs,
  );
  const formattedPinnedHtml = formatTelegramIndexHtml(manifestText, mergedItems);

  // Skip write call only if remote pinned message already has the neat summary header AND exact same payload
  const alreadyFormattedCleanly = Boolean(existingPinnedText?.includes('TeleDrive Cloud'));
  if (
    targetMessageId &&
    alreadyFormattedCleanly &&
    extractV3RawLine(existingPinnedText) === manifestText
  ) {
    return {
      pinnedMessageId: targetMessageId,
      syncedItems: mergedItems,
      syncedTombstones: mergedTombstones,
      syncedPrefs: mergedPrefs,
      rev,
    };
  }

  // If the existing pinned message is already a text message, edit it cleanly in place
  const canEditExistingText =
    Boolean(targetMessageId) &&
    (existingPinnedText === undefined ||
      existingPinnedText.includes(INDEX_V3_HEADER) ||
      existingPinnedText.includes('TELEDRIVE_IDX_V1:'));

  if (targetMessageId && canEditExistingText) {
    const editRes = await editBotTextMessage(
      botToken,
      chatId,
      targetMessageId,
      formattedPinnedHtml,
      'HTML',
    );
    if (editRes.ok) {
      return {
        pinnedMessageId: targetMessageId,
        syncedItems: mergedItems,
        syncedTombstones: mergedTombstones,
        syncedPrefs: mergedPrefs,
        rev,
      };
    }
    // IMPORTANT: Never spam new channel messages on transient errors or missing Edit permissions!
    if (!editRes.notFound) {
      return {
        pinnedMessageId: targetMessageId,
        syncedItems: mergedItems,
        syncedTombstones: mergedTombstones,
        syncedPrefs: mergedPrefs,
        rev,
      };
    }
  }

  // Only create a new pinned text manifest when there is no valid pinned text index yet
  const newMsgId = await postBotTextMessage(botToken, chatId, formattedPinnedHtml, 'HTML');
  if (!newMsgId) {
    return {
      pinnedMessageId: targetMessageId,
      syncedItems: mergedItems,
      syncedTombstones: mergedTombstones,
      syncedPrefs: mergedPrefs,
      rev,
    };
  }

  let pinBlocked = false;
  try {
    const pinRes = await fetch(tgApi(botToken, 'pinChatMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        message_id: newMsgId,
        disable_notification: true,
      }),
    });
    const pinData = (await pinRes.json()) as { ok: boolean };
    if (!pinData.ok) pinBlocked = true;
  } catch {
    pinBlocked = true;
  }

  if (targetMessageId && targetMessageId !== newMsgId) {
    void deleteTelegramMessageDirect(botToken, chatId, targetMessageId);
  }

  return {
    pinnedMessageId: newMsgId,
    syncedItems: mergedItems,
    syncedTombstones: mergedTombstones,
    syncedPrefs: mergedPrefs,
    rev,
    pinBlocked,
  };
}

export function buildTelegramMessageLink(
  chatId: string | undefined,
  messageId: number | undefined,
): string | null {
  if (!chatId || !messageId) return null;
  const clean = chatId.trim();
  if (clean.startsWith('-100')) {
    return `https://t.me/c/${clean.slice(4)}/${messageId}`;
  }
  return null;
}

interface TgChannelPostFile {
  message_id: number;
  date?: number;
  caption?: string;
  text?: string;
  chat?: { id: number | string };
  document?: { file_id: string; file_unique_id: string; file_name?: string; mime_type?: string; file_size?: number };
  video?: { file_id: string; file_unique_id: string; file_name?: string; mime_type?: string; file_size?: number };
  audio?: { file_id: string; file_unique_id: string; file_name?: string; mime_type?: string; file_size?: number };
  photo?: Array<{ file_id: string; file_unique_id: string; file_size?: number }>;
}

export async function fetchChannelMediaUpdates(
  botToken: string,
  chatId: string,
  knownMessageIds: Set<number>,
  dismissedMessageIds: Set<number>,
  activeIndexIds?: { pinnedMessageId?: number; shardIds?: Set<number> },
): Promise<DriveItem[]> {
  const token = botToken.trim();
  const targetChat = chatId.trim();
  if (!token || !targetChat) return [];

  try {
    const res = await fetch(tgApi(token, 'getUpdates'), {
      method: 'POST',
      body: new URLSearchParams({ limit: '100' }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      result?: Array<{ channel_post?: TgChannelPostFile; message?: TgChannelPostFile }>;
    };
    if (!data.ok || !Array.isArray(data.result)) return [];

    const discovered: DriveItem[] = [];

    for (const u of data.result) {
      const post = u.channel_post || u.message;
      if (!post || !post.chat) continue;
      if (String(post.chat.id) !== targetChat) continue;

      const isIndexText = Boolean(
        post.text?.includes('TELEDRIVE_IDX_V1:') ||
          post.text?.includes(INDEX_V3_HEADER) ||
          post.text?.includes('TELEDRIVE_IDX_V4:') ||
          post.text?.includes(INDEX_SHARD_V3_HEADER),
      );
      const isIndexDoc = Boolean(
        post.caption?.startsWith(INDEX_DOCUMENT_CAPTION_PREFIX) ||
          post.caption?.includes('TELEDRIVE_V4_') ||
          post.document?.file_name === INDEX_DOCUMENT_FILENAME ||
          post.document?.file_name?.startsWith('teledrive-'),
      );

      if (isIndexText || isIndexDoc) {
        if (activeIndexIds) {
          const isCurrentPinned =
            Boolean(activeIndexIds.pinnedMessageId) &&
            post.message_id === activeIndexIds.pinnedMessageId;
          const isCurrentShard = Boolean(activeIndexIds.shardIds?.has(post.message_id));
          if (
            !isCurrentPinned &&
            !isCurrentShard &&
            !post.caption?.includes('TELEDRIVE_V4_') &&
            !post.document?.file_name?.startsWith('teledrive-') &&
            (activeIndexIds.pinnedMessageId || post.document?.file_name === INDEX_DOCUMENT_FILENAME)
          ) {
            void deleteTelegramMessageDirect(token, targetChat, post.message_id);
          }
        }
        continue;
      }

      if (knownMessageIds.has(post.message_id) || dismissedMessageIds.has(post.message_id)) continue;

      const timestamp = post.date ? new Date(post.date * 1000).toISOString() : new Date().toISOString();
      const captionName = post.caption?.replace(/^TeleDrive:\s*/i, '').trim();

      if (post.document) {
        discovered.push({
          id: `tg-msg-${post.message_id}`,
          name: post.document.file_name || captionName || `Dokumen_TG_${post.message_id}`,
          type: 'file',
          parentId: null,
          size: post.document.file_size || 0,
          mimeType: post.document.mime_type || 'application/octet-stream',
          starred: false,
          trashed: false,
          createdAt: timestamp,
          updatedAt: timestamp,
          storageBackend: 'telegram',
          chunks: [
            {
              index: 0,
              size: post.document.file_size || 0,
              telegramFileId: post.document.file_id,
              telegramUniqueId: post.document.file_unique_id,
              telegramMessageId: post.message_id,
            },
          ],
        });
      } else if (post.video) {
        discovered.push({
          id: `tg-msg-${post.message_id}`,
          name: post.video.file_name || captionName || `Video_TG_${post.message_id}.mp4`,
          type: 'file',
          parentId: null,
          size: post.video.file_size || 0,
          mimeType: post.video.mime_type || 'video/mp4',
          starred: false,
          trashed: false,
          createdAt: timestamp,
          updatedAt: timestamp,
          storageBackend: 'telegram',
          chunks: [
            {
              index: 0,
              size: post.video.file_size || 0,
              telegramFileId: post.video.file_id,
              telegramUniqueId: post.video.file_unique_id,
              telegramMessageId: post.message_id,
            },
          ],
        });
      } else if (post.audio) {
        discovered.push({
          id: `tg-msg-${post.message_id}`,
          name: post.audio.file_name || captionName || `Audio_TG_${post.message_id}.mp3`,
          type: 'file',
          parentId: null,
          size: post.audio.file_size || 0,
          mimeType: post.audio.mime_type || 'audio/mpeg',
          starred: false,
          trashed: false,
          createdAt: timestamp,
          updatedAt: timestamp,
          storageBackend: 'telegram',
          chunks: [
            {
              index: 0,
              size: post.audio.file_size || 0,
              telegramFileId: post.audio.file_id,
              telegramUniqueId: post.audio.file_unique_id,
              telegramMessageId: post.message_id,
            },
          ],
        });
      } else if (post.photo && post.photo.length > 0) {
        const bestPhoto = post.photo[post.photo.length - 1];
        discovered.push({
          id: `tg-msg-${post.message_id}`,
          name: captionName || `Foto_TG_${post.message_id}.jpg`,
          type: 'file',
          parentId: null,
          size: bestPhoto.file_size || 0,
          mimeType: 'image/jpeg',
          starred: false,
          trashed: false,
          createdAt: timestamp,
          updatedAt: timestamp,
          storageBackend: 'telegram',
          chunks: [
            {
              index: 0,
              size: bestPhoto.file_size || 0,
              telegramFileId: bestPhoto.file_id,
              telegramUniqueId: bestPhoto.file_unique_id,
              telegramMessageId: post.message_id,
            },
          ],
        });
      }
    }

    return discovered;
  } catch {
    return [];
  }
}

export async function pullIndexFromTelegramPinnedMessage(
  botToken: string,
  chatId: string,
  options?: {
    skipVerifyGetMe?: boolean;
    prefetchedPinnedText?: string;
    prefetchedPinnedMessageId?: number;
    prefetchedChatId?: string;
    cachedRev?: string;
  },
): Promise<{
  items: DriveItem[];
  tombstones: Record<string, string>;
  prefs?: CloudViewPrefs;
  rev?: string;
  unchanged?: boolean;
  pinnedMessageId?: number;
  rawPinnedText?: string;
  shardRefs?: TelegramShardRef[];
  hasIndex: boolean;
  isCompleteIndex: boolean;
  rawLength: number;
  error?: string;
}> {
  let candidateText = options?.prefetchedPinnedText;
  let candidateMessageId = options?.prefetchedPinnedMessageId;
  let resolvedChatId = (options?.prefetchedChatId || chatId).trim();

  if (candidateText === undefined && candidateMessageId === undefined) {
    const check = options?.skipVerifyGetMe
      ? await fetchPinnedChatInfoQuick(botToken, chatId)
      : await verifyTelegramDirect(botToken, chatId);
    if (!check.ok) {
      return {
        items: [],
        tombstones: {},
        hasIndex: false,
        isCompleteIndex: false,
        rawLength: 0,
        error: check.error,
      };
    }
    candidateText = check.pinnedIndexText;
    candidateMessageId = check.pinnedMessageId;
    resolvedChatId = (check.chatId || chatId).trim();
  }

  // If pinned message is not yet a V3/V1 text manifest, check recent channel updates as fallback
  const hasPinnedTextManifest = Boolean(
    candidateText &&
      (candidateText.includes(INDEX_V3_HEADER) || candidateText.includes('TELEDRIVE_IDX_V1:')),
  );

  if (!hasPinnedTextManifest) {
    try {
      const updRes = await fetch(tgApi(botToken, 'getUpdates'), {
        method: 'POST',
        body: new URLSearchParams({ limit: '100' }),
      });
      const updData = (await updRes.json()) as {
        ok: boolean;
        result?: Array<{
          channel_post?: TgChannelPostFile;
          edited_channel_post?: TgChannelPostFile;
          message?: TgChannelPostFile;
          edited_message?: TgChannelPostFile;
        }>;
      };
      if (updData.ok && Array.isArray(updData.result)) {
        for (const u of updData.result) {
          const post =
            u.edited_channel_post || u.channel_post || u.edited_message || u.message;
          if (!post?.chat || String(post.chat.id) !== resolvedChatId) continue;
          if (post.text?.includes(INDEX_V3_HEADER)) {
            if (!candidateMessageId || !hasPinnedTextManifest || post.message_id >= candidateMessageId) {
              candidateText = post.text;
              candidateMessageId = post.message_id;
            }
          }
        }
      }
    } catch {
      // ignore fallback error
    }
  }

  if (candidateText?.includes(INDEX_V3_HEADER)) {
    const quickMeta = extractV3Meta(candidateText);
    if (options?.cachedRev && quickMeta?.rev && quickMeta.rev === options.cachedRev) {
      return {
        items: [],
        tombstones: {},
        rev: quickMeta.rev,
        unchanged: true,
        pinnedMessageId: candidateMessageId,
        rawPinnedText: candidateText,
        shardRefs: quickMeta.shardRefs,
        hasIndex: true,
        isCompleteIndex: true,
        rawLength: candidateText.length,
      };
    }

    const manifest = await decodeTelegramV3Manifest(candidateText);
    if (manifest.isV3) {
      const shardItems: DriveItem[] = [];
      for (const ref of manifest.shards) {
        const cacheKey = `${resolvedChatId}:${ref.id}:${ref.h}`;
        const cached = loadPersistedShard(cacheKey);
        if (cached) {
          shardItems.push(...cached);
          continue;
        }
        const rawShard = await readBotTextMessageById(botToken, resolvedChatId, ref.id);
        if (rawShard) {
          const decodedShard = await decodeTelegramV3Shard(rawShard);
          savePersistedShard(cacheKey, decodedShard);
          shardItems.push(...decodedShard);
        }
      }

      return {
        items: [...manifest.items, ...shardItems],
        tombstones: manifest.tombstones,
        prefs: manifest.prefs,
        rev: manifest.rev,
        unchanged: false,
        pinnedMessageId: candidateMessageId,
        rawPinnedText: candidateText,
        shardRefs: manifest.shards,
        hasIndex: true,
        isCompleteIndex: true,
        rawLength: candidateText.length,
      };
    }
  }

  const rawText = candidateText || '';
  const hasV1 = rawText.startsWith('TELEDRIVE_IDX_V1:');
  const items = decodeTelegramIndex(rawText);
  return {
    items,
    tombstones: {},
    pinnedMessageId: candidateMessageId,
    rawPinnedText: rawText || undefined,
    hasIndex: hasV1,
    isCompleteIndex: hasV1 && rawText.length < 3600,
    rawLength: rawText.length,
  };
}

export function buildTelegramMessageUrl(chatId: string, messageId: number): string | null {
  const cleanChat = chatId.trim();
  if (!cleanChat || !Number.isFinite(messageId) || messageId <= 0) return null;
  if (cleanChat.startsWith('-100') && cleanChat.length > 4) {
    return `https://t.me/c/${cleanChat.slice(4)}/${messageId}`;
  }
  if (cleanChat.startsWith('@') && cleanChat.length > 1) {
    return `https://t.me/${cleanChat.slice(1)}/${messageId}`;
  }
  return null;
}

