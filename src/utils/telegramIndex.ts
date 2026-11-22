import type { DriveItem } from '../types/drive';

const INDEX_HEADER = 'TELEDRIVE_IDX_V1:';
export const INDEX_V3_HEADER = 'TELEDRIVE_IDX_V3:';
export const INDEX_SHARD_V3_HEADER = 'TELEDRIVE_SHARD_V3:';
const MAX_TELEGRAM_TEXT_LENGTH = 4000;

export interface TelegramShardRef {
  id: number;
  h: string;
}

export interface CloudViewPrefs {
  v?: 'grid' | 'list';
  sf?: 'name' | 'updatedAt' | 'size';
  sd?: 'asc' | 'desc';
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
}

interface TelegramDocumentIndexPayload {
  v: 2;
  updatedAt: string;
  items: CompactDriveRecord[];
  tombstones?: Record<string, string>;
}

function toCompactRecord(item: DriveItem): CompactDriveRecord {
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
  if (item.chunks[0]?.telegramUniqueId) rec.uid = item.chunks[0].telegramUniqueId;
  if (item.chunks[0]?.telegramMessageId) rec.mid = item.chunks[0].telegramMessageId;
  return rec;
}

function fromCompactRecord(rec: CompactDriveRecord): DriveItem {
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
  if (!raw || !raw.startsWith(INDEX_SHARD_V3_HEADER)) return [];
  try {
    const rest = raw.slice(INDEX_SHARD_V3_HEADER.length);
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

  // Reserve room for up to ~20 shard refs in the manifest text (~500 chars)
  const MAX_INLINE_MANIFEST_CHARS = 3400;

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

  // Fast path: check if ALL items fit directly inside the single pinned text message
  const fullAttempt = await packInlineManifest(sorted);
  if (fullAttempt.length <= MAX_TELEGRAM_TEXT_LENGTH) {
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

export function extractV3Revision(raw: string | undefined | null): string | null {
  if (!raw || !raw.startsWith(INDEX_V3_HEADER)) return null;
  try {
    const parsed = JSON.parse(raw.slice(INDEX_V3_HEADER.length)) as Partial<TelegramV3ManifestPayload>;
    return parsed?.v === 3 && typeof parsed.rev === 'string' ? parsed.rev : null;
  } catch {
    return null;
  }
}

export async function decodeTelegramV3Manifest(raw: string | undefined | null): Promise<{
  isV3: boolean;
  rev: string;
  items: DriveItem[];
  tombstones: Record<string, string>;
  shards: TelegramShardRef[];
  prefs?: CloudViewPrefs;
}> {
  if (!raw || !raw.startsWith(INDEX_V3_HEADER)) {
    return { isV3: false, rev: '', items: [], tombstones: {}, shards: [] };
  }
  try {
    const parsed = JSON.parse(raw.slice(INDEX_V3_HEADER.length)) as Partial<TelegramV3ManifestPayload>;
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
