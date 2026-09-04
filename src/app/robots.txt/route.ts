import { headers } from "next/headers";
import {
  rootUrl,
  type SectionId,
  sectionForHostname,
  sectionOrigin,
  subdomainsEnabled,
} from "@/lib/sections";
import { sitemapUrlForHost } from "@/lib/sitemap-entries";

// robots.txt must differ per host once sections live on subdomains, and
// MetadataRoute.Robots can't read the request host — so this is a plain
// route handler.
export const dynamic = "force-dynamic";

const TRADE_QUERY_PARAMS = [
  "page",
  "search",
  "artist",
  "member",
  "season",
  "class",
  "on_offline",
  "filter_mode",
  "sort",
];

function robotsBody(
  rules: { allow: string[]; disallow: string[] },
  host: string,
  sitemap: string,
) {
  const lines = [
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠟⠋⠙⠻⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠟⠉⣀⣤⣶⣷⣦⣠⠈⠛⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠟⠋⢡⣠⣶⣾⣿⡿⠛⠛⠿⣿⣿⣦⣄⡀⠙⠻⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠟⠉⣀⣶⣄⡀⠈⠙⠻⣿⣿⣶⣤⡀⠈⠙⠻⢿⣿⣷⣤⣀⠉⠛⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠀⡨⠙⠻⢿⣿⣷⣤⣀⠀⠉⠻⢿⣿⣷⣦⣄⠀⠉⠛⠟⠋⢁⡄⠁⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⠀⣿⣷⣤⣀⠉⠛⠿⣿⣿⣦⣄⣠⣼⣿⣿⡿⠟⠀⣀⣤⣾⣿⡗⠀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣯⠀⣿⣿⠿⣿⣿⣦⣄⡈⠙⠻⣿⣿⠿⠋⠁⣠⣴⣿⣿⡿⠟⠉⠀⠂⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⠀⣿⣿⡀⠈⠙⠻⢿⣿⣶⣴⡀⠀⣤⣾⣿⣿⠿⠋⠁⢀⣢⣴⡧⠀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠀⠻⢿⣿⣷⣧⣠⠀⠉⠛⢿⡟⠀⣿⣿⠉⠀⣀⣤⣾⣿⣿⣿⣯⠀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⠀⣄⡀⠈⠙⠿⣿⣿⣶⣄⡀⠀⠀⣿⣿⣴⣿⣿⠿⠛⠉⣿⣿⣗⠀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠀⣿⣿⣶⣤⣀⠀⠙⠻⣿⣿⣷⠀⣿⣿⠟⠋⠁⣀⣤⣶⣿⣿⠏⠀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣤⣀⠉⠛⢿⣿⣷⣦⣄⣿⣿⣿⠒⠉⠀⣀⣴⣾⣿⡿⠟⠉⣀⣤⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣦⣆⠈⠙⠻⣿⣿⣿⣿⠀⣶⣿⣿⠿⠛⠁⣀⣴⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⣤⡀⠉⠛⠯⠀⡟⠋⢀⣤⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣦⣄⣀⣴⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "# ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
    "",
    "User-agent: *",
  ];
  for (const path of rules.allow) lines.push(`Allow: ${path}`);
  for (const path of rules.disallow) lines.push(`Disallow: ${path}`);
  lines.push("", `Host: ${host}`, `Sitemap: ${sitemap}`, "");
  return lines.join("\n");
}

function rulesForSection(section: SectionId) {
  switch (section) {
    case "trade":
      return {
        allow: ["/"],
        disallow: [
          "/api/",
          "/mine",
          "/history",
          "/active",
          ...TRADE_QUERY_PARAMS.map((param) => `/?*${param}=*`),
        ],
      };
    case "list":
      return { allow: ["/"], disallow: ["/api/", "/mine"] };
    default:
      return { allow: ["/"], disallow: ["/api/"] };
  }
}

// Pre-subdomain rules, kept verbatim for the disabled/single-host mode.
const LEGACY_RULES = {
  allow: ["/", "/trades", "/trades/*"],
  disallow: [
    "/api/",
    "/notifications",
    "/active-trades",
    "/trades/history",
    ...TRADE_QUERY_PARAMS.map((param) => `/trades?*${param}=*`),
  ],
};

export async function GET() {
  const requestHeaders = await headers();
  const hostname = requestHeaders.get("host") ?? "";

  let body: string;
  if (!subdomainsEnabled()) {
    body = robotsBody(LEGACY_RULES, rootUrl(), sitemapUrlForHost(null));
  } else {
    const who = sectionForHostname(hostname);
    if (who === null || who === "root") {
      // Root domain: trade pages no longer live here (they 301 to the
      // subdomain), so only the root-owned private paths need disallowing.
      body = robotsBody(
        {
          allow: ["/"],
          disallow: ["/api/", "/notifications", "/active-trades"],
        },
        rootUrl(),
        sitemapUrlForHost("root"),
      );
    } else {
      body = robotsBody(
        rulesForSection(who),
        sectionOrigin(who),
        sitemapUrlForHost(who),
      );
    }
  }

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
