import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import {
  CosmoUnavailableError,
  resolveNickname,
  validateNickname,
} from "@/lib/cosmo/resolve-nickname";
import { membersByArtist } from "@/lib/filters";
import {
  getCollectionStats,
  hasTradableCopyInGroup,
} from "@/lib/progress/collection-stats";
import { getProgressMemberCatalog } from "@/lib/progress/member-catalog";
import { mergeProgressRollups } from "@/lib/progress/merge";
import { getFreshOwnedCollectionCounts } from "@/lib/progress/owned-collection-counts";
import { redis } from "@/lib/redis";
import { decodeRouteParam } from "@/lib/route-params";
import { getCachedStaleWhileRevalidate } from "@/lib/server-cache";

export const dynamic = "force-dynamic";

type TotalsRow = {
  artist: string;
  member: string;
  class: string;
  season: string;
  onOffline: string;
  total: number;
};

type OwnedRow = Omit<TotalsRow, "total"> & { owned: number };

// Both rollup sides must iterate the identical catalog groups, or owned and
// total end up bucketed differently. Per-member catalogs are cached, so the
// second caller in a request reuses the first one's load.
function loadProgressCatalogs() {
  const members = Object.values(membersByArtist).flat();
  return Promise.all(members.map((member) => getProgressMemberCatalog(member)));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ nickname: string }> },
) {
  const nickname = decodeRouteParam((await params).nickname);

  if (!nickname || !validateNickname(nickname)) {
    return NextResponse.json({ error: "Invalid nickname" }, { status: 400 });
  }

  const session = await getSession();
  const rateLimitId = session?.user.id
    ? `user:${session.user.id}`
    : `ip:${request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown"}`;
  const rateLimitKey = `rate-limit:progress:${rateLimitId}`;
  const limit = session ? 60 : 10;
  try {
    const attempts = await redis.incr(rateLimitKey);
    if (attempts === 1) await redis.expire(rateLimitKey, 60);
    if (attempts > limit) {
      return NextResponse.json(
        { error: "Too many requests. Try again later." },
        { status: 429 },
      );
    }
  } catch {
    // Redis unavailable — skip rate limiting
  }

  let resolved: Awaited<ReturnType<typeof resolveNickname>>;
  try {
    resolved = await resolveNickname(nickname);
  } catch (error) {
    if (error instanceof CosmoUnavailableError) {
      return NextResponse.json(
        { error: "Cosmo is temporarily unavailable. Try again later." },
        { status: 503 },
      );
    }
    throw error;
  }
  if (!resolved) {
    return NextResponse.json(
      { error: "Cosmo user not found" },
      { status: 404 },
    );
  }

  const [totals, owned] = await Promise.all([
    getCachedStaleWhileRevalidate(
      "progress:totals:v6",
      10 * 60_000,
      async () => {
        const snapshot = await getCollectionStats();
        const catalogs = await loadProgressCatalogs();

        const totalsByKey = new Map<string, TotalsRow>();
        for (const catalog of catalogs) {
          for (const collection of catalog.collections) {
            if (!collection.baseProgressCountable) continue;
            if (
              !hasTradableCopyInGroup(
                snapshot,
                collection.variantCollectionDbIds,
              )
            ) {
              continue;
            }

            const key = [
              catalog.artist,
              catalog.member,
              collection.class,
              collection.season,
              collection.onOffline,
            ].join("|");
            const existing = totalsByKey.get(key);
            if (existing) {
              existing.total += 1;
              continue;
            }
            totalsByKey.set(key, {
              artist: catalog.artist,
              member: catalog.member,
              class: collection.class,
              season: collection.season,
              onOffline: collection.onOffline,
              total: 1,
            });
          }
        }

        return [...totalsByKey.values()];
      },
    ),
    // Owned is walked over the same catalog groups as totals rather than over
    // raw owned collection rows. Counting rows double-counted anyone holding
    // both A/Z twins and filed the A under an `offline` bucket the deduped
    // totals never create, so a whale could reach 535/500.
    getCachedStaleWhileRevalidate(
      `progress:owned-rollups:v8:${resolved.address}`,
      90_000,
      async () => {
        const ownedCounts = await getFreshOwnedCollectionCounts(
          resolved.address,
        );
        const ownedCollectionDbIds = new Set(
          ownedCounts.flatMap((row) =>
            row.collectionDbId ? [row.collectionDbId] : [],
          ),
        );
        const [catalogs, snapshot] = await Promise.all([
          loadProgressCatalogs(),
          getCollectionStats(),
        ]);
        const rollups = new Map<string, OwnedRow>();

        for (const catalog of catalogs) {
          for (const collection of catalog.collections) {
            if (!collection.baseProgressCountable) continue;
            if (
              !hasTradableCopyInGroup(
                snapshot,
                collection.variantCollectionDbIds,
              )
            ) {
              continue;
            }
            const ownsGroup = collection.variantCollectionDbIds.some((id) =>
              ownedCollectionDbIds.has(id),
            );
            if (!ownsGroup) continue;

            const key = [
              catalog.artist,
              catalog.member,
              collection.class,
              collection.season,
              collection.onOffline,
            ].join("|");
            const existing = rollups.get(key);
            if (existing) {
              existing.owned += 1;
              continue;
            }
            rollups.set(key, {
              artist: catalog.artist,
              member: catalog.member,
              class: collection.class,
              season: collection.season,
              onOffline: collection.onOffline,
              owned: 1,
            });
          }
        }

        return [...rollups.values()];
      },
    ),
  ]);

  const rollups = mergeProgressRollups(totals, owned);

  return NextResponse.json({
    nickname: resolved.nickname,
    address: resolved.address,
    rollups,
  });
}
