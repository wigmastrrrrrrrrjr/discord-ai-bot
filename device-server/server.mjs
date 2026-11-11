import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(process.env.BLOB_DIR || "./blobs");
const META = path.join(ROOT, "_meta");
const TOKEN = process.env.DEVICE_BLOB_TOKEN;
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 100 * 1024 * 1024);
const LIST_LIMIT = 500;

if (!TOKEN) {
  console.error("DEVICE_BLOB_TOKEN is required.");
  process.exit(1);
}

function authorized(request) {
  const header = request.headers.authorization || "";
  const expected = `Bearer ${TOKEN}`;
  if (header.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function safeKey(pathname) {
  const raw = pathname.slice("/objects/".length);
  const segments = raw.split("/").map((segment) => decodeURIComponent(segment));
  if (!segments.length) throw new Error("Missing object key");
  for (const segment of segments) {
    if (
      !segment ||
      segment === "." ||
      segment === ".." ||
      segment === "_meta" ||
      segment.includes("\0") ||
      segment.includes("\\") ||
      segment.includes("/")
    ) {
      throw new Error("Invalid object key");
    }
  }
  return segments.join("/");
}

function objectPath(key) {
  const filePath = path.join(ROOT, ...key.split("/"));
  if (!filePath.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error("Invalid object key");
  }
  return filePath;
}

function metaPath(key) {
  const filePath = path.join(META, ...key.split("/"));
  if (!filePath.startsWith(`${META}${path.sep}`)) {
    throw new Error("Invalid object key");
  }
  return `${filePath}.json`;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function readMeta(key) {
  try {
    return JSON.parse(await fs.readFile(metaPath(key), "utf8"));
  } catch {
    return null;
  }
}

async function writeMeta(key, contentType, size) {
  const file = metaPath(key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({
      contentType,
      size,
      lastModified: Date.now(),
    }),
  );
}

async function handlePut(request, response, key) {
  const body = await readBody(request);
  const filePath = objectPath(key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const temporary = `${filePath}.tmp-${crypto.randomUUID()}`;
  await fs.writeFile(temporary, body);
  await fs.rename(temporary, filePath);

  const contentType =
    request.headers["content-type"] || "application/octet-stream";
  await writeMeta(key, contentType, body.length);

  response.writeHead(204);
  response.end();
}

async function handleGet(response, key) {
  const filePath = objectPath(key);
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const meta = await readMeta(key);
  response.writeHead(200, {
    "content-type": meta?.contentType || "application/octet-stream",
    "content-length": stat.size,
    "last-modified": stat.mtime.toUTCString(),
  });
  createReadStream(filePath).pipe(response);
}

async function handleHead(response, key) {
  const filePath = objectPath(key);
  try {
    const stat = await fs.stat(filePath);
    const meta = await readMeta(key);
    response.writeHead(200, {
      "content-type": meta?.contentType || "application/octet-stream",
      "content-length": stat.size,
      "last-modified": stat.mtime.toUTCString(),
    });
    response.end();
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

async function handleDelete(response, key) {
  const filePath = objectPath(key);
  let deleted = false;
  try {
    await fs.unlink(filePath);
    deleted = true;
  } catch {
    // Missing file is fine; still try to remove stale metadata.
  }
  try {
    await fs.unlink(metaPath(key));
  } catch {
    // Missing metadata is fine.
  }
  if (!deleted) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  response.writeHead(204);
  response.end();
}

async function walk(directory, prefix = "", output = []) {
  if (output.length >= LIST_LIMIT) return output;
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return output;
  }

  for (const entry of entries) {
    if (output.length >= LIST_LIMIT) break;
    if (entry.name === "_meta" || entry.name.includes(".tmp-")) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, `${prefix}${entry.name}/`, output);
    } else if (entry.isFile()) {
      const key = `${prefix}${entry.name}`;
      const stat = await fs.stat(fullPath);
      const meta = await readMeta(key);
      output.push({
        key,
        size: stat.size,
        contentType: meta?.contentType || "application/octet-stream",
        lastModified: stat.mtimeMs,
      });
    }
  }
  return output;
}

async function handleList(response, url) {
  const prefix = url.searchParams.get("prefix") || "";
  const limit = Math.min(
    Number(url.searchParams.get("limit") || LIST_LIMIT),
    LIST_LIMIT,
  );
  const objects = (await walk(ROOT))
    .filter((object) => object.key.startsWith(prefix))
    .slice(0, limit);
  sendJson(response, 200, { objects });
}

const server = createServer(async (request, response) => {
  try {
    if (!authorized(request)) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }

    const url = new URL(request.url || "/", "http://localhost");

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && url.pathname === "/objects") {
      await handleList(response, url);
      return;
    }

    if (url.pathname.startsWith("/objects/")) {
      const key = safeKey(url.pathname);

      switch (request.method) {
        case "PUT":
          await handlePut(request, response, key);
          return;
        case "GET":
          await handleGet(response, key);
          return;
        case "HEAD":
          await handleHead(response, key);
          return;
        case "DELETE":
          await handleDelete(response, key);
          return;
        default:
          sendJson(response, 405, { error: "Method not allowed" });
          return;
      }
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    } else {
      response.destroy();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Blob server listening on http://${HOST}:${PORT}`);
  console.log(`Storage directory: ${ROOT}`);
});
