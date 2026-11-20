import type { DriveItem } from '../types/drive';

export interface DroppedUploadEntry {
  file: File;
  folderPath: string[];
}

export interface DroppedTreeResult {
  files: DroppedUploadEntry[];
  emptyFolderPaths: string[][];
  skippedUnreadableCount: number;
}

export interface CapturedDropPayload {
  entries: FileSystemEntry[];
  fallbackFiles: File[];
}

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}

interface FileSystemFileEntryLike extends FileSystemEntryLike {
  file: (success: (file: File) => void, error?: (err: unknown) => void) => void;
}

interface FileSystemDirectoryReaderLike {
  readEntries: (
    success: (entries: FileSystemEntryLike[]) => void,
    error?: (err: unknown) => void,
  ) => void;
}

interface FileSystemDirectoryEntryLike extends FileSystemEntryLike {
  createReader: () => FileSystemDirectoryReaderLike;
}

/**
 * MUST be called synchronously inside the `drop` event handler before any `await`,
 * because browsers clear `DataTransferItemList` after the event dispatch finishes.
 */
export function captureDropEntriesSync(dataTransfer: DataTransfer): CapturedDropPayload {
  const entries: FileSystemEntry[] = [];
  if (dataTransfer.items && dataTransfer.items.length > 0) {
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind !== 'file') continue;
      const entry =
        typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
      if (entry) {
        entries.push(entry);
      }
    }
  }
  const fallbackFiles = dataTransfer.files ? Array.from(dataTransfer.files) : [];
  return { entries, fallbackFiles };
}

async function isFileReadable(file: File): Promise<boolean> {
  try {
    await file.slice(0, 1).arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

function readFileFromEntry(entry: FileSystemFileEntryLike): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function readAllDirectoryEntries(
  dirEntry: FileSystemDirectoryEntryLike,
): Promise<FileSystemEntryLike[]> {
  const reader = dirEntry.createReader();
  const collected: FileSystemEntryLike[] = [];

  while (true) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) break;
    collected.push(...batch);
  }

  return collected;
}

async function walkEntry(
  entry: FileSystemEntryLike,
  currentFolderPath: string[],
  result: DroppedTreeResult,
): Promise<void> {
  if (entry.isFile) {
    try {
      const file = await readFileFromEntry(entry as FileSystemFileEntryLike);
      if (await isFileReadable(file)) {
        result.files.push({ file, folderPath: currentFolderPath });
      } else {
        result.skippedUnreadableCount += 1;
      }
    } catch {
      result.skippedUnreadableCount += 1;
    }
    return;
  }

  if (entry.isDirectory) {
    const nextPath = [...currentFolderPath, entry.name];
    try {
      const children = await readAllDirectoryEntries(entry as FileSystemDirectoryEntryLike);
      if (children.length === 0) {
        result.emptyFolderPaths.push(nextPath);
      } else {
        for (const child of children) {
          await walkEntry(child, nextPath, result);
        }
      }
    } catch {
      result.emptyFolderPaths.push(nextPath);
    }
  }
}

export async function extractDroppedTree(
  captured: CapturedDropPayload,
): Promise<DroppedTreeResult> {
  const result: DroppedTreeResult = {
    files: [],
    emptyFolderPaths: [],
    skippedUnreadableCount: 0,
  };

  if (captured.entries.length > 0) {
    for (const entry of captured.entries) {
      await walkEntry(entry as unknown as FileSystemEntryLike, [], result);
    }
    return result;
  }

  // Fallback for environments without webkitGetAsEntry
  for (const file of captured.fallbackFiles) {
    const readable = await isFileReadable(file);
    if (!readable) {
      // Dropped directory pseudo-file in DataTransfer.files -> create as empty folder instead of failing XHR
      if (file.name && !file.type) {
        result.emptyFolderPaths.push([file.name]);
      } else {
        result.skippedUnreadableCount += 1;
      }
      continue;
    }
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || '';
    const segments = rel.split('/').filter(Boolean);
    const folderPath = segments.length > 1 ? segments.slice(0, -1) : [];
    result.files.push({ file, folderPath });
  }

  return result;
}

export function extractTreeFromFileList(fileList: FileList | File[]): DroppedTreeResult {
  const files: DroppedUploadEntry[] = [];
  for (const file of Array.from(fileList)) {
    if (!file.name) continue;
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || '';
    const segments = rel.split('/').filter(Boolean);
    const folderPath = segments.length > 1 ? segments.slice(0, -1) : [];
    files.push({ file, folderPath });
  }
  return { files, emptyFolderPaths: [], skippedUnreadableCount: 0 };
}

export function materializeFolderTree(
  existingItems: DriveItem[],
  rootParentId: string | null,
  allFolderPaths: string[][],
  nowIso: string,
  createId: () => string,
): {
  createdFolders: DriveItem[];
  resolveParentId: (folderPath: string[]) => string | null;
} {
  const createdFolders: DriveItem[] = [];
  const lookup = new Map<string, string>();

  for (const item of existingItems) {
    if (item.type === 'folder' && !item.trashed) {
      lookup.set(`${item.parentId ?? 'ROOT'}::${item.name}`, item.id);
    }
  }

  const ensurePath = (segments: string[]): string | null => {
    let parentId = rootParentId;
    for (const rawName of segments) {
      const cleanName = rawName.trim().slice(0, 120);
      if (!cleanName) continue;
      const key = `${parentId ?? 'ROOT'}::${cleanName}`;
      const existingId = lookup.get(key);
      if (existingId) {
        parentId = existingId;
        continue;
      }
      const newFolderId = createId();
      const newFolder: DriveItem = {
        id: newFolderId,
        name: cleanName,
        type: 'folder',
        parentId,
        size: 0,
        mimeType: 'inode/directory',
        starred: false,
        trashed: false,
        createdAt: nowIso,
        updatedAt: nowIso,
        storageBackend: 'telegram',
        chunks: [],
      };
      createdFolders.push(newFolder);
      lookup.set(key, newFolderId);
      parentId = newFolderId;
    }
    return parentId;
  };

  for (const path of allFolderPaths) {
    if (path.length > 0) {
      ensurePath(path);
    }
  }

  return {
    createdFolders,
    resolveParentId: (folderPath: string[]) => ensurePath(folderPath),
  };
}
