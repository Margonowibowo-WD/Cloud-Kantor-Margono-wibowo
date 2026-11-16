import { useEffect, useState } from 'react';
import {
  Check,
  Download,
  FolderInput,
  Pencil,
  RotateCcw,
  Star,
  Trash2,
} from 'lucide-react';
import type { DriveItem, TelegramConfigState } from '../types/drive';
import {
  formatBytes,
  formatRelativeDateId,
  getFileCategory,
} from '../utils/fileHelpers';
import { getLocalBlob } from '../utils/localVault';
import { resolveTelegramFileUrl } from '../utils/telegramDirect';
import { FileIcon } from './FileIcon';

interface FileGridProps {
  items: DriveItem[];
  tgConfig: TelegramConfigState;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onOpenItem: (item: DriveItem) => void;
  onDownloadItem: (item: DriveItem) => void;
  onToggleStar: (item: DriveItem) => void;
  onRenameItem: (item: DriveItem) => void;
  onMoveItem: (item: DriveItem) => void;
  onTrashItem: (item: DriveItem) => void;
  onRestoreItem: (item: DriveItem) => void;
  onDeletePermanent: (item: DriveItem) => void;
  isTrashView: boolean;
}

function ImageThumbnail({
  item,
  tgConfig,
  onBroken,
}: {
  item: DriveItem;
  tgConfig: TelegramConfigState;
  onBroken: () => void;
}) {
  const [src, setSrc] = useState<string | null>(item.thumbnailUrl || null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    if (item.thumbnailUrl) {
      setSrc(item.thumbnailUrl);
      return;
    }

    (async () => {
      if (item.localBlobKey) {
        const blob = await getLocalBlob(item.localBlobKey);
        if (blob && active) {
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
          return;
        }
      }
      const tgFileId = item.chunks[0]?.telegramFileId;
      if (tgFileId && tgConfig.botToken) {
        try {
          const url = await resolveTelegramFileUrl(tgConfig.botToken, tgFileId);
          if (active) setSrc(url);
        } catch {
          if (active) onBroken();
        }
      }
    })();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item.id, item.thumbnailUrl, item.localBlobKey, item.chunks, tgConfig.botToken, onBroken]);

  if (!src) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 text-center">
        <FileIcon type="file" mimeType={item.mimeType} filename={item.name} size="lg" />
        <span className="font-mono text-[11px] font-medium text-slate-500 dark:text-slate-400">
          {item.name.split('.').pop()?.toUpperCase() || 'IMG'}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={item.name}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={onBroken}
      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
    />
  );
}

export function FileGrid({
  items,
  tgConfig,
  selectedIds,
  onToggleSelect,
  onOpenItem,
  onDownloadItem,
  onToggleStar,
  onRenameItem,
  onMoveItem,
  onTrashItem,
  onRestoreItem,
  onDeletePermanent,
  isTrashView,
}: FileGridProps) {
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(() => new Set());

  const folders = items.filter((i) => i.type === 'folder');
  const files = items.filter((i) => i.type === 'file');

  return (
    <div className="space-y-8">
      {/* Folders Section */}
      {folders.length > 0 && (
        <section aria-labelledby="grid-folders-heading">
          <h2
            id="grid-folders-heading"
            className="mb-3 text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400"
          >
            Folder ({folders.length})
          </h2>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {folders.map((folder) => {
              const selected = selectedIds.has(folder.id);
              return (
                <div
                  key={folder.id}
                  className={`group relative flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 transition-colors ${
                    selected
                      ? 'border-blue-500 bg-blue-50/70 dark:border-blue-500 dark:bg-blue-950/40'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => onToggleSelect(folder.id)}
                      aria-label={`Pilih folder ${folder.name}`}
                      aria-pressed={selected}
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                        selected
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-slate-300 bg-white text-transparent group-hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800'
                      }`}
                    >
                      <Check className="h-3 w-3" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpenItem(folder)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-blue-600 rounded-md"
                    >
                      <FileIcon type="folder" mimeType={folder.mimeType} filename={folder.name} />
                      <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                        {folder.name}
                      </span>
                    </button>
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5">
                    {!isTrashView ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onToggleStar(folder)}
                          aria-label={
                            folder.starred
                              ? `Hapus bintang ${folder.name}`
                              : `Bintangi ${folder.name}`
                          }
                          className={`h-7 w-7 items-center justify-center rounded-md transition-colors ${
                            folder.starred
                              ? 'flex text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                              : 'hidden group-hover:flex group-focus-within:flex text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-700'
                          }`}
                        >
                          <Star className={`h-3.5 w-3.5 ${folder.starred ? 'fill-amber-400' : ''}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRenameItem(folder)}
                          aria-label={`Ubah nama ${folder.name}`}
                          className="hidden h-7 w-7 items-center justify-center rounded-md text-slate-400 group-hover:flex group-focus-within:flex hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-700"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onTrashItem(folder)}
                          aria-label={`Buang ${folder.name}`}
                          className="hidden h-7 w-7 items-center justify-center rounded-md text-slate-400 group-hover:flex group-focus-within:flex hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-950/50 dark:hover:text-rose-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onRestoreItem(folder)}
                          aria-label={`Pulihkan ${folder.name}`}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-950/50"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeletePermanent(folder)}
                          aria-label={`Hapus permanen ${folder.name}`}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-rose-600 hover:bg-rose-100 dark:text-rose-400 dark:hover:bg-rose-950/50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Files Section */}
      {files.length > 0 && (
        <section aria-labelledby="grid-files-heading">
          <h2
            id="grid-files-heading"
            className="mb-3 text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400"
          >
            File ({files.length})
          </h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {files.map((file) => {
              const selected = selectedIds.has(file.id);
              const category = getFileCategory(file.mimeType, file.name);
              const isImage = category === 'image' && !brokenThumbs.has(file.id);

              return (
                <article
                  key={file.id}
                  className={`group relative flex flex-col overflow-hidden rounded-xl border transition-colors ${
                    selected
                      ? 'border-blue-500 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-950/30'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700'
                  }`}
                >
                  {/* Visual Preview Area */}
                  <div className="relative aspect-[16/10] w-full overflow-hidden border-b border-slate-100 bg-slate-100 dark:border-slate-800 dark:bg-slate-800/70">
                    <button
                      type="button"
                      onClick={() => onOpenItem(file)}
                      aria-label={`Pratinjau ${file.name}`}
                      className="flex h-full w-full items-center justify-center focus-visible:outline-2 focus-visible:outline-blue-600"
                    >
                      {isImage ? (
                        <ImageThumbnail
                          item={file}
                          tgConfig={tgConfig}
                          onBroken={() =>
                            setBrokenThumbs((prev) => new Set(prev).add(file.id))
                          }
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-2 px-4 text-center">
                          <FileIcon
                            type="file"
                            mimeType={file.mimeType}
                            filename={file.name}
                            size="lg"
                          />
                          <span className="font-mono text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            {file.name.split('.').pop()?.toUpperCase() || 'FILE'}
                          </span>
                        </div>
                      )}
                    </button>

                    {/* Top-left Select Checkbox */}
                    <button
                      type="button"
                      onClick={() => onToggleSelect(file.id)}
                      aria-label={`Pilih file ${file.name}`}
                      aria-pressed={selected}
                      className={`absolute left-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-md border transition-opacity ${
                        selected
                          ? 'border-blue-600 bg-blue-600 text-white opacity-100'
                          : 'border-slate-300 bg-white/95 text-transparent opacity-0 group-hover:opacity-100 focus:opacity-100 dark:border-slate-600 dark:bg-slate-900/95'
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>

                    {/* Top-right Star indicator / toggle */}
                    {!isTrashView && (
                      <button
                        type="button"
                        onClick={() => onToggleStar(file)}
                        aria-label={
                          file.starred ? `Hapus bintang ${file.name}` : `Bintangi ${file.name}`
                        }
                        className={`absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-slate-600 transition-opacity dark:bg-slate-900/90 dark:text-slate-300 ${
                          file.starred
                            ? 'opacity-100 text-amber-500'
                            : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                        }`}
                      >
                        <Star
                          className={`h-3.5 w-3.5 ${
                            file.starred ? 'fill-amber-400 text-amber-500' : ''
                          }`}
                        />
                      </button>
                    )}
                  </div>

                  {/* Card Body & Unboxed Metadata */}
                  <div className="flex flex-col gap-1.5 p-3">
                    <button
                      type="button"
                      onClick={() => onOpenItem(file)}
                      className="flex w-full items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-blue-600 rounded"
                    >
                      <FileIcon
                        type="file"
                        mimeType={file.mimeType}
                        filename={file.name}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {file.name}
                      </span>
                    </button>

                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs tabular-nums text-slate-500 dark:text-slate-400">
                        <span>{formatBytes(file.size)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{formatRelativeDateId(file.updatedAt)}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            file.storageBackend === 'telegram'
                              ? 'font-medium text-blue-600 dark:text-blue-400'
                              : ''
                          }
                        >
                          {file.storageBackend === 'telegram' ? 'Telegram' : 'Lokal'}
                        </span>
                      </div>

                      <div className="flex shrink-0 items-center gap-0.5">
                        {!isTrashView ? (
                          <>
                            <button
                              type="button"
                              onClick={() => onDownloadItem(file)}
                              aria-label={`Unduh ${file.name}`}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-blue-400"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onMoveItem(file)}
                              aria-label={`Pindahkan ${file.name}`}
                              className="hidden h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 sm:flex dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                            >
                              <FolderInput className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onTrashItem(file)}
                              aria-label={`Buang ${file.name}`}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => onRestoreItem(file)}
                              aria-label={`Pulihkan ${file.name}`}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeletePermanent(file)}
                              aria-label={`Hapus permanen ${file.name}`}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
