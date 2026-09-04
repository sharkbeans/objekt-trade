import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ClaimBanner } from "@/components/progress/claim-banner";
import { ProgressOverviewContent } from "@/components/progress/progress-overview-content";
import { getSession } from "@/lib/auth-server";
import { resolveNickname } from "@/lib/cosmo/resolve-nickname";
import { db } from "@/lib/db";
import { cosmoAccount } from "@/lib/db/schema";
import { decodeRouteParam } from "@/lib/route-params";
import { sectionAbsoluteUrl } from "@/lib/sections";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ nickname: string }>;
}): Promise<Metadata> {
  const nickname = decodeRouteParam((await params).nickname);
  const title = `${nickname}'s Collection Progress | objekt.my`;
  const description = `View ${nickname}'s Cosmo collection progress, grids, and trade list.`;
  const canonical = sectionAbsoluteUrl(
    `/collection/${encodeURIComponent(nickname)}`,
  );

  // URL only — no progress/DB/Cosmo work here. The OG route fetches and caches
  // its own data on the request Discord/etc. makes for the image, not on every
  // page navigation. Same split the [member] page uses.
  const ogImage = {
    url: sectionAbsoluteUrl(`/collection/${encodeURIComponent(nickname)}/og`),
    width: 1200,
    height: 630,
    type: "image/png",
  };

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      images: [ogImage],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function ProgressNicknamePage({
  params,
  searchParams,
}: {
  params: Promise<{ nickname: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const nickname = decodeRouteParam((await params).nickname);
  const resolved = await resolveNickname(nickname);
  if (!resolved) notFound();

  if (resolved.nickname !== nickname) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(await searchParams)) {
      if (Array.isArray(value)) {
        for (const item of value) query.append(key, item);
      } else if (value !== undefined) {
        query.append(key, value);
      }
    }
    const qs = query.toString();
    redirect(
      `/collection/${encodeURIComponent(resolved.nickname)}${qs ? `?${qs}` : ""}`,
    );
  }

  const session = await getSession();

  let isViewerLinked = false;
  if (session) {
    const linked = await db.query.cosmoAccount.findFirst({
      where: eq(cosmoAccount.userId, session.user.id),
      columns: { nickname: true },
    });
    isViewerLinked = !!linked?.nickname;
  }

  const showClaimBanner = !session || !isViewerLinked;

  return (
    <div className="mx-auto w-full max-w-[96rem] px-4 py-6 space-y-6">
      {showClaimBanner && <ClaimBanner isSignedIn={!!session} />}
      <ProgressOverviewContent
        key={resolved.address}
        nickname={resolved.nickname}
        address={resolved.address}
      />
    </div>
  );
}
