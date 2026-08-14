import { NextResponse } from "next/server";
import {
  getCollectionStats,
  getGroupCollectionTradability,
  hasTradableCopyInGroup,
} from "@/lib/progress/collection-stats";
import {
  getProgressMemberCatalog,
  isProgressMember,
} from "@/lib/progress/member-catalog";
import type { ProgressMemberTradabilityResponse } from "@/lib/progress/types";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ member: string }> },
) {
  const { member } = await params;
  if (!member || !isProgressMember(member)) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const catalog = await getProgressMemberCatalog(member);
  const snapshot = await getCollectionStats();

  const counts: ProgressMemberTradabilityResponse["counts"] = {};
  for (const collection of catalog.collections) {
    const tradability = getGroupCollectionTradability(
      snapshot,
      collection.variantCollectionDbIds,
    );
    counts[collection.collectionId] = {
      globalTotalCount: tradability?.totalCount ?? 0,
      globalTradableCount: tradability?.tradableCount ?? 0,
      progressCountable:
        collection.baseProgressCountable &&
        hasTradableCopyInGroup(snapshot, collection.variantCollectionDbIds),
    };
  }

  return NextResponse.json(
    { member, counts } satisfies ProgressMemberTradabilityResponse,
    {
      headers: {
        "Cache-Control":
          "public, max-age=60, s-maxage=600, stale-while-revalidate=3600",
      },
    },
  );
}
