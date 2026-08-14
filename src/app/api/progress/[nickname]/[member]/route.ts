import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { normalizeArtistId } from "@/lib/artist-utils";
import { getSession } from "@/lib/auth-server";
import {
  CosmoUnavailableError,
  resolveNickname,
  validateNickname,
} from "@/lib/cosmo/resolve-nickname";
import { mirror } from "@/lib/db/indexer-mirror";
import { collections } from "@/lib/db/indexer-schema";
import { compareSeasons } from "@/lib/filter-options";
import { membersByArtist } from "@/lib/filters";
import { groupAzVariants } from "@/lib/progress/az-groups";
import {
  getCollectionStats,
  getGroupCollectionTradability,
  hasTradableCopyInGroup,
} from "@/lib/progress/collection-stats";
import { isCollectionProgressCountable } from "@/lib/progress/countable";
import { getCachedProgressMemberResponse } from "@/lib/progress/member-response-cache";
import { getFreshOwnedCollectionCounts } from "@/lib/progress/owned-collection-counts";
import type {
  ProgressCollection,
  ProgressMemberResponse,
} from "@/lib/progress/types";
import { redis } from "@/lib/redis";
import { decodeRouteParam } from "@/lib/route-params";
import { getCached } from "@/lib/server-cache";

export const dynamic = "force-dynamic";

const allMembers = new Set(Object.values(membersByArtist).flat());

function artistForMember(member: string): string {
  for (const [artist, members] of Object.entries(membersByArtist)) {
    if (members.includes(member)) return normalizeArtistId(artist);
  }
  return "";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ nickname: string; member: string }> },
) {
  const { nickname: rawNickname, member: rawMember } = await params;
  const nickname = decodeRouteParam(rawNickname);
  const member = decodeRouteParam(rawMember);

  if (!nickname || !validateNickname(nickname)) {
    return NextResponse.json({ error: "Invalid nickname" }, { status: 400 });
  }

  if (!member || !allMembers.has(member)) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
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

  const response = await getCachedProgressMemberResponse(
    resolved.address,
    member,
    async (): Promise<ProgressMemberResponse> => {
      const [allCollections, ownedCounts] = await Promise.all([
        getCached(
          `progress:collections:v3:${member.toLowerCase()}`,
          10 * 60_000,
          () =>
            mirror
              .select({
                id: collections.id,
                collectionId: collections.collectionId,
                collectionNo: collections.collectionNo,
                season: collections.season,
                class: collections.class,
                onOffline: collections.onOffline,
                thumbnailImage: collections.thumbnailImage,
                frontImage: collections.frontImage,
                backImage: collections.backImage,
                accentColor: collections.accentColor,
              })
              .from(collections)
              .where(eq(collections.member, member)),
        ),
        // A composed response refresh must wait for fresh ownership data so
        // it does not mark a nested stale snapshot as fresh for another TTL.
        getFreshOwnedCollectionCounts(resolved.address),
      ]);

      const ownedMap = new Map<string, number>();
      const transferableMap = new Map<string, number>();
      for (const row of ownedCounts) {
        if (row.collectionDbId) {
          ownedMap.set(row.collectionDbId, row.ownedCount);
          transferableMap.set(row.collectionDbId, row.transferableCount);
        }
      }

      const snapshot = await getCollectionStats();

      const artist = artistForMember(member);
      const result: ProgressCollection[] = groupAzVariants(allCollections)
        .map(({ representative: c, variants }) => {
          // Owning either twin is owning the card, so every count folds over
          // the whole group — the representative is identity only.
          const variantIds = variants.map((variant) => variant.id);
          const tradability = getGroupCollectionTradability(
            snapshot,
            variantIds,
          );
          return {
            collectionId: c.collectionId,
            collectionNo: c.collectionNo,
            season: c.season,
            class: c.class,
            onOffline: c.onOffline,
            thumbnailImage: c.thumbnailImage,
            frontImage: c.frontImage,
            backImage: c.backImage,
            accentColor: c.accentColor,
            member,
            artist,
            ownedCount: variantIds.reduce(
              (sum, id) => sum + (ownedMap.get(id) ?? 0),
              0,
            ),
            transferableCount: variantIds.reduce(
              (sum, id) => sum + (transferableMap.get(id) ?? 0),
              0,
            ),
            globalTotalCount: tradability.totalCount,
            globalTradableCount: tradability.tradableCount,
            gridMintCount: 0,
            progressCountable:
              isCollectionProgressCountable(c) &&
              hasTradableCopyInGroup(snapshot, variantIds),
          };
        })
        .sort((a, b) => {
          const sc = compareSeasons(a.season, b.season);
          if (sc !== 0) return sc;
          return a.collectionNo.localeCompare(b.collectionNo, undefined, {
            numeric: true,
          });
        });

      return {
        nickname: resolved.nickname,
        address: resolved.address,
        member,
        artist,
        collections: result,
      };
    },
  );

  // The composed payload is cached by stable wallet address, so it can
  // survive a Cosmo rename. Identity is deliberately overlaid from the
  // current nickname resolution to avoid serving the old display name from
  // an otherwise-valid inventory snapshot.
  return NextResponse.json({
    ...response,
    nickname: resolved.nickname,
    address: resolved.address,
  });
}
