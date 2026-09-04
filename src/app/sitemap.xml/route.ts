import { headers } from "next/headers";
import {
  rootUrl,
  SECTION_IDS,
  sectionForHostname,
  sectionOrigin,
  subdomainsEnabled,
  toExternalPath,
} from "@/lib/sections";
import {
  profileSitemapEntries,
  renderSitemap,
  type SitemapEntry,
  sitemapEntriesForSection,
} from "@/lib/sitemap-entries";

// Like robots.txt, this can't be a MetadataRoute export: once sections live on
// their own subdomains each host needs its own sitemap, and MetadataRoute can't
// read the request host.
export const dynamic = "force-dynamic";

function xml(body: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export async function GET() {
  const hostname = (await headers()).get("host") ?? "";

  // Single-host mode: every path stays in its internal form on one origin.
  if (!subdomainsEnabled()) {
    const perSection = await Promise.all([
      sitemapEntriesForSection("root"),
      ...SECTION_IDS.map((section) => sitemapEntriesForSection(section)),
    ]);
    const entries: SitemapEntry[] = [
      ...perSection.flat(),
      ...(await profileSitemapEntries()),
    ];
    return xml(renderSitemap(rootUrl(), entries));
  }

  const who = sectionForHostname(hostname);

  // Unknown host — serve the root sitemap rather than nothing.
  if (who === null || who === "root") {
    const entries: SitemapEntry[] = [
      ...(await sitemapEntriesForSection("root")),
      ...(await profileSitemapEntries()),
    ];
    return xml(renderSitemap(rootUrl(), entries));
  }

  // Section host: strip the section's internal prefix so the sitemap lists the
  // clean URLs the middleware actually serves (/trades/x → trade.../x).
  const internal = await sitemapEntriesForSection(who);
  const entries = internal.flatMap((entry) => {
    const external = toExternalPath(entry.path);
    if (!external || external.section !== who) return [];
    return [{ ...entry, path: external.path }];
  });

  return xml(renderSitemap(sectionOrigin(who), entries));
}
