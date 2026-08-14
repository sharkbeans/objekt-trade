"use client";

import { ArrowLeftRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Edition } from "@/lib/edition";
import { EDITION_LABELS } from "@/lib/edition";
import {
  computeGriddable,
  formatSlotSerial,
  getGridSlots,
} from "@/lib/grid-progress";
import type { ProgressCollection } from "@/lib/progress/types";
import { DexDetailDialog } from "./dex-detail-dialog";
import { GridTradeDialog } from "./grid-trade-dialog";

interface Props {
  edition: Edition;
  firsts: ProgressCollection[];
  specials: ProgressCollection[];
  address: string;
  nickname: string;
  seasonCollections: ProgressCollection[];
  viewConsumed: boolean;
  ownershipLoaded: boolean;
  tradabilityLoaded: boolean;
}

function FirstCell({
  collection,
  displayCount,
  ownershipLoaded,
  onOpen,
}: {
  collection: ProgressCollection;
  displayCount: number;
  ownershipLoaded: boolean;
  onOpen: () => void;
}) {
  const owned = displayCount > 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-1 text-left"
    >
      <div className="relative aspect-11/17 w-full overflow-hidden rounded">
        {/* biome-ignore lint/performance/noImgElement: Indexer image URLs are already optimized card assets. */}
        <img
          src={collection.thumbnailImage}
          alt={collection.collectionNo}
          loading="lazy"
          className="h-full w-full object-cover"
        />
        <div
          className={`absolute inset-0 bg-black/71.5 transition-opacity duration-200 ${
            ownershipLoaded && !owned ? "opacity-100" : "opacity-0"
          }`}
        />
        {ownershipLoaded && owned && displayCount > 1 && (
          <span className="absolute bottom-1 right-1 flex h-5.5 w-5.5 items-center justify-center rounded-full border-2 border-white/30 bg-black text-[11px] font-bold text-white leading-none">
            {displayCount}
          </span>
        )}
      </div>
      <p className="truncate text-center text-[10px] leading-tight text-muted-foreground">
        {formatSlotSerial(collection.collectionNo)}
      </p>
    </button>
  );
}

// Every edition has a pool of 2 reward SCO variants (e.g. 201/202). Cosmo's
// own grid board cycles between them; we mirror that with a 2s crossfade
// rather than statically picking one.
const REWARD_CYCLE_MS = 2000;

function RewardCell({
  pool,
  ownershipLoaded,
  onOpen,
}: {
  pool: ProgressCollection[];
  ownershipLoaded: boolean;
  onOpen: (collection: ProgressCollection) => void;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (pool.length <= 1) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % pool.length);
    }, REWARD_CYCLE_MS);
    return () => clearInterval(id);
  }, [pool.length]);

  const current = pool[index % pool.length];
  const owned = current.ownedCount > 0;

  return (
    <button
      type="button"
      onClick={() => onOpen(current)}
      className="flex w-full flex-col gap-1 text-left"
    >
      <div className="relative aspect-11/17 w-full overflow-hidden rounded">
        {pool.map((c, i) => (
          // biome-ignore lint/performance/noImgElement: Indexer image URLs are already optimized card assets.
          <img
            key={c.collectionId}
            src={c.thumbnailImage}
            alt={c.collectionNo}
            loading="lazy"
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ease-in-out ${
              i === index ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}
        <div
          className={`absolute inset-0 bg-black/71.5 transition-opacity duration-700 ease-in-out ${
            !ownershipLoaded || owned ? "opacity-0" : "opacity-100"
          }`}
        />
      </div>
      <p className="truncate text-center text-[10px] leading-tight text-muted-foreground">
        {formatSlotSerial(current.collectionNo)}
      </p>
    </button>
  );
}

export function GridBoard({
  edition,
  firsts,
  specials,
  address,
  nickname,
  seasonCollections,
  viewConsumed,
  ownershipLoaded,
  tradabilityLoaded,
}: Props) {
  const [active, setActive] = useState<ProgressCollection | null>(null);
  const [tradeOpen, setTradeOpen] = useState(false);

  if (firsts.length === 0) return null;

  const slots = getGridSlots(edition);
  const owned = firsts.filter((c) => c.ownedCount > 0).length;

  // Gridding is a manual Cosmo action — owning all 8 FCOs doesn't mean the
  // grid was actually redeemed. `gridMintCount` on the reward SCOs is a
  // proxy for how many times this edition has been gridded (see the
  // progress API route for how it's derived). Copies consumed by past grids
  // stay in the wallet forever (grid-locked, not burned), so subtracting
  // that count from ownedCount gives the FCOs still usable for a new grid.
  // "Show gridded" (default on) shows raw ownedCount as always; turning it
  // off shows only usable copies, so cards fully spent on past grids tint
  // the same way an unowned card does.
  const gridded = specials.reduce((sum, c) => sum + c.gridMintCount, 0);
  const griddable = computeGriddable(firsts, gridded);

  return (
    <div className="w-full max-w-[min(90vw,30rem)] space-y-2 lg:w-[24rem] lg:max-w-[24rem] 2xl:w-[26rem] 2xl:max-w-[26rem]">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h4 className="text-base font-medium">{EDITION_LABELS[edition]}</h4>
          <span className="text-sm text-muted-foreground">
            {ownershipLoaded ? owned : "—"}/{firsts.length}
            {ownershipLoaded && gridded > 0 && ` · ${gridded} grids`}
            {ownershipLoaded && griddable > 0 && ` · ${griddable} griddable`}
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2.5 text-xs"
          onClick={() => setTradeOpen(true)}
          disabled={!ownershipLoaded}
        >
          <ArrowLeftRightIcon className="h-3.5 w-3.5" />
          Create List
        </Button>
      </div>
      <div className="grid w-full grid-cols-3 grid-rows-3 gap-2.5 lg:gap-3">
        {firsts.slice(0, slots.length).map((c, i) => {
          const [row, col] = slots[i];
          const displayCount = viewConsumed
            ? c.ownedCount
            : c.ownedCount - gridded;
          return (
            <div key={c.collectionId} style={{ gridRow: row, gridColumn: col }}>
              <FirstCell
                collection={c}
                displayCount={displayCount}
                ownershipLoaded={ownershipLoaded}
                onOpen={() => setActive(c)}
              />
            </div>
          );
        })}
        <div style={{ gridRow: 2, gridColumn: 2 }}>
          {specials.length > 0 ? (
            <RewardCell
              pool={specials}
              ownershipLoaded={ownershipLoaded}
              onOpen={setActive}
            />
          ) : (
            <div className="flex aspect-11/17 w-full items-center justify-center rounded bg-muted/20 text-muted-foreground">
              ?
            </div>
          )}
        </div>
      </div>

      <DexDetailDialog
        collection={active}
        address={address}
        ownershipLoaded={ownershipLoaded}
        tradabilityLoaded={tradabilityLoaded}
        onOpenChange={(open) => {
          if (!open) setActive(null);
        }}
      />

      <GridTradeDialog
        open={tradeOpen}
        onOpenChange={setTradeOpen}
        edition={edition}
        firsts={firsts}
        gridded={gridded}
        nickname={nickname}
        seasonCollections={seasonCollections}
      />
    </div>
  );
}
