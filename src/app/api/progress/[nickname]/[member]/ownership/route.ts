import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import {
  CosmoUnavailableError,
  resolveNickname,
  validateNickname,
} from "@/lib/cosmo/resolve-nickname";
import {
  getProgressMemberCatalog,
  isProgressMember,
} from "@/lib/progress/member-catalog";
import { getCachedOwnedCollectionCounts } from "@/lib/progress/owned-collection-counts";
import type { ProgressMemberOwnershipResponse } from "@/lib/progress/types";
import { redis } from "@/lib/redis";
import { decodeRouteParam } from "@/lib/route-params";

export const dynamic = "force-dynamic";

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
  if (!member || !isProgressMember(member)) {
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
    // Redis unavailable — skip rate limiting.
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

  const [catalog, ownedRows] = await Promise.all([
    getProgressMemberCatalog(member),
    getCachedOwnedCollectionCounts(resolved.address),
  ]);
  const ownedByDbId = new Map(
    ownedRows
      .filter((row) => row.collectionDbId)
      .map((row) => [
        row.collectionDbId as string,
        {
          ownedCount: row.ownedCount,
          transferableCount: row.transferableCount,
        },
      ]),
  );

  // Summed over the A/Z group: holding only the offline twin still counts as
  // owning the card, and the representative alone would report zero.
  const counts: ProgressMemberOwnershipResponse["counts"] = {};
  for (const collection of catalog.collections) {
    let ownedCount = 0;
    let transferableCount = 0;
    for (const variantDbId of collection.variantCollectionDbIds) {
      const owned = ownedByDbId.get(variantDbId);
      if (!owned) continue;
      ownedCount += owned.ownedCount;
      transferableCount += owned.transferableCount;
    }
    counts[collection.collectionId] = { ownedCount, transferableCount };
  }

  return NextResponse.json({
    nickname: resolved.nickname,
    address: resolved.address,
    member,
    counts,
  } satisfies ProgressMemberOwnershipResponse);
}
