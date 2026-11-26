import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMoveItems,
  buildBreadcrumbs,
  canMoveItemsToFolder,
  cloneDriveItemsForPaste,
  computeByteSlices,
  computeStorageSummary,
  filterAndSortItems,
  findCrossFolderDuplicates,
  formatBytes,
  formatEta,
  getFileCategory,
  getFileTypeLabel,
  getItemLocationPath,
  getOfficePreviewType,
  isDescendantOrSelf,
  isPdfFile,
  resolveMimeTypeForFilename,
  sanitizeDownloadFilename,
} from './fileHelpers';
import {
  type CatalogRecord,
  type TelegramV4Manifest,
  applyDeltaToCatalog,
  buildTelegramV3Plan,
  computeCatalogStorageSummary,
  decodeGzipJson,
  decodeTelegramDocumentIndex,
  decodeTelegramDocumentIndexFull,
  decodeTelegramIndex,
  decodeTelegramV3Manifest,
  decodeTelegramV3Shard,
  encodeGzipJson,
  encodeTelegramDocumentIndex,
  encodeTelegramIndex,
  encodeTelegramV3ManifestText,
  encodeTelegramV4ManifestText,
  extractV3Meta,
  extractV3Revision,
  extractV4Manifest,
  formatTelegramIndexHtml,
  formatTelegramShardHtml,
  formatTelegramV4IndexHtml,
  fromCatalogRecordStub,
  fromCompactRecord,
  mergeDriveItems,
  reconcileAuthoritativeRemoteItems,
  reconcileConcurrentDriveState,
  reconcileRemoteDriveItems,
  splitCatalogIntoVolumes,
  toCatalogRecord,
} from './telegramIndex';
import { planBlobCacheEviction } from './localVault';
import type { DriveItem } from '../types/drive';

const sampleItems: DriveItem[] = [
  {
    id: 'f-root-1',
    name: 'Desain Produk',
    type: 'folder',
    parentId: null,
    size: 0,
    mimeType: 'inode/directory',
    starred: false,
    trashed: false,
    createdAt: '2026-11-10T10:00:00.000Z',
    updatedAt: '2026-11-15T10:00:00.000Z',
    storageBackend: 'local',
    chunks: [],
  },
  {
    id: 'f-sub-1',
    name: 'Mockup Final',
    type: 'folder',
    parentId: 'f-root-1',
    size: 0,
    mimeType: 'inode/directory',
    starred: true,
    trashed: false,
    createdAt: '2026-11-11T10:00:00.000Z',
    updatedAt: '2026-11-15T12:00:00.000Z',
    storageBackend: 'local',
    chunks: [],
  },
  {
    id: 'file-1',
    name: 'Hero_Banner.jpg',
    type: 'file',
    parentId: null,
    size: 2_500_000,
    mimeType: 'image/jpeg',
    starred: true,
    trashed: false,
    createdAt: '2026-11-14T10:00:00.000Z',
    updatedAt: '2026-11-16T08:00:00.000Z',
    storageBackend: 'telegram',
    chunks: [{ index: 0, size: 2_500_000, telegramFileId: 'tg_1' }],
  },
  {
    id: 'file-2',
    name: 'Laporan_Q4.pdf',
    type: 'file',
    parentId: 'f-sub-1',
    size: 1_200_000,
    mimeType: 'application/pdf',
    starred: false,
    trashed: false,
    createdAt: '2026-11-12T10:00:00.000Z',
    updatedAt: '2026-11-14T08:00:00.000Z',
    storageBackend: 'local',
    chunks: [{ index: 0, size: 1_200_000 }],
  },
  {
    id: 'file-trash',
    name: 'Backup_Lama.zip',
    type: 'file',
    parentId: null,
    size: 5_000_000,
    mimeType: 'application/zip',
    starred: false,
    trashed: true,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-05T08:00:00.000Z',
    storageBackend: 'local',
    chunks: [{ index: 0, size: 5_000_000 }],
  },
];

test('formatBytes renders readable binary units', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1.00 KB');
  assert.equal(formatBytes(18 * 1024 * 1024), '18.0 MB');
});

test('formatEta handles seconds and minutes cleanly', () => {
  assert.equal(formatEta(0), 'Sesaat lagi');
  assert.equal(formatEta(14.2), '15 dtk');
  assert.equal(formatEta(125), '2 mnt 5 dtk');
});

test('getFileCategory classifies common extensions and mime types', () => {
  assert.equal(getFileCategory('image/jpeg', 'photo.jpg'), 'image');
  assert.equal(getFileCategory('application/octet-stream', 'movie.mkv'), 'video');
  assert.equal(getFileCategory('application/json', 'config.json'), 'code');
  assert.equal(getFileCategory('application/zip', 'archive.zip'), 'archive');
  assert.equal(getFileCategory('application/pdf', 'doc.pdf'), 'document');
});

test('computeByteSlices splits large files cleanly below Telegram 20MB limit', () => {
  const chunk = 18 * 1024 * 1024;
  const total = 40 * 1024 * 1024;
  const slices = computeByteSlices(total, chunk);
  assert.equal(slices.length, 3);
  assert.equal(slices[0].size, chunk);
  assert.equal(slices[1].size, chunk);
  assert.equal(slices[2].size, total - chunk * 2);
  assert.equal(slices[2].end, total);

  const emptySlices = computeByteSlices(0, chunk);
  assert.equal(emptySlices.length, 1);
  assert.equal(emptySlices[0].size, 0);
});

test('buildBreadcrumbs reconstructs nested folder hierarchy', () => {
  assert.deepEqual(buildBreadcrumbs(null, sampleItems), [{ id: null, name: 'Drive Saya' }]);
  assert.deepEqual(buildBreadcrumbs('f-sub-1', sampleItems), [
    { id: null, name: 'Drive Saya' },
    { id: 'f-root-1', name: 'Desain Produk' },
    { id: 'f-sub-1', name: 'Mockup Final' },
  ]);
});

test('isDescendantOrSelf prevents circular folder moves', () => {
  assert.equal(isDescendantOrSelf('f-root-1', 'f-root-1', sampleItems), true);
  assert.equal(isDescendantOrSelf('f-sub-1', 'f-root-1', sampleItems), true);
  assert.equal(isDescendantOrSelf('f-root-1', 'f-sub-1', sampleItems), false);
  assert.equal(isDescendantOrSelf(null, 'f-root-1', sampleItems), false);
});

test('filterAndSortItems scopes folders, search, starred, and trash properly', () => {
  const rootItems = filterAndSortItems(sampleItems, {
    section: 'my-drive',
    currentFolderId: null,
    searchQuery: '',
    typeFilter: 'all',
    sortField: 'name',
    sortDirection: 'asc',
  });
  assert.deepEqual(
    rootItems.map((i) => i.id),
    ['f-root-1', 'file-1'],
  );

  const searchItems = filterAndSortItems(sampleItems, {
    section: 'my-drive',
    currentFolderId: null,
    searchQuery: 'laporan',
    typeFilter: 'all',
    sortField: 'name',
    sortDirection: 'asc',
  });
  assert.deepEqual(
    searchItems.map((i) => i.id),
    ['file-2'],
  );

  const trashItems = filterAndSortItems(sampleItems, {
    section: 'trash',
    currentFolderId: null,
    searchQuery: '',
    typeFilter: 'all',
    sortField: 'name',
    sortDirection: 'asc',
  });
  assert.deepEqual(
    trashItems.map((i) => i.id),
    ['file-trash'],
  );
});

test('computeStorageSummary aggregates active, trashed, Telegram bytes, and per-category breakdown', () => {
  const summary = computeStorageSummary(sampleItems);
  assert.equal(summary.activeBytes, 3_700_000);
  assert.equal(summary.trashedBytes, 5_000_000);
  assert.equal(summary.totalBytes, 8_700_000);
  assert.equal(summary.fileCount, 2);
  assert.equal(summary.folderCount, 2);
  assert.equal(summary.telegramSyncedCount, 1);
  assert.equal(summary.telegramSyncedBytes, 2_500_000);
  assert.deepEqual(summary.categories.image, { bytes: 2_500_000, count: 1 });
  assert.deepEqual(summary.categories.document, { bytes: 1_200_000, count: 1 });
  assert.deepEqual(summary.categories.video, { bytes: 0, count: 0 });
  assert.deepEqual(summary.categories.audio, { bytes: 0, count: 0 });
  assert.deepEqual(summary.categories.other, { bytes: 0, count: 0 });
});

test('getItemLocationPath resolves full folder hierarchy and trash label cleanly', () => {
  assert.equal(getItemLocationPath(sampleItems[2], sampleItems), 'Drive Saya');
  assert.equal(
    getItemLocationPath(sampleItems[3], sampleItems),
    'Drive Saya / Desain Produk / Mockup Final',
  );
  assert.equal(getItemLocationPath(sampleItems[4], sampleItems), 'Sampah · Drive Saya');
});

test('encodeTelegramIndex and decodeTelegramIndex round-trip items under 4096 chars', () => {
  const encoded = encodeTelegramIndex(sampleItems);
  assert.ok(encoded.length <= 4096);
  const decoded = decodeTelegramIndex(encoded);
  assert.equal(decoded.length, sampleItems.length);
  const tgFile = decoded.find((d) => d.id === 'file-1');
  assert.equal(tgFile?.storageBackend, 'telegram');
  assert.equal(tgFile?.chunks[0]?.telegramFileId, 'tg_1');
});

test('mergeDriveItems preserves local blobs while adopting newer remote records', () => {
  const local: DriveItem[] = [
    {
      ...sampleItems[2],
      localBlobKey: 'blob-hero',
      updatedAt: '2026-11-16T08:00:00.000Z',
    },
  ];
  const remote: DriveItem[] = [
    {
      ...sampleItems[2],
      name: 'Hero_Banner_Renamed.jpg',
      updatedAt: '2026-11-16T09:00:00.000Z',
    },
    sampleItems[0],
  ];

  const merged = mergeDriveItems(local, remote);
  assert.equal(merged.length, 2);
  const updatedHero = merged.find((m) => m.id === 'file-1');
  assert.equal(updatedHero?.name, 'Hero_Banner_Renamed.jpg');
  assert.equal(updatedHero?.localBlobKey, 'blob-hero');
});

import {
  decryptTelegramVault,
  encryptTelegramVault,
  isVaultConfigured,
} from './cryptoVault';

test('encryptTelegramVault and decryptTelegramVault round-trip securely without leaking secrets', async () => {
  const secretToken = '7412345678:AAH_SecretToken_Example_12345';
  const secretChat = '-1001987654321';
  const pin = '842100';

  const vault = await encryptTelegramVault(
    { botToken: secretToken, chatId: secretChat },
    pin,
  );

  assert.equal(isVaultConfigured(vault), true);
  assert.equal(isVaultConfigured(''), false);
  assert.ok(!vault.includes(secretToken));
  assert.ok(!vault.includes(secretChat));

  const decoded = await decryptTelegramVault(vault, pin);
  assert.equal(decoded.botToken, secretToken);
  assert.equal(decoded.chatId, secretChat);

  await assert.rejects(
    () => decryptTelegramVault(vault, '000000'),
    /PIN salah/,
  );

  await assert.rejects(
    () => encryptTelegramVault({ botToken: secretToken, chatId: secretChat }, '12'),
    /minimal 4/,
  );
});

test('cloneDriveItemsForPaste clones files and nested folders with collision-free names', () => {
  let seq = 0;
  const makeId = (type: 'file' | 'folder') => `${type === 'folder' ? 'fld' : 'file'}-copy-${++seq}`;
  const now = '2026-11-16T16:00:00.000Z';

  // Copy Hero_Banner.jpg into root -> becomes Hero_Banner (Salinan).jpg
  const fileCopy = cloneDriveItemsForPaste(['file-1'], sampleItems, null, now, makeId);
  assert.equal(fileCopy.length, 1);
  assert.equal(fileCopy[0].name, 'Hero_Banner (Salinan).jpg');
  assert.equal(fileCopy[0].parentId, null);
  assert.equal(fileCopy[0].chunks[0]?.telegramFileId, 'tg_1');

  // Copy folder f-root-1 (which contains f-sub-1 -> file-2) into root
  const folderCopy = cloneDriveItemsForPaste(['f-root-1', 'f-sub-1'], sampleItems, null, now, makeId);
  assert.equal(folderCopy.length, 3);
  const clonedRoot = folderCopy.find((i) => i.name === 'Desain Produk (Salinan)');
  assert.ok(clonedRoot);
  const clonedSub = folderCopy.find((i) => i.name === 'Mockup Final');
  assert.equal(clonedSub?.parentId, clonedRoot?.id);
  const clonedFile2 = folderCopy.find((i) => i.name === 'Laporan_Q4.pdf');
  assert.equal(clonedFile2?.parentId, clonedSub?.id);
});

test('canMoveItemsToFolder and applyMoveItems prevent circular moves and update parentId', () => {
  assert.equal(canMoveItemsToFolder(['f-root-1'], 'f-sub-1', sampleItems), false);
  assert.equal(canMoveItemsToFolder(['file-1'], 'f-root-1', sampleItems), true);
  assert.equal(canMoveItemsToFolder(['file-1'], null, sampleItems), false);

  const res = applyMoveItems(['file-1', 'file-2'], 'f-root-1', sampleItems, '2026-11-16T16:05:00.000Z');
  assert.equal(res.movedCount, 2);
  assert.equal(res.nextItems.find((i) => i.id === 'file-1')?.parentId, 'f-root-1');
  assert.equal(res.nextItems.find((i) => i.id === 'file-2')?.parentId, 'f-root-1');
});

test('reconcileRemoteDriveItems prunes items deleted remotely from authoritative pinned index', () => {
  const syncStart = Date.parse('2026-11-19T14:00:00.000Z');
  const local: DriveItem[] = [
    sampleItems[0], // older than syncStart, deleted remotely -> should be pruned
    sampleItems[2], // present in remote -> should remain
    {
      ...sampleItems[3],
      id: 'file-just-created',
      updatedAt: '2026-11-19T14:00:02.000Z', // created right at syncStart -> kept
    },
  ];
  const pinnedRemote: DriveItem[] = [sampleItems[2]];
  const channelMedia: DriveItem[] = [];

  const reconciled = reconcileRemoteDriveItems(local, pinnedRemote, channelMedia, true, syncStart);
  assert.deepEqual(
    reconciled.map((i) => i.id).sort(),
    ['file-1', 'file-just-created'],
  );
});

test('filterAndSortItems separates photos, videos, and music cleanly', () => {
  const mediaDataset: DriveItem[] = [
    ...sampleItems,
    {
      id: 'vid-1',
      name: 'Company_Profile.mp4',
      type: 'file',
      parentId: null,
      size: 4_000_000,
      mimeType: 'video/mp4',
      starred: false,
      trashed: false,
      createdAt: '2026-11-16T10:00:00.000Z',
      updatedAt: '2026-11-16T10:00:00.000Z',
      storageBackend: 'telegram',
      chunks: [{ index: 0, size: 4_000_000, telegramFileId: 'tg_vid' }],
    },
    {
      id: 'aud-1',
      name: 'Jingle_Kantor.mp3',
      type: 'file',
      parentId: null,
      size: 1_500_000,
      mimeType: 'audio/mpeg',
      starred: false,
      trashed: false,
      createdAt: '2026-11-16T11:00:00.000Z',
      updatedAt: '2026-11-16T11:00:00.000Z',
      storageBackend: 'telegram',
      chunks: [{ index: 0, size: 1_500_000, telegramFileId: 'tg_aud' }],
    },
  ];

  const photos = filterAndSortItems(mediaDataset, {
    section: 'photos',
    currentFolderId: null,
    searchQuery: '',
    typeFilter: 'all',
    sortField: 'name',
    sortDirection: 'asc',
  });
  assert.deepEqual(
    photos.map((i) => i.id),
    ['file-1'],
  );

  const videos = filterAndSortItems(mediaDataset, {
    section: 'videos',
    currentFolderId: null,
    searchQuery: '',
    typeFilter: 'all',
    sortField: 'name',
    sortDirection: 'asc',
  });
  assert.deepEqual(
    videos.map((i) => i.id),
    ['vid-1'],
  );

  const music = filterAndSortItems(mediaDataset, {
    section: 'music',
    currentFolderId: null,
    searchQuery: '',
    typeFilter: 'all',
    sortField: 'name',
    sortDirection: 'asc',
  });
  assert.deepEqual(
    music.map((i) => i.id),
    ['aud-1'],
  );

  const archiveAndOther: DriveItem[] = [
    ...mediaDataset,
    {
      id: 'arc-1',
      name: 'Backup_Data.zip',
      type: 'file',
      parentId: null,
      size: 2048,
      mimeType: 'application/zip',
      starred: false,
      trashed: false,
      createdAt: '2026-11-16T11:00:00.000Z',
      updatedAt: '2026-11-16T11:00:00.000Z',
      storageBackend: 'telegram',
      chunks: [],
    },
    {
      id: 'oth-1',
      name: 'Installer_Aplikasi.apk',
      type: 'file',
      parentId: null,
      size: 4096,
      mimeType: 'application/vnd.android.package-archive',
      starred: false,
      trashed: false,
      createdAt: '2026-11-16T11:00:00.000Z',
      updatedAt: '2026-11-16T11:00:00.000Z',
      storageBackend: 'telegram',
      chunks: [],
    },
  ];

  assert.deepEqual(
    filterAndSortItems(archiveAndOther, {
      section: 'archives',
      currentFolderId: null,
      searchQuery: '',
      typeFilter: 'all',
      sortField: 'name',
      sortDirection: 'asc',
    }).map((i) => i.id),
    ['arc-1'],
  );

  assert.deepEqual(
    filterAndSortItems(archiveAndOther, {
      section: 'others',
      currentFolderId: null,
      searchQuery: '',
      typeFilter: 'all',
      sortField: 'name',
      sortDirection: 'asc',
    }).map((i) => i.id),
    ['oth-1'],
  );
});

test('getFileTypeLabel returns human-readable type labels like Word, Excel, MP3, PDF, Folder', () => {
  assert.equal(getFileTypeLabel({ type: 'folder', name: 'Kantor', mimeType: 'inode/directory' }), 'Folder');
  assert.equal(getFileTypeLabel({ type: 'file', name: 'Surat.docx', mimeType: 'application/octet-stream' }), 'Word');
  assert.equal(getFileTypeLabel({ type: 'file', name: 'Anggaran.xlsx', mimeType: 'application/octet-stream' }), 'Excel');
  assert.equal(getFileTypeLabel({ type: 'file', name: 'Slide.pptx', mimeType: 'application/octet-stream' }), 'PowerPoint');
  assert.equal(getFileTypeLabel({ type: 'file', name: 'Lagu.mp3', mimeType: 'audio/mpeg' }), 'MP3');
  assert.equal(getFileTypeLabel({ type: 'file', name: 'Kontrak.pdf', mimeType: 'application/pdf' }), 'PDF');
});

test('isPdfFile detects PDF by mimeType or .pdf extension', () => {
  assert.equal(isPdfFile('application/pdf', 'dokumen'), true);
  assert.equal(isPdfFile('application/octet-stream', 'Surat_Kontrak.PDF'), true);
  assert.equal(isPdfFile('image/png', 'foto.png'), false);
});

test('getOfficePreviewType classifies Word, Excel, PowerPoint, and legacy formats accurately', () => {
  assert.equal(getOfficePreviewType('application/octet-stream', 'Proposal.docx'), 'docx');
  assert.equal(
    getOfficePreviewType(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Laporan',
    ),
    'excel',
  );
  assert.equal(getOfficePreviewType('application/vnd.ms-excel', 'Rekap.xls'), 'excel');
  assert.equal(getOfficePreviewType('application/octet-stream', 'Deck.pptx'), 'pptx');
  assert.equal(getOfficePreviewType('application/msword', 'Surat_Lama.doc'), 'legacy-office');
  assert.equal(getOfficePreviewType('application/octet-stream', 'Slide_Lama.ppt'), 'legacy-office');
  assert.equal(getOfficePreviewType('application/pdf', 'Kontrak.pdf'), null);
});

import {
  extractDroppedTree,
  extractTreeFromFileList,
  filterDuplicateUploadEntries,
  materializeFolderTree,
} from './dropUploadHelpers';

test('extractDroppedTree reads nested FileSystemDirectoryEntry and skips unreadable directory fallback blobs', async () => {
  const fileA = new File(['isi surat'], 'Surat.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const fileB = new File(['rekap'], 'Rekap.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  // 1) Simulate FileSystemEntry traversal (mixed folder + top-level file)
  const makeFileEntry = (f: File) => ({
    isFile: true,
    isDirectory: false,
    name: f.name,
    file: (cb: (res: File) => void) => cb(f),
  });

  let batchIdx = 0;
  const subDirEntry = {
    isFile: false,
    isDirectory: true,
    name: 'Arsip 2026',
    createReader: () => ({
      readEntries: (cb: (entries: unknown[]) => void) => {
        if (batchIdx === 0) {
          batchIdx += 1;
          cb([makeFileEntry(fileB)]);
        } else {
          cb([]);
        }
      },
    }),
  };

  let emptyRead = false;
  const emptyDirEntry = {
    isFile: false,
    isDirectory: true,
    name: 'Folder Kosong',
    createReader: () => ({
      readEntries: (cb: (entries: unknown[]) => void) => {
        if (!emptyRead) {
          emptyRead = true;
          cb([]);
        } else {
          cb([]);
        }
      },
    }),
  };

  const tree = await extractDroppedTree({
    entries: [makeFileEntry(fileA), subDirEntry, emptyDirEntry] as unknown as FileSystemEntry[],
    fallbackFiles: [],
  });

  assert.equal(tree.files.length, 2);
  assert.deepEqual(tree.files[0].folderPath, []);
  assert.equal(tree.files[0].file.name, 'Surat.docx');
  assert.deepEqual(tree.files[1].folderPath, ['Arsip 2026']);
  assert.equal(tree.files[1].file.name, 'Rekap.xlsx');
  assert.deepEqual(tree.emptyFolderPaths, [['Folder Kosong']]);

  // 2) Simulate fallback FileList where browser included an unreadable directory pseudo-File
  const unreadableDirBlob = {
    name: 'Folder_Dokumen',
    size: 0,
    type: '',
    slice: () => ({
      arrayBuffer: async () => {
        throw new DOMException('NotReadableError');
      },
    }),
  } as unknown as File;

  const fallbackTree = await extractDroppedTree({
    entries: [],
    fallbackFiles: [unreadableDirBlob, fileA],
  });
  assert.equal(fallbackTree.files.length, 1);
  assert.equal(fallbackTree.files[0].file.name, 'Surat.docx');
  assert.deepEqual(fallbackTree.emptyFolderPaths, [['Folder_Dokumen']]);
});

test('materializeFolderTree reuses existing folders and creates missing nested folders', () => {
  let seq = 0;
  const res = materializeFolderTree(
    sampleItems,
    null,
    [
      ['Desain Produk', 'Baru 2026'],
      ['Kantor', 'Keuangan', 'Q1'],
    ],
    '2026-11-20T05:35:00.000Z',
    () => `fld-gen-${++seq}`,
  );

  // 'Desain Produk' already exists in sampleItems (id: 'f-root-1'), so only 4 new folders created
  assert.equal(res.createdFolders.length, 4);
  const baru2026 = res.createdFolders.find((f) => f.name === 'Baru 2026');
  assert.equal(baru2026?.parentId, 'f-root-1');
  assert.equal(res.resolveParentId(['Desain Produk', 'Baru 2026']), baru2026?.id);

  const q1Id = res.resolveParentId(['Kantor', 'Keuangan', 'Q1']);
  assert.ok(q1Id);

  const fileListTree = extractTreeFromFileList([
    Object.assign(new File(['abc'], 'a.txt'), { webkitRelativePath: 'Kantor/Q1/a.txt' }),
  ]);
  assert.deepEqual(fileListTree.files[0].folderPath, ['Kantor', 'Q1']);
});

test('encodeTelegramDocumentIndex and decodeTelegramDocumentIndex support 120+ items beyond 4000 chars and decode v1 fallback', () => {
  const manyItems: DriveItem[] = Array.from({ length: 120 }, (_, idx) => ({
    id: `item-bulk-${idx + 1}`,
    name: `Arsip_Dokumen_Kantor_Margono_2026_${idx + 1}.pdf`,
    type: 'file',
    parentId: idx % 5 === 0 ? 'f-root-1' : null,
    size: 1024 * (idx + 1),
    mimeType: 'application/pdf',
    starred: idx % 10 === 0,
    trashed: false,
    createdAt: '2026-11-20T07:00:00.000Z',
    updatedAt: '2026-11-20T07:00:00.000Z',
    storageBackend: 'telegram',
    chunks: [
      {
        index: 0,
        size: 1024 * (idx + 1),
        telegramFileId: `BQACAgUAAxkBAAI_${idx + 1}`,
        telegramUniqueId: `AgAD_${idx + 1}`,
        telegramMessageId: 500 + idx,
      },
    ],
  }));

  const v2Raw = encodeTelegramDocumentIndex(manyItems);
  assert.ok(v2Raw.length > 4000, 'v2 payload should not truncate at 4000 chars');
  const decodedV2 = decodeTelegramDocumentIndex(v2Raw);
  assert.equal(decodedV2.length, 120);
  assert.equal(decodedV2[119].id, 'item-bulk-120');
  assert.equal(decodedV2[119].chunks[0]?.telegramUniqueId, 'AgAD_120');
  assert.equal(decodedV2[119].chunks[0]?.telegramMessageId, 619);

  // Backward compatibility: v1 pinned text payload
  const v1Raw = encodeTelegramIndex(sampleItems);
  const decodedV1 = decodeTelegramDocumentIndex(v1Raw);
  assert.equal(decodedV1.length, sampleItems.length);
  assert.equal(decodedV1.find((d) => d.id === 'file-1')?.chunks[0]?.telegramFileId, 'tg_1');
});

test('planBlobCacheEviction evicts oldest LRU entries while protecting newly saved blob key', () => {
  const manifest = {
    'blob-oldest': { size: 120, lastAccessedAt: 1000 },
    'blob-middle': { size: 150, lastAccessedAt: 2000 },
    'blob-newest': { size: 100, lastAccessedAt: 3000 },
    'blob-protected-old': { size: 200, lastAccessedAt: 500 },
  };

  // Total is 570 bytes; cap is 350 bytes; protectedKey must never be evicted
  const plan = planBlobCacheEviction(manifest, 'blob-protected-old', 350);
  assert.deepEqual(plan.keysToEvict, ['blob-oldest', 'blob-middle']);
  assert.equal(plan.totalBytesAfter, 300);
  assert.ok('blob-protected-old' in plan.nextManifest);
  assert.ok('blob-newest' in plan.nextManifest);
  assert.ok(!('blob-oldest' in plan.nextManifest));
  assert.ok(!('blob-middle' in plan.nextManifest));

  // Under limit -> nothing evicted
  const underPlan = planBlobCacheEviction(manifest, 'blob-newest', 1000);
  assert.deepEqual(underPlan.keysToEvict, []);
  assert.equal(underPlan.totalBytesAfter, 570);
});

test('reconcileConcurrentDriveState unions multi-browser uploads while enforcing tombstoned deletions', () => {
  const browserAItems: DriveItem[] = [
    sampleItems[0],
    sampleItems[2], // file-1 (to be deleted by Browser B)
  ];
  const browserBItems: DriveItem[] = [
    sampleItems[0],
    {
      ...sampleItems[3],
      id: 'file-from-browser-b',
      name: 'Upload_Browser_B.pdf',
      updatedAt: '2026-11-20T08:15:00.000Z',
    },
  ];
  const browserATombstones = {};
  const browserBTombstones = { 'file-1': '2026-11-20T08:10:00.000Z' };

  const reconciled = reconcileConcurrentDriveState(
    browserAItems,
    browserBItems,
    [],
    browserATombstones,
    browserBTombstones,
  );

  // file-1 is removed due to tombstone, while f-root-1 and file-from-browser-b are both preserved
  assert.deepEqual(
    reconciled.items.map((i) => i.id).sort(),
    ['f-root-1', 'file-from-browser-b'],
  );

  // Encoded v2 document index preserves tombstones cleanly across browsers
  const rawV2 = encodeTelegramDocumentIndex(reconciled.items, reconciled.tombstones);
  const decodedFull = decodeTelegramDocumentIndexFull(rawV2);
  assert.equal(decodedFull.items.length, 2);
  assert.equal(decodedFull.tombstones['file-1'], '2026-11-20T08:10:00.000Z');
});

test('V3 compressed text manifest fits 100+ items inline <=4096 chars and shards 300+ items cleanly', async () => {
  const makeBulk = (count: number): DriveItem[] =>
    Array.from({ length: count }, (_, idx) => ({
      id: `v3-item-${idx + 1}`,
      name: `Dokumen_Kantor_Margono_${idx + 1}.pdf`,
      type: 'file',
      parentId: idx % 7 === 0 ? 'fld-1' : null,
      size: 2048 * (idx + 1),
      mimeType: 'application/pdf',
      starred: idx % 9 === 0,
      trashed: false,
      createdAt: `2026-11-20T08:${String(idx % 60).padStart(2, '0')}:00.000Z`,
      updatedAt: `2026-11-20T08:${String(idx % 60).padStart(2, '0')}:00.000Z`,
      storageBackend: 'telegram',
      chunks: [
        {
          index: 0,
          size: 2048 * (idx + 1),
          telegramFileId: `BQAC_V3_${idx + 1}`,
          telegramUniqueId: `AgAD_V3_${idx + 1}`,
          telegramMessageId: 1000 + idx,
        },
      ],
    }));

  // 1) 80 items compress cleanly into a single <=4000-char pinned text message
  const medium = makeBulk(80);
  const plan80 = await buildTelegramV3Plan(medium, { 'deleted-old': '2026-11-20T07:00:00.000Z' });
  assert.equal(plan80.shardBatches.length, 0);
  const manifest80 = await encodeTelegramV3ManifestText(
    plan80.inlineItems,
    plan80.cleanedTombstones,
    [],
  );
  assert.ok(manifest80.text.length <= 4096, `Expected <= 4096 chars, got ${manifest80.text.length}`);

  const decoded80 = await decodeTelegramV3Manifest(manifest80.text);
  assert.equal(decoded80.isV3, true);
  assert.equal(decoded80.items.length, 80);
  assert.equal(decoded80.tombstones['deleted-old'], '2026-11-20T07:00:00.000Z');

  // 2) 320 items automatically overflow older items into <=4000-char shards
  const huge = makeBulk(320);
  const plan320 = await buildTelegramV3Plan(huge, {});
  assert.ok(plan320.shardBatches.length >= 1, 'Expected overflow shards for 320 items');

  const shardRefs = [];
  const reconstructed: DriveItem[] = [];
  for (let i = 0; i < plan320.shardBatches.length; i += 1) {
    const batch = plan320.shardBatches[i];
    assert.ok(batch.text.length <= 4096);
    shardRefs.push({ id: 2000 + i, h: batch.hash });
    const decodedShard = await decodeTelegramV3Shard(batch.text);
    reconstructed.push(...decodedShard);
  }

  const manifest320 = await encodeTelegramV3ManifestText(
    plan320.inlineItems,
    plan320.cleanedTombstones,
    shardRefs,
  );
  assert.ok(manifest320.text.length <= 4096);
  const decoded320 = await decodeTelegramV3Manifest(manifest320.text);
  assert.equal(decoded320.items.length + reconstructed.length, 320);
});

test('V3 manifest preserves CloudViewPrefs and extracts revision without full decompression', async () => {
  const prefs = {
    v: 'list' as const,
    sf: 'updatedAt' as const,
    sd: 'desc' as const,
    u: '2026-11-22T03:00:00.000Z',
  };
  const plan = await buildTelegramV3Plan(sampleItems.slice(0, 2), {}, prefs);
  const encoded = await encodeTelegramV3ManifestText(plan.inlineItems, plan.cleanedTombstones, [], prefs);

  const quickRev = extractV3Revision(encoded.text);
  assert.equal(quickRev, encoded.rev);

  const decoded = await decodeTelegramV3Manifest(encoded.text);
  assert.deepEqual(decoded.prefs, prefs);
  assert.equal(decoded.rev, encoded.rev);

  // Verify decoding still succeeds when Telegram wraps V3 inside readable summary + expandable quote
  const htmlFormatted = formatTelegramIndexHtml(encoded.text, sampleItems.slice(0, 2));
  const simulatedTelegramPlainText = htmlFormatted
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  assert.ok(simulatedTelegramPlainText.includes('TeleDrive Cloud — Indeks Sinkronisasi'));
  assert.equal(extractV3Revision(simulatedTelegramPlainText), encoded.rev);
  const decodedWrapped = await decodeTelegramV3Manifest(simulatedTelegramPlainText);
  assert.equal(decodedWrapped.isV3, true);
  assert.equal(decodedWrapped.items.length, 2);

  const shardHtml = formatTelegramShardHtml('TELEDRIVE_SHARD_V3:J:abc:[]', 1);
  const shardPlain = shardHtml.replace(/<[^>]+>/g, '');
  const decodedShard = await decodeTelegramV3Shard(shardPlain);
  assert.deepEqual(decodedShard, []);
});

test('formatTelegramIndexHtml stays <= 4080 plain-text chars and extractV3Meta preserves shardRefs', async () => {
  const longManifest = `TELEDRIVE_IDX_V3:${JSON.stringify({
    v: 3,
    rev: 'rev999',
    z: 'a'.repeat(3910),
    s: [
      { id: 101, h: 'h1' },
      { id: 102, h: 'h2' },
    ],
  })}`;
  const html = formatTelegramIndexHtml(longManifest, sampleItems);
  const plainText = html.replace(/<[^>]+>/g, '');
  assert.ok(plainText.length <= 4080, `Expected plain text <= 4080, got ${plainText.length}`);

  const meta = extractV3Meta(plainText);
  assert.equal(meta?.rev, 'rev999');
  assert.deepEqual(meta?.shardRefs, [
    { id: 101, h: 'h1' },
    { id: 102, h: 'h2' },
  ]);
});

import {
  buildProxiedTelegramFileUrl,
  buildTelegramMessageUrl,
  normalizeCorsProxyUrl,
} from './telegramDirect';

test('normalizeCorsProxyUrl and buildProxiedTelegramFileUrl safely wrap Telegram file URLs', async () => {
  assert.equal(normalizeCorsProxyUrl(''), undefined);
  assert.equal(normalizeCorsProxyUrl('javascript:alert(1)'), undefined);
  assert.equal(
    normalizeCorsProxyUrl('https://my-proxy.workers.dev///'),
    'https://my-proxy.workers.dev',
  );

  const tgUrl = 'https://api.telegram.org/file/bot123:ABC/documents/test.pdf';
  assert.equal(buildProxiedTelegramFileUrl(tgUrl, undefined), tgUrl);
  assert.equal(
    buildProxiedTelegramFileUrl(tgUrl, 'https://my-proxy.workers.dev/'),
    `https://my-proxy.workers.dev?url=${encodeURIComponent(tgUrl)}`,
  );

  assert.equal(
    buildProxiedTelegramFileUrl(tgUrl, 'https://my-proxy.workers.dev/', {
      filename: 'Laporan Akhir.pdf',
      mimeType: 'application/pdf',
    }),
    `https://my-proxy.workers.dev?url=${encodeURIComponent(tgUrl)}&dl=1&filename=${encodeURIComponent('Laporan Akhir.pdf')}&mime=${encodeURIComponent('application/pdf')}`,
  );

  const vaultWithProxy = await encryptTelegramVault(
    {
      botToken: '987654321:AAH_token',
      chatId: '-10011223344',
      corsProxyUrl: 'https://my-proxy.workers.dev/',
    },
    '4321',
  );
  const decoded = await decryptTelegramVault(vaultWithProxy, '4321');
  assert.equal(decoded.corsProxyUrl, 'https://my-proxy.workers.dev/');
});

test('resolveMimeTypeForFilename and sanitizeDownloadFilename preserve real extensions for mobile downloads', () => {
  assert.equal(
    resolveMimeTypeForFilename('Kontrak.pdf', 'application/octet-stream'),
    'application/pdf',
  );
  assert.equal(
    resolveMimeTypeForFilename('Rekap.xlsx', ''),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  assert.equal(
    resolveMimeTypeForFilename('Catatan_Tanpa_Ekstensi', 'text/plain; charset=utf-8'),
    'text/plain',
  );
  assert.equal(
    sanitizeDownloadFilename('Laporan:Q4/2026?.pdf', 'application/pdf'),
    'Laporan_Q4_2026_.pdf',
  );
  assert.equal(
    sanitizeDownloadFilename('RekamanSuara', 'audio/mpeg'),
    'RekamanSuara.mp3',
  );
});

test('V4 encodeGzipJson and decodeGzipJson round-trip structured payloads accurately', async () => {
  const payload = {
    v: 4,
    folderId: 'f-root-1',
    items: sampleItems.map((i) => ({ id: i.id, name: i.name, size: i.size })),
  };
  const { bytes, hash } = await encodeGzipJson(payload);
  assert.ok(bytes.byteLength > 0);
  assert.ok(hash.length > 0);
  const decoded = await decodeGzipJson<typeof payload>(bytes);
  assert.deepEqual(decoded, payload);
});

test('V4 CatalogRecord conversion, stub hydration preservation, delta apply, and volume splitting work at scale', () => {
  const folderWithRef: DriveItem = {
    ...sampleItems[0],
    folderIdx: { mid: 8801, fid: 'FID_FLD_1', h: 'hash_f1' },
  };
  const folderCat = toCatalogRecord(folderWithRef);
  assert.equal(folderCat.t, 'd');
  assert.equal(folderCat.fm, 8801);
  assert.equal(folderCat.ff, 'FID_FLD_1');
  assert.equal(folderCat.fh, 'hash_f1');

  const fileCat = toCatalogRecord(sampleItems[2]);
  assert.equal(fileCat.t, 'f');
  assert.equal(fileCat.s, 2_500_000);
  assert.equal(fileCat.st, 1);

  const fileStub = fromCatalogRecordStub(fileCat);
  assert.equal(fileStub.isCatalogStub, true);
  assert.equal(fileStub.chunks.length, 0);
  assert.equal(fileStub.name, 'Hero_Banner.jpg');

  // Stub-aware mergeDriveItems must NOT downgrade an already-hydrated full item with chunks into a stub
  const hydratedMerge = mergeDriveItems([sampleItems[2]], [fileStub]);
  assert.equal(hydratedMerge[0].isCatalogStub, undefined);
  assert.equal(hydratedMerge[0].chunks.length, 1);

  // Delta log applies newer upserts and removes tombstoned deletions
  const baseCatalog: CatalogRecord[] = [folderCat, fileCat];
  const renamedNewer: CatalogRecord = {
    ...fileCat,
    n: 'Hero_Banner_Final.jpg',
    u: fileCat.u + 5000,
  };
  const applied = applyDeltaToCatalog(baseCatalog, {}, {
    v: 4,
    updatedAt: '2026-11-25T10:00:00.000Z',
    upserts: [renamedNewer],
    deletes: { 'f-root-1': new Date(folderCat.u + 1000).toISOString() },
  });
  assert.equal(applied.catalog.length, 1);
  assert.equal(applied.catalog[0].n, 'Hero_Banner_Final.jpg');

  // Split into volumes cleanly
  const manyRecords: CatalogRecord[] = Array.from({ length: 1200 }, (_, idx) => ({
    i: `id-${idx}`,
    p: null,
    n: `Arsip_Tahunan_Dokumen_Pribadi_${idx}.pdf`,
    t: 'f',
    s: 1024,
    u: 1700000000000 + idx,
  }));
  const vols = splitCatalogIntoVolumes(manyRecords, 25_000);
  assert.ok(vols.length > 1);
  assert.equal(vols.flat().length, 1200);

  const catSummary = computeCatalogStorageSummary([folderCat, fileCat, toCatalogRecord(sampleItems[4])]);
  assert.equal(catSummary.folderCount, 1);
  assert.equal(catSummary.fileCount, 1);
  assert.equal(catSummary.activeBytes, 2_500_000);
  assert.equal(catSummary.trashedBytes, 5_000_000);
});

test('V4 manifest formats cleanly within Telegram limits and parses back identically', () => {
  const manifest: TelegramV4Manifest = {
    v: 4,
    rev: 'rev_v4_123',
    p: { v: 'grid', sf: 'name', sd: 'asc', px: 'https://proxy.example.workers.dev' },
    root: { mid: 101, fid: 'FID_ROOT', h: 'hroot', cnt: 12 },
    cat: [{ mid: 102, fid: 'FID_CAT1', h: 'hcat1', cnt: 125000 }],
    delta: { mid: 103, fid: 'FID_DELTA', h: 'hdelta', cnt: 14 },
    sum: { f: 120000, d: 5000, b: 250_000_000_000, tb: 1_000_000 },
  };
  const raw = encodeTelegramV4ManifestText(manifest);
  const html = formatTelegramV4IndexHtml(raw, manifest.sum!);
  const plain = html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  assert.ok(plain.length <= 4080);

  const extracted = extractV4Manifest(plain);
  assert.deepEqual(extracted, manifest);
});

test('filterAndSortItems supports sort by type, typeFilter, searchScope, sizeFilter, and ext: search', () => {
  const dataset: DriveItem[] = [
    ...sampleItems,
    {
      id: 'file-word',
      name: 'Surat_Resmi.docx',
      type: 'file',
      parentId: 'f-root-1',
      size: 400_000, // < 1 MB (small)
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      starred: false,
      trashed: false,
      createdAt: '2026-11-16T09:00:00.000Z',
      updatedAt: '2026-11-16T09:00:00.000Z',
      storageBackend: 'telegram',
      chunks: [],
    },
    {
      id: 'file-big-vid',
      name: 'Dokumentasi_Acara_Kantor.mp4',
      type: 'file',
      parentId: null,
      size: 15_000_000, // > 10 MB (large)
      mimeType: 'video/mp4',
      starred: false,
      trashed: false,
      createdAt: '2026-11-16T10:00:00.000Z',
      updatedAt: '2026-11-16T10:00:00.000Z',
      storageBackend: 'telegram',
      chunks: [],
    },
  ];

  // 1) Sort by 'type' keeps folders first, then sorts files by getFileTypeLabel (JPG, MP4, PDF, Word)
  const sortedByTypeAsc = filterAndSortItems(dataset, {
    section: 'my-drive',
    currentFolderId: null,
    searchQuery: ' ',
    typeFilter: 'all',
    sortField: 'type',
    sortDirection: 'asc',
  });
  // Root items only (empty trimmed query -> currentFolderId=null -> f-root-1, file-1, file-big-vid)
  assert.deepEqual(
    sortedByTypeAsc.map((i) => i.id),
    ['f-root-1', 'file-1', 'file-big-vid'],
  );

  // Search matching all active files sorted by 'type' asc: JPG ('file-1'), MP4 ('file-big-vid'), PDF ('file-2'), Word ('file-word')
  const recentSortedByTypeAsc = filterAndSortItems(dataset, {
    section: 'recent',
    currentFolderId: null,
    searchQuery: '',
    typeFilter: 'all',
    sortField: 'type',
    sortDirection: 'asc',
  });
  assert.deepEqual(
    recentSortedByTypeAsc.map((i) => i.id),
    ['file-1', 'file-big-vid', 'file-2', 'file-word'],
  );

  const recentSortedByTypeDesc = filterAndSortItems(dataset, {
    section: 'recent',
    currentFolderId: null,
    searchQuery: '',
    typeFilter: 'all',
    sortField: 'type',
    sortDirection: 'desc',
  });
  assert.deepEqual(
    recentSortedByTypeDesc.map((i) => i.id),
    ['file-word', 'file-2', 'file-big-vid', 'file-1'],
  );

  // 2) typeFilter: 'folder'
  const foldersOnly = filterAndSortItems(dataset, {
    section: 'my-drive',
    currentFolderId: null,
    searchQuery: '',
    typeFilter: 'folder',
    sortField: 'name',
    sortDirection: 'asc',
  });
  assert.deepEqual(
    foldersOnly.map((i) => i.id),
    ['f-root-1'],
  );

  // 3) Everything-style multi-word AND + ext: search + searchScope: 'folder'
  const extSearch = filterAndSortItems(dataset, {
    section: 'my-drive',
    currentFolderId: null,
    searchQuery: 'laporan ext:pdf,docx',
    typeFilter: 'all',
    sortField: 'name',
    sortDirection: 'asc',
  });
  assert.deepEqual(
    extSearch.map((i) => i.id),
    ['file-2'],
  );

  // Scoped inside f-root-1 finds file-word (direct child) and file-2 (in nested f-sub-1) + f-sub-1
  const folderScoped = filterAndSortItems(dataset, {
    section: 'my-drive',
    currentFolderId: 'f-root-1',
    searchQuery: 'ext:docx,pdf',
    searchScope: 'folder',
    typeFilter: 'all',
    sortField: 'name',
    sortDirection: 'asc',
  });
  assert.deepEqual(
    folderScoped.map((i) => i.id),
    ['file-2', 'file-word'],
  );

  // 4) sizeFilter: small (<1MB), medium (1-10MB), large (>10MB)
  const smallFiles = filterAndSortItems(dataset, {
    section: 'my-drive',
    currentFolderId: null,
    searchQuery: 'surat',
    typeFilter: 'all',
    sizeFilter: 'small',
    sortField: 'name',
    sortDirection: 'asc',
  });
  assert.deepEqual(
    smallFiles.map((i) => i.id),
    ['file-word'],
  );

  const largeFiles = filterAndSortItems(dataset, {
    section: 'my-drive',
    currentFolderId: null,
    searchQuery: 'acara kantor',
    typeFilter: 'all',
    sizeFilter: 'large',
    sortField: 'name',
    sortDirection: 'asc',
  });
  assert.deepEqual(
    largeFiles.map((i) => i.id),
    ['file-big-vid'],
  );
});

test('filterDuplicateUploadEntries skips existing, queued, and intra-batch duplicates per folder while keeping unique files', () => {
  const sameAsHero = new File([new Uint8Array(10)], 'hero_banner.jpg', { type: 'image/jpeg' });
  Object.defineProperty(sameAsHero, 'size', { value: 2_500_000 });

  const differentSizeHero = new File([new Uint8Array(10)], 'Hero_Banner.jpg', {
    type: 'image/jpeg',
  });
  Object.defineProperty(differentSizeHero, 'size', { value: 3_000_000 });

  const queuedFile = new File([new Uint8Array(10)], 'Antrean.pdf', { type: 'application/pdf' });
  Object.defineProperty(queuedFile, 'size', { value: 12_345 });

  const sameInSubfolder = new File([new Uint8Array(10)], 'Laporan_Q4.pdf', {
    type: 'application/pdf',
  });
  Object.defineProperty(sameInSubfolder, 'size', { value: 1_200_000 });

  const freshFile = new File([new Uint8Array(10)], 'Baru.pdf', { type: 'application/pdf' });
  Object.defineProperty(freshFile, 'size', { value: 99_999 });

  const freshDuplicateInBatch = new File([new Uint8Array(10)], 'baru.pdf', {
    type: 'application/pdf',
  });
  Object.defineProperty(freshDuplicateInBatch, 'size', { value: 99_999 });

  const resolveParent = (folderPath: string[]) =>
    folderPath.join('/') === 'Desain Produk/Mockup Final' ? 'f-sub-1' : null;

  const result = filterDuplicateUploadEntries(
    [
      { file: sameAsHero, folderPath: [] }, // matches sampleItems['file-1'] in root -> skip
      { file: differentSizeHero, folderPath: [] }, // different size -> keep
      { file: queuedFile, folderPath: [] }, // matches queuedItems -> skip
      { file: sameInSubfolder, folderPath: ['Desain Produk', 'Mockup Final'] }, // matches 'file-2' in f-sub-1 -> skip
      { file: freshFile, folderPath: ['Desain Produk', 'Mockup Final'] }, // new -> keep
      { file: freshDuplicateInBatch, folderPath: ['Desain Produk', 'Mockup Final'] }, // intra-batch duplicate -> skip
    ],
    resolveParent,
    sampleItems,
    [{ filename: 'Antrean.pdf', size: 12_345, targetParent: null }],
  );

  assert.equal(result.skippedDuplicateCount, 4);
  assert.equal(result.entriesToUpload.length, 2);
  assert.equal(result.entriesToUpload[0].entry.file.name, 'Hero_Banner.jpg');
  assert.equal(result.entriesToUpload[0].targetParent, null);
  assert.equal(result.entriesToUpload[1].entry.file.name, 'Baru.pdf');
  assert.equal(result.entriesToUpload[1].targetParent, 'f-sub-1');
});

test('findCrossFolderDuplicates detects duplicate files across folders while ignoring trashed and unique items', () => {
  const archiveItems: DriveItem[] = [
    ...sampleItems,
    {
      id: 'dup-banner-copy',
      name: 'hero_banner.jpg', // case-insensitive match with file-1 (starred, root)
      type: 'file',
      parentId: 'f-root-1',
      size: 2_500_000,
      mimeType: 'image/jpeg',
      starred: false,
      trashed: false,
      createdAt: '2026-11-18T10:00:00.000Z',
      updatedAt: '2026-11-18T10:00:00.000Z',
      storageBackend: 'telegram',
      chunks: [],
    },
    {
      id: 'dup-banner-diff-size',
      name: 'Hero_Banner.jpg',
      type: 'file',
      parentId: 'f-sub-1',
      size: 900_000, // different size -> NOT duplicate
      mimeType: 'image/jpeg',
      starred: false,
      trashed: false,
      createdAt: '2026-11-19T10:00:00.000Z',
      updatedAt: '2026-11-19T10:00:00.000Z',
      storageBackend: 'telegram',
      chunks: [],
    },
    {
      id: 'dup-backup-trashed',
      name: 'Backup_Lama.zip',
      type: 'file',
      parentId: 'f-root-1',
      size: 5_000_000, // sampleItems['file-trash'] is trashed -> NOT duplicate
      mimeType: 'application/zip',
      starred: false,
      trashed: false,
      createdAt: '2026-11-19T10:00:00.000Z',
      updatedAt: '2026-11-19T10:00:00.000Z',
      storageBackend: 'telegram',
      chunks: [],
    },
  ];

  const dupRes = findCrossFolderDuplicates(archiveItems);
  assert.equal(dupRes.groups.length, 1);
  assert.equal(dupRes.totalDuplicateFiles, 1);
  assert.equal(dupRes.totalWastedBytes, 2_500_000);
  // Starred item 'file-1' must be ordered first as primary copy
  assert.deepEqual(
    dupRes.groups[0].items.map((i) => i.id),
    ['file-1', 'dup-banner-copy'],
  );
});

test('buildTelegramMessageUrl generates valid t.me deep links for private channels and public usernames', () => {
  assert.equal(
    buildTelegramMessageUrl('-1001987654321', 420),
    'https://t.me/c/1987654321/420',
  );
  assert.equal(
    buildTelegramMessageUrl('@my_backup_channel', 88),
    'https://t.me/my_backup_channel/88',
  );
  assert.equal(buildTelegramMessageUrl('123456', 10), null);
});

test('planBlobCacheEviction never evicts pinned offline blobs or queued offline upload blobs', () => {
  const manifest = {
    'blob-pinned-old': { size: 150, lastAccessedAt: 10 },
    'blob-queued-old': { size: 150, lastAccessedAt: 20 },
    'blob-normal-old': { size: 180, lastAccessedAt: 30 },
    'blob-fresh-upload': { size: 100, lastAccessedAt: 100 },
  };
  const extraProtected = new Set(['blob-pinned-old', 'blob-queued-old']);
  const plan = planBlobCacheEviction(manifest, 'blob-fresh-upload', 420, extraProtected);

  assert.deepEqual(plan.keysToEvict, ['blob-normal-old']);
  assert.ok('blob-pinned-old' in plan.nextManifest);
  assert.ok('blob-queued-old' in plan.nextManifest);
  assert.ok('blob-fresh-upload' in plan.nextManifest);
  assert.ok(!('blob-normal-old' in plan.nextManifest));
  assert.equal(plan.totalBytesAfter, 400);
});

test('reconcileAuthoritativeRemoteItems drops stale local items missing from remote while preserving pending local uploads and channel media', () => {
  const baseItem = sampleItems[1]; // file-1
  const staleLocalOnly: DriveItem = {
    ...baseItem,
    id: 'file-stale-deleted-elsewhere',
    name: 'Old_Browser_Ghost.pdf',
  };
  const pendingOffline: DriveItem = {
    ...baseItem,
    id: 'file-pending-offline',
    name: 'Pending_Offline.pdf',
    pendingOfflineUpload: true,
    chunks: [],
  };
  const channelMedia: DriveItem = {
    ...baseItem,
    id: 'tg-msg-999',
    name: 'Bot_Upload.png',
  };

  const reconciledItems = [baseItem, staleLocalOnly, pendingOffline, channelMedia];
  const remoteAuthoritative = [baseItem];
  const result = reconcileAuthoritativeRemoteItems(
    reconciledItems,
    remoteAuthoritative,
    [channelMedia],
    new Set(['file-pending-offline']),
  );

  assert.deepEqual(
    result.map((i) => i.id),
    [baseItem.id, pendingOffline.id, channelMedia.id],
  );
});

test('mergeDriveItems adopts remote folderIdx even when local folder updatedAt is newer due to clock skew', () => {
  const localFolder: DriveItem = {
    ...sampleItems[0], // f-root-1
    updatedAt: '2026-11-26T12:00:00.000Z',
    folderIdx: { mid: 100, fid: 'doc-old', h: 'oldhash1' },
  };
  const remoteFolder: DriveItem = {
    ...sampleItems[0],
    updatedAt: '2026-11-26T10:00:00.000Z', // earlier timestamp due to device clock skew
    folderIdx: { mid: 250, fid: 'doc-new', h: 'newhash2' },
  };

  const merged = mergeDriveItems([localFolder], [remoteFolder]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].folderIdx, { mid: 250, fid: 'doc-new', h: 'newhash2' });
});

test('mergeDriveItems strips isCatalogStub and upgrades chunks when remote matches or trails stub updatedAt', () => {
  const baseFile = sampleItems[2]; // file-1
  const stub = fromCatalogRecordStub(toCatalogRecord(baseFile));
  assert.equal(stub.isCatalogStub, true);
  assert.equal(stub.chunks.length, 0);

  // 1) remoteTime === localTime (exact same updatedAt when hydrating V4 folder doc)
  const hydratedCompact = fromCompactRecord({
    i: baseFile.id,
    p: baseFile.parentId,
    n: baseFile.name,
    t: 'f',
    s: baseFile.size,
    m: baseFile.mimeType,
    u: stub.updatedAt,
    fid: 'tg_hydrated_1',
    mid: 901,
  });
  const mergedSameTime = mergeDriveItems([stub], [hydratedCompact]);
  assert.equal(mergedSameTime.length, 1);
  assert.equal(mergedSameTime[0].isCatalogStub, undefined);
  assert.equal(mergedSameTime[0].chunks.length, 1);
  assert.equal(mergedSameTime[0].chunks[0].telegramFileId, 'tg_hydrated_1');

  // 2) localTime > remoteTime (stub touched later, e.g. starred/moved before folder doc reloaded)
  const newerStub: DriveItem = {
    ...stub,
    updatedAt: '2026-11-26T20:00:00.000Z',
  };
  const midOnlyHydrated = fromCompactRecord({
    i: baseFile.id,
    p: baseFile.parentId,
    n: baseFile.name,
    t: 'f',
    s: baseFile.size,
    m: baseFile.mimeType,
    u: '2026-11-26T10:00:00.000Z',
    mid: 902,
  });
  const mergedNewerStub = mergeDriveItems([newerStub], [midOnlyHydrated]);
  assert.equal(mergedNewerStub.length, 1);
  assert.equal(mergedNewerStub[0].isCatalogStub, undefined);
  assert.equal(mergedNewerStub[0].chunks.length, 1);
  assert.equal(mergedNewerStub[0].chunks[0].telegramMessageId, 902);
});
