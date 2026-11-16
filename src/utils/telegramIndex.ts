import type { DriveItem } from '../types/drive';

const INDEX_HEADER = 'TELEDRIVE_IDX_V1:';
const MAX_TELEGRAM_TEXT_LENGTH = 4000;

interface CompactDriveRecord {
  i: string; // id
  n: string; // name
  t: 'f' | 'd'; // file or directory
  p: string | null; // parentId
  s: number; // size
  m: string; // mimeType
  st?: 1; // starred
  tr?: 1; // trashed
  u: string; // updatedAt
  fid?: string; // telegramFileId
  mid?: number; // telegramMessageId
}

export function encodeTelegramIndex(items: DriveItem[]): string {
  // Prioritize non-trashed & Telegram-synced items, newest first, within 4096-char Telegram text limit
  const sorted = [...items].sort((a, b) => {
    if (a.trashed !== b.trashed) return a.trashed ? 1 : -1;
    if (a.storageBackend !== b.storageBackend) {
      return a.storageBackend === 'telegram' ? -1 : 1;
    }
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });

  const packed: CompactDriveRecord[] = [];
  for (const item of sorted) {
    const rec: CompactDriveRecord = {
      i: item.id,
      n: item.name,
      t: item.type === 'folder' ? 'd' : 'f',
      p: item.parentId,
      s: item.size,
      m: item.mimeType,
      u: item.updatedAt,
    };
    if (item.starred) rec.st = 1;
    if (item.trashed) rec.tr = 1;
    if (item.chunks[0]?.telegramFileId) rec.fid = item.chunks[0].telegramFileId;
    if (item.chunks[0]?.telegramMessageId) rec.mid = item.chunks[0].telegramMessageId;

    const candidate = INDEX_HEADER + JSON.stringify([...packed, rec]);
    if (candidate.length > MAX_TELEGRAM_TEXT_LENGTH) {
      break;
    }
    packed.push(rec);
  }

  return INDEX_HEADER + JSON.stringify(packed);
}

export function decodeTelegramIndex(text: string | undefined | null): DriveItem[] {
  if (!text || !text.startsWith(INDEX_HEADER)) {
    return [];
  }
  try {
    const raw = JSON.parse(text.slice(INDEX_HEADER.length)) as CompactDriveRecord[];
    if (!Array.isArray(raw)) return [];
    return raw.map((rec) => {
      const isFolder = rec.t === 'd';
      const hasTg = Boolean(rec.fid);
      return {
        id: rec.i,
        name: rec.n,
        type: isFolder ? 'folder' : 'file',
        parentId: rec.p ?? null,
        size: Number(rec.s) || 0,
        mimeType: rec.m || (isFolder ? 'inode/directory' : 'application/octet-stream'),
        starred: rec.st === 1,
        trashed: rec.tr === 1,
        createdAt: rec.u,
        updatedAt: rec.u,
        storageBackend: hasTg ? 'telegram' : 'local',
        chunks: hasTg
          ? [
              {
                index: 0,
                size: Number(rec.s) || 0,
                telegramFileId: rec.fid,
                telegramMessageId: rec.mid,
              },
            ]
          : [],
      };
    });
  } catch {
    return [];
  }
}

export function mergeDriveItems(localItems: DriveItem[], remoteItems: DriveItem[]): DriveItem[] {
  const byId = new Map<string, DriveItem>();
  for (const item of localItems) {
    byId.set(item.id, item);
  }

  for (const remote of remoteItems) {
    const existing = byId.get(remote.id);
    if (!existing) {
      byId.set(remote.id, remote);
      continue;
    }

    const remoteTime = Date.parse(remote.updatedAt) || 0;
    const localTime = Date.parse(existing.updatedAt) || 0;
    if (remoteTime > localTime) {
      byId.set(remote.id, {
        ...existing,
        ...remote,
        localBlobKey: existing.localBlobKey,
        thumbnailUrl: existing.thumbnailUrl,
        demoTextContent: existing.demoTextContent,
      });
    }
  }

  return Array.from(byId.values());
}
