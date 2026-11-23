const VAULT_PREFIX = 'TDVAULT1:';
const PBKDF2_ITERATIONS = 100_000;

export interface TelegramVaultPayload {
  botToken: string;
  chatId: string;
  corsProxyUrl?: string;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

async function deriveVaultKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(pin.trim()),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function isVaultConfigured(vaultString: string | undefined | null): boolean {
  return Boolean(vaultString && vaultString.trim().startsWith(VAULT_PREFIX));
}

export async function encryptTelegramVault(
  payload: TelegramVaultPayload,
  pin: string,
): Promise<string> {
  const cleanToken = payload.botToken.trim();
  const cleanChat = payload.chatId.trim();
  const cleanPin = pin.trim();

  if (!cleanToken || !cleanChat) {
    throw new Error('Bot Token dan Chat ID wajib diisi sebelum membuat kode brankas.');
  }
  if (cleanPin.length < 4) {
    throw new Error('PIN brankas minimal 4 karakter atau angka.');
  }

  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveVaultKey(cleanPin, salt);

  const cleanProxy = payload.corsProxyUrl?.trim();
  const payloadObj: { t: string; c: string; p?: string } = { t: cleanToken, c: cleanChat };
  if (cleanProxy) {
    payloadObj.p = cleanProxy;
  }
  const plaintext = new TextEncoder().encode(JSON.stringify(payloadObj));
  const cipherBuffer = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    plaintext,
  );

  return `${VAULT_PREFIX}${bytesToBase64Url(salt)}.${bytesToBase64Url(iv)}.${bytesToBase64Url(
    new Uint8Array(cipherBuffer),
  )}`;
}

export async function decryptTelegramVault(
  vaultString: string,
  pin: string,
): Promise<TelegramVaultPayload> {
  const cleanVault = vaultString.trim();
  const cleanPin = pin.trim();

  if (!isVaultConfigured(cleanVault)) {
    throw new Error('Kode brankas tidak valid.');
  }
  if (!cleanPin) {
    throw new Error('Masukkan PIN brankas terlebih dahulu.');
  }

  const body = cleanVault.slice(VAULT_PREFIX.length);
  const parts = body.split('.');
  if (parts.length !== 3) {
    throw new Error('Format kode brankas rusak.');
  }

  try {
    const salt = base64UrlToBytes(parts[0]);
    const iv = base64UrlToBytes(parts[1]);
    const cipherBytes = base64UrlToBytes(parts[2]);

    const key = await deriveVaultKey(cleanPin, salt);
    const plainBuffer = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(cipherBytes),
    );

    const parsed = JSON.parse(new TextDecoder().decode(plainBuffer)) as {
      t?: string;
      c?: string;
      p?: string;
    };
    if (!parsed.t || !parsed.c) {
      throw new Error('Isi brankas kosong.');
    }
    return {
      botToken: parsed.t,
      chatId: parsed.c,
      corsProxyUrl: parsed.p?.trim() || undefined,
    };
  } catch {
    throw new Error('PIN salah atau kode brankas tidak cocok.');
  }
}
