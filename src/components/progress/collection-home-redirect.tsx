"use client";

import { Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  clearStoredCosmoIdentity,
  readStoredCosmoAddress,
  readStoredCosmoUsername,
} from "@/lib/cosmo-username-storage";
import { sectionHref } from "@/lib/sections";
import { ProgressSearch } from "./progress-search";

export function CollectionHomeRedirect({
  walletUnresolved = false,
}: {
  walletUnresolved?: boolean;
}) {
  const router = useRouter();
  const [checkedStorage, setCheckedStorage] = useState(false);

  useEffect(() => {
    // The by-wallet resolver bounced us back here because the stored address
    // no longer maps to a Cosmo nickname — the usual cause being a rename.
    // Drop the whole saved identity: keeping the username would just send us
    // to its 404 (it was renamed away too), and keeping the address would
    // ping-pong through the resolver forever.
    if (walletUnresolved) clearStoredCosmoIdentity();

    const savedAddress = readStoredCosmoAddress();
    if (savedAddress) {
      router.replace(
        sectionHref(`/collection/by-wallet/${savedAddress}`, {
          currentSection: "collect",
        }),
      );
      return;
    }

    const savedNickname = readStoredCosmoUsername();
    if (savedNickname) {
      router.replace(
        sectionHref(`/collection/${encodeURIComponent(savedNickname)}`, {
          currentSection: "collect",
        }),
      );
      return;
    }

    setCheckedStorage(true);
  }, [router, walletUnresolved]);

  if (!checkedStorage) {
    return (
      <div className="mx-auto flex max-w-xl items-center gap-2 px-4 py-12 text-sm text-muted-foreground">
        <Loader2Icon className="h-4 w-4 animate-spin" />
        <span>Opening your collection...</span>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-12">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Collection</h1>
        <p className="text-sm text-muted-foreground">
          Search any Cosmo username to view their collection, or link your own
          account.
        </p>
      </div>
      <ProgressSearch />
      <div className="flex flex-wrap gap-3">
        <Link
          href={sectionHref("/link", { currentSection: "collect" })}
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Link Cosmo account
        </Link>
        <Link
          href={sectionHref("/", { currentSection: "collect" })}
          className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-accent"
        >
          Back to home
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        Once you view a collection, we&apos;ll bring you back to it
        automatically from here.
      </p>
    </div>
  );
}
