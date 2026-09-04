import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import {
  loadProfileStats,
  resolveProfileIdentity,
} from "@/lib/profile/profile-summary";
import { decodeRouteParam } from "@/lib/route-params";

// GET /api/users/[address] — public user profile stats
// Accepts: wallet address (0x...) or cosmo nickname (falls back to Cosmo API lookup).
// The lookup and stats live in @/lib/profile/profile-summary so the profile
// page's generateMetadata and OG image share one implementation with this route.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  // Can be a wallet address or a Cosmo nickname, and nicknames are frequently
  // non-ASCII — normalize before matching either shape.
  const identifier = decodeRouteParam((await params).address);
  const session = await getSession();

  const result = await resolveProfileIdentity(identifier);

  if (result.kind === "cosmo-unavailable") {
    return NextResponse.json(
      { error: "Cosmo is temporarily unavailable. Try again later." },
      { status: 503 },
    );
  }

  if (result.kind === "not-found") {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (result.kind === "redirect") {
    return NextResponse.json({ nickname: result.nickname }, { status: 301 });
  }

  if (result.kind === "unlinked") {
    return NextResponse.json({
      linked: false,
      address: result.address,
      nickname: result.nickname,
      image: null,
      linkedAt: null,
      email: null,
      discordId: null,
      discordUsername: null,
      viewer: {
        isOwner: false,
        userId: null,
      },
      stats: {
        completed: 0,
        cancelled: 0,
        defaulted: 0,
        openPosts: 0,
      },
      banned: null,
    });
  }

  const { cosmo } = result;
  const userId = cosmo.userId;
  const isOwner = session?.user.id === userId;
  const { stats, banned } = await loadProfileStats(userId);

  return NextResponse.json({
    linked: true,
    address: cosmo.address,
    nickname: cosmo.nickname ?? null,
    image: cosmo.user.image,
    linkedAt: cosmo.linkedAt,
    email: isOwner ? cosmo.user.email : null,
    // Discord username is shown publicly on profiles and to trade partners
    discordId: cosmo.user.discordId ?? null,
    discordUsername: cosmo.user.discordUsername ?? null,
    viewer: {
      isOwner,
      userId: isOwner ? userId : null,
    },
    stats,
    banned,
  });
}
