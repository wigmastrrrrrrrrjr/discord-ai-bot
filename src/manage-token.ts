import type { Env } from "./env";

const TOKEN_VERSION = "v1";
const TOKEN_BYTES = 15;

function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encryptionBytes(value: string | undefined): Uint8Array {
  if (!value) throw new Error("DASHBOARD_ENCRYPTION_KEY is not configured");
  const base64 = value.trim();
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encryptionBytes(env.DASHBOARD_ENCRYPTION_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signPayload(
  env: Env,
  payload: string,
): Promise<string> {
  const key = await hmacKey(env);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

async function verifySignature(
  env: Env,
  payload: string,
  signature: string,
): Promise<boolean> {
  const key = await hmacKey(env);
  return crypto.subtle.verify(
    "HMAC",
    key,
    decodeBase64Url(signature),
    new TextEncoder().encode(payload),
  );
}

export interface ManageTokenPayload {
  guildId: string;
  userId: string;
  guildName?: string;
  expiresAt: number;
}

export async function createManageToken(
  env: Env,
  payload: Omit<ManageTokenPayload, "expiresAt">,
): Promise<string> {
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const bodyText = JSON.stringify({ ...payload, expiresAt });
  const body = encodeBase64Url(new TextEncoder().encode(bodyText));
  const signature = await signPayload(env, body);
  return `${TOKEN_VERSION}.${body}.${signature}`;
}

export async function readManageToken(
  env: Env,
  token: string,
): Promise<ManageTokenPayload | null> {
  if (!token.startsWith(`${TOKEN_VERSION}.`)) return null;
  const body = token.slice(TOKEN_VERSION.length + 1);
  const signature = body.slice(body.lastIndexOf(".") + 1);
  const payload = body.slice(0, body.lastIndexOf("."));
  if (!payload || !signature) return null;

  try {
    const valid = await verifySignature(env, payload, signature);
    if (!valid) return null;
    const decoded = new TextDecoder().decode(decodeBase64Url(payload));
    const parsed = JSON.parse(decoded) as ManageTokenPayload;
    if (!parsed.guildId || !parsed.userId || !parsed.expiresAt) return null;
    if (Date.now() > parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function randomManageNonce(bytes = TOKEN_BYTES): Promise<string> {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return encodeBase64Url(data);
}
