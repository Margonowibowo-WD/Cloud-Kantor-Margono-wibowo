import type { DriveItem, TelegramConfigState, TelegramPublicStatus } from '../types/drive';
import { decodeTelegramIndex, encodeTelegramIndex } from './telegramIndex';

export const DIRECT_TELEGRAM_MAX_BYTES = 20 * 1024 * 1024; // 20 MB Telegram getFile limit

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
    concurrency: 1,
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

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          onProgress(ev.loaded, ev.total);
        }
      };

      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText) as {
            ok: boolean;
            description?: string;
            result?: {
              message_id: number;
              document?: { file_id: string; file_unique_id: string };
              video?: { file_id: string; file_unique_id: string };
              audio?: { file_id: string; file_unique_id: string };
              photo?: Array<{ file_id: string; file_unique_id: string }>;
            };
          };
          if (xhr.status < 200 || xhr.status >= 300 || !data.ok || !data.result) {
            reject(new Error(data.description || 'Telegram menolak unggahan file ini.'));
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
          reject(new Error('Respons Telegram tidak valid.'));
        }
      };

      xhr.onerror = () => reject(new Error('Koneksi terputus saat mengunggah ke Telegram.'));
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
): Promise<void> {
  try {
    await fetch(tgApi(botToken, 'deleteMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId.trim(), message_id: messageId }),
    });
  } catch {
    // Ignore non-fatal Telegram deletion limits
  }
}

export async function pushIndexToTelegramPinnedMessage(
  botToken: string,
  chatId: string,
  items: DriveItem[],
  existingMessageId?: number,
): Promise<number | undefined> {
  const encoded = encodeTelegramIndex(items);

  if (existingMessageId) {
    try {
      const editRes = await fetch(tgApi(botToken, 'editMessageText'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId.trim(),
          message_id: existingMessageId,
          text: encoded,
        }),
      });
      const editData = (await editRes.json()) as { ok: boolean; description?: string };
      if (editData.ok || editData.description?.includes('message is not modified')) {
        return existingMessageId;
      }
    } catch {
      // Fall through to send + pin a fresh index message
    }
  }

  try {
    const sendRes = await fetch(tgApi(botToken, 'sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        text: encoded,
        disable_notification: true,
      }),
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

    return newMsgId;
  } catch {
    return existingMessageId;
  }
}

export async function pullIndexFromTelegramPinnedMessage(
  botToken: string,
  chatId: string,
): Promise<{ items: DriveItem[]; pinnedMessageId?: number; error?: string }> {
  const verification = await verifyTelegramDirect(botToken, chatId);
  if (!verification.ok) {
    return { items: [], error: verification.error };
  }
  const items = decodeTelegramIndex(verification.pinnedIndexText);
  return {
    items,
    pinnedMessageId: verification.pinnedMessageId,
  };
}
