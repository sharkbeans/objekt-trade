import { membersByArtist } from "@/lib/filters";
import {
  getCollectionStats,
  hasTradableCopyInGroup,
} from "@/lib/progress/collection-stats";
import { getProgressMemberCatalog } from "@/lib/progress/member-catalog";
import { mergeProgressRollups } from "@/lib/progress/merge";
import { getFreshOwnedCollectionCounts } from "@/lib/progress/owned-collection-counts";
import type { ProgressRollup } from "@/lib/progress/types";
import { getCachedStaleWhileRevalidate } from "@/lib/server-cache";

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

/**
 * Whole-collection owned/total rollups for one address.
 *
 * Extracted from the progress overview API route so the collection page's OG
 * image renders the same numbers the page itself shows, off the same caches —
 * totals are global (10 min), owned is per-address (90s).
 */
export async function loadOverviewRollups(
  address: string,
): Promise<ProgressRollup[]> {
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
      `progress:owned-rollups:v8:${address}`,
      90_000,
      async () => {
        const ownedCounts = await getFreshOwnedCollectionCounts(address);
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

  return mergeProgressRollups(totals, owned);
}

export type OverviewSummary = {
  owned: number;
  total: number;
  percent: number;
  byArtist: { artist: string; owned: number; total: number }[];
};

/** Flattens rollups into the headline figures an OG card can render. */
export function summarizeOverview(rollups: ProgressRollup[]): OverviewSummary {
  let owned = 0;
  let total = 0;
  const byArtist = new Map<string, { owned: number; total: number }>();

  for (const row of rollups) {
    owned += row.owned;
    total += row.total;
    const existing = byArtist.get(row.artist);
    if (existing) {
      existing.owned += row.owned;
      existing.total += row.total;
    } else {
      byArtist.set(row.artist, { owned: row.owned, total: row.total });
    }
  }

  return {
    owned,
    total,
    percent: total > 0 ? Math.round((owned / total) * 1000) / 10 : 0,
    byArtist: [...byArtist.entries()]
      .map(([artist, counts]) => ({ artist, ...counts }))
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total),
  };
}
