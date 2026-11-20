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
  formatBytes,
  formatEta,
  getFileCategory,
  getOfficePreviewType,
  isDescendantOrSelf,
  isPdfFile,
} from './fileHelpers';
import {
  decodeTelegramIndex,
  encodeTelegramIndex,
  mergeDriveItems,
  reconcileRemoteDriveItems,
} from './telegramIndex';
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

test('computeStorageSummary aggregates active, trashed, and Telegram bytes', () => {
  const summary = computeStorageSummary(sampleItems);
  assert.equal(summary.activeBytes, 3_700_000);
  assert.equal(summary.trashedBytes, 5_000_000);
  assert.equal(summary.fileCount, 2);
  assert.equal(summary.folderCount, 2);
  assert.equal(summary.telegramSyncedCount, 1);
  assert.equal(summary.telegramSyncedBytes, 2_500_000);
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


