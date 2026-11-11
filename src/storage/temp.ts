import type { Env } from "../env";
import { intVar } from "../env";
import {
  base64ToBytes,
  bytesToBase64,
  chunkBytes,
  concatBytes,
} from "./base64";
import {
  deviceConfigured,
  deviceHealth,
  devicePut,
} from "./device";

const TEMP_CHUNK_BYTES = 64 * 1024;
const INSERT_BATCH = 8;

interface TempRow {
  key: string;
  content_type: string;
  size: number;
  chunks: number;
  created_at: number;
}

interface TempChunkRow {
  idx: number;
  data: string;
}

export interface TempBlob {
  data: Uint8Array;
  contentType: string;
}

export interface TempBlobInfo {
  key: string;
  size: number;
  contentType: string;
  createdAt: number;
}

export async function putTemp(
  env: Env,
  key: string,
  data: Uint8Array,
  contentType: string,
): Promise<void> {
  const chunks = chunkBytes(data, TEMP_CHUNK_BYTES).map(bytesToBase64);
  const now = Date.now();
  const ttlDays = intVar(env.TEMP_BLOB_TTL_DAYS, 30);
  const expiresAt = now + ttlDays * 86_400_000;

  await env.DB.batch([
    env.DB.prepare("DELETE FROM temp_blobs WHERE key = ?").bind(key),
    env.DB.prepare("DELETE FROM temp_blob_chunks WHERE key = ?").bind(key),
  ]);

  // Insert the parent row first as pending. This prevents orphan-cleanup from
  // deleting chunks while they are being written.
  await env.DB.prepare(
    `INSERT INTO temp_blobs
      (key, content_type, size, chunks, pending, created_at, expires_at)
     VALUES (?, ?, 0, 0, 1, ?, ?)`,
  )
    .bind(key, contentType || "application/octet-stream", now, expiresAt)
    .run();

  for (let offset = 0; offset < chunks.length; offset += INSERT_BATCH) {
    const statements = chunks
      .slice(offset, offset + INSERT_BATCH)
      .map((chunk, index) =>
        env.DB.prepare(
          "INSERT INTO temp_blob_chunks (key, idx, data) VALUES (?, ?, ?)",
        ).bind(key, offset + index, chunk),
      );
    if (statements.length) {
      await env.DB.batch(statements);
    }
  }

  await env.DB.prepare(
    `UPDATE temp_blobs
        SET size = ?, chunks = ?, pending = 0
      WHERE key = ?`,
  )
    .bind(data.byteLength, chunks.length, key)
    .run();
}

export async function getTemp(
  env: Env,
  key: string,
): Promise<TempBlob | null> {
  const meta = await env.DB.prepare(
    `SELECT key, content_type, size, chunks, created_at
       FROM temp_blobs
      WHERE key = ? AND pending = 0 AND expires_at > ?`,
  )
    .bind(key, Date.now())
    .first<TempRow>();

  if (!meta) return null;

  const rows = await env.DB.prepare(
    "SELECT idx, data FROM temp_blob_chunks WHERE key = ? ORDER BY idx",
  )
    .bind(key)
    .all<TempChunkRow>();

  if (rows.results.length !== meta.chunks) {
    throw new Error(
      `Temporary blob ${key} is incomplete (${rows.results.length}/${meta.chunks} chunks)`,
    );
  }

  const data = concatBytes(rows.results.map((row) => base64ToBytes(row.data)));
  if (data.byteLength !== meta.size) {
    throw new Error(
      `Temporary blob ${key} has an unexpected size (${data.byteLength}/${meta.size})`,
    );
  }

  return {
    data,
    contentType: meta.content_type || "application/octet-stream",
  };
}

export async function tempStat(
  env: Env,
  key: string,
): Promise<{ size: number; contentType: string; createdAt: number } | null> {
  const row = await env.DB.prepare(
    `SELECT size, content_type, created_at
       FROM temp_blobs
      WHERE key = ? AND pending = 0 AND expires_at > ?`,
  )
    .bind(key, Date.now())
    .first<{ size: number; content_type: string; created_at: number }>();

  if (!row) return null;
  return {
    size: row.size,
    contentType: row.content_type,
    createdAt: row.created_at,
  };
}

export async function deleteTemp(env: Env, key: string): Promise<boolean> {
  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM temp_blob_chunks WHERE key = ?").bind(key),
    env.DB.prepare("DELETE FROM temp_blobs WHERE key = ?").bind(key),
  ]);
  return (results[1]?.meta.changes ?? 0) > 0;
}

export async function listTemp(
  env: Env,
  prefix: string,
  limit = 500,
): Promise<TempBlobInfo[]> {
  const rows = await env.DB.prepare(
    `SELECT key, content_type, size, created_at
       FROM temp_blobs
      WHERE pending = 0
        AND expires_at > ?
        AND substr(key, 1, ?) = ?
      ORDER BY key
      LIMIT ?`,
  )
    .bind(Date.now(), prefix.length, prefix, limit)
    .all<TempRow>();

  return rows.results.map((row) => ({
    key: row.key,
    size: row.size,
    contentType: row.content_type,
    createdAt: row.created_at,
  }));
}

export async function tempStats(
  env: Env,
): Promise<{ count: number; bytes: number }> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes
       FROM temp_blobs
      WHERE pending = 0 AND expires_at > ?`,
  )
    .bind(Date.now())
    .first<{ count: number; bytes: number }>();
  return {
    count: row?.count ?? 0,
    bytes: row?.bytes ?? 0,
  };
}

export async function markTempFailure(
  env: Env,
  key: string,
  message: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE temp_blobs
        SET attempts = attempts + 1,
            last_attempt_at = ?,
            last_error = ?
      WHERE key = ?`,
  )
    .bind(Date.now(), message.slice(0, 500), key)
    .run();
}

export async function cleanupExpired(env: Env): Promise<number> {
  const now = Date.now();
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM temp_blobs WHERE expires_at <= ?",
  )
    .bind(now)
    .first<{ count: number }>();

  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM temp_blob_chunks
        WHERE key IN (SELECT key FROM temp_blobs WHERE expires_at <= ?)`,
    ).bind(now),
    env.DB.prepare("DELETE FROM temp_blobs WHERE expires_at <= ?").bind(now),
  ]);

  await env.DB.prepare(
    `DELETE FROM temp_blob_chunks
      WHERE key NOT IN (SELECT key FROM temp_blobs)`,
  ).run();

  return row?.count ?? 0;
}

export interface FlushResult {
  deviceAvailable: boolean;
  synced: number;
  failed: number;
  expiredCleaned: number;
}

export async function flushTemp(
  env: Env,
  limit = 10,
): Promise<FlushResult> {
  const expiredCleaned = await cleanupExpired(env);

  if (!deviceConfigured(env)) {
    return {
      deviceAvailable: false,
      synced: 0,
      failed: 0,
      expiredCleaned,
    };
  }

  if (!(await deviceHealth(env))) {
    return {
      deviceAvailable: false,
      synced: 0,
      failed: 0,
      expiredCleaned,
    };
  }

  const rows = await env.DB.prepare(
    `SELECT key
       FROM temp_blobs
      WHERE pending = 0
        AND expires_at > ?
      ORDER BY created_at
      LIMIT ?`,
  )
    .bind(Date.now(), limit)
    .all<{ key: string }>();

  let synced = 0;
  let failed = 0;

  for (const row of rows.results) {
    const temp = await getTemp(env, row.key);
    if (!temp) continue;

    try {
      await devicePut(env, row.key, temp.data, temp.contentType);
      await deleteTemp(env, row.key);
      synced++;
    } catch (error) {
      failed++;
      await markTempFailure(
        env,
        row.key,
        error instanceof Error ? error.message : String(error),
      );
      break;
    }
  }

  return { deviceAvailable: true, synced, failed, expiredCleaned };
}
