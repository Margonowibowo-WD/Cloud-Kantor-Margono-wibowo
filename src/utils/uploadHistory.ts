export type UploadHistoryStatus = 'success' | 'error' | 'cancelled';

export interface UploadHistoryEntry {
  id: string;
  taskId?: string;
  filename: string;
  size: number;
  parentId: string | null;
  folderPathLabel: string;
  status: UploadHistoryStatus;
  errorMessage?: string;
  timestamp: string;
  dayKey: string;
  speedBytesPerSec?: number;
  elapsedSeconds?: number;
  totalChunks?: number;
}

export const UPLOAD_HISTORY_STORAGE_KEY = 'teledrive_upload_history_v1';
export const MAX_DAILY_HISTORY_ENTRIES = 2000;

export function getLocalDayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildHistoryMatchKey(
  parentId: string | null,
  filename: string,
  size: number,
): string {
  return `${parentId ?? 'ROOT'}::${filename.trim().toLowerCase()}::${Number(size) || 0}`;
}

export function pruneUploadHistoryByDay(
  entries: UploadHistoryEntry[],
  todayKey = getLocalDayKey(),
): UploadHistoryEntry[] {
  return entries.filter(
    (entry) =>
      Boolean(entry) &&
      typeof entry.id === 'string' &&
      typeof entry.filename === 'string' &&
      entry.dayKey === todayKey,
  );
}

export function capDailyHistoryEntries(
  entries: UploadHistoryEntry[],
  maxEntries = MAX_DAILY_HISTORY_ENTRIES,
): UploadHistoryEntry[] {
  if (entries.length <= maxEntries) return entries;
  // Preserve unresolved failed/cancelled items first when capping very large daily logs
  const unresolved = entries.filter((e) => e.status !== 'success');
  const successes = entries.filter((e) => e.status === 'success');
  if (unresolved.length >= maxEntries) {
    return unresolved.slice(0, maxEntries);
  }
  const keepSuccessCount = Math.max(0, maxEntries - unresolved.length);
  const keptSet = new Set([
    ...unresolved.map((e) => e.id),
    ...successes.slice(0, keepSuccessCount).map((e) => e.id),
  ]);
  return entries.filter((e) => keptSet.has(e.id));
}

export function recordUploadHistoryEntry(
  currentEntries: UploadHistoryEntry[],
  incoming: Omit<UploadHistoryEntry, 'id' | 'timestamp' | 'dayKey'> & {
    id?: string;
    timestamp?: string;
    dayKey?: string;
  },
  now = new Date(),
): UploadHistoryEntry[] {
  const todayKey = incoming.dayKey || getLocalDayKey(now);
  const todayOnly = pruneUploadHistoryByDay(currentEntries, todayKey);
  const incomingKey = buildHistoryMatchKey(incoming.parentId, incoming.filename, incoming.size);

  const entry: UploadHistoryEntry = {
    ...incoming,
    id: incoming.id || `hist-${crypto.randomUUID()}`,
    timestamp: incoming.timestamp || now.toISOString(),
    dayKey: todayKey,
  };

  // When a file succeeds (or fails again), replace any older unresolved failed/cancelled record
  // for the same folder+filename+size so the Gagal tab never holds stale duplicates.
  const filtered = todayOnly.filter((existing) => {
    if (existing.status === 'success') return true;
    const existingKey = buildHistoryMatchKey(
      existing.parentId,
      existing.filename,
      existing.size,
    );
    return existingKey !== incomingKey;
  });

  return capDailyHistoryEntries([entry, ...filtered]);
}

export function loadTodayUploadHistory(now = new Date()): UploadHistoryEntry[] {
  const todayKey = getLocalDayKey(now);
  try {
    const raw = localStorage.getItem(UPLOAD_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UploadHistoryEntry[];
    if (!Array.isArray(parsed)) return [];
    const todayOnly = pruneUploadHistoryByDay(parsed, todayKey);
    if (todayOnly.length !== parsed.length) {
      saveTodayUploadHistory(todayOnly, now);
    }
    return todayOnly;
  } catch {
    return [];
  }
}

export function saveTodayUploadHistory(
  entries: UploadHistoryEntry[],
  now = new Date(),
): void {
  const todayKey = getLocalDayKey(now);
  const pruned = capDailyHistoryEntries(pruneUploadHistoryByDay(entries, todayKey));
  try {
    if (pruned.length === 0) {
      localStorage.removeItem(UPLOAD_HISTORY_STORAGE_KEY);
      return;
    }
    localStorage.setItem(UPLOAD_HISTORY_STORAGE_KEY, JSON.stringify(pruned));
  } catch {
    // Quota fallback: retain unresolved errors + latest 200 successes
    try {
      const compact = capDailyHistoryEntries(pruned, 250);
      localStorage.setItem(UPLOAD_HISTORY_STORAGE_KEY, JSON.stringify(compact));
    } catch {
      // ignore storage errors
    }
  }
}

export function clearTodayUploadHistory(): void {
  try {
    localStorage.removeItem(UPLOAD_HISTORY_STORAGE_KEY);
  } catch {
    // ignore
  }
}
