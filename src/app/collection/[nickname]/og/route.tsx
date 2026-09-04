import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import {
  resolveNickname,
  validateNickname,
} from "@/lib/cosmo/resolve-nickname";
import {
  loadOverviewRollups,
  summarizeOverview,
} from "@/lib/progress/overview-rollups";
import { decodeRouteParam } from "@/lib/route-params";

export const runtime = "nodejs";

const PAL = {
  bg: "#0f0f14",
  fg: "#e4e4e7",
  muted: "#a1a1aa",
  border: "#3f3f46",
  sectionBg: "#18181b",
  track: "#26262d",
  accent: "#ffffff",
};

function readFont(filename: string): Buffer {
  return fs.readFileSync(path.join(process.cwd(), "public", filename));
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ nickname: string }> },
) {
  const nickname = decodeRouteParam((await params).nickname);

  const [regularFont, boldFont, memberFont] = [
    readFont("og-regular.ttf"),
    readFont("og-bold.ttf"),
    readFont("og-member.otf"),
  ];

  // A bad nickname or a Cosmo outage still has to produce an image — Discord
  // caches a failed fetch, so returning 404/500 here would poison the embed
  // for that URL long after the outage ends.
  let summary: ReturnType<typeof summarizeOverview> | null = null;
  let displayName = nickname;
  if (validateNickname(nickname)) {
    try {
      const resolved = await resolveNickname(nickname);
      if (resolved) {
        displayName = resolved.nickname;
        summary = summarizeOverview(
          await loadOverviewRollups(resolved.address),
        );
      }
    } catch {
      // Fall through to the nameplate-only card.
    }
  }

  const html = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: PAL.bg,
        color: PAL.fg,
        fontFamily: "Regular",
        padding: 56,
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: 20,
          color: PAL.muted,
          letterSpacing: 1,
        }}
      >
        objekt.my · collection
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginTop: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 68,
            fontFamily: "Member",
            color: PAL.accent,
            lineHeight: 1.05,
          }}
        >
          {displayName}
        </div>
        <div style={{ display: "flex", fontSize: 24, color: PAL.muted }}>
          Collection progress
        </div>
      </div>

      {summary && summary.total > 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 22,
            marginTop: "auto",
          }}
        >
          {/* Headline figure */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 16 }}>
            <div
              style={{
                display: "flex",
                fontSize: 96,
                fontFamily: "Bold",
                color: PAL.accent,
                lineHeight: 1,
              }}
            >
              {summary.percent}%
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 28,
                color: PAL.muted,
                paddingBottom: 10,
              }}
            >
              {summary.owned} / {summary.total} collected
            </div>
          </div>

          {/* Overall progress bar */}
          <div
            style={{
              display: "flex",
              width: "100%",
              height: 14,
              borderRadius: 7,
              background: PAL.track,
            }}
          >
            <div
              style={{
                display: "flex",
                width: `${Math.max(1, Math.min(100, summary.percent))}%`,
                height: 14,
                borderRadius: 7,
                background: PAL.accent,
              }}
            />
          </div>

          {/* Per-artist split */}
          <div style={{ display: "flex", gap: 16 }}>
            {summary.byArtist.slice(0, 3).map((row) => (
              <div
                key={row.artist}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flex: 1,
                  gap: 4,
                  padding: "16px 20px",
                  borderRadius: 12,
                  border: `1px solid ${PAL.border}`,
                  background: PAL.sectionBg,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    fontSize: 30,
                    fontFamily: "Bold",
                    color: PAL.accent,
                  }}
                >
                  {row.owned}
                  <span style={{ color: PAL.muted, fontSize: 22 }}>
                    /{row.total}
                  </span>
                </div>
                <div
                  style={{ display: "flex", fontSize: 18, color: PAL.muted }}
                >
                  {row.artist}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            marginTop: "auto",
            padding: "26px 28px",
            borderRadius: 12,
            border: `1px solid ${PAL.border}`,
            background: PAL.sectionBg,
            fontSize: 24,
            color: PAL.muted,
          }}
        >
          Track your Cosmo collection, grids, and trades on objekt.my
        </div>
      )}
    </div>
  );

  return new ImageResponse(html, {
    width: 1200,
    height: 630,
    fonts: [
      { name: "Regular", data: regularFont, weight: 400 },
      { name: "Member", data: memberFont, weight: 600 },
      { name: "Bold", data: boldFont, weight: 700 },
    ],
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
}
