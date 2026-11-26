import type { DriveItem, StorageSummary } from '../types/drive';
import { getFileCategory, resolveMimeTypeForFilename } from './fileHelpers';

const INDEX_HEADER = 'TELEDRIVE_IDX_V1:';
export const INDEX_V3_HEADER = 'TELEDRIVE_IDX_V3:';
export const INDEX_V4_HEADER = 'TELEDRIVE_IDX_V4:';
export const INDEX_SHARD_V3_HEADER = 'TELEDRIVE_SHARD_V3:';
const MAX_TELEGRAM_TEXT_LENGTH = 4000;

export interface TelegramShardRef {
  id: number;
  h: string;
}

export interface CloudViewPrefs {
  v?: 'grid' | 'list';
  sf?: 'name' | 'updatedAt' | 'size' | 'type';
  sd?: 'asc' | 'desc';
  px?: string;
  u?: string;
}

interface TelegramV3BodyPayload {
  i: CompactDriveRecord[];
  t?: Record<string, string>;
  p?: CloudViewPrefs;
}

interface TelegramV3ManifestPayload {
  v: 3;
  rev: string;
  z?: string; // deflate-raw base64url of TelegramV3BodyPayload
  j?: TelegramV3BodyPayload;
  s?: TelegramShardRef[];
}

function bytesToB64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function compressText(text: string): Promise<string | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buf = await new Response(stream).arrayBuffer();
    return bytesToB64Url(new Uint8Array(buf));
  } catch {
    return null;
  }
}

async function decompressText(b64: string): Promise<string | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const bytes = b64UrlToBytes(b64);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const stream = new Blob([copy.buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  } catch {
    return null;
  }
}

export function computeQuickHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

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
  uid?: string; // telegramUniqueId
  mid?: number; // telegramMessageId
  fm?: number; // folder doc message_id
  ff?: string; // folder doc file_id
  fh?: string; // folder doc hash
}

interface TelegramDocumentIndexPayload {
  v: 2;
  updatedAt: string;
  items: CompactDriveRecord[];
  tombstones?: Record<string, string>;
}

export function toCompactRecord(item: DriveItem): CompactDriveRecord {
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
  const firstChunk = item.chunks?.[0];
  if (firstChunk?.telegramFileId) rec.fid = firstChunk.telegramFileId;
  if (firstChunk?.telegramUniqueId) rec.uid = firstChunk.telegramUniqueId;
  if (firstChunk?.telegramMessageId) rec.mid = firstChunk.telegramMessageId;
  if (item.type === 'folder' && item.folderIdx?.mid) {
    rec.fm = item.folderIdx.mid;
    rec.ff = item.folderIdx.fid;
    rec.fh = item.folderIdx.h;
  }
  return rec;
}

export function fromCompactRecord(rec: CompactDriveRecord): DriveItem {
  const isFolder = rec.t === 'd';
  const hasTg = Boolean(rec.fid || rec.mid);
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
    storageBackend: hasTg || isFolder ? 'telegram' : 'local',
    chunks: hasTg
      ? [
          {
            index: 0,
            size: Number(rec.s) || 0,
            telegramFileId: rec.fid,
            telegramUniqueId: rec.uid,
            telegramMessageId: rec.mid,
          },
        ]
      : [],
    ...(isFolder && rec.fm
      ? {
          folderIdx: {
            mid: rec.fm,
            fid: rec.ff || '',
            h: rec.fh || '',
          },
        }
      : {}),
  };
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
    const rec = toCompactRecord(item);
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
    return raw.map(fromCompactRecord);
  } catch {
    return [];
  }
}

export function encodeTelegramDocumentIndex(
  items: DriveItem[],
  tombstones?: Record<string, string>,
): string {
  const cleanedTombstones = tombstones ? pruneTombstones(tombstones) : undefined;
  const payload: TelegramDocumentIndexPayload = {
    v: 2,
    updatedAt: new Date().toISOString(),
    items: items.map(toCompactRecord),
    ...(cleanedTombstones && Object.keys(cleanedTombstones).length > 0
      ? { tombstones: cleanedTombstones }
      : {}),
  };
  return JSON.stringify(payload);
}

export function decodeTelegramDocumentIndexFull(raw: string | undefined | null): {
  items: DriveItem[];
  tombstones: Record<string, string>;
} {
  if (!raw) return { items: [], tombstones: {} };
  const trimmed = raw.trim();
  if (trimmed.startsWith(INDEX_HEADER)) {
    return { items: decodeTelegramIndex(trimmed), tombstones: {} };
  }
  try {
    const parsed = JSON.parse(trimmed) as Partial<TelegramDocumentIndexPayload>;
    if (parsed && parsed.v === 2 && Array.isArray(parsed.items)) {
      const tombstones: Record<string, string> = {};
      if (parsed.tombstones && typeof parsed.tombstones === 'object') {
        for (const [k, v] of Object.entries(parsed.tombstones)) {
          if (typeof k === 'string' && typeof v === 'string') {
            tombstones[k] = v;
          }
        }
      }
      return {
        items: parsed.items.map(fromCompactRecord),
        tombstones,
      };
    }
    return { items: [], tombstones: {} };
  } catch {
    return { items: [], tombstones: {} };
  }
}

export function decodeTelegramDocumentIndex(raw: string | undefined | null): DriveItem[] {
  return decodeTelegramDocumentIndexFull(raw).items;
}

const MAX_TOMBSTONES = 500;

export function pruneTombstones(tombstones: Record<string, string>): Record<string, string> {
  const entries = Object.entries(tombstones).filter(
    ([id, ts]) => Boolean(id) && typeof ts === 'string' && Number.isFinite(Date.parse(ts)),
  );
  if (entries.length <= MAX_TOMBSTONES) {
    return Object.fromEntries(entries);
  }
  entries.sort(([, a], [, b]) => Date.parse(b) - Date.parse(a));
  return Object.fromEntries(entries.slice(0, MAX_TOMBSTONES));
}

export function mergeTombstones(
  localTombstones: Record<string, string>,
  remoteTombstones: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = { ...localTombstones };
  for (const [id, remoteIso] of Object.entries(remoteTombstones)) {
    const existingIso = merged[id];
    if (!existingIso || Date.parse(remoteIso) > Date.parse(existingIso)) {
      merged[id] = remoteIso;
    }
  }
  return pruneTombstones(merged);
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
    const upgradeFromStub = Boolean(existing.isCatalogStub && !remote.isCatalogStub);

    if (remoteTime > localTime) {
      const keepExistingChunks = Boolean(
        remote.isCatalogStub && !existing.isCatalogStub && existing.chunks.length > 0,
      );
      const merged: DriveItem = {
        ...existing,
        ...remote,
        chunks: keepExistingChunks ? existing.chunks : remote.chunks,
        folderIdx: remote.folderIdx ?? existing.folderIdx,
        localBlobKey: existing.localBlobKey,
        thumbnailUrl: existing.thumbnailUrl,
        demoTextContent: existing.demoTextContent,
      };
      if (keepExistingChunks || !remote.isCatalogStub) {
        delete merged.isCatalogStub;
      }
      byId.set(remote.id, merged);
    } else if (remoteTime === localTime) {
      const upgradeFolderIdx = Boolean(
        remote.folderIdx && (!existing.folderIdx || existing.folderIdx.h !== remote.folderIdx.h),
      );
      if (upgradeFromStub || upgradeFolderIdx) {
        const merged: DriveItem = {
          ...existing,
          ...(upgradeFromStub ? remote : {}),
          folderIdx: remote.folderIdx ?? existing.folderIdx,
          localBlobKey: existing.localBlobKey,
          thumbnailUrl: existing.thumbnailUrl,
          demoTextContent: existing.demoTextContent,
        };
        if (upgradeFromStub) {
          delete merged.isCatalogStub;
        }
        byId.set(remote.id, merged);
      }
    } else if (upgradeFromStub) {
      const merged: DriveItem = {
        ...existing,
        storageBackend: remote.storageBackend,
        chunks: remote.chunks.length > 0 ? remote.chunks : existing.chunks,
        folderIdx: remote.folderIdx ?? existing.folderIdx,
      };
      delete merged.isCatalogStub;
      byId.set(remote.id, merged);
    } else if (
      remote.type === 'folder' &&
      remote.folderIdx &&
      (!existing.folderIdx || existing.folderIdx.h !== remote.folderIdx.h)
    ) {
      // pushV4ChangesToTelegram updates folderIdx without bumping folder.updatedAt;
      // adopt newer remote folderIdx even if local clock was slightly ahead.
      byId.set(remote.id, {
        ...existing,
        folderIdx: remote.folderIdx,
      });
    }
  }

  return Array.from(byId.values());
}

export function reconcileConcurrentDriveState(
  localItems: DriveItem[],
  remoteItems: DriveItem[],
  channelMediaItems: DriveItem[],
  localTombstones: Record<string, string>,
  remoteTombstones: Record<string, string>,
): { items: DriveItem[]; tombstones: Record<string, string> } {
  const tombstones = mergeTombstones(localTombstones, remoteTombstones);
  const merged = mergeDriveItems(localItems, [...remoteItems, ...channelMediaItems]);

  const activeItems = merged.filter((item) => {
    const deletedAtIso = tombstones[item.id];
    if (!deletedAtIso) return true;
    const deletedMs = Date.parse(deletedAtIso) || 0;
    const updatedMs = Date.parse(item.updatedAt) || 0;
    return updatedMs > deletedMs;
  });

  return { items: activeItems, tombstones };
}

export function reconcileRemoteDriveItems(
  localItems: DriveItem[],
  pinnedRemoteItems: DriveItem[],
  channelMediaItems: DriveItem[],
  isAuthoritativeCompleteIndex: boolean,
  syncStartedAtMs: number,
): DriveItem[] {
  const merged = mergeDriveItems(localItems, [...pinnedRemoteItems, ...channelMediaItems]);
  if (!isAuthoritativeCompleteIndex) return merged;

  const remoteIdSet = new Set<string>([
    ...pinnedRemoteItems.map((i) => i.id),
    ...channelMediaItems.map((i) => i.id),
  ]);

  return merged.filter((item) => {
    if (remoteIdSet.has(item.id)) return true;
    // Keep very recently modified/created local items that might be racing with this sync
    const updatedMs = Date.parse(item.updatedAt) || 0;
    return updatedMs >= syncStartedAtMs - 5000;
  });
}

/**
 * Prunes stale local cache items that no longer exist in an authoritative remote cloud index,
 * preserving only truly pending local changes (dirty items / offline-queued uploads) and new channel media.
 */
export function reconcileAuthoritativeRemoteItems(
  reconciledItems: DriveItem[],
  effectiveRemoteItems: DriveItem[],
  channelMediaItems: DriveItem[],
  pendingLocalIds: Set<string>,
): DriveItem[] {
  const authoritativeIds = new Set<string>();
  for (const item of effectiveRemoteItems) authoritativeIds.add(item.id);
  for (const item of channelMediaItems) authoritativeIds.add(item.id);

  return reconciledItems.filter(
    (item) =>
      authoritativeIds.has(item.id) ||
      pendingLocalIds.has(item.id) ||
      Boolean(item.pendingOfflineUpload),
  );
}

export async function encodeTelegramV3Shard(items: DriveItem[]): Promise<{ text: string; hash: string }> {
  const compact = items.map(toCompactRecord);
  const json = JSON.stringify(compact);
  const compressed = await compressText(json);
  const hash = computeQuickHash(json);
  const text = compressed
    ? `${INDEX_SHARD_V3_HEADER}Z:${hash}:${compressed}`
    : `${INDEX_SHARD_V3_HEADER}J:${hash}:${json}`;
  return { text, hash };
}

export async function decodeTelegramV3Shard(raw: string | undefined | null): Promise<DriveItem[]> {
  if (!raw) return [];
  const headerIdx = raw.indexOf(INDEX_SHARD_V3_HEADER);
  if (headerIdx === -1) return [];
  try {
    const rest = raw.slice(headerIdx + INDEX_SHARD_V3_HEADER.length).trim();
    const mode = rest.slice(0, 2);
    const secondColon = rest.indexOf(':', 2);
    if (secondColon === -1) return [];
    const payload = rest.slice(secondColon + 1);
    const jsonText = mode === 'Z:' ? await decompressText(payload) : payload;
    if (!jsonText) return [];
    const arr = JSON.parse(jsonText) as CompactDriveRecord[];
    return Array.isArray(arr) ? arr.map(fromCompactRecord) : [];
  } catch {
    return [];
  }
}

export async function buildTelegramV3Plan(
  items: DriveItem[],
  tombstones: Record<string, string> = {},
  prefs?: CloudViewPrefs,
): Promise<{
  inlineItems: DriveItem[];
  shardBatches: Array<{ items: DriveItem[]; text: string; hash: string }>;
  cleanedTombstones: Record<string, string>;
}> {
  const cleanedTombstones = pruneTombstones(tombstones);
  const sorted = [...items].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  // Reserve room for readable header (~180 chars) + up to ~20 shard refs in the manifest text
  const MAX_INLINE_MANIFEST_CHARS = 3200;
  const MAX_MANIFEST_WITH_HEADER_CHARS = 3820;

  const packInlineManifest = async (candidateInline: DriveItem[]): Promise<string> => {
    const body: TelegramV3BodyPayload = {
      i: candidateInline.map(toCompactRecord),
      ...(Object.keys(cleanedTombstones).length > 0 ? { t: cleanedTombstones } : {}),
      ...(prefs ? { p: prefs } : {}),
    };
    const json = JSON.stringify(body);
    const z = await compressText(json);
    const manifest: TelegramV3ManifestPayload = {
      v: 3,
      rev: '00000000',
      ...(z ? { z } : { j: body }),
    };
    return INDEX_V3_HEADER + JSON.stringify(manifest);
  };

  // Fast path: check if ALL items fit directly inside the single pinned text message (with human header)
  const fullAttempt = await packInlineManifest(sorted);
  if (fullAttempt.length <= MAX_MANIFEST_WITH_HEADER_CHARS) {
    return { inlineItems: sorted, shardBatches: [], cleanedTombstones };
  }

  // Binary search max inline items that fit safely with shard refs
  let low = 0;
  let high = sorted.length;
  let bestCount = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const encoded = await packInlineManifest(sorted.slice(0, mid));
    if (encoded.length <= MAX_INLINE_MANIFEST_CHARS) {
      bestCount = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const inlineItems = sorted.slice(0, bestCount);
  const overflow = sorted.slice(bestCount);
  const shardBatches: Array<{ items: DriveItem[]; text: string; hash: string }> = [];

  let cursor = 0;
  while (cursor < overflow.length) {
    let take = Math.min(overflow.length - cursor, 80);
    while (take > 1) {
      const candidate = await encodeTelegramV3Shard(overflow.slice(cursor, cursor + take));
      if (candidate.text.length <= MAX_TELEGRAM_TEXT_LENGTH) {
        shardBatches.push({
          items: overflow.slice(cursor, cursor + take),
          text: candidate.text,
          hash: candidate.hash,
        });
        break;
      }
      take = Math.max(1, Math.floor(take * 0.7));
    }
    if (take === 1 && overflow.slice(cursor, cursor + 1).length === 1) {
      const single = await encodeTelegramV3Shard(overflow.slice(cursor, cursor + 1));
      shardBatches.push({
        items: overflow.slice(cursor, cursor + 1),
        text: single.text,
        hash: single.hash,
      });
    }
    cursor += take;
  }

  return { inlineItems, shardBatches, cleanedTombstones };
}

export async function encodeTelegramV3ManifestText(
  inlineItems: DriveItem[],
  cleanedTombstones: Record<string, string>,
  shards: TelegramShardRef[],
  prefs?: CloudViewPrefs,
): Promise<{ text: string; rev: string }> {
  const body: TelegramV3BodyPayload = {
    i: inlineItems.map(toCompactRecord),
    ...(Object.keys(cleanedTombstones).length > 0 ? { t: cleanedTombstones } : {}),
    ...(prefs ? { p: prefs } : {}),
  };
  const json = JSON.stringify(body);
  const z = await compressText(json);
  const rev = computeQuickHash(`${json}|${JSON.stringify(shards)}`);
  const manifest: TelegramV3ManifestPayload = {
    v: 3,
    rev,
    ...(z ? { z } : { j: body }),
    ...(shards.length > 0 ? { s: shards } : {}),
  };
  return {
    text: INDEX_V3_HEADER + JSON.stringify(manifest),
    rev,
  };
}

export function extractV3RawLine(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const idx = raw.indexOf(INDEX_V3_HEADER);
  if (idx === -1) return null;
  return raw.slice(idx).trim();
}

export function extractV3Meta(
  raw: string | undefined | null,
): { rev: string; shardRefs: TelegramShardRef[] } | null {
  const v3Line = extractV3RawLine(raw);
  if (!v3Line) return null;
  try {
    const parsed = JSON.parse(v3Line.slice(INDEX_V3_HEADER.length)) as Partial<TelegramV3ManifestPayload>;
    if (parsed?.v !== 3 || typeof parsed.rev !== 'string') return null;
    const shardRefs: TelegramShardRef[] = Array.isArray(parsed.s)
      ? parsed.s.filter(
          (ref): ref is TelegramShardRef =>
            Boolean(ref && typeof ref.id === 'number' && typeof ref.h === 'string'),
        )
      : [];
    return { rev: parsed.rev, shardRefs };
  } catch {
    return null;
  }
}

export function extractV3Revision(raw: string | undefined | null): string | null {
  return extractV3Meta(raw)?.rev ?? null;
}

function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatCompactStorageSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatTelegramIndexHtml(manifestText: string, items: DriveItem[]): string {
  const active = items.filter((i) => !i.trashed);
  const folderCount = active.filter((i) => i.type === 'folder').length;
  const fileCount = active.filter((i) => i.type === 'file').length;
  const totalBytes = active.reduce((acc, i) => acc + (i.type === 'file' ? i.size || 0 : 0), 0);
  const timeLabel = new Date().toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  const escapedManifest = escapeTelegramHtml(manifestText);
  const quoteBlock = `<blockquote expandable>${escapedManifest}</blockquote>`;

  const fullHeaderLines = [
    '🗂 <b>TeleDrive Cloud — Indeks Sinkronisasi</b>',
    `📁 ${folderCount} Folder • 📄 ${fileCount} File (${formatCompactStorageSize(totalBytes)}) • 🕒 ${escapeTelegramHtml(timeLabel)}`,
    '<i>Pesan tersemat otomatis agar semua perangkat tetap sinkron (jangan dihapus).</i>',
    '',
  ];
  const fullCandidate = [...fullHeaderLines, quoteBlock].join('\n');
  const fullPlainLen = fullCandidate.replace(/<[^>]+>/g, '').length;
  if (fullPlainLen <= 4080) {
    return fullCandidate;
  }

  const compactHeader = `🗂 <b>TeleDrive Cloud — Indeks</b> (${folderCount}F · ${fileCount}B)\n`;
  if ((compactHeader + quoteBlock).replace(/<[^>]+>/g, '').length <= 4080) {
    return compactHeader + quoteBlock;
  }
  return quoteBlock;
}

export function formatTelegramShardHtml(shardText: string, partNumber: number): string {
  return [
    `📦 <b>TeleDrive Cloud — Arsip Sinkronisasi #${partNumber}</b>`,
    '<i>Paket data otomatis untuk folder/file besar (jangan dihapus).</i>',
    `<blockquote expandable>${escapeTelegramHtml(shardText)}</blockquote>`,
  ].join('\n');
}

export async function decodeTelegramV3Manifest(raw: string | undefined | null): Promise<{
  isV3: boolean;
  rev: string;
  items: DriveItem[];
  tombstones: Record<string, string>;
  shards: TelegramShardRef[];
  prefs?: CloudViewPrefs;
}> {
  const v3Line = extractV3RawLine(raw);
  if (!v3Line) {
    return { isV3: false, rev: '', items: [], tombstones: {}, shards: [] };
  }
  try {
    const parsed = JSON.parse(v3Line.slice(INDEX_V3_HEADER.length)) as Partial<TelegramV3ManifestPayload>;
    if (!parsed || parsed.v !== 3) {
      return { isV3: false, rev: '', items: [], tombstones: {}, shards: [] };
    }
    let body: Partial<TelegramV3BodyPayload> | null = null;
    if (typeof parsed.z === 'string') {
      const decodedJson = await decompressText(parsed.z);
      if (decodedJson) {
        body = JSON.parse(decodedJson) as Partial<TelegramV3BodyPayload>;
      }
    } else if (parsed.j && typeof parsed.j === 'object') {
      body = parsed.j;
    }

    const items = Array.isArray(body?.i) ? body.i.map(fromCompactRecord) : [];
    const tombstones: Record<string, string> = {};
    if (body?.t && typeof body.t === 'object') {
      for (const [k, v] of Object.entries(body.t)) {
        if (typeof k === 'string' && typeof v === 'string') tombstones[k] = v;
      }
    }
    const shards: TelegramShardRef[] = Array.isArray(parsed.s)
      ? parsed.s.filter((ref): ref is TelegramShardRef => Boolean(ref && typeof ref.id === 'number' && typeof ref.h === 'string'))
      : [];
    const prefs: CloudViewPrefs | undefined =
      body?.p && typeof body.p === 'object' ? body.p : undefined;

    return {
      isV3: true,
      rev: typeof parsed.rev === 'string' ? parsed.rev : '',
      items,
      tombstones,
      shards,
      prefs,
    };
  } catch {
    return { isV3: false, rev: '', items: [], tombstones: {}, shards: [] };
  }
}

/* -------------------------------------------------------------------------- */
/* V4 Hybrid Architecture: Lazy Per-Folder Docs + Everything-style Catalog    */
/* -------------------------------------------------------------------------- */

export interface TelegramDocRef {
  mid: number;
  fid: string;
  h: string;
  cnt?: number;
}

export interface CatalogRecord {
  i: string;
  p: string | null;
  n: string;
  t: 'f' | 'd';
  s: number;
  u: number;
  m?: string;
  st?: 1;
  tr?: 1;
  fm?: number;
  ff?: string;
  fh?: string;
}

export interface TelegramV4FolderDocPayload {
  v: 4;
  folderId: string | null;
  updatedAt: string;
  items: CompactDriveRecord[];
}

export interface TelegramV4CatalogDocPayload {
  v: 4;
  vol: number;
  updatedAt: string;
  records: CatalogRecord[];
}

export interface TelegramV4DeltaDocPayload {
  v: 4;
  baseRev?: string;
  updatedAt: string;
  upserts: CatalogRecord[];
  deletes: Record<string, string>;
}

export interface TelegramV4Manifest {
  v: 4;
  rev: string;
  p?: CloudViewPrefs;
  root?: TelegramDocRef;
  cat?: TelegramDocRef[];
  delta?: TelegramDocRef;
  sum?: {
    f: number;
    d: number;
    b: number;
    tb: number;
  };
}

export async function encodeGzipJson(data: unknown): Promise<{ bytes: Uint8Array; hash: string }> {
  const json = JSON.stringify(data);
  const hash = computeQuickHash(json);
  if (typeof CompressionStream === 'undefined') {
    return { bytes: new TextEncoder().encode(json), hash };
  }
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return { bytes: new Uint8Array(buf), hash };
}

export async function decodeGzipJson<T>(bytes: Uint8Array): Promise<T | null> {
  try {
    // Check gzip magic header 0x1f 0x8b
    const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    let text: string;
    if (isGzip && typeof DecompressionStream !== 'undefined') {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const stream = new Blob([copy.buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
      text = await new Response(stream).text();
    } else {
      text = new TextDecoder().decode(bytes);
    }
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function toCatalogRecord(item: DriveItem): CatalogRecord {
  const updatedMs = Date.parse(item.updatedAt) || Date.now();
  const inferredMime =
    item.type === 'folder' ? undefined : resolveMimeTypeForFilename(item.name, item.mimeType);
  const rec: CatalogRecord = {
    i: item.id,
    p: item.parentId ?? null,
    n: item.name,
    t: item.type === 'folder' ? 'd' : 'f',
    s: item.type === 'folder' ? 0 : Number(item.size) || 0,
    u: updatedMs,
  };
  if (inferredMime && inferredMime !== 'application/octet-stream') {
    // Only store mimeType when extension doesn't already resolve it identically (keeps catalog super compact)
    const extOnlyMime = resolveMimeTypeForFilename(item.name, '');
    if (extOnlyMime !== inferredMime) {
      rec.m = inferredMime;
    }
  }
  if (item.starred) rec.st = 1;
  if (item.trashed) rec.tr = 1;
  if (item.type === 'folder' && item.folderIdx?.mid) {
    rec.fm = item.folderIdx.mid;
    rec.ff = item.folderIdx.fid;
    rec.fh = item.folderIdx.h;
  }
  return rec;
}

export function fromCatalogRecordStub(rec: CatalogRecord): DriveItem {
  const isFolder = rec.t === 'd';
  const iso = new Date(Number(rec.u) || Date.now()).toISOString();
  const mimeType = isFolder
    ? 'inode/directory'
    : resolveMimeTypeForFilename(rec.n, rec.m || '');
  return {
    id: rec.i,
    name: rec.n,
    type: isFolder ? 'folder' : 'file',
    parentId: rec.p ?? null,
    size: isFolder ? 0 : Number(rec.s) || 0,
    mimeType,
    starred: rec.st === 1,
    trashed: rec.tr === 1,
    createdAt: iso,
    updatedAt: iso,
    storageBackend: 'telegram',
    chunks: [],
    isCatalogStub: !isFolder,
    ...(isFolder && rec.fm
      ? {
          folderIdx: {
            mid: rec.fm,
            fid: rec.ff || '',
            h: rec.fh || '',
          },
        }
      : {}),
  };
}

export function applyDeltaToCatalog(
  baseCatalog: CatalogRecord[],
  baseTombstones: Record<string, string>,
  delta?: TelegramV4DeltaDocPayload | null,
): { catalog: CatalogRecord[]; tombstones: Record<string, string> } {
  const tombstones = mergeTombstones(baseTombstones, delta?.deletes || {});
  const byId = new Map<string, CatalogRecord>();
  for (const rec of baseCatalog) {
    byId.set(rec.i, rec);
  }
  if (delta?.upserts) {
    for (const up of delta.upserts) {
      const prev = byId.get(up.i);
      if (!prev || up.u >= prev.u) {
        byId.set(up.i, {
          ...up,
          fm: up.fm ?? prev?.fm,
          ff: up.ff ?? prev?.ff,
          fh: up.fh ?? prev?.fh,
        });
      }
    }
  }
  const active: CatalogRecord[] = [];
  for (const rec of byId.values()) {
    const delIso = tombstones[rec.i];
    if (delIso && (Date.parse(delIso) || 0) >= (rec.u || 0)) {
      continue;
    }
    active.push(rec);
  }
  return { catalog: active, tombstones };
}

export function splitCatalogIntoVolumes(
  records: CatalogRecord[],
  maxApproxRawBytes = 6 * 1024 * 1024,
): CatalogRecord[][] {
  if (records.length === 0) return [[]];
  const volumes: CatalogRecord[][] = [];
  let current: CatalogRecord[] = [];
  let approxBytes = 0;

  for (const rec of records) {
    const est = 48 + rec.n.length + (rec.ff?.length || 0);
    if (current.length > 0 && approxBytes + est > maxApproxRawBytes) {
      volumes.push(current);
      current = [];
      approxBytes = 0;
    }
    current.push(rec);
    approxBytes += est;
  }
  if (current.length > 0) {
    volumes.push(current);
  }
  return volumes;
}

export function computeCatalogStorageSummary(records: CatalogRecord[]): StorageSummary {
  const categories = {
    image: { bytes: 0, count: 0 },
    video: { bytes: 0, count: 0 },
    document: { bytes: 0, count: 0 },
    audio: { bytes: 0, count: 0 },
    other: { bytes: 0, count: 0 },
  };
  let activeBytes = 0;
  let trashedBytes = 0;
  let fileCount = 0;
  let folderCount = 0;

  for (const rec of records) {
    if (rec.tr === 1) {
      if (rec.t === 'f') trashedBytes += rec.s || 0;
      continue;
    }
    if (rec.t === 'd') {
      folderCount += 1;
      continue;
    }
    fileCount += 1;
    const size = rec.s || 0;
    activeBytes += size;
    const cat = getFileCategory(rec.m || '', rec.n);
    if (cat === 'image') {
      categories.image.bytes += size;
      categories.image.count += 1;
    } else if (cat === 'video') {
      categories.video.bytes += size;
      categories.video.count += 1;
    } else if (cat === 'audio') {
      categories.audio.bytes += size;
      categories.audio.count += 1;
    } else if (cat === 'document' || cat === 'code') {
      categories.document.bytes += size;
      categories.document.count += 1;
    } else {
      categories.other.bytes += size;
      categories.other.count += 1;
    }
  }

  return {
    totalBytes: activeBytes + trashedBytes,
    activeBytes,
    trashedBytes,
    fileCount,
    folderCount,
    telegramSyncedCount: fileCount,
    telegramSyncedBytes: activeBytes,
    categories,
  };
}

export function extractV4RawLine(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const idx = raw.indexOf(INDEX_V4_HEADER);
  if (idx === -1) return null;
  return raw.slice(idx).trim();
}

export function extractV4Manifest(raw: string | undefined | null): TelegramV4Manifest | null {
  const line = extractV4RawLine(raw);
  if (!line) return null;
  try {
    const parsed = JSON.parse(line.slice(INDEX_V4_HEADER.length)) as Partial<TelegramV4Manifest>;
    if (parsed?.v !== 4 || typeof parsed.rev !== 'string') return null;
    return parsed as TelegramV4Manifest;
  } catch {
    return null;
  }
}

export function encodeTelegramV4ManifestText(manifest: TelegramV4Manifest): string {
  return INDEX_V4_HEADER + JSON.stringify(manifest);
}

export function formatTelegramV4IndexHtml(
  manifestText: string,
  summary: { f: number; d: number; b: number; tb: number },
): string {
  const timeLabel = new Date().toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const quoteBlock = `<blockquote expandable>${escapeTelegramHtml(manifestText)}</blockquote>`;
  const lines = [
    '🗂 <b>TeleDrive Cloud — Indeks Utama V4</b>',
    `📁 ${summary.d.toLocaleString('id-ID')} Folder • 📄 ${summary.f.toLocaleString('id-ID')} File (${formatCompactStorageSize(summary.b + summary.tb)}) • 🕒 ${escapeTelegramHtml(timeLabel)}`,
    '<i>Indeks skala besar tersemat otomatis (jangan dihapus).</i>',
    '',
    quoteBlock,
  ];
  const full = lines.join('\n');
  if (full.replace(/<[^>]+>/g, '').length <= 4080) {
    return full;
  }
  return `🗂 <b>TeleDrive V4</b> (${summary.d}F · ${summary.f}B)\n${quoteBlock}`;
}
