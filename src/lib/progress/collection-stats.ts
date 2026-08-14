import { gunzipSync, gzipSync } from "node:zlib";
import { indexerPool } from "@/lib/db/indexer";
import { COSMO_SPIN_ADDRESS } from "@/lib/indexer-constants";
import {
  type CollectionTradability,
  hasGlobalTradableCopy,
} from "@/lib/progress/tradability";
import { redis } from "@/lib/redis";
import { getCached } from "@/lib/server-cache";

const REDIS_KEY = "collection-stats:v1";
const REDIS_UPDATED_AT_KEY = "collection-stats:updated-at";
const MEMORY_CACHE_KEY = "collection-stats:snapshot:v1";
const MEMORY_TTL_MS = 60_000;

// Reported for a collection when the sheet itself is missing (mode
// "unfiltered") — distinguishes "we don't know" from a real zero so the UI
// can render "—" instead of "0.00% (0)".
const UNKNOWN_TRADABILITY: CollectionTradability = {
  totalCount: -1,
  tradableCount: -1,
};

type StatsRow = {
  collection_id: string;
  total_count: string;
  tradable_count: string;
};

export type CollectionStatsSnapshot = {
  byId: Map<string, CollectionTradability>;
  // "exact": the sheet was read from Redis — apply its per-collection counts.
  // "unfiltered": the sheet is missing entirely (cold boot, wiped Redis) —
  // every collection is treated as tradable so the page never blocks on a
  // cold cache; see hasTradableCopy.
  mode: "exact" | "unfiltered";
};

// Runs the global aggregate against the remote indexer. Cron-only — the
// request path must never call this, since it's the ~10-30s query the sheet
// exists to avoid.
export async function buildCollectionStats(): Promise<
  Map<string, CollectionTradability>
> {
  const res = await indexerPool.query<StatsRow>(
    `
      select
        collection_id,
        count(*)::text as total_count,
        count(*) filter (
          where transferable = true
            and owner <> $1
        )::text as tradable_count
      from objekt
      group by collection_id
    `,
    [COSMO_SPIN_ADDRESS],
  );

  return new Map(
    res.rows.map((row) => [
      row.collection_id,
      {
        totalCount: Number(row.total_count),
        tradableCount: Number(row.tradable_count),
      },
    ]),
  );
}

// Persists the sheet with no expiry — cron overwrites it in place, so a
// refresh is never an eviction. Throws on failure so the cron route can
// report it rather than silently leaving a stale sheet in place.
export async function persistCollectionStats(
  stats: Map<string, CollectionTradability>,
): Promise<void> {
  const compressed = gzipSync(JSON.stringify([...stats.entries()])).toString(
    "base64",
  );
  await redis.set(REDIS_KEY, `gzip:${compressed}`);
  await redis.set(REDIS_UPDATED_AT_KEY, String(Date.now()));
}

export async function getCollectionStatsUpdatedAt(): Promise<number | null> {
  try {
    const raw = await redis.get(REDIS_UPDATED_AT_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseSheetPayload(
  raw: string | null,
): Map<string, CollectionTradability> | null {
  if (!raw) return null;
  try {
    const json = raw.startsWith("gzip:")
      ? gunzipSync(Buffer.from(raw.slice(5), "base64")).toString("utf8")
      : raw;
    const entries = JSON.parse(json) as Array<[string, CollectionTradability]>;
    if (!Array.isArray(entries)) return null;
    return new Map(entries);
  } catch {
    return null;
  }
}

async function loadSnapshot(): Promise<CollectionStatsSnapshot> {
  try {
    const byId = parseSheetPayload(await redis.get(REDIS_KEY));
    if (byId) return { byId, mode: "exact" };
  } catch {
    // Redis unreachable — degrade to unfiltered below rather than block.
  }
  return { byId: new Map(), mode: "unfiltered" };
}

// The only read call sites should use. Never computes the sheet itself —
// always either hits the in-process cache, the Redis copy, or degrades.
export function getCollectionStats(): Promise<CollectionStatsSnapshot> {
  return getCached(MEMORY_CACHE_KEY, MEMORY_TTL_MS, loadSnapshot);
}

// The single place the sheet's two unknown-policies live: sheet absent
// entirely -> tradable (generous, page stays fast); sheet present but this
// collection missing (newly minted since last refresh) -> not tradable
// (self-heals on the next cron tick). Callers must not reimplement this.
export function hasTradableCopy(
  snapshot: CollectionStatsSnapshot,
  collectionDbId: string,
): boolean {
  if (snapshot.mode === "unfiltered") return true;
  return hasGlobalTradableCopy(snapshot.byId.get(collectionDbId));
}

// Raw counts for display. Mirrors hasTradableCopy's policy: unfiltered mode
// reports the -1 "unknown" sentinel rather than a misleading 0.
export function getCollectionTradability(
  snapshot: CollectionStatsSnapshot,
  collectionDbId: string,
): CollectionTradability {
  if (snapshot.mode === "unfiltered") return UNKNOWN_TRADABILITY;
  return (
    snapshot.byId.get(collectionDbId) ?? { totalCount: 0, tradableCount: 0 }
  );
}

// An A/Z group is obtainable if either twin has a tradable copy — see
// az-groups.ts. Callers holding a group must use this, not hasTradableCopy on
// the representative, or a card tradable only in its other form is dropped
// from the catalog total while still counting as owned.
export function hasTradableCopyInGroup(
  snapshot: CollectionStatsSnapshot,
  collectionDbIds: readonly string[],
): boolean {
  return collectionDbIds.some((id) => hasTradableCopy(snapshot, id));
}

// Circulation counts for a whole A/Z group. Keeps hasTradableCopyInGroup's
// policy: unfiltered mode reports the "unknown" sentinel rather than a sum of
// zeroes that would render as a real 0.
export function getGroupCollectionTradability(
  snapshot: CollectionStatsSnapshot,
  collectionDbIds: readonly string[],
): CollectionTradability {
  if (snapshot.mode === "unfiltered") return UNKNOWN_TRADABILITY;

  let totalCount = 0;
  let tradableCount = 0;
  for (const id of collectionDbIds) {
    const entry = snapshot.byId.get(id);
    if (!entry) continue;
    totalCount += entry.totalCount;
    tradableCount += entry.tradableCount;
  }
  return { totalCount, tradableCount };
}
