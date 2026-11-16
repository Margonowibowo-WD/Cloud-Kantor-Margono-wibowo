import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBreadcrumbs,
  computeByteSlices,
  computeStorageSummary,
  filterAndSortItems,
  formatBytes,
  formatEta,
  getFileCategory,
  isDescendantOrSelf,
} from './fileHelpers';
import {
  decodeTelegramIndex,
  encodeTelegramIndex,
  mergeDriveItems,
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
