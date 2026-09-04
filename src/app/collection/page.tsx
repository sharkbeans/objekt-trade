import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CollectionHomeRedirect } from "@/components/progress/collection-home-redirect";
import { CollectorDirectory } from "@/components/progress/collector-directory";
import { getSession } from "@/lib/auth-server";
import { refreshCosmoAccountIfStale } from "@/lib/cosmo/refresh-account";
import { resolveNickname } from "@/lib/cosmo/resolve-nickname";
import {
  UNRESOLVED_WALLET_MARKER,
  UNRESOLVED_WALLET_PARAM,
} from "@/lib/cosmo-username-storage";
import { db } from "@/lib/db";
import { cosmoAccount } from "@/lib/db/schema";
import { sectionHref } from "@/lib/sections";

export const metadata: Metadata = {
  title: "Collection Progress | objekt.my",
  description: "Open your Cosmo collection progress.",
};

export default async function ProgressPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();

  let linkedNickname: string | null = null;
  if (session) {
    const linked = await db.query.cosmoAccount.findFirst({
      where: eq(cosmoAccount.userId, session.user.id),
      columns: {
        id: true,
        address: true,
        cosmoId: true,
        nickname: true,
        lastCosmoCheck: true,
      },
    });
    if (linked) {
      const refreshed = await refreshCosmoAccountIfStale(linked, 5 * 60_000);
      if (refreshed.nickname) {
        try {
          const resolved = await resolveNickname(refreshed.nickname);
          if (resolved?.address === linked.address.toLowerCase()) {
            linkedNickname = resolved.nickname;
          }
        } catch {
          // Fall through to the search/last-viewed screen during a Cosmo
          // outage instead of redirecting to a possibly stale nickname.
        }
      }
    }
  }

  if (linkedNickname) {
    redirect(
      sectionHref(`/collection/${encodeURIComponent(linkedNickname)}`, {
        currentSection: "collect",
      }),
    );
  }

  return (
    <>
      <CollectionHomeRedirect
        walletUnresolved={
          (await searchParams)[UNRESOLVED_WALLET_PARAM] ===
          UNRESOLVED_WALLET_MARKER
        }
      />
      <CollectorDirectory />
    </>
  );
}
