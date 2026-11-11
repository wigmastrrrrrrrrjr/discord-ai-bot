import type { Env } from "./env";

// Google login for the web agent UI. Sessions are random bearer tokens; the
// payload is encrypted with WEB_SESSION_SECRET before it lands in KV.

const WEB_COOKIE = "agent_session";
const WEB_STATE_COOKIE = "agent_oauth_state";
const SESSION_TTL = 30 * 24 * 3600; // 30 days

export interface WebSession {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
  issuedAt: number;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptPayload(secret: string, data: string): Promise<string> {
  const key = await aesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(data),
  );
  return `${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(encrypted))}`;
}

export async function decryptPayload(secret: string, blob: string): Promise<string | null> {
  const [ivPart, dataPart] = blob.split(".");
  if (!ivPart || !dataPart) return null;
  try {
    const key = await aesKey(secret);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlDecode(ivPart) },
      key,
      base64UrlDecode(dataPart),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export function googleConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function startGoogleAuth(env: Env, request: Request): Response {
  if (!googleConfigured(env)) {
    return new Response("Google login is not configured yet.", { status: 503 });
  }
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${new URL(request.url).origin}/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  const headers = new Headers({
    Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
  });
  headers.append(
    "Set-Cookie",
    cookie(WEB_STATE_COOKIE, state, 600),
  );
  return new Response(null, { status: 302, headers });
}

async function storeSession(env: Env, session: WebSession): Promise<string> {
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const secret = env.WEB_SESSION_SECRET ?? "";
  const blob = await encryptPayload(secret, JSON.stringify(session));
  await env.DB.prepare(
    `INSERT INTO dashboard_state (kind, key, payload, expires_at)
     VALUES ('websess', ?, ?, ?)
     ON CONFLICT(kind, key) DO UPDATE SET
       payload = excluded.payload, expires_at = excluded.expires_at`,
  )
    .bind(token, blob, Date.now() / 1000 + SESSION_TTL)
    .run()
    .catch(() =>
      env.CONVERSATIONS.put(`websess:${token}`, blob, {
        expirationTtl: SESSION_TTL,
      }),
    );
  return token;
}

export async function finishGoogleAuth(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = readCookie(request, WEB_STATE_COOKIE);
  const fail = (message: string) =>
    new Response(null, {
      status: 302,
      headers: { Location: `/agent?error=${encodeURIComponent(message)}` },
    });
  if (!code || !state || !expectedState || state !== expectedState) {
    return fail("Invalid Google OAuth state");
  }
  if (!googleConfigured(env)) return fail("Google login is not configured");

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${url.origin}/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResponse.ok) return fail("Google token exchange failed");
  const tokens = (await tokenResponse.json()) as { id_token?: string };
  const idToken = tokens.id_token;
  if (!idToken) return fail("Google returned no identity token");
  const payloadPart = idToken.split(".")[1];
  if (!payloadPart) return fail("Malformed Google identity token");
  let claims: { sub?: string; email?: string; name?: string; picture?: string };
  try {
    claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
  } catch {
    return fail("Malformed Google identity token");
  }
  if (!claims.sub) return fail("Google identity missing subject");

  const token = await storeSession(env, {
    sub: claims.sub,
    email: claims.email ?? "",
    name: claims.name ?? claims.email ?? "Google user",
    picture: claims.picture ?? null,
    issuedAt: Date.now(),
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/agent",
      "Set-Cookie": `${cookie(WEB_COOKIE, token, SESSION_TTL)}; ${cookie(WEB_STATE_COOKIE, "", 0)}`.replace("; ", "; "),
    },
  });
}

export async function loadWebSession(
  env: Env,
  request: Request,
): Promise<WebSession | null> {
  const token = readCookie(request, WEB_COOKIE);
  if (!token) return null;
  let blob: string | null = null;
  try {
    const row = await env.DB.prepare(
      `SELECT payload FROM dashboard_state WHERE kind = 'websess' AND key = ? AND expires_at > ?`,
    )
      .bind(token, Date.now() / 1000)
      .first<{ payload: string }>();
    blob = row?.payload ?? null;
  } catch {
    blob = null;
  }
  if (!blob) blob = await env.CONVERSATIONS.get(`websess:${token}`);
  if (!blob) return null;
  const json = await decryptPayload(env.WEB_SESSION_SECRET ?? "", blob);
  if (!json) return null;
  try {
    return JSON.parse(json) as WebSession;
  } catch {
    return null;
  }
}

export function webSessionLogout(env: Env, request: Request): Response {
  const token = readCookie(request, WEB_COOKIE);
  if (token) {
    env.DB.prepare(`DELETE FROM dashboard_state WHERE kind = 'websess' AND key = ?`)
      .bind(token)
      .run()
      .catch(() => undefined);
    env.CONVERSATIONS.delete(`websess:${token}`).catch(() => undefined);
  }
  return new Response(null, {
    status: 302,
    headers: { Location: "/agent", "Set-Cookie": cookie(WEB_COOKIE, "", 0) },
  });
}

export async function sessionCookieToken(env: Env, request: Request): Promise<string | null> {
  const token = readCookie(request, WEB_COOKIE);
  if (!token) return null;
  if (!(await env.CONVERSATIONS.get(`websess:${token}`))) return null;
  return token;
}

export interface WebIdentity {
  id: string;
  name: string;
  email: string;
  picture: string | null;
  provider: "google" | "discord";
}

// Accepts either the Google web session cookie or the existing Discord
// dashboard session cookie. Every caller treats these as the same user space.
export async function getWebIdentity(
  env: Env,
  request: Request,
): Promise<WebIdentity | null> {
  const google = await loadWebSession(env, request);
  if (google) {
    return {
      id: `google:${google.sub}`,
      name: google.name,
      email: google.email,
      picture: google.picture,
      provider: "google",
    };
  }
  try {
    const { loadSession } = await import("./dashboard");
    const found = await loadSession(env, request);
    if (found?.session.userId) {
      return {
        id: `discord:${found.session.userId}`,
        name: found.session.globalName || found.session.username,
        email: "",
        picture: found.session.avatar
          ? `https://cdn.discordapp.com/avatars/${found.session.userId}/${found.session.avatar}.png`
          : null,
        provider: "discord",
      };
    }
  } catch {
    // discord session unavailable
  }
  return null;
}
