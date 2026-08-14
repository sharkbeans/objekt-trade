import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  not,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { normalizeArtistId } from "@/lib/artist-utils";
import { indexer } from "@/lib/db/indexer";
import { mirror } from "@/lib/db/indexer-mirror";
import { collections, objekts } from "@/lib/db/indexer-schema";
import { decodeGroupedValue } from "@/lib/filter-utils";
import {
  parseObjektSearchGroups,
  resolveObjektMemberAlias,
} from "@/lib/objekt-search";

type CollectionMetadata = {
  id: string;
  collectionId: string;
  artist: string;
  member: string;
  collectionNo: string;
  season: string;
  class: string;
  thumbnailImage: string;
  frontImage: string;
  backImage: string;
  accentColor: string;
  onOffline: "online" | "offline";
  createdAt: Date;
};

export type InventoryRow = {
  collectionId: string;
  artist: string;
  member: string;
  collectionNo: string;
  season: string;
  class: string;
  thumbnailImage: string;
  serial: number;
  objektId: string;
  createdAt: Date;
};

export type OwnedObjektRow = {
  collectionDbId: string | null;
  collectionId: string;
  serial: number;
  transferable: boolean;
  objektId: string;
};

export type InventoryPageFilters = {
  query?: string;
  artist?: string[];
  member?: string[];
  season?: string[];
  class?: string[];
  onOffline?: string[];
};

export type InventoryOwnershipCandidate = {
  collectionId: string;
  serial?: number | null;
};

export async function loadCollectionMetadataByDbIds(
  collectionDbIds: string[],
): Promise<Map<string, CollectionMetadata>> {
  const uniqueIds = uniqueStrings(collectionDbIds);

  if (uniqueIds.length === 0) {
    return new Map();
  }

  const rows = await mirror
    .select({
      id: collections.id,
      collectionId: collections.collectionId,
      artist: collections.artist,
      member: collections.member,
      collectionNo: collections.collectionNo,
      season: collections.season,
      class: collections.class,
      thumbnailImage: collections.thumbnailImage,
      frontImage: collections.frontImage,
      backImage: collections.backImage,
      accentColor: collections.accentColor,
      onOffline: collections.onOffline,
      createdAt: collections.createdAt,
    })
    .from(collections)
    .where(inArray(collections.id, uniqueIds));

  const metadataById = new Map(rows.map((row) => [row.id, row]));
  const missingIds = uniqueIds.filter((id) => !metadataById.has(id));

  if (missingIds.length > 0) {
    const fallbackRows = await indexer
      .select({
        id: collections.id,
        collectionId: collections.collectionId,
        artist: collections.artist,
        member: collections.member,
        collectionNo: collections.collectionNo,
        season: collections.season,
        class: collections.class,
        thumbnailImage: collections.thumbnailImage,
        frontImage: collections.frontImage,
        backImage: collections.backImage,
        accentColor: collections.accentColor,
        onOffline: collections.onOffline,
        createdAt: collections.createdAt,
      })
      .from(collections)
      .where(inArray(collections.id, missingIds));

    for (const row of fallbackRows) {
      metadataById.set(row.id, row);
    }
  }

  return metadataById;
}

export async function resolveCollectionDbIdsByPublicIds(
  collectionIds: string[],
): Promise<Map<string, string>> {
  const uniqueIds = uniqueStrings(collectionIds);

  if (uniqueIds.length === 0) {
    return new Map();
  }

  const rows = await mirror
    .select({
      id: collections.id,
      collectionId: collections.collectionId,
    })
    .from(collections)
    .where(inArray(collections.collectionId, uniqueIds));

  const collectionDbIdByPublicId = new Map(
    rows.map((row) => [row.collectionId, row.id]),
  );
  const missingCollectionIds = uniqueIds.filter(
    (collectionId) => !collectionDbIdByPublicId.has(collectionId),
  );

  if (missingCollectionIds.length > 0) {
    const fallbackRows = await indexer
      .select({
        id: collections.id,
        collectionId: collections.collectionId,
      })
      .from(collections)
      .where(inArray(collections.collectionId, missingCollectionIds));

    for (const row of fallbackRows) {
      collectionDbIdByPublicId.set(row.collectionId, row.id);
    }
  }

  return collectionDbIdByPublicId;
}

export async function loadTransferableInventoryRows(
  address: string,
): Promise<InventoryRow[]> {
  const ownedRows = await indexer
    .select({
      collectionDbId: objekts.collectionId,
      serial: objekts.serial,
      objektId: objekts.id,
    })
    .from(objekts)
    .where(and(eq(objekts.owner, address), eq(objekts.transferable, true)));

  const collectionById = await loadCollectionMetadataByDbIds(
    uniqueCollectionDbIds(ownedRows.map((row) => row.collectionDbId)),
  );

  return ownedRows
    .flatMap((row) => {
      if (!row.collectionDbId) return [];
      const collection = collectionById.get(row.collectionDbId);
      if (!collection) return [];
      return [
        {
          collectionId: collection.collectionId,
          artist: collection.artist,
          member: collection.member,
          collectionNo: collection.collectionNo,
          season: collection.season,
          class: collection.class,
          thumbnailImage: collection.thumbnailImage,
          serial: row.serial,
          objektId: row.objektId,
          createdAt: collection.createdAt,
        },
      ];
    })
    .sort(compareInventoryRows);
}

export async function countTransferableInventoryRows(
  address: string,
  filters: InventoryPageFilters = {},
): Promise<number> {
  const [row] = await indexer
    .select({ value: count() })
    .from(objekts)
    .innerJoin(collections, eq(objekts.collectionId, collections.id))
    .where(and(...buildInventoryConditions(address, filters)));

  return Number(row?.value ?? 0);
}

export async function loadTransferableInventoryPage(
  address: string,
  filters: InventoryPageFilters,
  page: number,
  limit: number,
): Promise<InventoryRow[]> {
  const offset = (page - 1) * limit;

  return indexer
    .select({
      collectionId: collections.collectionId,
      artist: collections.artist,
      member: collections.member,
      collectionNo: collections.collectionNo,
      season: collections.season,
      class: collections.class,
      thumbnailImage: collections.thumbnailImage,
      serial: objekts.serial,
      objektId: objekts.id,
      createdAt: collections.createdAt,
    })
    .from(objekts)
    .innerJoin(collections, eq(objekts.collectionId, collections.id))
    .where(and(...buildInventoryConditions(address, filters)))
    .orderBy(
      desc(collections.createdAt),
      asc(collections.collectionNo),
      asc(objekts.serial),
    )
    .limit(limit)
    .offset(offset);
}

export function hasInventoryPageFilters(filters: InventoryPageFilters) {
  return Boolean(
    filters.query?.trim() ||
      filters.artist?.length ||
      filters.member?.length ||
      filters.season?.length ||
      filters.class?.length ||
      filters.onOffline?.length,
  );
}

export async function hasAnyTransferableInventoryCandidate(
  address: string,
  candidates: InventoryOwnershipCandidate[],
): Promise<boolean> {
  const uniqueCandidates = candidates.filter(
    (candidate, index, all) =>
      all.findIndex(
        (value) =>
          value.collectionId === candidate.collectionId &&
          value.serial === candidate.serial,
      ) === index,
  );
  const collectionDbIdByPublicId = await resolveCollectionDbIdsByPublicIds(
    uniqueCandidates.map((candidate) => candidate.collectionId),
  );
  const candidateConditions = uniqueCandidates.flatMap((candidate) => {
    const collectionDbId = collectionDbIdByPublicId.get(candidate.collectionId);
    if (!collectionDbId) return [];
    return [
      candidate.serial == null
        ? eq(objekts.collectionId, collectionDbId)
        : and(
            eq(objekts.collectionId, collectionDbId),
            eq(objekts.serial, candidate.serial),
          ),
    ];
  });

  if (candidateConditions.length === 0) return false;

  const [match] = await indexer
    .select({ id: objekts.id })
    .from(objekts)
    .where(
      and(
        eq(objekts.owner, address),
        eq(objekts.transferable, true),
        or(...candidateConditions),
      ),
    )
    .limit(1);

  return Boolean(match);
}

export async function loadOwnedCollectionCountsByDbId(address: string) {
  return indexer
    .select({
      collectionDbId: objekts.collectionId,
      ownedCount: count(),
      transferableCount:
        sql<number>`count(*) filter (where ${objekts.transferable})`.mapWith(
          Number,
        ),
    })
    .from(objekts)
    .where(eq(objekts.owner, address))
    .groupBy(objekts.collectionId);
}

export async function loadOwnedDistinctCollectionDbIds(address: string) {
  const rows = await indexer
    .selectDistinct({
      collectionDbId: objekts.collectionId,
    })
    .from(objekts)
    .where(eq(objekts.owner, address));

  return uniqueCollectionDbIds(rows.map((row) => row.collectionDbId));
}

/**
 * Expands a public collection id into every A/Z twin's public id. Progress
 * counts fold both forms into one card (see lib/progress/az-groups.ts), so a
 * drill-down must list serials from both or a card can read as owned with an
 * empty serial table. Returns just the input id when the card has no twin.
 */
export async function expandAzGroupPublicCollectionIds(
  collectionId: string,
): Promise<string[]> {
  const [row] = await mirror
    .select({
      member: collections.member,
      season: collections.season,
      collectionNo: collections.collectionNo,
    })
    .from(collections)
    .where(eq(collections.collectionId, collectionId))
    .limit(1);

  const collectionNo = row?.collectionNo.toUpperCase();
  if (!row || !collectionNo) return [collectionId];
  if (!collectionNo.endsWith("A") && !collectionNo.endsWith("Z")) {
    return [collectionId];
  }
  const base = collectionNo.slice(0, -1);

  const twins = await mirror
    .select({ collectionId: collections.collectionId })
    .from(collections)
    .where(
      and(
        eq(collections.member, row.member),
        eq(collections.season, row.season),
        inArray(sql`upper(${collections.collectionNo})`, [
          `${base}A`,
          `${base}Z`,
        ]),
      ),
    );

  return [
    ...new Set([collectionId, ...twins.map((twin) => twin.collectionId)]),
  ];
}

export async function loadOwnedObjektsForPublicCollectionIds(
  address: string,
  collectionIds: string[],
): Promise<OwnedObjektRow[]> {
  const collectionDbIdByPublicId =
    await resolveCollectionDbIdsByPublicIds(collectionIds);
  const publicIdByCollectionDbId = new Map(
    [...collectionDbIdByPublicId.entries()].map(([collectionId, id]) => [
      id,
      collectionId,
    ]),
  );
  const collectionDbIds = [...publicIdByCollectionDbId.keys()];

  if (collectionDbIds.length === 0) {
    return [];
  }

  const rows = await indexer
    .select({
      collectionDbId: objekts.collectionId,
      serial: objekts.serial,
      transferable: objekts.transferable,
      objektId: objekts.id,
    })
    .from(objekts)
    .where(
      and(
        eq(objekts.owner, address),
        inArray(objekts.collectionId, collectionDbIds),
      ),
    )
    .orderBy(asc(objekts.serial));

  return rows.flatMap((row) => {
    if (!row.collectionDbId) return [];
    const collectionId = publicIdByCollectionDbId.get(row.collectionDbId);
    if (!collectionId) return [];
    return [{ ...row, collectionId }];
  });
}

function compareInventoryRows(a: InventoryRow, b: InventoryRow) {
  const createdAtCompare = b.createdAt.getTime() - a.createdAt.getTime();
  if (createdAtCompare !== 0) return createdAtCompare;

  const collectionNoCompare = a.collectionNo.localeCompare(
    b.collectionNo,
    undefined,
    { numeric: true },
  );
  if (collectionNoCompare !== 0) return collectionNoCompare;

  return a.serial - b.serial;
}

function buildInventoryConditions(
  address: string,
  filters: InventoryPageFilters,
): SQL[] {
  const conditions: SQL[] = [
    eq(objekts.owner, address),
    eq(objekts.transferable, true),
  ];

  const queryCondition = buildInventorySearchCondition(filters.query ?? "");
  if (queryCondition) conditions.push(queryCondition);

  if (filters.artist?.length) {
    conditions.push(
      inArray(collections.artist, filters.artist.map(toIndexerArtist)),
    );
  }
  if (filters.member?.length) {
    conditions.push(inArray(collections.member, filters.member));
  }

  const seasonCondition = buildGroupedMetadataCondition(
    "season",
    filters.season ?? [],
  );
  if (seasonCondition) conditions.push(seasonCondition);

  const classCondition = buildGroupedMetadataCondition(
    "class",
    filters.class ?? [],
  );
  if (classCondition) conditions.push(classCondition);

  const onlineTypes = (filters.onOffline ?? []).filter(
    (value): value is "online" | "offline" =>
      value === "online" || value === "offline",
  );
  if (onlineTypes.length) {
    conditions.push(inArray(collections.onOffline, onlineTypes));
  }

  return conditions;
}

function buildGroupedMetadataCondition(
  field: "season" | "class",
  values: string[],
): SQL | undefined {
  if (values.length === 0) return undefined;
  const column = field === "season" ? collections.season : collections.class;
  const conditions = values.map((value) => {
    const grouped = decodeGroupedValue(value);
    return grouped
      ? and(
          eq(collections.artist, toIndexerArtist(grouped.artistId)),
          eq(column, grouped.item),
        )
      : eq(column, value);
  });
  return or(...conditions);
}

function buildInventorySearchCondition(query: string): SQL | undefined {
  const groups = parseObjektSearchGroups(query);
  if (groups.length === 0) return undefined;

  return or(
    ...groups.map((group) =>
      and(
        ...group.map((rawTerm) => {
          const excluded = rawTerm.startsWith("!");
          const term = excluded ? rawTerm.slice(1) : rawTerm;
          const condition = buildInventorySearchTerm(term);
          return excluded ? not(condition) : condition;
        }),
      ),
    ),
  );
}

function buildInventorySearchTerm(term: string): SQL {
  const serialMatch = term.match(/^#(\d+)(?:-(\d+))?$/);
  if (serialMatch) {
    const start = Number(serialMatch[1]);
    const end = Number(serialMatch[2] ?? serialMatch[1]);
    return and(
      gte(objekts.serial, Math.min(start, end)),
      lte(objekts.serial, Math.max(start, end)),
    ) as SQL;
  }

  const collectionRange = parseCollectionRange(term);
  if (collectionRange) {
    const conditions: SQL[] = [
      sql<boolean>`substring(lower(${collections.collectionNo}) from 1 for 3) between ${collectionRange.start.collectionNo} and ${collectionRange.end.collectionNo}`,
      sql<boolean>`coalesce(nullif(substring(lower(${collections.collectionNo}) from 4 for 1), ''), 'a') between ${collectionRange.start.type || "a"} and ${collectionRange.end.type || collectionRange.start.type || "z"}`,
    ];
    if (
      collectionRange.start.seasonNumber ||
      collectionRange.end.seasonNumber
    ) {
      const startSeason = toSeasonRangeKey(
        collectionRange.start.seasonCode ||
          collectionRange.end.seasonCode ||
          "a",
        collectionRange.start.seasonNumber || collectionRange.end.seasonNumber,
      );
      const endSeason = toSeasonRangeKey(
        collectionRange.end.seasonCode ||
          collectionRange.start.seasonCode ||
          "z",
        collectionRange.end.seasonNumber ||
          collectionRange.start.seasonNumber ||
          99,
      );
      conditions.push(
        sql<boolean>`(right(lower(${collections.season}), 2) || left(lower(${collections.season}), 1)) between ${startSeason} and ${endSeason}`,
      );
    }
    return and(...conditions) as SQL;
  }

  const classShortcut = term.match(/^([a-z])co$/i);
  if (classShortcut) {
    return sql<boolean>`left(lower(${collections.class}), 1) = ${classShortcut[1]?.toLowerCase()}`;
  }

  const pattern = `%${term}%`;
  const memberAlias = resolveObjektMemberAlias(term);
  return or(
    ...(memberAlias ? [eq(collections.member, memberAlias)] : []),
    ilike(collections.member, pattern),
    ilike(collections.collectionId, pattern),
    ilike(collections.collectionNo, pattern),
    ilike(collections.season, pattern),
    ilike(collections.class, pattern),
    ilike(collections.artist, pattern),
  ) as SQL;
}

function parseCollectionRange(term: string) {
  const match = term.match(/^([a-z]*)(\d{3})([az]?)-([a-z]*)(\d{3})([az]?)$/i);
  if (!match) return null;
  const [
    ,
    startPrefix = "",
    startNo = "",
    startType = "",
    endPrefix = "",
    endNo = "",
    endType = "",
  ] = match;
  return {
    start: {
      seasonCode: startPrefix.charAt(0).toLowerCase(),
      seasonNumber: startPrefix.length,
      collectionNo: startNo,
      type: startType.toLowerCase(),
    },
    end: {
      seasonCode: endPrefix.charAt(0).toLowerCase(),
      seasonNumber: endPrefix.length,
      collectionNo: endNo,
      type: endType.toLowerCase(),
    },
  };
}

function toSeasonRangeKey(code: string, number: number) {
  return `${String(number).padStart(2, "0")}${code.toLowerCase()}`;
}

function toIndexerArtist(artist: string) {
  const normalized = normalizeArtistId(artist);
  return normalized === "tripleS" ? "triples" : normalized;
}

function uniqueCollectionDbIds(
  collectionDbIds: Array<string | null>,
): string[] {
  return [...new Set(collectionDbIds.filter((id): id is string => !!id))];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
