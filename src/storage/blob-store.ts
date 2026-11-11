import type { Env } from "../env";
import { intVar } from "../env";
import {
  deviceConfigured,
  deviceDelete,
  deviceGet,
  deviceHead,
  deviceHealth,
  deviceList,
  devicePut,
  DeviceUnavailableError,
} from "./device";
import { buildScopedKey, sanitizeRelativeKey } from "./keys";
import {
  deleteTemp,
  getTemp,
  listTemp,
  putTemp,
  tempStat,
  tempStats,
} from "./temp";

export type BlobLocation = "device" | "temp";

export interface StoredBlob {
  key: string;
  data: Uint8Array;
  contentType: string;
  location: BlobLocation;
}

export interface BlobInfo {
  key: string;
  size: number;
  contentType?: string;
  location: BlobLocation;
}

export interface PutResult {
  key: string;
  location: BlobLocation;
  size: number;
}

export class BlobStore {
  constructor(
    private readonly env: Env,
    private readonly scope: string,
  ) {}

  private scopedKey(relativeKey: string): {
    relative: string;
    full: string;
  } {
    const relative = sanitizeRelativeKey(relativeKey);
    return {
      relative,
      full: buildScopedKey(this.scope, relative),
    };
  }

  private scopePrefix(): string {
    return `${this.scope.replace(/\/+$/, "")}/`;
  }

  async put(
    relativeKey: string,
    data: Uint8Array,
    contentType = "application/octet-stream",
  ): Promise<PutResult> {
    const { relative, full } = this.scopedKey(relativeKey);
    const type = contentType || "application/octet-stream";

    if (deviceConfigured(this.env)) {
      try {
        await devicePut(this.env, full, data, type);
        try {
          await deleteTemp(this.env, full);
        } catch {
          // The sync job will retry the delete; the device copy is authoritative.
        }
        return { key: relative, location: "device", size: data.byteLength };
      } catch (error) {
        if (!(error instanceof DeviceUnavailableError)) throw error;
      }
    }

    const maxTempBytes = intVar(this.env.MAX_TEMP_BLOB_BYTES, 5 * 1024 * 1024);
    if (data.byteLength > maxTempBytes) {
      throw new Error(
        `Device storage is unavailable and this file is ${data.byteLength} bytes, ` +
          `which is above the ${maxTempBytes}-byte temporary D1 limit.`,
      );
    }

    await putTemp(this.env, full, data, type);
    return { key: relative, location: "temp", size: data.byteLength };
  }

  async get(relativeKey: string): Promise<StoredBlob | null> {
    const { relative, full } = this.scopedKey(relativeKey);

    // A temp row means a newer write has not reached the device yet. Prefer it
    // over the device copy until the sync job moves it and deletes the row.
    const temp = await getTemp(this.env, full);
    if (temp) {
      return {
        key: relative,
        data: temp.data,
        contentType: temp.contentType,
        location: "temp",
      };
    }

    let deviceError: unknown = null;
    if (deviceConfigured(this.env)) {
      try {
        const found = await deviceGet(this.env, full);
        if (found) {
          return {
            key: relative,
            data: found.data,
            contentType: found.contentType,
            location: "device",
          };
        }
      } catch (error) {
        deviceError = error;
      }
    }

    if (deviceError) throw deviceError;
    return null;
  }

  async stat(relativeKey: string): Promise<BlobInfo | null> {
    const { relative, full } = this.scopedKey(relativeKey);

    const temp = await tempStat(this.env, full);
    if (temp) {
      return {
        key: relative,
        size: temp.size,
        contentType: temp.contentType,
        location: "temp",
      };
    }

    let deviceError: unknown = null;
    if (deviceConfigured(this.env)) {
      try {
        const head = await deviceHead(this.env, full);
        if (head) {
          return {
            key: relative,
            size: head.size,
            contentType: head.contentType,
            location: "device",
          };
        }
      } catch (error) {
        deviceError = error;
      }
    }

    if (deviceError) throw deviceError;
    return null;
  }

  async delete(
    relativeKey: string,
  ): Promise<{ key: string; device: boolean; temp: boolean }> {
    const { relative, full } = this.scopedKey(relativeKey);
    let deviceDeleted = false;
    let deviceError: unknown = null;

    if (deviceConfigured(this.env)) {
      try {
        deviceDeleted = await deviceDelete(this.env, full);
      } catch (error) {
        deviceError = error;
      }
    }

    const tempDeleted = await deleteTemp(this.env, full);
    if (deviceError && !tempDeleted) throw deviceError;

    return { key: relative, device: deviceDeleted, temp: tempDeleted };
  }

  async list(prefix = ""): Promise<BlobInfo[]> {
    const scopePrefix = this.scopePrefix();
    let cleanPrefix = "";
    if (prefix.trim()) {
      try {
        cleanPrefix = sanitizeRelativeKey(prefix);
      } catch {
        cleanPrefix = "";
      }
    }

    const fullPrefix = cleanPrefix
      ? `${scopePrefix}${cleanPrefix}`
      : scopePrefix;

    const results = new Map<string, BlobInfo>();

    if (deviceConfigured(this.env)) {
      try {
        const objects = await deviceList(this.env, fullPrefix);
        for (const object of objects) {
          if (!object.key.startsWith(fullPrefix)) continue;
          results.set(object.key, {
            key: object.key.slice(scopePrefix.length),
            size: object.size,
            contentType: object.contentType,
            location: "device",
          });
        }
      } catch {
        // Fall through to temporary storage.
      }
    }

    const temporary = await listTemp(this.env, fullPrefix);
    for (const object of temporary) {
      // Temp wins for duplicate keys because it represents a newer write that
      // has not been synced to the device yet.
      results.set(object.key, {
        key: object.key.slice(scopePrefix.length),
        size: object.size,
        contentType: object.contentType,
        location: "temp",
      });
    }

    return [...results.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  async status(): Promise<{
    deviceConfigured: boolean;
    deviceAvailable: boolean;
    tempCount: number;
    tempBytes: number;
  }> {
    const configured = deviceConfigured(this.env);
    const available = configured ? await deviceHealth(this.env) : false;
    const stats = await tempStats(this.env);
    return {
      deviceConfigured: configured,
      deviceAvailable: available,
      tempCount: stats.count,
      tempBytes: stats.bytes,
    };
  }
}
