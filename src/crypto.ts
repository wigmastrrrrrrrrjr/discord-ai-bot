import type { Env } from "./env";

const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const BLOB_HEADER = new TextEncoder().encode("AESGCM1");

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encryptionKey(env: Env): Uint8Array {
  const configured = env.DASHBOARD_ENCRYPTION_KEY?.trim();
  if (!configured) {
    throw new Error("DASHBOARD_ENCRYPTION_KEY is not configured");
  }
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(configured);
  } catch {
    throw new Error("DASHBOARD_ENCRYPTION_KEY must be base64");
  }
  if (bytes.length !== KEY_BYTES) {
    throw new Error(
      "DASHBOARD_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
    );
  }
  return bytes;
}

async function importEncryptionKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encryptionKey(env),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

export function isEncryptedText(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith(`${VERSION}.`));
}

export async function encryptText(env: Env, plaintext: string): Promise<string> {
  const key = await importEncryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${VERSION}.${encodeBase64(iv)}.${encodeBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptText(env: Env, value: string): Promise<string> {
  const [version, ivValue, ciphertextValue] = value.split(".");
  if (version !== VERSION || !ivValue || !ciphertextValue) {
    throw new Error("Invalid encrypted text");
  }
  const key = await importEncryptionKey(env);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeBase64(ivValue) },
    key,
    decodeBase64(ciphertextValue),
  );
  return new TextDecoder().decode(plaintext);
}

export async function encryptBytes(
  env: Env,
  data: Uint8Array,
): Promise<Uint8Array> {
  const key = await importEncryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data),
  );
  const output = new Uint8Array(
    BLOB_HEADER.byteLength + IV_BYTES + ciphertext.byteLength,
  );
  output.set(BLOB_HEADER, 0);
  output.set(iv, BLOB_HEADER.byteLength);
  output.set(ciphertext, BLOB_HEADER.byteLength + IV_BYTES);
  return output;
}

export function isEncryptedBytes(data: Uint8Array): boolean {
  if (data.byteLength < BLOB_HEADER.byteLength + IV_BYTES) return false;
  return BLOB_HEADER.every((byte, index) => data[index] === byte);
}

export async function decryptBytes(
  env: Env,
  data: Uint8Array,
): Promise<Uint8Array> {
  if (!isEncryptedBytes(data)) return data;
  const key = await importEncryptionKey(env);
  const iv = data.slice(
    BLOB_HEADER.byteLength,
    BLOB_HEADER.byteLength + IV_BYTES,
  );
  const ciphertext = data.slice(BLOB_HEADER.byteLength + IV_BYTES);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );
  return new Uint8Array(plaintext);
}
