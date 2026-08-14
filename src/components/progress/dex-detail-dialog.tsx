"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLinkIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { TiltCard } from "@/components/tilt-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  ProgressCollection,
  ProgressSerialsResponse,
} from "@/lib/progress/types";

interface Props {
  collection: ProgressCollection | null;
  address: string;
  ownershipLoaded: boolean;
  tradabilityLoaded: boolean;
  onOpenChange: (open: boolean) => void;
}

function artistLabel(artist?: string) {
  if (!artist) return null;
  return artist === "artms" ? "ARTMS" : artist;
}

function apolloUrl(collection: ProgressCollection) {
  const slug = [collection.season, collection.member, collection.collectionNo]
    .filter(Boolean)
    .join("-")
    .toLowerCase();
  return `https://apollo.cafe/?id=${slug}`;
}

function tradableValue(
  collection: ProgressCollection,
  tradabilityLoaded: boolean,
) {
  if (!tradabilityLoaded) return "Loading…";
  // -1 is the sentinel for "unknown" — the shared tradability sheet hasn't
  // built yet, distinct from a real zero.
  if (collection.globalTotalCount < 0) return "—";
  if (collection.globalTotalCount === 0) return "0.00% (0)";

  const percent =
    (collection.globalTradableCount / collection.globalTotalCount) * 100;
  return `${percent.toFixed(2)}% (${collection.globalTradableCount.toLocaleString()})`;
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <Badge variant="secondary" className="gap-1.5 rounded-md px-2 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </Badge>
  );
}

function FlipCard({ collection }: { collection: ProgressCollection }) {
  const [flipped, setFlipped] = useState(false);
  const [backLoaded, setBackLoaded] = useState(false);

  return (
    <TiltCard
      className="aspect-11/17 w-full max-w-56 select-none rounded perspective-distant sm:max-w-none"
      onClick={() => setFlipped((prev) => !prev)}
    >
      <div
        className="relative size-full transition-transform duration-300 [transform-style:preserve-3d]"
        style={{ transform: flipped ? "rotateY(180deg)" : undefined }}
      >
        {/* Front */}
        <div className="absolute inset-0 overflow-hidden rounded [backface-visibility:hidden]">
          {/* biome-ignore lint/performance/noImgElement: Indexer image URLs are already optimized card assets. */}
          <img
            src={collection.frontImage}
            alt={collection.collectionNo}
            className="h-full w-full object-cover"
          />
        </div>

        {/* Back */}
        <div
          className="absolute inset-0 overflow-hidden rounded [backface-visibility:hidden]"
          style={{ transform: "rotateY(180deg)" }}
        >
          {collection.backImage && (
            // biome-ignore lint/performance/noImgElement: Indexer image URLs are already optimized card assets.
            <img
              src={collection.backImage}
              alt={collection.collectionNo}
              loading="lazy"
              className="h-full w-full object-cover"
              onLoad={() => setBackLoaded(true)}
            />
          )}
          {!backLoaded && (
            <div
              className="h-full w-full bg-black"
              style={
                collection.accentColor
                  ? { backgroundColor: collection.accentColor }
                  : undefined
              }
            />
          )}
        </div>
      </div>
    </TiltCard>
  );
}

function SerialsTable({
  address,
  collectionId,
}: {
  address: string;
  collectionId: string;
}) {
  const { data, isLoading, error } = useQuery<ProgressSerialsResponse>({
    queryKey: ["progress-serials", address, collectionId],
    queryFn: async () => {
      const res = await fetch(
        `/api/progress/serials?address=${encodeURIComponent(address)}&collectionId=${encodeURIComponent(collectionId)}`,
      );
      if (!res.ok) throw new Error("Failed to load serials");
      return res.json();
    },
    staleTime: 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        <Loader2Icon className="h-4 w-4 animate-spin" />
        <span>Loading serials</span>
      </div>
    );
  }

  if (error) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        Couldn&apos;t load serials.
      </p>
    );
  }

  const serials = data?.serials ?? [];
  if (serials.length === 0) return null;

  return (
    <div className="max-h-60 overflow-y-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="sticky top-0 border-b border-border bg-muted text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">Serial</th>
            <th className="px-3 py-2 font-medium">Token ID</th>
            <th className="px-3 py-2 font-medium">Transferable</th>
          </tr>
        </thead>
        <tbody>
          {serials.map((s) => (
            <tr
              key={s.objektId}
              className="border-b border-border last:border-0"
            >
              <td className="px-3 py-2 font-medium tabular-nums">{s.serial}</td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground">
                {s.objektId || "—"}
              </td>
              <td className="px-3 py-2">
                <Badge
                  variant={s.transferable ? "secondary" : "outline"}
                  className="rounded px-1.5 py-0.5 text-xs font-normal"
                >
                  {s.transferable ? "Yes" : "No"}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DexDetailDialog({
  collection,
  address,
  ownershipLoaded,
  tradabilityLoaded,
  onOpenChange,
}: Props) {
  const c = collection;
  const artist = artistLabel(c?.artist);

  const title = c
    ? [c.season, c.member, c.collectionNo].filter(Boolean).join(" ")
    : "";

  return (
    <Dialog open={c !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-3xl!">
        {c && (
          <div className="flex flex-col sm:flex-row">
            {/* Card — left */}
            <div className="flex w-full shrink-0 items-center justify-center bg-background p-5 sm:w-90">
              <FlipCard collection={c} />
            </div>

            {/* Details — right */}
            <div className="flex-1 space-y-4 overflow-y-auto p-5 sm:max-h-[80vh]">
              <DialogHeader className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  {c.collectionId}
                </p>
                <DialogTitle className="text-lg">{title}</DialogTitle>
                <DialogDescription className="sr-only">
                  Objekt attributes for {title}
                </DialogDescription>
              </DialogHeader>

              {/* Attributes */}
              <div className="flex flex-wrap gap-1.5">
                {artist && <Pill label="Artist" value={artist} />}
                {c.member && <Pill label="Member" value={c.member} />}
                <Pill label="Season" value={c.season} />
                <Pill label="Class" value={c.class} />
                <Pill
                  label="Type"
                  value={c.onOffline === "online" ? "Digital" : "Physical"}
                />
                <Pill
                  label="Tradable"
                  value={tradableValue(c, tradabilityLoaded)}
                />
              </div>

              {/* Ownership */}
              <div className="flex items-center gap-3 pt-1 text-sm">
                <span className="font-medium text-foreground">
                  {!ownershipLoaded
                    ? "Checking ownership…"
                    : c.ownedCount > 0
                      ? `Owned ×${c.ownedCount}`
                      : "Not owned"}
                </span>
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={apolloUrl(c)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View in Apollo
                    <ExternalLinkIcon />
                  </a>
                </Button>
              </div>

              {/* Serials owned */}
              {ownershipLoaded && c.ownedCount > 0 && (
                <SerialsTable address={address} collectionId={c.collectionId} />
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
