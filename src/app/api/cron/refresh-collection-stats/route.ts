import crypto from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import {
  buildCollectionStats,
  getCollectionStatsUpdatedAt,
  persistCollectionStats,
} from "@/lib/progress/collection-stats";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

const THROTTLE_MS = 30 * 60_000;
const LOCK_KEY = "collection-stats:refresh-lock:v1";
const LOCK_SECONDS = 120;

// GET /api/cron/refresh-collection-stats
// Called by the cron container every 5 minutes. Rebuilds the global
// collection-tradability sheet that /api/progress/* reads instead of
// running the ~10-30s remote aggregate on the request path. Self-throttled
// to once per THROTTLE_MS regardless of call frequency, and lock-guarded so
// overlapping ticks (e.g. a slow build still running past its own interval)
// don't double-run the aggregate.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  let authorized = false;
  try {
    authorized =
      authHeader.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
  } catch {
    authorized = false;
  }
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const updatedAt = await getCollectionStatsUpdatedAt();
  const stale = updatedAt === null || Date.now() - updatedAt > THROTTLE_MS;
  if (!stale) {
    return NextResponse.json({ refreshed: false, collections: 0, ms: 0 });
  }

  let acquired = false;
  try {
    acquired =
      (await redis.set(LOCK_KEY, "1", "EX", LOCK_SECONDS, "NX")) === "OK";
  } catch {
    return NextResponse.json({ error: "Redis unavailable" }, { status: 502 });
  }
  if (!acquired) {
    return NextResponse.json({ refreshed: false, collections: 0, ms: 0 });
  }

  const start = Date.now();
  try {
    const stats = await buildCollectionStats();
    await persistCollectionStats(stats);
    return NextResponse.json({
      refreshed: true,
      collections: stats.size,
      ms: Date.now() - start,
    });
  } catch (error) {
    console.error("Collection stats refresh failed:", error);
    return NextResponse.json(
      { error: "Failed to refresh collection stats" },
      { status: 502 },
    );
  } finally {
    try {
      await redis.del(LOCK_KEY);
    } catch {
      // Lock expires on its own via EX if this fails.
    }
  }
}
