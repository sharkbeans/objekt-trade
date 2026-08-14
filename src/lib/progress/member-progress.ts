import { eq } from "drizzle-orm";
import {
  CosmoUnavailableError,
  resolveNickname,
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
import { getFreshOwnedCollectionCounts } from "@/lib/progress/owned-collection-counts";
import { getCached } from "@/lib/server-cache";

export { CosmoUnavailableError };

function artistForMember(member: string): string {
  for (const [artist, members] of Object.entries(membersByArtist)) {
    if (members.includes(member)) return artist;
  }
  return "";
}

export type GridMemberProgressCollection = {
  collectionNo: string;
  season: string;
  class: string;
  onOffline: string;
  thumbnailImage: string;
  ownedCount: number;
};

export type MemberProgressCollection = GridMemberProgressCollection & {
  globalTotalCount: number;
  globalTradableCount: number;
  progressCountable: boolean;
};

export type MemberProgress = {
  nickname: string;
  address: string;
  artist: string;
  collections: MemberProgressCollection[];
};

export type GridMemberProgress = {
  nickname: string;
  address: string;
  artist: string;
  collections: GridMemberProgressCollection[];
};

type BaseMemberProgressCollection = GridMemberProgressCollection & {
  id: string;
  /** Every A/Z twin folded into this entry — see az-groups.ts. */
  variantIds: string[];
};

/**
 * Data loader for the collection member OG image ONLY — deliberately kept
 * out of both generateMetadata() on the collection page and
 * /api/progress/[nickname]/[member]/route.ts. An earlier version wired this
 * same kind of loading into generateMetadata() directly, which made local
 * Next dev repeatedly re-request the page during navigation/RSC/metadata
 * handling. Calling this only from the OG route's own request (which the
 * browser/Discord fetches once, out-of-band from page navigation) is what
 * avoids that. Catalog cache keys remain namespaced with "og:"; the
 * wallet-wide ownership snapshot is intentionally shared with the API.
 */
async function loadBaseMemberProgress(
  nickname: string,
  member: string,
): Promise<{
  nickname: string;
  address: string;
  artist: string;
  collections: BaseMemberProgressCollection[];
} | null> {
  const resolved = await resolveNickname(nickname);
  if (!resolved) return null;

  const artist = artistForMember(member);

  const [allCollections, ownedCounts] = await Promise.all([
    getCached(
      `og:progress:collections:v1:${member.toLowerCase()}`,
      10 * 60_000,
      () =>
        mirror
          .select({
            id: collections.id,
            collectionNo: collections.collectionNo,
            season: collections.season,
            class: collections.class,
            onOffline: collections.onOffline,
            thumbnailImage: collections.thumbnailImage,
          })
          .from(collections)
          .where(eq(collections.member, member)),
    ),
    // Reuse the same ownership snapshot as the collection APIs. A visitor
    // normally opens the collection page immediately before sharing it, so
    // this avoids repeating the wallet-wide ownership query in the OG route.
    getFreshOwnedCollectionCounts(resolved.address),
  ]);

  const ownedMap = new Map<string, number>();
  for (const row of ownedCounts) {
    if (row.collectionDbId) ownedMap.set(row.collectionDbId, row.ownedCount);
  }

  // A/Z folding mirrors /api/progress/[nickname]/[member]/route.ts so the OG
  // image's totals match what the page shows.
  const result: BaseMemberProgressCollection[] = groupAzVariants(allCollections)
    .map(({ representative: c, variants }) => {
      const variantIds = variants.map((variant) => variant.id);
      return {
        id: c.id,
        variantIds,
        collectionNo: c.collectionNo,
        season: c.season,
        class: c.class,
        onOffline: c.onOffline,
        thumbnailImage: c.thumbnailImage,
        ownedCount: variantIds.reduce(
          (sum, id) => sum + (ownedMap.get(id) ?? 0),
          0,
        ),
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
    artist,
    collections: result,
  };
}

/**
 * Grid share cards only need catalog placement, thumbnails, and ownership.
 * Keeping this path lean avoids the expensive global tradability aggregation
 * used to calculate completion totals for the regular member share card.
 */
export async function loadGridMemberProgress(
  nickname: string,
  member: string,
): Promise<GridMemberProgress | null> {
  const progress = await loadBaseMemberProgress(nickname, member);
  if (!progress) return null;

  return {
    ...progress,
    collections: progress.collections.map(
      ({ id: _id, variantIds: _variantIds, ...collection }) => collection,
    ),
  };
}

export async function loadMemberProgress(
  nickname: string,
  member: string,
): Promise<MemberProgress | null> {
  const progress = await loadBaseMemberProgress(nickname, member);
  if (!progress) return null;

  const snapshot = await getCollectionStats();

  return {
    ...progress,
    collections: progress.collections.map(
      ({ id: _id, variantIds, ...collection }) => {
        const tradability = getGroupCollectionTradability(snapshot, variantIds);
        return {
          ...collection,
          globalTotalCount: tradability.totalCount,
          globalTradableCount: tradability.tradableCount,
          progressCountable:
            isCollectionProgressCountable(collection) &&
            hasTradableCopyInGroup(snapshot, variantIds),
        };
      },
    ),
  };
}
