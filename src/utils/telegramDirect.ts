import type { DriveItem, TelegramConfigState, TelegramPublicStatus } from '../types/drive';
import {
  decodeTelegramDocumentIndex,
  decodeTelegramIndex,
  encodeTelegramDocumentIndex,
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
    const meRes = await fetch(tgApi(token, 'getMe'));
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
      const chatRes = await fetch(
        `${tgApi(token, 'getChat')}?chat_id=${encodeURIComponent(trimmedChat)}`,
      );
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
    const res = await fetch(`${tgApi(token, 'getUpdates')}?limit=50`);
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

  const res = await fetch(`${tgApi(botToken, 'getFile')}?file_id=${encodeURIComponent(fileId)}`);
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

export async function pushIndexToTelegramPinnedMessage(
  botToken: string,
  chatId: string,
  items: DriveItem[],
  existingMessageId?: number,
): Promise<number | undefined> {
  const jsonText = encodeTelegramDocumentIndex(items);
  const blob = new Blob([jsonText], { type: 'application/json' });
  const caption = `${INDEX_DOCUMENT_CAPTION_PREFIX}${items.length} item`;

  if (existingMessageId) {
    try {
      const form = new FormData();
      form.append('chat_id', chatId.trim());
      form.append('message_id', String(existingMessageId));
      form.append(
        'media',
        JSON.stringify({
          type: 'document',
          media: 'attach://index_file',
          caption,
        }),
      );
      form.append('index_file', blob, INDEX_DOCUMENT_FILENAME);

      const editRes = await fetch(tgApi(botToken, 'editMessageMedia'), {
        method: 'POST',
        body: form,
      });
      const editData = (await editRes.json()) as { ok: boolean; description?: string };
      if (editData.ok || editData.description?.includes('message is not modified')) {
        return existingMessageId;
      }
    } catch {
      // Fall through to send + pin a fresh document index message (e.g. migrating from legacy v1 text index)
    }
  }

  try {
    const form = new FormData();
    form.append('chat_id', chatId.trim());
    form.append('caption', caption);
    form.append('disable_notification', 'true');
    form.append('document', blob, INDEX_DOCUMENT_FILENAME);

    const sendRes = await fetch(tgApi(botToken, 'sendDocument'), {
      method: 'POST',
      body: form,
    });
    const sendData = (await sendRes.json()) as {
      ok: boolean;
      result?: { message_id: number };
    };
    if (!sendData.ok || !sendData.result) return existingMessageId;

    const newMsgId = sendData.result.message_id;
    await fetch(tgApi(botToken, 'pinChatMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        message_id: newMsgId,
        disable_notification: true,
      }),
    }).catch(() => undefined);

    // Clean up old replaced index message if migrating or recreating
    if (existingMessageId && existingMessageId !== newMsgId) {
      void deleteTelegramMessageDirect(botToken, chatId, existingMessageId);
    }

    return newMsgId;
  } catch {
    return existingMessageId;
  }
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
    const res = await fetch(`${tgApi(token, 'getUpdates')}?limit=100`);
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
      if (post.text?.startsWith('TELEDRIVE_IDX_V1:')) continue;
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
  pinnedMessageId?: number;
  hasIndex: boolean;
  isCompleteIndex: boolean;
  rawLength: number;
  error?: string;
}> {
  const verification = await verifyTelegramDirect(botToken, chatId);
  if (!verification.ok) {
    return {
      items: [],
      hasIndex: false,
      isCompleteIndex: false,
      rawLength: 0,
      error: verification.error,
    };
  }

  // Prefer unlimited v2 JSON document pinned index
  const isV2Doc =
    Boolean(verification.pinnedIndexDocumentFileId) &&
    (verification.pinnedIndexCaption?.startsWith(INDEX_DOCUMENT_CAPTION_PREFIX) ||
      verification.pinnedIndexDocumentName === INDEX_DOCUMENT_FILENAME ||
      !verification.pinnedIndexText);

  if (isV2Doc && verification.pinnedIndexDocumentFileId) {
    try {
      const docUrl = await resolveTelegramFileUrl(
        botToken,
        verification.pinnedIndexDocumentFileId,
      );
      const res = await fetch(docUrl);
      if (res.ok) {
        const rawJson = await res.text();
        const items = decodeTelegramDocumentIndex(rawJson);
        return {
          items,
          pinnedMessageId: verification.pinnedMessageId,
          hasIndex: true,
          isCompleteIndex: true,
          rawLength: rawJson.length,
        };
      }
    } catch {
      // Fall through to legacy text index if document download temporarily failed
    }
  }

  const rawText = verification.pinnedIndexText || '';
  const hasIndex = rawText.startsWith('TELEDRIVE_IDX_V1:');
  const items = decodeTelegramIndex(verification.pinnedIndexText);
  return {
    items,
    pinnedMessageId: verification.pinnedMessageId,
    hasIndex,
    isCompleteIndex: hasIndex && rawText.length < 3600,
    rawLength: rawText.length,
  };
}
