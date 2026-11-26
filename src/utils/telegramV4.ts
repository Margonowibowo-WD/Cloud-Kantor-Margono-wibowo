import type { DriveItem } from '../types/drive';
import {
  getCachedTelegramDocIdb,
  setCachedTelegramDocIdb,
} from './indexedCatalog';
import {
  buildProxiedTelegramFileUrl,
  deleteTelegramMessageDirect,
  editBotTextMessage,
  fetchPinnedChatInfoQuick,
  normalizeCorsProxyUrl,
  postBotTextMessage,
  pullIndexFromTelegramPinnedMessage,
  resolveTelegramFileUrl,
  tgApi,
} from './telegramDirect';
import {
  type CatalogRecord,
  type CloudViewPrefs,
  INDEX_V4_HEADER,
  type TelegramDocRef,
  type TelegramShardRef,
  type TelegramV4CatalogDocPayload,
  type TelegramV4DeltaDocPayload,
  type TelegramV4FolderDocPayload,
  type TelegramV4Manifest,
  applyDeltaToCatalog,
  computeCatalogStorageSummary,
  computeQuickHash,
  decodeGzipJson,
  encodeGzipJson,
  encodeTelegramV4ManifestText,
  extractV4Manifest,
  formatTelegramV4IndexHtml,
  fromCatalogRecordStub,
  fromCompactRecord,
  mergeDriveItems,
  mergeTombstones,
  pruneTombstones,
  splitCatalogIntoVolumes,
  toCatalogRecord,
  toCompactRecord,
} from './telegramIndex';

const DELTA_COMPACTION_THRESHOLD = 200;
const DELTA_AGE_COMPACT_MS = 7 * 24 * 60 * 60 * 1000;
const DELTA_AGE_MIN_CHANGES = 25;
const MAX_BOT_RETRIES = 3;

export interface FailedChannelDelete {
  mid: number;
  label: string;
  error?: string;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function refreshDocFileIdByMessageId(
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
      result?: {
        message_id: number;
        document?: { file_id: string };
      };
    };
    if (!data.ok || !data.result) return null;
    const fileId = data.result.document?.file_id || null;
    if (data.result.message_id && data.result.message_id !== messageId) {
      void deleteTelegramMessageDirect(botToken, chatId, data.result.message_id);
    }
    return fileId;
  } catch {
    return null;
  }
}

export async function uploadGzipDocumentToTelegram(
  botToken: string,
  chatId: string,
  filename: string,
  captionHtml: string,
  data: unknown,
  existingMessageId?: number,
  knownCnt?: number,
): Promise<TelegramDocRef & { replacedMid?: number }> {
  const { bytes, hash } = await encodeGzipJson(data);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: 'application/gzip' });

  if (existingMessageId) {
    for (let attempt = 0; attempt < MAX_BOT_RETRIES; attempt += 1) {
      const form = new FormData();
      form.append('chat_id', chatId.trim());
      form.append('message_id', String(existingMessageId));
      form.append(
        'media',
        JSON.stringify({
          type: 'document',
          media: 'attach://file',
          caption: captionHtml,
          parse_mode: 'HTML',
        }),
      );
      form.append('file', blob, filename);

      const res = await fetch(tgApi(botToken, 'editMessageMedia'), {
        method: 'POST',
        body: form,
      });
      const json = (await res.json()) as {
        ok: boolean;
        error_code?: number;
        description?: string;
        parameters?: { retry_after?: number };
        result?: { message_id: number; document?: { file_id: string } };
      };

      if (json.ok && json.result?.document?.file_id) {
        return {
          mid: json.result.message_id,
          fid: json.result.document.file_id,
          h: hash,
          ...(knownCnt !== undefined ? { cnt: knownCnt } : {}),
        };
      }

      const desc = (json.description || '').toLowerCase();
      if (desc.includes('message is not modified')) {
        const fid =
          (await refreshDocFileIdByMessageId(botToken, chatId, existingMessageId)) || '';
        return {
          mid: existingMessageId,
          fid,
          h: hash,
          ...(knownCnt !== undefined ? { cnt: knownCnt } : {}),
        };
      }

      if (json.error_code === 429 && json.parameters?.retry_after) {
        await sleepMs((json.parameters.retry_after + 1) * 1000);
        continue;
      }

      const notEditable =
        desc.includes('message to edit not found') ||
        desc.includes('message_id_invalid') ||
        desc.includes("message can't be edited") ||
        desc.includes('there is no media in the message');
      if (notEditable) {
        break;
      }

      if (attempt < MAX_BOT_RETRIES - 1) {
        await sleepMs(1000 * (attempt + 1));
        continue;
      }
      throw new Error(json.description || `Gagal memperbarui dokumen indeks ${filename}.`);
    }
  }

  for (let attempt = 0; attempt < MAX_BOT_RETRIES; attempt += 1) {
    const form = new FormData();
    form.append('chat_id', chatId.trim());
    form.append('caption', captionHtml);
    form.append('parse_mode', 'HTML');
    form.append('disable_notification', 'true');
    form.append('document', blob, filename);

    const res = await fetch(tgApi(botToken, 'sendDocument'), {
      method: 'POST',
      body: form,
    });
    const json = (await res.json()) as {
      ok: boolean;
      error_code?: number;
      description?: string;
      parameters?: { retry_after?: number };
      result?: { message_id: number; document?: { file_id: string } };
    };

    if (json.ok && json.result?.document?.file_id) {
      return {
        mid: json.result.message_id,
        fid: json.result.document.file_id,
        h: hash,
        ...(knownCnt !== undefined ? { cnt: knownCnt } : {}),
        ...(existingMessageId && json.result.message_id !== existingMessageId
          ? { replacedMid: existingMessageId }
          : {}),
      };
    }

    if (json.error_code === 429 && json.parameters?.retry_after) {
      await sleepMs((json.parameters.retry_after + 1) * 1000);
      continue;
    }

    if (attempt < MAX_BOT_RETRIES - 1) {
      await sleepMs(1000 * (attempt + 1));
      continue;
    }

    throw new Error(json.description || `Gagal mengunggah dokumen indeks ${filename}.`);
  }

  throw new Error(`Gagal mengunggah dokumen indeks ${filename}.`);
}

export async function downloadGzipDocumentFromTelegram<T>(
  botToken: string,
  chatId: string,
  ref: { mid: number; fid?: string; h: string },
  corsProxyUrl?: string,
): Promise<T> {
  const cleanProxy = normalizeCorsProxyUrl(corsProxyUrl);
  if (!cleanProxy) {
    throw new Error(
      'Proxy Cloudflare Worker belum aktif. Aktifkan URL Proxy di Pengaturan Telegram untuk membaca indeks skala besar.',
    );
  }

  const cacheKey = `${chatId.trim()}:${ref.mid}:${ref.h}`;
  if (ref.h) {
    const cached = await getCachedTelegramDocIdb<T>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
  }

  const fetchByFileId = async (fileId: string): Promise<T> => {
    const tgUrl = await resolveTelegramFileUrl(botToken, fileId);
    const proxied = buildProxiedTelegramFileUrl(tgUrl, cleanProxy);
    const res = await fetch(proxied);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} saat mengunduh indeks dari Telegram.`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const decoded = await decodeGzipJson<T>(buf);
    if (!decoded) {
      throw new Error('Dokumen indeks terkompresi tidak valid atau rusak.');
    }
    return decoded;
  };

  let payload: T | null = null;
  if (ref.fid) {
    try {
      payload = await fetchByFileId(ref.fid);
    } catch {
      payload = null;
    }
  }

  if (!payload && ref.mid) {
    const freshFid = await refreshDocFileIdByMessageId(botToken, chatId, ref.mid);
    if (!freshFid) {
      throw new Error(`Pesan indeks #${ref.mid} tidak ditemukan atau tidak dapat diakses bot.`);
    }
    payload = await fetchByFileId(freshFid);
  }

  if (!payload) {
    throw new Error('Dokumen indeks gagal dimuat dari Telegram.');
  }

  if (ref.h) {
    void setCachedTelegramDocIdb(cacheKey, payload);
  }
  return payload;
}

export interface UnifiedCloudPullResult {
  isV4: boolean;
  hasIndex: boolean;
  unchanged: boolean;
  rev?: string;
  pinnedMessageId?: number;
  rawPinnedText?: string;
  v4Manifest?: TelegramV4Manifest;
  v3ShardRefs?: TelegramShardRef[];
  items: DriveItem[];
  rootItems?: DriveItem[];
  catalog: CatalogRecord[];
  tombstones: Record<string, string>;
  prefs?: CloudViewPrefs;
  error?: string;
  needsProxy?: boolean;
}

export async function pullCloudStateFromTelegram(
  botToken: string,
  chatId: string,
  options?: {
    corsProxyUrl?: string;
    cachedRev?: string;
    skipVerifyGetMe?: boolean;
    prefetchedPinnedText?: string;
    prefetchedPinnedMessageId?: number;
  },
): Promise<UnifiedCloudPullResult> {
  let pinnedText = options?.prefetchedPinnedText;
  let pinnedMessageId = options?.prefetchedPinnedMessageId;
  let resolvedChatId = chatId.trim();

  if (pinnedText === undefined) {
    const check = await fetchPinnedChatInfoQuick(botToken, chatId);
    if (!check.ok) {
      return {
        isV4: false,
        hasIndex: false,
        unchanged: false,
        items: [],
        catalog: [],
        tombstones: {},
        error: check.error,
      };
    }
    pinnedText = check.pinnedIndexText;
    pinnedMessageId = check.pinnedMessageId;
    resolvedChatId = (check.chatId || chatId).trim();
  }

  const v4Manifest = extractV4Manifest(pinnedText);
  if (v4Manifest) {
    if (options?.cachedRev && v4Manifest.rev === options.cachedRev) {
      return {
        isV4: true,
        hasIndex: true,
        unchanged: true,
        rev: v4Manifest.rev,
        pinnedMessageId,
        rawPinnedText: pinnedText,
        v4Manifest,
        items: [],
        catalog: [],
        tombstones: {},
        prefs: v4Manifest.p,
      };
    }

    const effectiveProxy = normalizeCorsProxyUrl(options?.corsProxyUrl || v4Manifest.p?.px);
    if (!effectiveProxy) {
      return {
        isV4: true,
        hasIndex: true,
        unchanged: false,
        rev: v4Manifest.rev,
        pinnedMessageId,
        rawPinnedText: pinnedText,
        v4Manifest,
        items: [],
        catalog: [],
        tombstones: {},
        prefs: v4Manifest.p,
        needsProxy: true,
        error:
          'Aktifkan Proxy Cloudflare Worker di Pengaturan Telegram untuk membaca indeks skala besar (V4).',
      };
    }

    try {
      const rootItemsPromise = v4Manifest.root
        ? downloadGzipDocumentFromTelegram<TelegramV4FolderDocPayload>(
            botToken,
            resolvedChatId,
            v4Manifest.root,
            effectiveProxy,
          ).then((doc) => (Array.isArray(doc.items) ? doc.items.map(fromCompactRecord) : []))
        : Promise.resolve<DriveItem[]>([]);

      const catVolumesPromise = Promise.all(
        (v4Manifest.cat || []).map((volRef) =>
          downloadGzipDocumentFromTelegram<TelegramV4CatalogDocPayload>(
            botToken,
            resolvedChatId,
            volRef,
            effectiveProxy,
          ).then((doc) => (Array.isArray(doc.records) ? doc.records : [])),
        ),
      );

      const deltaPromise = v4Manifest.delta
        ? downloadGzipDocumentFromTelegram<TelegramV4DeltaDocPayload>(
            botToken,
            resolvedChatId,
            v4Manifest.delta,
            effectiveProxy,
          )
        : Promise.resolve<TelegramV4DeltaDocPayload | null>(null);

      const [rootItems, catVolumes, deltaDoc] = await Promise.all([
        rootItemsPromise,
        catVolumesPromise,
        deltaPromise,
      ]);

      const baseCatalog = catVolumes.flat();
      const { catalog, tombstones } = applyDeltaToCatalog(baseCatalog, {}, deltaDoc);
      const catalogStubs = catalog.map(fromCatalogRecordStub);
      const merged = mergeDriveItems(catalogStubs, rootItems);

      return {
        isV4: true,
        hasIndex: true,
        unchanged: false,
        rev: v4Manifest.rev,
        pinnedMessageId,
        rawPinnedText: pinnedText,
        v4Manifest,
        items: merged,
        rootItems,
        catalog,
        tombstones,
        prefs: v4Manifest.p,
      };
    } catch (err) {
      return {
        isV4: true,
        hasIndex: true,
        unchanged: false,
        rev: v4Manifest.rev,
        pinnedMessageId,
        rawPinnedText: pinnedText,
        v4Manifest,
        items: [],
        catalog: [],
        tombstones: {},
        prefs: v4Manifest.p,
        error: err instanceof Error ? err.message : 'Gagal memuat indeks V4 dari Telegram.',
      };
    }
  }

  // Fallback / backward compatibility: V3 or V1 text manifest
  const v3Res = await pullIndexFromTelegramPinnedMessage(botToken, resolvedChatId, {
    skipVerifyGetMe: options?.skipVerifyGetMe ?? true,
    prefetchedPinnedText: pinnedText,
    prefetchedPinnedMessageId: pinnedMessageId,
    prefetchedChatId: resolvedChatId,
    cachedRev: options?.cachedRev,
  });

  return {
    isV4: false,
    hasIndex: v3Res.hasIndex,
    unchanged: Boolean(v3Res.unchanged),
    rev: v3Res.rev,
    pinnedMessageId: v3Res.pinnedMessageId,
    rawPinnedText: v3Res.rawPinnedText,
    v3ShardRefs: v3Res.shardRefs,
    items: v3Res.items,
    catalog: v3Res.items.map(toCatalogRecord),
    tombstones: v3Res.tombstones,
    prefs: v3Res.prefs,
    error: v3Res.error,
  };
}

export async function loadFolderChildrenV4(
  botToken: string,
  chatId: string,
  folderItem: DriveItem,
  corsProxyUrl?: string,
): Promise<DriveItem[]> {
  if (!folderItem.folderIdx?.mid) return [];
  const doc = await downloadGzipDocumentFromTelegram<TelegramV4FolderDocPayload>(
    botToken,
    chatId,
    folderItem.folderIdx,
    corsProxyUrl,
  );
  return Array.isArray(doc.items) ? doc.items.map(fromCompactRecord) : [];
}

export async function pushV4ChangesToTelegram(params: {
  botToken: string;
  chatId: string;
  corsProxyUrl: string;
  allItems: DriveItem[];
  dirtyFolderIds: Set<string>;
  dirtyItemIds: Set<string>;
  tombstones: Record<string, string>;
  currentManifest?: TelegramV4Manifest;
  pinnedMessageId?: number;
  prefs?: CloudViewPrefs;
  forceCompact?: boolean;
  obsoleteV3ShardIds?: number[];
}): Promise<{
  manifest: TelegramV4Manifest;
  pinnedMessageId?: number;
  updatedItems: DriveItem[];
  catalog: CatalogRecord[];
  tombstones: Record<string, string>;
  compacted: boolean;
  pinBlocked?: boolean;
  cleanedUpCount: number;
  failedDeleteMids: FailedChannelDelete[];
}> {
  const {
    botToken,
    chatId,
    corsProxyUrl,
    dirtyFolderIds,
    dirtyItemIds,
    currentManifest,
    prefs,
    forceCompact = false,
    obsoleteV3ShardIds = [],
  } = params;

  const cleanedTombstones = pruneTombstones(params.tombstones);
  const obsoleteCandidates: Array<{ mid: number; label: string }> = [];
  const toRef = (docRef: TelegramDocRef & { replacedMid?: number }, label: string): TelegramDocRef => {
    if (docRef.replacedMid) {
      obsoleteCandidates.push({ mid: docRef.replacedMid, label });
    }
    return {
      mid: docRef.mid,
      fid: docRef.fid || '',
      h: docRef.h,
      ...(docRef.cnt !== undefined ? { cnt: docRef.cnt } : {}),
    };
  };
  const nowIso = new Date().toISOString();
  let workingItems = [...params.allItems];
  const byId = new Map<string, DriveItem>(workingItems.map((i) => [i.id, i]));
  const extraDirtyIds = new Set<string>(dirtyItemIds);

  const isFullBootstrap =
    dirtyFolderIds.has('ALL') || !currentManifest?.root || !currentManifest?.cat?.length;

  const targetFoldersToUpload = new Set<string>();
  if (isFullBootstrap) {
    targetFoldersToUpload.add('ROOT');
    for (const item of workingItems) {
      if (item.parentId) targetFoldersToUpload.add(item.parentId);
    }
  } else {
    for (const fId of dirtyFolderIds) {
      targetFoldersToUpload.add(fId || 'ROOT');
    }
  }

  // 1. Upload dirty subfolder documents first (so their updated folderIdx {mid, fid, h} propagates to parent/catalog)
  for (const folderKey of targetFoldersToUpload) {
    if (folderKey === 'ROOT') continue;
    const folderObj = byId.get(folderKey);
    if (!folderObj || folderObj.type !== 'folder') continue;

    // Safeguard: if user dropped/moved/uploaded into an unopened folder that already has a Telegram folder doc,
    // hydrate its existing children first so we never overwrite them with a partial list.
    const hasUnloadedChildren =
      Boolean(folderObj.folderIdx?.mid) &&
      workingItems.some((i) => i.parentId === folderKey && i.isCatalogStub);
    if (hasUnloadedChildren) {
      try {
        const existingChildren = await loadFolderChildrenV4(
          botToken,
          chatId,
          folderObj,
          corsProxyUrl,
        );
        const mergedFolderChildren = mergeDriveItems(
          workingItems.filter((i) => i.parentId === folderKey),
          existingChildren,
        );
        for (const child of mergedFolderChildren) {
          byId.set(child.id, child);
        }
        workingItems = Array.from(byId.values());
      } catch {
        // proceed with available items
      }
    }

    const directChildren = workingItems.filter(
      (i) => i.parentId === folderKey && !i.isCatalogStub,
    );
    // Skip creating a separate folder doc for completely empty folders that never had a doc
    if (directChildren.length === 0 && !folderObj.folderIdx?.mid) {
      continue;
    }

    const payload: TelegramV4FolderDocPayload = {
      v: 4,
      folderId: folderKey,
      updatedAt: nowIso,
      items: directChildren.map(toCompactRecord),
    };
    const safeName = folderObj.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) || 'folder';
    const rawRef = await uploadGzipDocumentToTelegram(
      botToken,
      chatId,
      `teledrive-fld-${safeName}.json.gz`,
      `📁 <b>TELEDRIVE_V4_FOLDER</b>: ${escapeHtml(folderObj.name)} (${directChildren.length} item)`,
      payload,
      folderObj.folderIdx?.mid,
      directChildren.length,
    );
    const ref = toRef(rawRef, `Indeks folder lama: ${folderObj.name}`);

    const updatedFolder: DriveItem = {
      ...folderObj,
      folderIdx: { mid: ref.mid, fid: ref.fid, h: ref.h },
    };
    byId.set(folderKey, updatedFolder);
    extraDirtyIds.add(folderKey);

    // If this subfolder lives under Root or another parent, mark its parent dirty too so folderIdx is stored
    const parentKey = updatedFolder.parentId || 'ROOT';
    targetFoldersToUpload.add(parentKey);
  }

  workingItems = Array.from(byId.values());

  // 2. Upload Root document if Root or a root-level folder ref changed
  let nextRootRef = currentManifest?.root;
  if (targetFoldersToUpload.has('ROOT') || isFullBootstrap) {
    const rootChildren = workingItems.filter((i) => i.parentId === null && !i.isCatalogStub);
    const rootPayload: TelegramV4FolderDocPayload = {
      v: 4,
      folderId: null,
      updatedAt: nowIso,
      items: rootChildren.map(toCompactRecord),
    };
    const rawRootRef = await uploadGzipDocumentToTelegram(
      botToken,
      chatId,
      'teledrive-root.json.gz',
      `🗂 <b>TELEDRIVE_V4_ROOT</b> (${rootChildren.length} item utama)`,
      rootPayload,
      currentManifest?.root?.mid,
      rootChildren.length,
    );
    nextRootRef = toRef(rawRootRef, 'Indeks Root lama');
  }

  // 3. Build updated Search Catalog + Delta Log
  const fullCatalog = workingItems.map(toCatalogRecord);
  const summaryStats = computeCatalogStorageSummary(fullCatalog);
  const compactSummary = {
    f: summaryStats.fileCount,
    d: summaryStats.folderCount,
    b: summaryStats.activeBytes,
    tb: summaryStats.trashedBytes,
  };

  let existingDelta: TelegramV4DeltaDocPayload | null = null;
  if (!isFullBootstrap && !forceCompact && currentManifest?.delta?.mid) {
    try {
      existingDelta = await downloadGzipDocumentFromTelegram<TelegramV4DeltaDocPayload>(
        botToken,
        chatId,
        currentManifest.delta,
        corsProxyUrl,
      );
    } catch {
      existingDelta = null;
    }
  }

  const deltaUpsertMap = new Map<string, CatalogRecord>();
  if (existingDelta?.upserts) {
    for (const rec of existingDelta.upserts) {
      deltaUpsertMap.set(rec.i, rec);
    }
  }
  for (const id of extraDirtyIds) {
    const item = byId.get(id);
    if (item) {
      deltaUpsertMap.set(id, toCatalogRecord(item));
    }
  }
  const mergedDeltaDeletes = mergeTombstones(existingDelta?.deletes || {}, cleanedTombstones);
  const deltaTotalChanges = deltaUpsertMap.size + Object.keys(mergedDeltaDeletes).length;
  const existingDeltaAgeMs = existingDelta?.updatedAt
    ? Date.now() - (Date.parse(existingDelta.updatedAt) || Date.now())
    : 0;
  const shouldCompact =
    isFullBootstrap ||
    forceCompact ||
    deltaUpsertMap.size >= DELTA_COMPACTION_THRESHOLD ||
    Object.keys(mergedDeltaDeletes).length >= DELTA_COMPACTION_THRESHOLD ||
    (deltaTotalChanges >= DELTA_AGE_MIN_CHANGES && existingDeltaAgeMs >= DELTA_AGE_COMPACT_MS);

  let nextCatRefs: TelegramDocRef[] = currentManifest?.cat ? [...currentManifest.cat] : [];
  let nextDeltaRef: TelegramDocRef | undefined = currentManifest?.delta;
  let compacted = false;

  if (shouldCompact) {
    compacted = true;
    const volumes = splitCatalogIntoVolumes(fullCatalog);
    const uploadedVols: TelegramDocRef[] = [];

    for (let volIdx = 0; volIdx < volumes.length; volIdx += 1) {
      const volRecords = volumes[volIdx];
      const volPayload: TelegramV4CatalogDocPayload = {
        v: 4,
        vol: volIdx + 1,
        updatedAt: nowIso,
        records: volRecords,
      };
      const prevVolMid = currentManifest?.cat?.[volIdx]?.mid;
      const rawVolRef = await uploadGzipDocumentToTelegram(
        botToken,
        chatId,
        `teledrive-catalog-${volIdx + 1}.json.gz`,
        `🔎 <b>TELEDRIVE_V4_CATALOG</b> #${volIdx + 1} (${volRecords.length.toLocaleString('id-ID')} item)`,
        volPayload,
        prevVolMid,
        volRecords.length,
      );
      uploadedVols.push(toRef(rawVolRef, `Katalog lama #${volIdx + 1}`));
    }

    // Queue excess catalog volume messages for cleanup if catalog shrank
    if (currentManifest?.cat && currentManifest.cat.length > uploadedVols.length) {
      for (let i = uploadedVols.length; i < currentManifest.cat.length; i += 1) {
        const oldMid = currentManifest.cat[i]?.mid;
        if (oldMid) {
          obsoleteCandidates.push({ mid: oldMid, label: `Katalog berlebih #${i + 1}` });
        }
      }
    }

    nextCatRefs = uploadedVols;

    // Reset delta log cleanly (or keep empty delta doc if one existed so message_id stays reusable)
    if (currentManifest?.delta?.mid || Object.keys(cleanedTombstones).length > 0) {
      const resetDelta: TelegramV4DeltaDocPayload = {
        v: 4,
        updatedAt: nowIso,
        upserts: [],
        deletes: cleanedTombstones,
      };
      const rawResetDelta = await uploadGzipDocumentToTelegram(
        botToken,
        chatId,
        'teledrive-delta.json.gz',
        '📝 <b>TELEDRIVE_V4_DELTA</b> (Terkompaksi)',
        resetDelta,
        currentManifest?.delta?.mid,
        0,
      );
      nextDeltaRef = toRef(rawResetDelta, 'Catatan Delta lama');
    } else {
      nextDeltaRef = undefined;
    }
  } else {
    const nextUpserts = Array.from(deltaUpsertMap.values());
    const deltaPayload: TelegramV4DeltaDocPayload = {
      v: 4,
      baseRev: currentManifest?.rev,
      updatedAt: nowIso,
      upserts: nextUpserts,
      deletes: mergedDeltaDeletes,
    };
    const rawDeltaRef = await uploadGzipDocumentToTelegram(
      botToken,
      chatId,
      'teledrive-delta.json.gz',
      `📝 <b>TELEDRIVE_V4_DELTA</b> (+${nextUpserts.length} perubahan)`,
      deltaPayload,
      currentManifest?.delta?.mid,
      nextUpserts.length,
    );
    nextDeltaRef = toRef(rawDeltaRef, 'Catatan Delta lama');
  }

  // 4. Write compact Pinned Master Pointer (TELEDRIVE_IDX_V4:{...}, < 1500 chars)
  const manifestBody: TelegramV4Manifest = {
    v: 4,
    rev: '',
    ...(prefs ? { p: prefs } : {}),
    ...(nextRootRef ? { root: nextRootRef } : {}),
    cat: nextCatRefs,
    ...(nextDeltaRef ? { delta: nextDeltaRef } : {}),
    sum: compactSummary,
  };
  manifestBody.rev = computeQuickHash(
    JSON.stringify({
      p: manifestBody.p,
      root: manifestBody.root?.h,
      cat: manifestBody.cat?.map((c) => c.h),
      delta: manifestBody.delta?.h,
      sum: manifestBody.sum,
    }),
  );

  const manifestText = encodeTelegramV4ManifestText(manifestBody);
  const manifestHtml = formatTelegramV4IndexHtml(manifestText, compactSummary);

  let nextPinnedId = params.pinnedMessageId;
  let uneditablePinnedId: number | undefined;
  let pinBlocked = false;

  if (nextPinnedId) {
    const editRes = await editBotTextMessage(botToken, chatId, nextPinnedId, manifestHtml, 'HTML');
    if (!editRes.ok && editRes.notFound) {
      nextPinnedId = undefined;
    } else if (!editRes.ok && (editRes.description || '').toLowerCase().includes("can't be edited")) {
      uneditablePinnedId = nextPinnedId;
      nextPinnedId = undefined;
    }
  }

  if (!nextPinnedId) {
    const createdId = await postBotTextMessage(botToken, chatId, manifestHtml, 'HTML');
    if (createdId) {
      nextPinnedId = createdId;
      if (uneditablePinnedId && uneditablePinnedId !== createdId) {
        obsoleteCandidates.push({ mid: uneditablePinnedId, label: 'Pesan Pin Indeks lama' });
      }
      try {
        const pinRes = await fetch(tgApi(botToken, 'pinChatMessage'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId.trim(),
            message_id: createdId,
            disable_notification: true,
          }),
        });
        const pinJson = (await pinRes.json()) as { ok: boolean };
        if (!pinJson.ok) pinBlocked = true;
      } catch {
        pinBlocked = true;
      }
    }
  }

  // Queue obsolete V3 shards for safe deletion after successful V4 migration
  if (obsoleteV3ShardIds.length > 0) {
    for (const shardMid of obsoleteV3ShardIds) {
      obsoleteCandidates.push({ mid: shardMid, label: 'Pecahan Indeks V3 lama' });
    }
  }

  let cleanedUpCount = 0;
  const failedDeleteMids: FailedChannelDelete[] = [];
  const seenCleanupMids = new Set<number>();
  for (const cand of obsoleteCandidates) {
    if (!cand.mid || seenCleanupMids.has(cand.mid) || cand.mid === nextPinnedId) continue;
    seenCleanupMids.add(cand.mid);
    const delRes = await deleteTelegramMessageDirect(botToken, chatId, cand.mid);
    if (delRes.ok) {
      cleanedUpCount += 1;
    } else {
      failedDeleteMids.push({ mid: cand.mid, label: cand.label, error: delRes.error });
    }
  }

  return {
    manifest: manifestBody,
    pinnedMessageId: nextPinnedId,
    updatedItems: workingItems,
    catalog: fullCatalog,
    tombstones: cleanedTombstones,
    compacted,
    pinBlocked,
    cleanedUpCount,
    failedDeleteMids,
  };
}

export async function cleanupObsoleteTelegramMessages<
  T extends { mid: number; label: string; recordedAt: string; lastError?: string },
>(
  botToken: string,
  chatId: string,
  records: T[],
): Promise<{ deletedCount: number; remaining: T[] }> {
  let deletedCount = 0;
  const remaining: T[] = [];
  const seen = new Set<number>();

  for (const rec of records) {
    if (!rec.mid || seen.has(rec.mid)) continue;
    seen.add(rec.mid);
    const delRes = await deleteTelegramMessageDirect(botToken, chatId, rec.mid);
    if (delRes.ok) {
      deletedCount += 1;
    } else {
      remaining.push({ ...rec, lastError: delRes.error });
    }
  }

  return { deletedCount, remaining };
}

export { INDEX_V4_HEADER };

