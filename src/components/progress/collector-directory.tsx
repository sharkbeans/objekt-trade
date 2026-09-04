import Link from "next/link";
import { sectionHref } from "@/lib/sections";
import { listedCollectors } from "@/lib/sitemap-entries";

const DIRECTORY_SIZE = 60;

/**
 * Public index of collectors who linked objekt.my.
 *
 * Two jobs: it gives visitors somewhere to go when they land on /collection
 * without a saved identity, and it gives crawlers the only internal path into
 * the collection pages — nothing else on the site links collectors to one
 * another, so without this every /collection/[nickname] is orphaned no matter
 * what the sitemap says.
 *
 * Only linked accounts appear here (see listedCollectors) — any Cosmo nickname
 * resolves to a page, but publishing a directory of people who never signed up
 * would be us distributing them.
 */
export async function CollectorDirectory() {
  const collectors = (await listedCollectors()).slice(0, DIRECTORY_SIZE);
  if (collectors.length === 0) return null;

  return (
    <section className="mx-auto w-full max-w-3xl px-4 pb-12">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">Browse collectors</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Collections and grid progress from people trading on objekt.my.
        </p>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {collectors.map((collector) => (
          <li key={collector.nickname}>
            <Link
              href={sectionHref(
                `/collection/${encodeURIComponent(collector.nickname)}`,
                { currentSection: "collect" },
              )}
              className="inline-flex rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              {collector.nickname}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
