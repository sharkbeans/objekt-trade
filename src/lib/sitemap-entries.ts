import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { cosmoAccount, poster, tradePost } from "@/lib/db/schema";
import { membersByArtist } from "@/lib/filters";
import {
  rootUrl,
  type SectionId,
  sectionOrigin,
  subdomainsEnabled,
} from "@/lib/sections";
import { getCached } from "@/lib/server-cache";

// Caps keep the generated XML inside the 50k-URL / 50MB sitemap limits and
// keep the DB work bounded — this route is hit by crawlers, not users.
const MAX_COLLECTORS = 1000;
const MAX_MEMBER_PAGES = 8000;
const MAX_LISTS = 2000;

export type SitemapEntry = {
  path: string;
  lastModified?: Date;
  changeFrequency?: "daily" | "weekly" | "monthly";
  priority?: number;
};

/**
 * Collectors listed in the sitemap.
 *
 * Deliberately limited to accounts that linked objekt.my. Any Cosmo nickname
 * resolves to a collection page, but publishing an index of people who never
 * signed up would be us distributing them — a linked account has a public
 * profile here by its own action, which is the consent this list relies on.
 */
export async function listedCollectors() {
  return getCached("sitemap:collectors:v1", 30 * 60_000, async () => {
    const rows = await db
      .select({
        nickname: cosmoAccount.nickname,
        linkedAt: cosmoAccount.linkedAt,
      })
      .from(cosmoAccount)
      .where(isNotNull(cosmoAccount.nickname))
      .orderBy(desc(cosmoAccount.linkedAt))
      .limit(MAX_COLLECTORS);
    return rows.flatMap((row) =>
      row.nickname ? [{ nickname: row.nickname, linkedAt: row.linkedAt }] : [],
    );
  });
}

async function publicLists() {
  return getCached("sitemap:lists:v1", 30 * 60_000, async () => {
    // Only lists still backing an open trade post — a closed or expired list
    // is a page with nothing actionable on it.
    const rows = await db
      .select({ id: poster.id, updatedAt: poster.updatedAt })
      .from(poster)
      .innerJoin(tradePost, eq(tradePost.linkedPosterId, poster.id))
      .where(and(eq(tradePost.status, "open"), isNotNull(poster.userId)))
      .orderBy(desc(poster.updatedAt))
      .limit(MAX_LISTS);
    return rows;
  });
}

const ALL_MEMBERS = Object.values(membersByArtist).flat();

/** Internal (unprefixed) paths this section should expose to crawlers. */
export async function sitemapEntriesForSection(
  section: SectionId | "root",
): Promise<SitemapEntry[]> {
  if (section === "root") {
    return [
      { path: "/", changeFrequency: "weekly", priority: 1 },
      { path: "/proofshot", changeFrequency: "monthly", priority: 0.6 },
      { path: "/spin", changeFrequency: "monthly", priority: 0.6 },
    ];
  }

  if (section === "trade") {
    return [{ path: "/trades", changeFrequency: "daily", priority: 0.9 }];
  }

  if (section === "create") {
    return [
      { path: "/objekt-maker", changeFrequency: "monthly", priority: 0.6 },
    ];
  }

  if (section === "list") {
    const lists = await publicLists();
    return [
      { path: "/list", changeFrequency: "weekly", priority: 0.7 },
      ...lists.map((row) => ({
        path: `/list/${row.id}`,
        lastModified: row.updatedAt,
        changeFrequency: "weekly" as const,
        priority: 0.5,
      })),
    ];
  }

  // collect — the long tail, and the reason this sitemap exists: nothing on
  // the site links collectors to one another, so without these entries every
  // collection page is orphaned from a crawler's point of view.
  const collectors = await listedCollectors();
  const entries: SitemapEntry[] = [
    { path: "/collection", changeFrequency: "weekly", priority: 0.7 },
  ];

  for (const collector of collectors) {
    entries.push({
      path: `/collection/${encodeURIComponent(collector.nickname)}`,
      changeFrequency: "daily",
      priority: 0.8,
    });
  }

  let memberPages = 0;
  for (const collector of collectors) {
    if (memberPages >= MAX_MEMBER_PAGES) break;
    for (const member of ALL_MEMBERS) {
      if (memberPages >= MAX_MEMBER_PAGES) break;
      entries.push({
        path: `/collection/${encodeURIComponent(collector.nickname)}/${encodeURIComponent(member)}`,
        changeFrequency: "weekly",
        priority: 0.4,
      });
      memberPages += 1;
    }
  }

  return entries;
}

/** Profiles live on the root host only (see ROOT_ONLY_PREFIXES). */
export async function profileSitemapEntries(): Promise<SitemapEntry[]> {
  const collectors = await listedCollectors();
  return collectors.map((collector) => ({
    path: `/@${encodeURIComponent(collector.nickname)}`,
    changeFrequency: "daily" as const,
    priority: 0.7,
  }));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderSitemap(origin: string, entries: SitemapEntry[]): string {
  const urls = entries
    .map((entry) => {
      const parts = [`    <loc>${escapeXml(`${origin}${entry.path}`)}</loc>`];
      if (entry.lastModified) {
        parts.push(
          `    <lastmod>${entry.lastModified.toISOString().slice(0, 10)}</lastmod>`,
        );
      }
      if (entry.changeFrequency) {
        parts.push(`    <changefreq>${entry.changeFrequency}</changefreq>`);
      }
      if (entry.priority !== undefined) {
        parts.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
      }
      return `  <url>\n${parts.join("\n")}\n  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** Absolute sitemap URL for the host currently being served. */
export function sitemapUrlForHost(section: SectionId | "root" | null): string {
  if (!subdomainsEnabled() || section === null || section === "root") {
    return `${rootUrl()}/sitemap.xml`;
  }
  return `${sectionOrigin(section)}/sitemap.xml`;
}
