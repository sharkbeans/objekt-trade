import { type Edition, getCollectionEdition } from "@/lib/edition";

// Copies consumed by past grids stay in the wallet (grid-locked, not
// burned), so usable copies of an FCO = ownedCount - gridded. The number of
// full sets currently griddable is the scarcest FCO's usable count.
export function computeGriddable(
  firsts: { ownedCount: number }[],
  gridded: number,
): number {
  if (firsts.length === 0) return 0;
  return Math.max(0, Math.min(...firsts.map((c) => c.ownedCount - gridded)));
}

// 3x3 grid slots (row/col, 1-indexed), skipping the center cell reserved for
// the reward SCO. Editions 1-2 use all 8 outer cells; edition 3 uses only
// the 4 orthogonal (diamond) cells and leaves the corners empty.
export const FULL_GRID_SLOTS = [
  [1, 1],
  [1, 2],
  [1, 3],
  [2, 1],
  [2, 3],
  [3, 1],
  [3, 2],
  [3, 3],
] as const;

export const DIAMOND_GRID_SLOTS = [
  [1, 2],
  [2, 1],
  [2, 3],
  [3, 2],
] as const;

export function getGridSlots(edition: number) {
  return edition === 3 ? DIAMOND_GRID_SLOTS : FULL_GRID_SLOTS;
}

// FCO collectionNo carries a trailing A/Z variant letter (e.g. "101Z") that's
// meaningless to a user picking a slot — strip it for display.
export function formatSlotSerial(collectionNo: string): string {
  return collectionNo.replace(/[A-Za-z]$/, "");
}

type OfferableInput = {
  collectionId: string;
  collectionNo: string;
  class: string;
  season: string;
  onOffline: string;
  artist?: string | null;
  ownedCount: number;
  transferableCount: number;
  gridMintCount: number;
};

export type OfferableDupe<T> = { collection: T; offerable: number };

// Map key for FCOs that belong to no grid at all (collectionNo outside the
// 101-120 range, or an artist with no edition concept).
const NO_EDITION = 0;

/**
 * How many copies of each FCO in a season are genuinely spare — i.e. safe to
 * offer as trade haves.
 *
 * The reserve is *not* a flat "keep one of each". It's the number of grids
 * you could still craft, held back from every slot card of that edition:
 * craft 0 grids (a slot is missing) and nothing is reserved; craft 2 and two
 * copies of each are. And because a spare 1st-edition FCO is only spare
 * relative to the *1st-edition* grid, each edition is bucketed and scored
 * against its own slots.
 *
 * `activeEdition` is the grid the caller is building a list *for*. Its slots
 * keep a floor of one copy each even when no grid is craftable yet — giving
 * away the pieces of the grid you're actively chasing is never what the user
 * meant. Every other edition is scored on the grid math alone, which is what
 * frees up e.g. spare 1st-edition FCOs to pay for a 2nd-edition grid.
 */
export function computeOfferableDupes<T extends OfferableInput>(
  seasonCollections: T[],
  activeEdition?: Edition,
): OfferableDupe<T>[] {
  const byEdition = new Map<number, T[]>();
  for (const c of seasonCollections) {
    const edition =
      getCollectionEdition({
        artist: c.artist,
        class: c.class,
        onOffline: c.onOffline,
        collectionNo: c.collectionNo,
        season: c.season,
      }) ?? NO_EDITION;
    const group = byEdition.get(edition);
    if (group) group.push(c);
    else byEdition.set(edition, [c]);
  }

  const offerable: OfferableDupe<T>[] = [];

  for (const [edition, group] of byEdition) {
    const firsts = group.filter((c) => c.class === "First");
    if (firsts.length === 0) continue;

    // No grid ever consumes these, so there's no grid-based reserve to
    // derive — fall back to the plain reading of "duplicate": keep one.
    if (edition === NO_EDITION) {
      for (const c of firsts) {
        offerable.push({
          collection: c,
          offerable: Math.max(
            0,
            Math.min(c.transferableCount, c.ownedCount - 1),
          ),
        });
      }
      continue;
    }

    // Same derivation as the grid board: the edition's reward SCOs carry the
    // mint count that stands in for "how many times this grid was redeemed".
    const gridded = group
      .filter((c) => c.class === "Special")
      .reduce((sum, c) => sum + c.gridMintCount, 0);
    const griddable = computeGriddable(firsts, gridded);
    const reserve =
      edition === activeEdition ? Math.max(1, griddable) : griddable;

    for (const c of firsts) {
      const usable = Math.max(0, c.ownedCount - gridded);
      // `min` against transferableCount holds back the *non*-transferable
      // copies first to satisfy the reserve — they can't be traded anyway,
      // so spending them on the reserve frees up more tradeable ones.
      offerable.push({
        collection: c,
        offerable: Math.max(0, Math.min(c.transferableCount, usable - reserve)),
      });
    }
  }

  return offerable.filter((row) => row.offerable > 0);
}
