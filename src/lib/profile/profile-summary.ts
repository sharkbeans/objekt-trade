import { and, count, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { fetchUserByNickname } from "@/lib/cosmo/client";
import { refreshCosmoAccountIfStale } from "@/lib/cosmo/refresh-account";
import { db } from "@/lib/db";
import {
  activeTrade,
  cosmoAccount,
  tradeBan,
  tradePost,
} from "@/lib/db/schema";
import { getCached } from "@/lib/server-cache";

// Shared by the public profile API route, the profile page's generateMetadata,
// and the profile OG image — all three need the same "who is this and how do
// they trade" answer, and previously only the API route knew how to compute it.

export const PROFILE_USER_COLUMNS = {
  id: true,
  name: true,
  image: true,
  email: true,
  discordId: true,
  discordUsername: true,
} as const;

export type ProfileCosmoRow = Awaited<
  ReturnType<
    typeof db.query.cosmoAccount.findFirst<{
      with: { user: { columns: typeof PROFILE_USER_COLUMNS } };
    }>
  >
>;

export type ProfileStats = {
  completed: number;
  cancelled: number;
  defaulted: number;
  openPosts: number;
};

export type ProfileBan = { reason: string; since: Date } | null;

export function isWalletAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * Resolve a wallet address or Cosmo nickname to a profile.
 *
 * `redirect` means the caller is at a non-canonical URL (an address for an
 * account that has a nickname, or a nickname the account has since renamed
 * away from) and should send the visitor to `/@{nickname}`.
 *
 * `refresh` revalidates the cached nickname against the live Cosmo API. The
 * API route wants that; generateMetadata and the OG route do not, since a
 * per-render external call would sit in the page's critical path.
 */
export async function resolveProfileIdentity(
  identifier: string,
  { refresh = true }: { refresh?: boolean } = {},
): Promise<
  | { kind: "linked"; cosmo: NonNullable<ProfileCosmoRow> }
  | { kind: "redirect"; nickname: string }
  | { kind: "unlinked"; address: string; nickname: string }
  | { kind: "not-found" }
  | { kind: "cosmo-unavailable" }
> {
  const withUser = { user: { columns: PROFILE_USER_COLUMNS } } as const;

  if (isWalletAddress(identifier)) {
    let cosmo = await db.query.cosmoAccount.findFirst({
      where: eq(cosmoAccount.address, identifier.toLowerCase()),
      with: withUser,
    });
    if (!cosmo) return { kind: "not-found" };
    if (refresh) cosmo = await refreshCosmoAccountIfStale(cosmo);
    // Prefer the prettier /@nickname URL when the account has one.
    if (cosmo.nickname) return { kind: "redirect", nickname: cosmo.nickname };
    return { kind: "linked", cosmo };
  }

  // Nickname. Compared with lower() rather than ilike: "_" and "%" are LIKE
  // wildcards and both are legal in a Cosmo nickname, so ilike would let
  // "/@some_user" match a different account that happens to fit the pattern.
  let cosmo = await db.query.cosmoAccount.findFirst({
    where: sql`lower(${cosmoAccount.nickname}) = lower(${identifier})`,
    with: withUser,
  });

  if (!cosmo) {
    if (!refresh) return { kind: "not-found" };
    // Fall back to Cosmo to resolve nickname → address for accounts that have
    // never linked objekt.my.
    let resolved: { nickname: string; address: string } | null;
    try {
      resolved = await fetchUserByNickname(identifier);
    } catch (error) {
      console.error("Failed to resolve Cosmo user profile:", error);
      return { kind: "cosmo-unavailable" };
    }
    if (!resolved) return { kind: "not-found" };
    return {
      kind: "unlinked",
      address: resolved.address.toLowerCase(),
      nickname: resolved.nickname,
    };
  }

  if (refresh) {
    // Revalidate: the lookup above matched on a possibly outdated nickname.
    cosmo = await refreshCosmoAccountIfStale(cosmo);
    if (
      cosmo.nickname &&
      cosmo.nickname.toLowerCase() !== identifier.toLowerCase()
    ) {
      return { kind: "redirect", nickname: cosmo.nickname };
    }
  }

  return { kind: "linked", cosmo };
}

/**
 * Trade reputation for a linked account. Cached for 60s under the same key
 * the profile API has always used, so the page, the OG image, and the API
 * share one computation.
 */
export async function loadProfileStats(
  userId: string,
): Promise<{ stats: ProfileStats; banned: ProfileBan }> {
  const userTradeFilter = or(
    eq(activeTrade.initiatorUserId, userId),
    eq(activeTrade.recipientUserId, userId),
  );

  const {
    completedCount,
    cancelledCount,
    openPostCount,
    activeBan,
    defaultedTrades,
  } = await getCached(`user-profile-stats:${userId}`, 60_000, async () => {
    const [
      [{ value: completedCount }],
      [{ value: cancelledCount }],
      [{ value: openPostCount }],
      activeBan,
      defaultedTrades,
    ] = await Promise.all([
      db
        .select({ value: count() })
        .from(activeTrade)
        .where(and(userTradeFilter, eq(activeTrade.status, "completed"))),
      db
        .select({ value: count() })
        .from(activeTrade)
        .where(and(userTradeFilter, eq(activeTrade.status, "cancelled"))),
      db
        .select({ value: count() })
        .from(tradePost)
        .where(and(eq(tradePost.userId, userId), eq(tradePost.status, "open"))),
      db.query.tradeBan.findFirst({
        where: and(eq(tradeBan.userId, userId), isNull(tradeBan.liftedAt)),
        columns: { id: true, reason: true, createdAt: true },
      }),
      // Defaulted: cancelled after acceptance, user had unsent sides
      db.query.activeTrade.findMany({
        where: and(
          userTradeFilter,
          eq(activeTrade.status, "cancelled"),
          isNotNull(activeTrade.acceptedAt),
        ),
        with: { sides: true },
        columns: { id: true },
        limit: 500,
      }),
    ]);
    return {
      completedCount,
      cancelledCount,
      openPostCount,
      activeBan,
      defaultedTrades,
    };
  });

  const defaultedCount = defaultedTrades.filter((t) =>
    t.sides.some((s) => s.userId === userId && s.status === "pending"),
  ).length;

  return {
    stats: {
      completed: completedCount,
      cancelled: cancelledCount,
      defaulted: defaultedCount,
      openPosts: openPostCount,
    },
    banned: activeBan
      ? { reason: activeBan.reason, since: activeBan.createdAt }
      : null,
  };
}

export type ProfileCard = {
  linked: boolean;
  nickname: string | null;
  address: string | null;
  linkedAt: Date | null;
  stats: ProfileStats | null;
  banned: ProfileBan;
};

/**
 * Display-ready profile summary for generateMetadata and the OG image.
 *
 * DB-only by design: an unlinked Cosmo user has no stats to show, so paying
 * for a Cosmo API round-trip on every page render (and every Discord embed
 * fetch) would buy nothing but latency. Callers fall back to a generic card
 * when this returns null.
 */
export async function loadProfileCard(
  identifier: string,
): Promise<ProfileCard | null> {
  const result = await resolveProfileIdentity(identifier, { refresh: false });
  if (result.kind !== "linked") return null;

  const { cosmo } = result;
  const { stats, banned } = await loadProfileStats(cosmo.userId);

  return {
    linked: true,
    nickname: cosmo.nickname ?? null,
    address: cosmo.address,
    linkedAt: cosmo.linkedAt,
    stats,
    banned,
  };
}
