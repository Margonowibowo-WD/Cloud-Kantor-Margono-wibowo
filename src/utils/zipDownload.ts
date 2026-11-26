import JSZip from 'jszip';
import type { DriveItem, TelegramConfigState } from '../types/drive';
import {
  type TransferProgressUpdate,
  resolveItemArrayBuffer,
  triggerBlobDownload,
} from './uploadClient';

export interface ZipEntryPlan {
  item: DriveItem;
  zipPath: string;
}

export function dedupeZipPath(rawPath: string, usedPaths: Set<string>): string {
  const normalized = rawPath.replace(/^\/+/, '');
  if (!usedPaths.has(normalized)) {
    usedPaths.add(normalized);
    return normalized;
  }
  const slashIdx = normalized.lastIndexOf('/');
  const dir = slashIdx >= 0 ? normalized.slice(0, slashIdx + 1) : '';
  const base = slashIdx >= 0 ? normalized.slice(slashIdx + 1) : normalized;
  const dotIdx = base.lastIndexOf('.');
  const stem = dotIdx > 0 ? base.slice(0, dotIdx) : base;
  const ext = dotIdx > 0 ? base.slice(dotIdx) : '';

  let counter = 2;
  while (true) {
    const candidate = `${dir}${stem} (${counter})${ext}`;
    if (!usedPaths.has(candidate)) {
      usedPaths.add(candidate);
      return candidate;
    }
    counter += 1;
  }
}

export function buildZipArchiveFilename(targets: DriveItem[]): string {
  if (targets.length === 1) {
    const clean = targets[0].name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'TeleDrive_Folder';
    return `${clean}.zip`;
  }
  const dateStamp = new Date().toISOString().slice(0, 10);
  return `TeleDrive_Arsip_${dateStamp}.zip`;
}

export function startZipDownload(params: {
  targets: DriveItem[];
  getLatestItems: () => DriveItem[];
  tgConfig: TelegramConfigState;
  ensureFolderLoaded?: (folderId: string) => Promise<void>;
  onProgress: (update: TransferProgressUpdate) => void;
}): { cancel: () => void; promise: Promise<{ fileCount: number; skippedCount: number }> } {
  let cancelled = false;

  const cancel = () => {
    cancelled = true;
  };

  const promise = (async (): Promise<{ fileCount: number; skippedCount: number }> => {
    const { targets, getLatestItems, tgConfig, ensureFolderLoaded, onProgress } = params;
    const validTargets = targets.filter((t) => !t.trashed);
    if (validTargets.length === 0) {
      throw new Error('Tidak ada item aktif untuk diunduh sebagai ZIP.');
    }

    const zip = new JSZip();
    const usedFilePaths = new Set<string>();
    const filesToZip: ZipEntryPlan[] = [];
    const emptyFolderPaths: string[] = [];
    const visitedFolderIds = new Set<string>();

    const walkFolder = async (folder: DriveItem, prefix: string): Promise<void> => {
      if (cancelled) throw new Error('Dibatalkan');
      if (visitedFolderIds.has(folder.id)) return;
      visitedFolderIds.add(folder.id);

      if (ensureFolderLoaded) {
        await ensureFolderLoaded(folder.id);
      }
      if (cancelled) throw new Error('Dibatalkan');

      const latest = getLatestItems();
      const children = latest.filter((i) => !i.trashed && i.parentId === folder.id);
      if (children.length === 0) {
        emptyFolderPaths.push(prefix);
        return;
      }

      for (const child of children) {
        const cleanName = child.name.replace(/[\\/]/g, '_') || 'item';
        if (child.type === 'folder') {
          await walkFolder(child, `${prefix}/${cleanName}`);
        } else {
          const uniquePath = dedupeZipPath(`${prefix}/${cleanName}`, usedFilePaths);
          filesToZip.push({ item: child, zipPath: uniquePath });
        }
      }
    };

    onProgress({
      loadedBytes: 0,
      speedBytesPerSec: 0,
      etaSeconds: 0,
      elapsedSeconds: 0,
      completedChunks: 0,
      totalChunks: 1,
      status: 'active',
      statusLabel: 'Menyiapkan daftar ZIP...',
      errorMessage: undefined,
      targetBackend: 'telegram',
    });

    for (const target of validTargets) {
      const cleanName = target.name.replace(/[\\/]/g, '_') || 'item';
      if (target.type === 'folder') {
        await walkFolder(target, cleanName);
      } else {
        const uniquePath = dedupeZipPath(cleanName, usedFilePaths);
        filesToZip.push({ item: target, zipPath: uniquePath });
      }
    }

    if (filesToZip.length === 0 && emptyFolderPaths.length === 0) {
      throw new Error('Folder yang dipilih kosong.');
    }

    for (const folderPath of emptyFolderPaths) {
      zip.folder(folderPath);
    }

    const totalBytes = Math.max(
      1,
      filesToZip.reduce((acc, entry) => acc + (entry.item.size || 0), 0),
    );
    const totalCount = Math.max(1, filesToZip.length);
    const startedAt = performance.now();
    let loadedBytes = 0;
    let skippedCount = 0;

    for (let idx = 0; idx < filesToZip.length; idx += 1) {
      if (cancelled) throw new Error('Dibatalkan');
      const { item, zipPath } = filesToZip[idx];

      const preElapsed = Math.max(0.05, (performance.now() - startedAt) / 1000);
      const preSpeed = loadedBytes > 0 ? loadedBytes / preElapsed : 0;
      const preEta = preSpeed > 0 ? Math.max(0, totalBytes - loadedBytes) / preSpeed : 0;
      onProgress({
        loadedBytes,
        speedBytesPerSec: preSpeed,
        etaSeconds: preEta,
        elapsedSeconds: preElapsed,
        completedChunks: idx,
        totalChunks: totalCount,
        status: 'active',
        statusLabel: `File ${idx + 1}/${totalCount}`,
        errorMessage: undefined,
        targetBackend: 'telegram',
      });

      try {
        const buf = await resolveItemArrayBuffer(item, tgConfig);
        if (cancelled) throw new Error('Dibatalkan');
        if (buf) {
          zip.file(zipPath, buf);
          loadedBytes += item.size || buf.byteLength;
        } else {
          skippedCount += 1;
        }
      } catch (err) {
        if (err instanceof Error && err.message === 'Dibatalkan') throw err;
        skippedCount += 1;
      }

      const elapsed = Math.max(0.05, (performance.now() - startedAt) / 1000);
      const speed = loadedBytes / elapsed;
      const eta = speed > 0 ? Math.max(0, totalBytes - loadedBytes) / speed : 0;
      onProgress({
        loadedBytes,
        speedBytesPerSec: speed,
        etaSeconds: eta,
        elapsedSeconds: elapsed,
        completedChunks: idx + 1,
        totalChunks: totalCount,
        status: 'active',
        statusLabel: `File ${idx + 1}/${totalCount}`,
        errorMessage: undefined,
        targetBackend: 'telegram',
      });
    }

    if (cancelled) throw new Error('Dibatalkan');

    const preZipElapsed = Math.max(0.05, (performance.now() - startedAt) / 1000);
    onProgress({
      loadedBytes: totalBytes,
      speedBytesPerSec: totalBytes / preZipElapsed,
      etaSeconds: 0,
      elapsedSeconds: preZipElapsed,
      completedChunks: totalCount,
      totalChunks: totalCount,
      status: 'active',
      statusLabel: 'Mengompres ZIP...',
      errorMessage: undefined,
      targetBackend: 'telegram',
    });

    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 5 },
    });
    if (cancelled) throw new Error('Dibatalkan');

    const archiveName = buildZipArchiveFilename(validTargets);
    triggerBlobDownload(zipBlob, archiveName);

    const finalElapsed = Math.max(0.05, (performance.now() - startedAt) / 1000);
    onProgress({
      loadedBytes: totalBytes,
      speedBytesPerSec: totalBytes / finalElapsed,
      etaSeconds: 0,
      elapsedSeconds: finalElapsed,
      completedChunks: totalCount,
      totalChunks: totalCount,
      status: 'completed',
      statusLabel: undefined,
      errorMessage: undefined,
      targetBackend: 'telegram',
    });

    return { fileCount: filesToZip.length - skippedCount, skippedCount };
  })();

  return { cancel, promise };
}
