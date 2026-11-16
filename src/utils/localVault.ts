import type { DriveItem, TelegramConfigState } from '../types/drive';

const ITEMS_KEY = 'teledrive_items_v2';
const TG_CONFIG_KEY = 'teledrive_tg_config_v2';
const IDB_NAME = 'TeleDriveBlobVault';
const IDB_STORE = 'blobs';

function openBlobDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLocalBlob(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openBlobDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // IndexedDB unavailable (e.g. private browsing restrictions)
  }
}

export async function getLocalBlob(key: string): Promise<Blob | null> {
  try {
    const db = await openBlobDb();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as Blob) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function deleteLocalBlob(key: string): Promise<void> {
  try {
    const db = await openBlobDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

export function createSeedItems(): DriveItem[] {
  const now = Date.now();
  const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();

  const panduanText = `TELEDRIVE — MODE LANGSUNG GITHUB PAGES + TELEGRAM

1. Cara Menghubungkan Bot Telegram Anda:
   - Buka @BotFather di Telegram, ketik /newbot, dan salin Bot Token Anda.
   - Buat Private Channel di Telegram sebagai brankas penyimpanan.
   - Tambahkan bot Anda sebagai Administrator Channel tersebut.
   - Buka "Hubungkan Telegram" di TeleDrive, tempel Bot Token, lalu klik "Deteksi Chat ID Otomatis".

2. Cara Kerja Mode Langsung (Versi 2):
   - Berjalan 100% statis (siap di-online-kan gratis di GitHub Pages).
   - File hingga 20 MB diunggah langsung dari browser Anda ke Channel Telegram.
   - Daftar folder & file disinkronkan lewat Pesan Tersemat (Pinned Message) di Channel Telegram Anda.
`;

  const roadmapText = `# Rencana Penyimpanan Cloud Gratis 2026

## Ringkasan Mode Langsung (GitHub Pages + Telegram)
- **Hosting Frontend**: GitHub Pages (Rp 0 / gratis permanen).
- **Penyimpanan File**: Private Channel Telegram (maks. 20 MB/file pada mode langsung browser).
- **Sinkronisasi Indeks**: Tersimpan otomatis di browser dan Pinned Message Channel Telegram.
`;

  const configText = JSON.stringify(
    {
      service: 'TeleDrive Static Edition',
      hosting: 'GitHub Pages',
      storage: 'Telegram Bot API (Direct Browser)',
      maxDirectFileSizeMb: 20,
      localCache: 'IndexedDB',
    },
    null,
    2,
  );

  const briefText = `# Brief Antarmuka TeleDrive

- Tata letak bersih terinspirasi Google Drive dengan respons kilat.
- Mendukung pratinjau langsung gambar, audio, video, teks, Markdown, dan JSON.
- Drag & drop file dari desktop ke jendela mana saja untuk langsung mengunggah.
`;

  const csvText = `Jenis_File,Ukuran_MB,Waktu_Upload_Detik,Status
Dokumen_PDF,4.2,1.1,Sukses
Foto_RAW,12.5,2.4,Sukses
Video_Klip,18.8,3.6,Sukses
`;

  return [
    {
      id: 'folder-desain',
      name: 'Desain Produk',
      type: 'folder',
      parentId: null,
      size: 0,
      mimeType: 'inode/directory',
      starred: true,
      trashed: false,
      createdAt: hoursAgo(72),
      updatedAt: hoursAgo(5),
      storageBackend: 'local',
      chunks: [],
    },
    {
      id: 'folder-dokumen',
      name: 'Dokumentasi Proyek',
      type: 'folder',
      parentId: null,
      size: 0,
      mimeType: 'inode/directory',
      starred: false,
      trashed: false,
      createdAt: hoursAgo(60),
      updatedAt: hoursAgo(8),
      storageBackend: 'local',
      chunks: [],
    },
    {
      id: 'folder-arsip',
      name: 'Arsip Backup',
      type: 'folder',
      parentId: null,
      size: 0,
      mimeType: 'inode/directory',
      starred: false,
      trashed: false,
      createdAt: hoursAgo(120),
      updatedAt: hoursAgo(24),
      storageBackend: 'local',
      chunks: [],
    },
    {
      id: 'file-studio-img',
      name: 'Studio_Arsitektur_Q4.jpg',
      type: 'file',
      parentId: null,
      size: 872_448,
      mimeType: 'image/jpeg',
      starred: true,
      trashed: false,
      createdAt: hoursAgo(14),
      updatedAt: hoursAgo(2),
      storageBackend: 'local',
      thumbnailUrl: './src/assets/images/demo_architecture_studio_1794836278695.jpg',
      chunks: [{ index: 0, size: 872_448 }],
    },
    {
      id: 'file-speaker-img',
      name: 'Speaker_Aural_Studio.jpg',
      type: 'file',
      parentId: null,
      size: 721_920,
      mimeType: 'image/jpeg',
      starred: false,
      trashed: false,
      createdAt: hoursAgo(18),
      updatedAt: hoursAgo(4),
      storageBackend: 'local',
      thumbnailUrl: './src/assets/images/demo_product_audio_1794836278300.jpg',
      chunks: [{ index: 0, size: 721_920 }],
    },
    {
      id: 'file-mountain-img',
      name: 'Puncak_Fajar_4K.jpg',
      type: 'file',
      parentId: 'folder-desain',
      size: 984_320,
      mimeType: 'image/jpeg',
      starred: true,
      trashed: false,
      createdAt: hoursAgo(30),
      updatedAt: hoursAgo(6),
      storageBackend: 'local',
      thumbnailUrl: './src/assets/images/demo_mountain_dawn_1794836279238.jpg',
      chunks: [{ index: 0, size: 984_320 }],
    },
    {
      id: 'file-panduan-txt',
      name: 'Panduan_Cepat_TeleDrive.txt',
      type: 'file',
      parentId: null,
      size: new Blob([panduanText]).size,
      mimeType: 'text/plain',
      starred: true,
      trashed: false,
      createdAt: hoursAgo(10),
      updatedAt: hoursAgo(1),
      storageBackend: 'local',
      demoTextContent: panduanText,
      chunks: [{ index: 0, size: new Blob([panduanText]).size }],
    },
    {
      id: 'file-roadmap-md',
      name: 'Rencana_Peluncuran_2026.md',
      type: 'file',
      parentId: null,
      size: new Blob([roadmapText]).size,
      mimeType: 'text/markdown',
      starred: false,
      trashed: false,
      createdAt: hoursAgo(22),
      updatedAt: hoursAgo(3),
      storageBackend: 'local',
      demoTextContent: roadmapText,
      chunks: [{ index: 0, size: new Blob([roadmapText]).size }],
    },
    {
      id: 'file-config-json',
      name: 'Konfigurasi_API_TeleDrive.json',
      type: 'file',
      parentId: null,
      size: new Blob([configText]).size,
      mimeType: 'application/json',
      starred: false,
      trashed: false,
      createdAt: hoursAgo(28),
      updatedAt: hoursAgo(9),
      storageBackend: 'local',
      demoTextContent: configText,
      chunks: [{ index: 0, size: new Blob([configText]).size }],
    },
    {
      id: 'file-brief-md',
      name: 'Brief_UI_Dashboard.md',
      type: 'file',
      parentId: 'folder-desain',
      size: new Blob([briefText]).size,
      mimeType: 'text/markdown',
      starred: false,
      trashed: false,
      createdAt: hoursAgo(40),
      updatedAt: hoursAgo(12),
      storageBackend: 'local',
      demoTextContent: briefText,
      chunks: [{ index: 0, size: new Blob([briefText]).size }],
    },
    {
      id: 'file-benchmark-csv',
      name: 'Laporan_Kecepatan_Chunking.csv',
      type: 'file',
      parentId: 'folder-dokumen',
      size: new Blob([csvText]).size,
      mimeType: 'text/csv',
      starred: false,
      trashed: false,
      createdAt: hoursAgo(36),
      updatedAt: hoursAgo(16),
      storageBackend: 'local',
      demoTextContent: csvText,
      chunks: [{ index: 0, size: new Blob([csvText]).size }],
    },
  ];
}

export function loadStoredItems(): DriveItem[] {
  try {
    const raw = localStorage.getItem(ITEMS_KEY);
    if (!raw) {
      const seeded = createSeedItems();
      saveStoredItems(seeded);
      return seeded;
    }
    const parsed = JSON.parse(raw) as DriveItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return createSeedItems();
  }
}

export function saveStoredItems(items: DriveItem[]): void {
  try {
    localStorage.setItem(ITEMS_KEY, JSON.stringify(items));
  } catch {
    // ignore storage quota errors
  }
}

export function loadStoredTelegramConfig(): TelegramConfigState {
  try {
    const raw = localStorage.getItem(TG_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TelegramConfigState>;
      return {
        connected: Boolean(parsed.connected && parsed.botToken && parsed.chatId),
        botToken: parsed.botToken || '',
        chatId: parsed.chatId || '',
        botUsername: parsed.botUsername,
        botName: parsed.botName,
        chatTitle: parsed.chatTitle,
        chatType: parsed.chatType,
        autoSync: parsed.autoSync ?? true,
        pinnedIndexMessageId: parsed.pinnedIndexMessageId,
        lastSyncedAt: parsed.lastSyncedAt,
      };
    }
  } catch {
    // fall through
  }

  return {
    connected: false,
    botToken: '',
    chatId: '',
    autoSync: true,
  };
}

export function saveStoredTelegramConfig(cfg: TelegramConfigState): void {
  try {
    localStorage.setItem(TG_CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    // ignore
  }
}
