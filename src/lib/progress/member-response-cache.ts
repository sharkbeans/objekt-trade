import { gunzipSync, gzipSync } from "node:zlib";
import type { ProgressMemberResponse } from "@/lib/progress/types";
import { redis } from "@/lib/redis";
import {
  getCachedStaleWhileRevalidate,
  setCachedValue,
} from "@/lib/server-cache";

const FRESH_TTL_MS = 90_000;
const PERSISTED_TTL_SECONDS = 30 * 60;
const REFRESH_LOCK_SECONDS = 60;

type PersistedMemberResponse = {
  cachedAt: number;
  value: ProgressMemberResponse;
};

function cacheKeys(address: string, member: string) {
  const suffix = `${address.toLowerCase()}:${member.toLowerCase()}`;
  return {
    memory: `progress:member-response:v2:${suffix}`,
    persisted: `progress:member-response:persisted:v2:${suffix}`,
    refreshLock: `progress:member-response:refresh-lock:v2:${suffix}`,
  };
}

function parsePersistedMemberResponse(
  raw: string | null,
): PersistedMemberResponse | null {
  if (!raw) return null;
  try {
    const json = raw.startsWith("gzip:")
      ? gunzipSync(Buffer.from(raw.slice(5), "base64")).toString("utf8")
      : raw;
    const parsed = JSON.parse(json) as Partial<PersistedMemberResponse>;
    if (
      typeof parsed.cachedAt !== "number" ||
      !parsed.value ||
      typeof parsed.value.address !== "string" ||
      typeof parsed.value.member !== "string" ||
      !Array.isArray(parsed.value.collections)
    ) {
      return null;
    }
    return parsed as PersistedMemberResponse;
  } catch {
    return null;
  }
}

async function persistMemberResponse(
  key: string,
  value: ProgressMemberResponse,
) {
  try {
    const compressed = gzipSync(
      JSON.stringify({ cachedAt: Date.now(), value }),
    ).toString("base64");
    await redis.set(key, `gzip:${compressed}`, "EX", PERSISTED_TTL_SECONDS);
  } catch {
    // Redis is an optimization; the in-process cache still works without it.
  }
}

export function getCachedProgressMemberResponse(
  address: string,
  member: string,
  load: () => Promise<ProgressMemberResponse>,
) {
  const keys = cacheKeys(address, member);

  const loadAndPersist = async () => {
    const value = await load();
    await persistMemberResponse(keys.persisted, value);
    setCachedValue(keys.memory, value, FRESH_TTL_MS);
    return value;
  };

  const refreshPersistedInBackground = async () => {
    let acquired = true;
    try {
      acquired =
        (await redis.set(
          keys.refreshLock,
          "1",
          "EX",
          REFRESH_LOCK_SECONDS,
          "NX",
        )) === "OK";
    } catch {
      // Fall back to the in-process request deduplication when Redis is down.
    }
    if (!acquired) return;
    try {
      await loadAndPersist();
    } catch {
      // Continue serving the persisted stale snapshot on refresh failures.
    }
  };

  return getCachedStaleWhileRevalidate(keys.memory, FRESH_TTL_MS, async () => {
    let persisted: PersistedMemberResponse | null = null;
    try {
      persisted = parsePersistedMemberResponse(await redis.get(keys.persisted));
    } catch {
      // Fall through to the upstream loader.
    }

    if (persisted) {
      if (Date.now() - persisted.cachedAt > FRESH_TTL_MS) {
        void refreshPersistedInBackground();
      }
      return persisted.value;
    }

    return loadAndPersist();
  });
}
