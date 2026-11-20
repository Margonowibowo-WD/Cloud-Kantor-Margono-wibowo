import type { DriveItem, TelegramConfigState, TelegramPublicStatus } from '../types/drive';
import {
  INDEX_SHARD_V3_HEADER,
  INDEX_V3_HEADER,
  type TelegramShardRef,
  buildTelegramV3Plan,
  decodeTelegramIndex,
  decodeTelegramV3Manifest,
  decodeTelegramV3Shard,
  encodeTelegramV3ManifestText,
  reconcileConcurrentDriveState,
} from './telegramIndex';

export const DIRECT_TELEGRAM_MAX_BYTES = 20 * 1024 * 1024; // 20 MB Telegram getFile limit
export const UPLOAD_CONCURRENCY = 1;
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
}

const fileUrlCache = new Map<string, { url: string; expiresAt: number }>();

function tgApi(botToken: string, method: string): string {
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
  };
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
): { cancel: () => void; promise: Promise<{ fileId: string; fileUniqueId: string; messageId: number }> } {
  const xhr = new XMLHttpRequest();

  const promise = new Promise<{ fileId: string; fileUniqueId: string; messageId: number }>(
    (resolve, reject) => {
      if (file.size > DIRECT_TELEGRAM_MAX_BYTES) {
        reject(
          new Error(
            'Ukuran file melebihi 20 MB (batas download langsung Telegram Bot API tanpa proxy).',
          ),
        );
        return;
      }

      const form = new FormData();
      form.append('chat_id', chatId.trim());
      form.append('caption', `TeleDrive: ${filename}`);
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
}

const shardReadCache = new Map<string, DriveItem[]>();

async function postBotTextMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<number | undefined> {
  try {
    const res = await fetch(tgApi(botToken, 'sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        text,
        disable_notification: true,
      }),
    });
    const data = (await res.json()) as { ok: boolean; result?: { message_id: number } };
    return data.ok && data.result ? data.result.message_id : undefined;
  } catch {
    return undefined;
  }
}

async function editBotTextMessage(
  botToken: string,
  chatId: string,
  messageId: number,
  text: string,
): Promise<boolean> {
  try {
    const res = await fetch(tgApi(botToken, 'editMessageText'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        message_id: messageId,
        text,
      }),
    });
    const data = (await res.json()) as { ok: boolean; description?: string };
    return Boolean(data.ok || data.description?.includes('message is not modified'));
  } catch {
    return false;
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
      void deleteTelegramMessageDirect(botToken, chatId, data.result.message_id);
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
  options?: { skipMergePull?: boolean },
): Promise<PushIndexResult | undefined> {
  let mergedItems = items;
  let mergedTombstones = tombstones;
  let targetMessageId = existingMessageId;
  let existingPinnedText: string | undefined;
  let existingShardRefs: TelegramShardRef[] = [];

  if (!options?.skipMergePull) {
    const remote = await pullIndexFromTelegramPinnedMessage(botToken, chatId);
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
      }
    }
  }

  const plan = await buildTelegramV3Plan(mergedItems, mergedTombstones);
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
    if (prevRef) {
      const edited = await editBotTextMessage(botToken, chatId, prevRef.id, batch.text);
      if (edited) {
        nextShardRefs.push({ id: prevRef.id, h: batch.hash });
        reusedShardIds.add(prevRef.id);
        shardReadCache.set(`${chatId.trim()}:${prevRef.id}:${batch.hash}`, batch.items);
        continue;
      }
    }
    const createdShardId = await postBotTextMessage(botToken, chatId, batch.text);
    if (createdShardId) {
      nextShardRefs.push({ id: createdShardId, h: batch.hash });
      reusedShardIds.add(createdShardId);
      shardReadCache.set(`${chatId.trim()}:${createdShardId}:${batch.hash}`, batch.items);
    }
  }

  // Delete obsolete overflow shard messages
  for (const oldRef of existingShardRefs) {
    if (!reusedShardIds.has(oldRef.id)) {
      void deleteTelegramMessageDirect(botToken, chatId, oldRef.id);
    }
  }

  const { text: manifestText } = await encodeTelegramV3ManifestText(
    plan.inlineItems,
    plan.cleanedTombstones,
    nextShardRefs,
  );

  // If the existing pinned message is already a text message, edit it cleanly in place
  const canEditExistingText =
    Boolean(targetMessageId) &&
    (existingPinnedText === undefined ||
      existingPinnedText.startsWith(INDEX_V3_HEADER) ||
      existingPinnedText.startsWith('TELEDRIVE_IDX_V1:'));

  if (targetMessageId && canEditExistingText) {
    const edited = await editBotTextMessage(botToken, chatId, targetMessageId, manifestText);
    if (edited) {
      return {
        pinnedMessageId: targetMessageId,
        syncedItems: mergedItems,
        syncedTombstones: mergedTombstones,
      };
    }
  }

  // Otherwise create a fresh pinned text manifest (e.g. migrating off legacy teledrive-index.json document)
  const newMsgId = await postBotTextMessage(botToken, chatId, manifestText);
  if (!newMsgId) {
    return {
      pinnedMessageId: targetMessageId,
      syncedItems: mergedItems,
      syncedTombstones: mergedTombstones,
    };
  }

  await fetch(tgApi(botToken, 'pinChatMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId.trim(),
      message_id: newMsgId,
      disable_notification: true,
    }),
  }).catch(() => undefined);

  if (targetMessageId && targetMessageId !== newMsgId) {
    void deleteTelegramMessageDirect(botToken, chatId, targetMessageId);
  }

  return {
    pinnedMessageId: newMsgId,
    syncedItems: mergedItems,
    syncedTombstones: mergedTombstones,
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
      if (
        post.text?.startsWith('TELEDRIVE_IDX_V1:') ||
        post.text?.startsWith(INDEX_V3_HEADER) ||
        post.text?.startsWith(INDEX_SHARD_V3_HEADER)
      ) {
        continue;
      }
      if (
        post.caption?.startsWith(INDEX_DOCUMENT_CAPTION_PREFIX) ||
        post.document?.file_name === INDEX_DOCUMENT_FILENAME
      ) {
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
): Promise<{
  items: DriveItem[];
  tombstones: Record<string, string>;
  pinnedMessageId?: number;
  rawPinnedText?: string;
  shardRefs?: TelegramShardRef[];
  hasIndex: boolean;
  isCompleteIndex: boolean;
  rawLength: number;
  error?: string;
}> {
  const verification = await verifyTelegramDirect(botToken, chatId);
  if (!verification.ok) {
    return {
      items: [],
      tombstones: {},
      hasIndex: false,
      isCompleteIndex: false,
      rawLength: 0,
      error: verification.error,
    };
  }

  let candidateText = verification.pinnedIndexText;
  let candidateMessageId = verification.pinnedMessageId;
  const resolvedChatId = (verification.chatId || chatId).trim();

  // If pinned message is not yet a V3/V1 text manifest, check recent channel updates as fallback
  const hasPinnedTextManifest = Boolean(
    candidateText &&
      (candidateText.startsWith(INDEX_V3_HEADER) || candidateText.startsWith('TELEDRIVE_IDX_V1:')),
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
          if (post.text?.startsWith(INDEX_V3_HEADER)) {
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

  if (candidateText?.startsWith(INDEX_V3_HEADER)) {
    const manifest = await decodeTelegramV3Manifest(candidateText);
    if (manifest.isV3) {
      const shardItems: DriveItem[] = [];
      for (const ref of manifest.shards) {
        const cacheKey = `${resolvedChatId}:${ref.id}:${ref.h}`;
        const cached = shardReadCache.get(cacheKey);
        if (cached) {
          shardItems.push(...cached);
          continue;
        }
        const rawShard = await readBotTextMessageById(botToken, resolvedChatId, ref.id);
        if (rawShard) {
          const decodedShard = await decodeTelegramV3Shard(rawShard);
          shardReadCache.set(cacheKey, decodedShard);
          shardItems.push(...decodedShard);
        }
      }

      return {
        items: [...manifest.items, ...shardItems],
        tombstones: manifest.tombstones,
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
