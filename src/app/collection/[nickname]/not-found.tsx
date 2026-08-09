import Link from "next/link";
import { ProgressSearch } from "@/components/progress/progress-search";
import { StaleIdentityCleanup } from "@/components/progress/stale-identity-cleanup";
import { rootUrl } from "@/lib/sections";

// Not-found boundary for every collection URL. Unlike the global 404 this one
// has to assume the visitor was sent here by their own saved username, so it
// clears that save when it has gone stale (Cosmo rename) and offers the search
// box to find the new name. "Go home" points at the root host on purpose: on
// collect.<domain> a relative "/" is the collection home, which redirects
// straight back into the saved username — the loop this page exists to end.
export default function CollectionNotFound() {
  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-12">
      <StaleIdentityCleanup />
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Collection not found</h1>
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t find that collection. Cosmo usernames can change, and
          old links stop working when they do — search for the current username
          to pick it back up.
        </p>
      </div>
      <ProgressSearch />
      <div className="flex flex-wrap gap-3">
        <Link
          href={`${rootUrl()}/link`}
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Link Cosmo account
        </Link>
        <Link
          href={rootUrl()}
          className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-accent"
        >
          Go home
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        Linking your account keeps this working through future renames.
      </p>
    </div>
  );
}
