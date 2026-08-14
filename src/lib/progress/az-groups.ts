/**
 * A/Z dedup: collectionNo like "101A" and "101Z" are the same physical card
 * issued in two forms (A is the offline/physical twin, Z the online one).
 * Progress counts them once.
 *
 * Every count derived from a group must be an OR/sum across all its variants,
 * never a value read off the representative alone. Owning either twin means
 * owning the card, so ownership, tradability, and serials all fold together;
 * the representative only supplies catalog identity (images, collectionNo,
 * and the season/class/onOffline a rollup buckets by). Reading ownership off
 * the representative while counting the whole catalog as deduped totals is
 * what once let a wallet report 535/500.
 */

type AzVariant = {
  collectionNo: string;
  season: string;
};

export type AzGroup<T> = {
  /** Supplies catalog identity only — never counts. */
  representative: T;
  /** Every row in the group, representative included. */
  variants: T[];
};

function azGroupKey(collection: AzVariant): string {
  const noUpper = collection.collectionNo.toUpperCase();
  const base =
    noUpper.endsWith("A") || noUpper.endsWith("Z")
      ? noUpper.slice(0, -1)
      : noUpper;
  return `${collection.season}::${base}`;
}

export function groupAzVariants<T extends AzVariant>(
  rows: readonly T[],
): AzGroup<T>[] {
  const groups = new Map<string, { a?: T; z?: T; other?: T }>();

  for (const row of rows) {
    const key = azGroupKey(row);
    const noUpper = row.collectionNo.toUpperCase();
    const entry = groups.get(key) ?? {};
    if (noUpper.endsWith("Z")) entry.z = row;
    else if (noUpper.endsWith("A")) entry.a = row;
    else entry.other = row;
    groups.set(key, entry);
  }

  const result: AzGroup<T>[] = [];
  for (const entry of groups.values()) {
    const representative = entry.other ?? entry.z ?? entry.a;
    if (!representative) continue;
    result.push({
      representative,
      variants: [entry.other, entry.z, entry.a].filter(
        (variant): variant is T => variant !== undefined,
      ),
    });
  }
  return result;
}
