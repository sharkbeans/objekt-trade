"use client";

import { Check, Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { PosterData } from "@/components/poster/poster-canvas";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useSession } from "@/lib/auth-client";
import type { ObjektEntry } from "@/lib/cosmo/types";
import { EDITION_LABELS, type Edition } from "@/lib/edition";
import {
  computeGriddable,
  computeOfferableDupes,
  formatSlotSerial,
  getGridSlots,
} from "@/lib/grid-progress";
import {
  encodeGridTradeStash,
  GRID_TRADE_HASH_PARAM,
} from "@/lib/grid-trade-stash";
import {
  makePosterItem,
  resolvedItemToApiInput,
} from "@/lib/poster/poster-item";
import type { ProgressCollection } from "@/lib/progress/types";
import { sectionHref } from "@/lib/sections";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  edition: Edition;
  firsts: ProgressCollection[];
  gridded: number;
  nickname: string;
  seasonCollections: ProgressCollection[];
}

function toEntry(c: ProgressCollection): ObjektEntry {
  return {
    collectionId: c.collectionId,
    artist: c.artist ?? "",
    member: c.member ?? "",
    collectionNo: c.collectionNo,
    season: c.season,
    class: c.class,
    thumbnailImage: c.thumbnailImage,
  };
}

export function GridTradeDialog({
  open,
  onOpenChange,
  edition,
  firsts,
  gridded,
  nickname,
  seasonCollections,
}: Props) {
  const router = useRouter();
  const { data: session } = useSession();
  const [offerDupes, setOfferDupes] = useState(true);
  const [creating, setCreating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Only the profile's own owner can auto-create a matchable trade list from
  // it — a visitor viewing someone else's grid shouldn't be able to spin up
  // a list claiming that person's dupes under the visitor's own account.
  const [isOwnProfile, setIsOwnProfile] = useState(false);

  useEffect(() => {
    if (!session) {
      setIsOwnProfile(false);
      return;
    }
    let cancelled = false;
    fetch("/api/cosmo/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { nickname?: string | null } | null) => {
        if (!cancelled) setIsOwnProfile(data?.nickname === nickname);
      })
      .catch(() => {
        if (!cancelled) setIsOwnProfile(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, nickname]);

  // Target the *next* grid past however many are already griddable now, so
  // this works whether nothing has been gridded yet (feature 2) or the user
  // wants to stack up for another grid on top of ones they can already do
  // (feature 3).
  const target = computeGriddable(firsts, gridded) + 1;
  const slots = getGridSlots(edition);

  const rows = useMemo(
    () =>
      firsts.map((c) => {
        const usable = c.ownedCount - gridded;
        const needed = Math.max(0, target - usable);
        return { collection: c, usable, needed };
      }),
    [firsts, gridded, target],
  );

  const defaultSelection = useMemo(
    () =>
      new Set(
        rows.filter((r) => r.needed > 0).map((r) => r.collection.collectionId),
      ),
    [rows],
  );

  const [selected, setSelected] = useState<Set<string>>(defaultSelection);
  const [touched, setTouched] = useState(false);

  // This dialog mounts with the grid board, which happens as soon as the
  // grid-mint query resolves — potentially *before* the ownership query. At
  // that point every FCO reads ownedCount 0, so the default selection would
  // be all 8 slots and, seeded once via useState, would stay that way even
  // after the real counts arrive. Re-seed from the live rows until the user
  // makes a choice of their own.
  useEffect(() => {
    if (touched) return;
    setSelected((prev) =>
      prev.size === defaultSelection.size &&
      [...defaultSelection].every((id) => prev.has(id))
        ? prev
        : defaultSelection,
    );
  }, [defaultSelection, touched]);

  // Closing discards the manual picks, so the next open starts from a default
  // computed against whatever ownership data has landed by then.
  useEffect(() => {
    if (!open) setTouched(false);
  }, [open]);

  // Spare copies across the *whole season*, not just this board's edition —
  // trading away extra 1st-edition FCOs to complete a 2nd-edition grid is the
  // normal case. Each edition's reserve is computed against its own grid
  // inside computeOfferableDupes, with this board's edition protected.
  const offerableDupes = useMemo(
    () => computeOfferableDupes(seasonCollections, edition),
    [seasonCollections, edition],
  );

  // Never offer what this same list is asking for.
  const dupes = useMemo(
    () =>
      offerableDupes.filter((d) => !selected.has(d.collection.collectionId)),
    [offerableDupes, selected],
  );

  const dupeCount = useMemo(
    () => dupes.reduce((sum, d) => sum + d.offerable, 0),
    [dupes],
  );

  const toggle = (id: string) => {
    setTouched(true);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  function buildPosterData(): PosterData {
    const wants = rows
      .filter((r) => selected.has(r.collection.collectionId))
      .map((r) => makePosterItem(toEntry(r.collection)));

    // One entry per offerable duplicate copy (not a single pre-aggregated
    // quantity) so the poster's "Combine Duplicates" toggle can actually
    // merge/split them, same as any other multi-copy have.
    const haves = offerDupes
      ? dupes.flatMap(({ collection, offerable }) =>
          Array.from({ length: offerable }, () =>
            makePosterItem(toEntry(collection)),
          ),
        )
      : [];

    return {
      username: nickname,
      cosmoId: nickname,
      haves,
      wants,
      date: new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
      haveTitle: "Have",
      wantTitle: "Want",
    };
  }

  // Secondary path: stash the draft and open the full poster editor so the
  // user can customize before saving.
  const handleCustomize = () => {
    const stash = encodeGridTradeStash(buildPosterData());
    onOpenChange(false);
    router.push(
      `${sectionHref("/list?prefill=grid", { currentSection: "collect" })}#${GRID_TRADE_HASH_PARAM}=${stash}`,
    );
  };

  // Primary path: create the trade list immediately and land on its Matches
  // view — skips the editor detour for the common case of "just find me a
  // trade for this".
  const handleFindTrades = async () => {
    const posterData = buildPosterData();
    setCreating(true);
    try {
      const res = await fetch("/api/posters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: posterData.username,
          cosmoId: posterData.cosmoId,
          haves: posterData.haves.map((item, i) =>
            resolvedItemToApiInput(item, i),
          ),
          wants: posterData.wants.map((item, i) =>
            resolvedItemToApiInput(item, i),
          ),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed");
      }
      const { id } = (await res.json()) as { id: string };
      onOpenChange(false);
      // This dialog renders on the collect host — passing "collect" makes
      // sectionHref emit an absolute URL onto the list host instead of a
      // relative path that would 404 on collect.<root>.
      router.push(sectionHref(`/list/${id}`, { currentSection: "collect" }));
    } catch {
      toast.error(
        "Couldn't create your trade list automatically — try customizing it instead.",
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Trade for {firsts[0]?.member} {firsts[0]?.season}{" "}
            {EDITION_LABELS[edition]}
          </DialogTitle>
          <DialogDescription>
            Pick which FCOs you still need, then create a trade list with them
            as your wants.
          </DialogDescription>
        </DialogHeader>

        <div className="mx-auto grid w-[85%] grid-cols-3 grid-rows-3 gap-2.5">
          {rows.slice(0, slots.length).map(({ collection: c, usable }, i) => {
            const isSelected = selected.has(c.collectionId);
            const [row, col] = slots[i];
            return (
              <div
                key={c.collectionId}
                style={{ gridRow: row, gridColumn: col }}
              >
                <button
                  type="button"
                  onClick={() => toggle(c.collectionId)}
                  className={cn(
                    "relative w-full rounded-sm overflow-hidden focus:outline-none ring-2 ring-inset ring-transparent transition-colors",
                    isSelected && "ring-green-500",
                  )}
                >
                  {/* biome-ignore lint/performance/noImgElement: Indexer image URLs are already optimized card assets. */}
                  <img
                    src={c.thumbnailImage}
                    alt={c.collectionNo}
                    loading="lazy"
                    className="w-full aspect-photocard object-cover"
                  />
                  {usable <= 0 && (
                    <div className="absolute inset-0 bg-black/71.5" />
                  )}
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-3">
                    <p className="text-[10px] text-white font-medium leading-tight">
                      {formatSlotSerial(c.collectionNo)}
                    </p>
                  </div>
                  {isSelected && (
                    <>
                      <div className="absolute inset-0 bg-black/25" />
                      <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center shadow">
                        <Check
                          className="w-3.5 h-3.5 text-white"
                          strokeWidth={3}
                        />
                      </div>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 rounded border border-border px-3 py-2">
          <div>
            <p className="text-sm font-medium">Offer my duplicates</p>
            <p className="text-xs text-muted-foreground">
              {dupeCount > 0
                ? `Add ${dupeCount} duplicate FCO${dupeCount === 1 ? "" : "s"} from this season as haves`
                : "No duplicate FCOs available to offer this season"}
            </p>
          </div>
          <Switch
            checked={offerDupes}
            onCheckedChange={setOfferDupes}
            disabled={dupeCount === 0}
          />
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row sm:items-center">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {isOwnProfile ? (
            <>
              <Button
                variant="outline"
                onClick={handleCustomize}
                disabled={selected.size === 0 || creating}
              >
                Customize list first
              </Button>
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={selected.size === 0 || creating}
                className="gap-1.5"
              >
                {creating && <Loader2Icon className="h-4 w-4 animate-spin" />}
                Find trades
              </Button>
            </>
          ) : (
            <Button
              onClick={handleCustomize}
              disabled={selected.size === 0 || creating}
            >
              Create trade list
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create a trade list?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create a public trade list with these items as your
              wants, so other traders can find and match with it. You can
              customize the haves and wants first, or create it now as-is.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setConfirmOpen(false);
                handleCustomize();
              }}
            >
              Edit list
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                handleFindTrades();
              }}
            >
              Create List
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
