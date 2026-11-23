import { useEffect, useState } from 'react';
import { Folder, HardDrive, MapPin, Star } from 'lucide-react';
import type { DriveItem } from '../types/drive';
import {
  formatBytes,
  formatRelativeDateId,
  getFileCategory,
  getItemLocationPath,
} from '../utils/fileHelpers';
import { DIRECT_TELEGRAM_MAX_BYTES } from '../utils/telegramDirect';

export interface HoveredItemAnchor {
  item: DriveItem;
  rect: {
    top: number;
    left: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
}

interface ItemHoverTooltipProps {
  anchor: HoveredItemAnchor | null;
  allItems: DriveItem[];
  folderCounts?: Record<string, number>;
}

const CATEGORY_LABELS: Record<string, string> = {
  image: 'Foto / Gambar',
  video: 'Video',
  audio: 'Musik / Audio',
  document: 'Dokumen',
  code: 'Kode / Teks',
  archive: 'Arsip',
  other: 'File Lainnya',
};

const TOOLTIP_MAX_WIDTH = 340;
const VIEWPORT_MARGIN = 12;

export function ItemHoverTooltip({
  anchor,
  allItems,
  folderCounts = {},
}: ItemHoverTooltipProps) {
  const [viewport, setViewport] = useState<{ w: number; h: number }>(() =>
    typeof window !== 'undefined'
      ? { w: window.innerWidth, h: window.innerHeight }
      : { w: 1280, h: 720 },
  );

  useEffect(() => {
    const onResize = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!anchor) return null;

  const { item, rect } = anchor;
  const locationPath = getItemLocationPath(item, allItems);
  const isFolder = item.type === 'folder';
  const childCount = isFolder ? folderCounts[item.id] ?? 0 : 0;
  const category = isFolder ? 'Folder' : CATEGORY_LABELS[getFileCategory(item.mimeType, item.name)] || 'File';

  const tooltipWidth = Math.min(TOOLTIP_MAX_WIDTH, viewport.w - VIEWPORT_MARGIN * 2);
  const clampedLeft = Math.max(
    VIEWPORT_MARGIN,
    Math.min(rect.left, viewport.w - tooltipWidth - VIEWPORT_MARGIN),
  );

  const estimatedHeight = 152;
  const spaceBelow = viewport.h - rect.bottom - VIEWPORT_MARGIN;
  const showAbove = spaceBelow < estimatedHeight && rect.top > estimatedHeight + VIEWPORT_MARGIN;
  const topPos = showAbove
    ? Math.max(VIEWPORT_MARGIN, rect.top - estimatedHeight - 8)
    : Math.min(viewport.h - estimatedHeight - VIEWPORT_MARGIN, rect.bottom + 8);

  return (
    <div
      role="tooltip"
      aria-live="off"
      style={{
        left: clampedLeft,
        top: topPos,
        width: tooltipWidth,
      }}
      className="td-animate-pop pointer-events-none fixed z-50 rounded-xl border border-slate-200 bg-white p-3.5 shadow-xl dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 [overflow-wrap:anywhere] font-display text-xs font-bold leading-snug text-slate-900 dark:text-slate-100">
          {item.name}
        </p>
        {item.starred && (
          <Star className="mt-0.5 h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" />
        )}
      </div>

      <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2 text-[11px] dark:border-slate-800">
        <div className="flex items-start gap-1.5 text-slate-600 dark:text-slate-300">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere] leading-snug">{locationPath}</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-200">
            {isFolder ? (
              <Folder className="h-3 w-3 text-amber-500" />
            ) : (
              <HardDrive className="h-3 w-3 text-blue-600 dark:text-blue-400" />
            )}
            <span>{category}</span>
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
            {isFolder
              ? childCount > 0
                ? `${childCount} item`
                : 'Kosong'
              : formatBytes(item.size)}
          </span>
          <span aria-hidden="true">·</span>
          <span>{formatRelativeDateId(item.updatedAt)}</span>
        </div>

        {!isFolder && (
          <div className="text-[10.5px] text-slate-500 dark:text-slate-400">
            Penyimpanan:{' '}
            <span className="font-medium text-blue-600 dark:text-blue-400">
              {item.size > DIRECT_TELEGRAM_MAX_BYTES ? 'Telegram (>20 MB)' : 'Cloud Telegram'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
