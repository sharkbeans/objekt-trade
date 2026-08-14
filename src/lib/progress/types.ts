export type ProgressRollup = {
  artist: string;
  member: string;
  class: string;
  season: string;
  onOffline: string;
  owned: number;
  total: number;
};

export type ProgressOverviewResponse = {
  nickname: string;
  address: string;
  rollups: ProgressRollup[];
};

export type ProgressIdentityResponse = Pick<
  ProgressOverviewResponse,
  "nickname" | "address"
>;

export type ProgressCollection = {
  collectionId: string;
  collectionNo: string;
  season: string;
  class: string;
  onOffline: string;
  thumbnailImage: string;
  frontImage: string;
  backImage: string;
  accentColor: string;
  ownedCount: number;
  transferableCount: number;
  globalTotalCount: number;
  globalTradableCount: number;
  gridMintCount: number;
  progressCountable: boolean;
  member?: string;
  artist?: string;
};

export type ProgressSerial = {
  serial: number;
  objektId: string;
  transferable: boolean;
};

export type ProgressSerialsResponse = {
  serials: ProgressSerial[];
};

export type ProgressMemberResponse = {
  nickname: string;
  address: string;
  member: string;
  artist: string;
  collections: ProgressCollection[];
};

export type ProgressCatalogCollection = Omit<
  ProgressCollection,
  | "ownedCount"
  | "transferableCount"
  | "globalTotalCount"
  | "globalTradableCount"
  | "gridMintCount"
  | "progressCountable"
> & {
  baseProgressCountable: boolean;
};

export type ProgressMemberCatalogResponse = {
  member: string;
  artist: string;
  collections: ProgressCatalogCollection[];
};

export type ProgressCatalogCollectionWithDbId = ProgressCatalogCollection & {
  collectionDbId: string;
  /**
   * Every A/Z twin folded into this entry, representative included. Ownership
   * and tradability must be summed across these — see az-groups.ts.
   */
  variantCollectionDbIds: string[];
};

export type ProgressMemberCatalogInternalResponse = Omit<
  ProgressMemberCatalogResponse,
  "collections"
> & {
  collections: ProgressCatalogCollectionWithDbId[];
};

export type ProgressOwnershipCounts = {
  ownedCount: number;
  transferableCount: number;
};

export type ProgressMemberOwnershipResponse = {
  nickname: string;
  address: string;
  member: string;
  counts: Record<string, ProgressOwnershipCounts>;
};

export type ProgressTradabilityCounts = {
  globalTotalCount: number;
  globalTradableCount: number;
  progressCountable: boolean;
};

export type ProgressMemberTradabilityResponse = {
  member: string;
  counts: Record<string, ProgressTradabilityCounts>;
};
