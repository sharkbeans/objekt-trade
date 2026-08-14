"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ChevronDownIcon,
  InfoIcon,
  LayoutGridIcon,
  Loader2Icon,
  ShareIcon,
  XIcon,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useProgressOverview } from "@/hooks/use-progress-overview";
import { shareOrDownloadCanvas } from "@/lib/download-canvas";
import {
  EDITION_LABELS,
  type Edition,
  getCollectionEdition,
} from "@/lib/edition";
import { isCollectionProgressCountable } from "@/lib/progress/countable";
import {
  progressMemberCatalogQueryKey,
  progressMemberOwnershipQueryKey,
  progressMemberTradabilityQueryKey,
  progressSelectionStorageKey,
} from "@/lib/progress/identity-keys";
import { renderProgressCardToCanvas } from "@/lib/progress/progress-card-render";
import type {
  ProgressCollection,
  ProgressMemberCatalogResponse,
  ProgressMemberOwnershipResponse,
  ProgressMemberResponse,
  ProgressMemberTradabilityResponse,
} from "@/lib/progress/types";
import { sectionAbsoluteUrl, sectionHref } from "@/lib/sections";
import { cn } from "@/lib/utils";
import { GridSection } from "./grid-section";
import { ObjektScanStatus, useScanComplete } from "./objekt-scan-status";
import type { ProgressNavigationState } from "./progress-search";
import { ProgressSearch } from "./progress-search";
import { SeasonSection } from "./season-section";

interface SeasonColorsResponse {
  colors: Record<string, string>;
}

interface GridMintCountsResponse {
  counts: Record<string, number>;
}

type ViewTab = "dex" | "grid";

interface StoredSelection {
  dexActiveClasses?: string[];
  dexActiveSeasons?: string[];
  dexActiveEditions?: Edition[];
  perRow?: number;
  gridActiveSeasons?: string[];
  gridActiveEditions?: Edition[];
}

function chipClass(active: boolean): string {
  return `px-3 py-1 rounded-full text-sm font-medium transition-colors border ${
    active
      ? "bg-muted text-foreground border-transparent"
      : "bg-transparent text-muted-foreground border-border hover:text-foreground"
  }`;
}

function EditionChipRow({
  active,
  onToggle,
  onClear,
}: {
  active: Edition[];
  onToggle: (edition: Edition) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      <button
        type="button"
        onClick={onClear}
        className={chipClass(active.length === 0)}
      >
        All editions
      </button>
      {([1, 2, 3] as const).map((ed) => (
        <button
          key={ed}
          type="button"
          onClick={() => onToggle(ed)}
          className={chipClass(active.includes(ed))}
        >
          {EDITION_LABELS[ed]}
        </button>
      ))}
    </div>
  );
}

function mobileFilterSummary<T>({
  active,
  allLabel,
  renderValue,
}: {
  active: T[];
  allLabel: string;
  renderValue?: (value: T) => string;
}) {
  if (active.length === 0) return allLabel;
  if (active.length === 1) {
    return renderValue ? renderValue(active[0]) : String(active[0]);
  }
  return `${active.length} selected`;
}

function MobileMultiSelectDropdown<T extends string | number>({
  label,
  allLabel,
  active,
  options,
  onToggle,
  onClear,
  renderOption,
  summaryAllLabel,
}: {
  label: string;
  allLabel: string;
  active: T[];
  options: readonly T[];
  onToggle: (value: T) => void;
  onClear: () => void;
  renderOption?: (value: T) => string;
  summaryAllLabel?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 sm:hidden">
          <span>{label}</span>
          <span className="max-w-24 truncate text-muted-foreground">
            {mobileFilterSummary({
              active,
              allLabel: summaryAllLabel ?? allLabel,
              renderValue: renderOption,
            })}
          </span>
          <ChevronDownIcon className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onClear();
          }}
        >
          {allLabel}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={String(option)}
            checked={active.includes(option)}
            onCheckedChange={() => onToggle(option)}
          >
            {renderOption ? renderOption(option) : String(option)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SeasonChipRow({
  seasons,
  active,
  artist,
  seasonColors,
  onToggle,
  onClear,
}: {
  seasons: string[];
  active: string[];
  artist: string;
  seasonColors: Record<string, string>;
  onToggle: (season: string) => void;
  onClear: () => void;
}) {
  if (seasons.length <= 1) return null;
  return (
    <div className="flex gap-1.5 flex-wrap">
      <button
        type="button"
        onClick={onClear}
        className={`px-3 py-1 rounded-full text-sm font-medium transition-colors border ${
          active.length === 0
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-transparent text-muted-foreground border-border hover:text-foreground"
        }`}
      >
        All
      </button>
      {seasons.map((s) => {
        const color = seasonColors[`${artist}|${s}`] ?? null;
        const isActive = active.includes(s);
        return (
          <button
            key={s}
            type="button"
            onClick={() => onToggle(s)}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors border ${
              isActive
                ? "text-white"
                : "bg-transparent text-muted-foreground hover:text-foreground"
            }`}
            style={
              color
                ? isActive
                  ? { backgroundColor: color, borderColor: color }
                  : { borderColor: color }
                : isActive
                  ? undefined
                  : { borderColor: "hsl(var(--border))" }
            }
          >
            {s}
          </button>
        );
      })}
    </div>
  );
}

function toggleValue<T>(prev: T[], value: T): T[] {
  return prev.includes(value)
    ? prev.filter((x) => x !== value)
    : [...prev, value];
}

function countsForProgress(collections: ProgressCollection[]) {
  const countable = collections.filter(
    (c) => c.progressCountable ?? isCollectionProgressCountable(c),
  );
  return {
    owned: countable.filter((c) => c.ownedCount > 0).length,
    total: countable.length,
  };
}

// Filters (season/class/edition chips, the switches/dropdown/share row)
// aren't member-specific enough to warrant a loading state of their own —
// they render immediately using data from the nickname-scoped overview
// query, which is already cached by the time this component mounts. Only
// the objekt cells themselves depend on the still-in-flight per-member
// fetch, so these skeletons cover just that: a season header plus the grid
// (dexContent) or side-by-side boards (gridContent).

// Mirrors a single GridBoard: a 3x3 board of First-copy cells around one
// reward-slot cell, matching grid-board.tsx's layout so the skeleton doesn't
// jump in size/shape once real boards render in.
function GridBoardSkeleton() {
  return (
    <div className="w-full max-w-[min(90vw,30rem)] space-y-2 lg:w-96 lg:max-w-96 2xl:w-104 2xl:max-w-104">
      <div className="flex items-baseline gap-2">
        <div className="h-5 w-16 rounded bg-muted animate-pulse" />
        <div className="h-4 w-12 rounded bg-muted animate-pulse" />
      </div>
      <div className="grid w-full grid-cols-3 grid-rows-3 gap-2.5 lg:gap-3">
        {Array.from({ length: 9 }, (_, i) => `gb-sk-${i}`).map((id) => (
          <div
            key={id}
            className="aspect-11/17 rounded bg-muted animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}

function EmptyFilterState({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <p className="text-sm text-muted-foreground">
        No objekts to show. Try checking your filters.
      </p>
      <button
        type="button"
        onClick={onReset}
        className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4 hover:text-muted-foreground"
      >
        <XIcon className="h-3.5 w-3.5" />
        Reset Filters
      </button>
    </div>
  );
}

function GridBoardsRowSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-6 w-20 rounded bg-muted animate-pulse" />
      <div className="flex flex-wrap items-stretch gap-8">
        <GridBoardSkeleton />
        <div className="hidden w-px shrink-0 self-stretch bg-border sm:block" />
        <GridBoardSkeleton />
      </div>
    </div>
  );
}

interface Props {
  nickname: string;
  address: string;
  member: string;
  initialCatalog: ProgressMemberCatalogResponse;
  availableSeasons: string[];
}

export function MemberDexContent({
  nickname,
  address,
  member,
  initialCatalog,
  availableSeasons,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab: ViewTab =
    searchParams.get("view") === "grid" ? "grid" : "dex";
  const [clientReady, setClientReady] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<ProgressNavigationState>(null);
  useEffect(() => setClientReady(true), []);

  const catalogQuery = useQuery<ProgressMemberCatalogResponse>({
    queryKey: progressMemberCatalogQueryKey(member),
    queryFn: async () => {
      const res = await fetch(
        `/api/progress/catalog/${encodeURIComponent(member)}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw Object.assign(new Error(body.error ?? "Failed to load"), {
          status: res.status,
        });
      }
      return res.json();
    },
    initialData: initialCatalog,
    initialDataUpdatedAt: 0,
    staleTime: 10 * 60_000,
    retry: false,
  });

  const ownershipQuery = useQuery<ProgressMemberOwnershipResponse>({
    queryKey: progressMemberOwnershipQueryKey(address, member),
    queryFn: async () => {
      const res = await fetch(
        `/api/progress/${encodeURIComponent(nickname)}/${encodeURIComponent(member)}/ownership`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw Object.assign(new Error(body.error ?? "Failed to load"), {
          status: res.status,
        });
      }
      return res.json();
    },
    staleTime: 60_000,
    // Same reasoning as the overview query: the default 5min gcTime drops
    // this while the user is off looking at another member (or another
    // collection), so coming back re-runs the ownership scan from scratch.
    gcTime: 60 * 60_000,
    retry: false,
  });

  const tradabilityQuery = useQuery<ProgressMemberTradabilityResponse>({
    queryKey: progressMemberTradabilityQueryKey(member),
    queryFn: async () => {
      const res = await fetch(
        `/api/progress/catalog/${encodeURIComponent(member)}/tradability`,
      );
      if (!res.ok) throw new Error("Failed to load tradability");
      return res.json();
    },
    staleTime: 10 * 60_000,
    retry: false,
  });

  // QueryClient can already hold data during client-side navigation. Keep
  // the first client render identical to the server-rendered catalog, then
  // apply cached/fetched overlays after hydration.
  const catalog = clientReady
    ? (catalogQuery.data ?? initialCatalog)
    : initialCatalog;
  const ownership = clientReady ? ownershipQuery.data : undefined;
  const tradability = clientReady ? tradabilityQuery.data : undefined;
  const ownershipError = clientReady ? ownershipQuery.error : null;
  const ownershipLoaded = ownership !== undefined;
  const displayOwnershipLoaded = ownershipLoaded && switchingTo === null;
  const tradabilityLoaded = tradability !== undefined;

  const data = useMemo<ProgressMemberResponse>(() => {
    return {
      nickname: ownership?.nickname ?? nickname,
      address: ownership?.address ?? address,
      member: catalog.member,
      artist: catalog.artist,
      collections: catalog.collections.map((collection) => {
        const owned = ownership?.counts[collection.collectionId];
        const global = tradability?.counts[collection.collectionId];
        return {
          collectionId: collection.collectionId,
          collectionNo: collection.collectionNo,
          season: collection.season,
          class: collection.class,
          onOffline: collection.onOffline,
          thumbnailImage: collection.thumbnailImage,
          frontImage: collection.frontImage,
          backImage: collection.backImage,
          accentColor: collection.accentColor,
          member: collection.member,
          artist: collection.artist,
          ownedCount: owned?.ownedCount ?? 0,
          transferableCount: owned?.transferableCount ?? 0,
          globalTotalCount: global?.globalTotalCount ?? 0,
          globalTradableCount: global?.globalTradableCount ?? 0,
          gridMintCount: 0,
          progressCountable:
            global?.progressCountable ?? collection.baseProgressCountable,
        };
      }),
    };
  }, [address, catalog, nickname, ownership, tradability]);

  const { data: gridMintData } = useQuery<GridMintCountsResponse>({
    queryKey: ["progress-grid-mints", "address", address.toLowerCase(), member],
    queryFn: async () => {
      const res = await fetch(
        `/api/progress/${encodeURIComponent(nickname)}/${encodeURIComponent(member)}/grid-mints`,
      );
      if (!res.ok) return { counts: {} };
      return res.json();
    },
    enabled: activeTab === "grid",
    staleTime: 10 * 60_000,
    retry: false,
  });

  // Overview data is fetched (and cached) by the persistent layout above
  // this page, so it's typically already available the instant this
  // component mounts — even though the per-member fetch above is still in
  // flight. The rollups it carries are coarser than the per-member response
  // (grouped by class/season, no per-collection numbers) but that's enough
  // to render real totals and real filter chips immediately instead of
  // waiting on the slower fetch — only the objekt cells themselves need a
  // loading state below.
  const overviewQuery = useProgressOverview(nickname, address);
  const overviewData = clientReady ? overviewQuery.data : undefined;

  const earlyTotals = useMemo(() => {
    if (!overviewData) return null;
    let owned = 0;
    let total = 0;
    let found = false;
    for (const r of overviewData.rollups) {
      if (r.member !== member) continue;
      found = true;
      owned += r.owned;
      total += r.total;
    }
    return found ? { owned, total } : null;
  }, [overviewData, member]);

  const earlyArtist = useMemo(() => {
    if (!overviewData) return "";
    return overviewData.rollups.find((r) => r.member === member)?.artist ?? "";
  }, [overviewData, member]);

  // Same class/artist rules getCollectionEdition uses, just without needing
  // per-collection numbers — good enough to guess which seasons are
  // grid-eligible, and whether the Collection/Grid tab strip should even
  // show a Grid tab, before the real per-member data confirms it.
  const guessedHasEditions = useMemo(() => {
    if (!overviewData) return false;
    return overviewData.rollups.some(
      (r) =>
        r.member === member &&
        r.artist !== "idntt" &&
        (r.class === "First" || r.class === "Special" || r.class === "Motion"),
    );
  }, [overviewData, member]);

  // Dex-scoped filters
  const [dexActiveClasses, setDexActiveClasses] = useState<string[]>([]);
  const [dexActiveSeasons, setDexActiveSeasons] = useState<string[]>(() => {
    const latest = initialCatalog.collections.at(-1)?.season;
    return latest ? [latest] : [];
  });
  const [dexActiveEditions, setDexActiveEditions] = useState<Edition[]>([]);
  const [dexSeasonInitialized, setDexSeasonInitialized] = useState(
    initialCatalog.collections.length > 0,
  );
  const [unownedOnly, setUnownedOnly] = useState(false);
  const [ownedOnly, setOwnedOnly] = useState(false);
  // Objekts per row: 5 on desktop, 3 on mobile (set after mount to avoid a
  // hydration mismatch). User can override via the dropdown.
  const [perRow, setPerRow] = useState(5);
  useEffect(() => {
    if (window.matchMedia("(max-width: 639px)").matches) setPerRow(3);
  }, []);

  // Grid-scoped filters — independent from Dex's. A grid board is always
  // First+Special, so there's no class dimension here.
  const [gridActiveSeasons, setGridActiveSeasons] = useState<string[]>([]);
  const [gridActiveEditions, setGridActiveEditions] = useState<Edition[]>([]);
  const [gridSeasonInitialized, setGridSeasonInitialized] = useState(false);
  const [viewConsumed, setViewConsumed] = useState(true);

  // Captured once on mount (not kept in sync with `searchParams`): the
  // season a shared link pointed at, e.g. .../SoHyun?view=grid&season=Binary02.
  // Takes priority over the localStorage-remembered selection below so a
  // shared link always opens on the season it was shared for, even if this
  // browser has a different season saved from a previous visit.
  const [initialUrlSeason] = useState(() => searchParams.get("season"));

  // Restore this page's last-used filters from localStorage (client only —
  // runs after mount to avoid a hydration mismatch). The stable key follows
  // the wallet through a rename and cannot leak preferences when an old
  // nickname is claimed by a different wallet.
  const [selectionRestored, setSelectionRestored] = useState(false);
  useEffect(() => {
    setSelectionRestored(false);
    setUnownedOnly(false);
    setOwnedOnly(false);
    try {
      const stableKey = progressSelectionStorageKey(address, member);
      const legacyKey = `collection-selection:${nickname.toLowerCase()}:${member.toLowerCase()}`;
      const stableRaw = localStorage.getItem(stableKey);
      const raw = stableRaw ?? localStorage.getItem(legacyKey);
      if (!stableRaw && raw) {
        localStorage.setItem(stableKey, raw);
      }
      if (raw) {
        const stored = JSON.parse(raw) as StoredSelection;
        if (stored.dexActiveClasses)
          setDexActiveClasses(stored.dexActiveClasses);
        if (stored.dexActiveSeasons) {
          setDexActiveSeasons(stored.dexActiveSeasons);
          setDexSeasonInitialized(true);
        }
        if (stored.dexActiveEditions)
          setDexActiveEditions(stored.dexActiveEditions);
        if (stored.perRow != null) setPerRow(stored.perRow);
        if (stored.gridActiveSeasons && !initialUrlSeason) {
          setGridActiveSeasons(stored.gridActiveSeasons);
          setGridSeasonInitialized(true);
        }
        if (stored.gridActiveEditions)
          setGridActiveEditions(stored.gridActiveEditions);
      }
    } catch {
      // Malformed/unavailable storage — fall back to defaults.
    }
    setSelectionRestored(true);
  }, [address, nickname, member, initialUrlSeason]);

  // Persist the current filters whenever they change, once the initial
  // restore above has run (so we don't clobber storage with defaults first).
  useEffect(() => {
    if (!selectionRestored) return;
    const selection: StoredSelection = {
      dexActiveClasses,
      dexActiveSeasons,
      dexActiveEditions,
      perRow,
      gridActiveSeasons,
      gridActiveEditions,
    };
    localStorage.setItem(
      progressSelectionStorageKey(address, member),
      JSON.stringify(selection),
    );
  }, [
    selectionRestored,
    address,
    member,
    dexActiveClasses,
    dexActiveSeasons,
    dexActiveEditions,
    perRow,
    gridActiveSeasons,
    gridActiveEditions,
  ]);

  const setActiveTab = useCallback(
    (nextTab: ViewTab) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("view", nextTab === "grid" ? "grid" : "collection");
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  const buildSameMemberHref = useCallback(
    (nextNickname: string) => {
      const params = new URLSearchParams(searchParams.toString());
      const query = params.toString();
      const encodedNickname = encodeURIComponent(nextNickname);
      const encodedMember = encodeURIComponent(member);
      const path = `/collection/${encodedNickname}/${encodedMember}`;
      return sectionHref(query ? `${path}?${query}` : path, {
        currentSection: "collect",
      });
    },
    [member, searchParams],
  );

  const { data: seasonColorsData } = useQuery<SeasonColorsResponse>({
    queryKey: ["progress-season-colors"],
    queryFn: async () => {
      const res = await fetch("/api/progress/season-colors");
      if (!res.ok) return { colors: {} };
      return res.json();
    },
    staleTime: 10 * 60_000,
  });
  const seasonColors = seasonColorsData?.colors ?? {};

  const allSeasons = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [...availableSeasons];
    for (const season of out) seen.add(season);
    for (const c of data.collections) {
      if (!seen.has(c.season)) {
        seen.add(c.season);
        out.push(c.season);
      }
    }
    return out;
  }, [availableSeasons, data]);

  const allClasses = useMemo(() => {
    return [...new Set(data.collections.map((c) => c.class))].sort();
  }, [data]);

  const editionByCollectionId = useMemo(() => {
    const map = new Map<string, Edition>();
    for (const c of data.collections) {
      const edition = getCollectionEdition({
        artist: c.artist,
        class: c.class,
        onOffline: c.onOffline,
        collectionNo: c.collectionNo,
        season: c.season,
      });
      if (edition) map.set(c.collectionId, edition);
    }
    return map;
  }, [data]);

  const hasEditions = editionByCollectionId.size > 0;

  // Seasons that actually have grid-eligible (edition-bearing) collections —
  // a season with only idntt-style non-editioned classes shouldn't show up
  // as a Grid season chip even if it's a valid Dex season.
  const gridAllSeasons = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of data.collections) {
      if (editionByCollectionId.has(c.collectionId) && !seen.has(c.season)) {
        seen.add(c.season);
        out.push(c.season);
      }
    }
    return out;
  }, [data, editionByCollectionId]);

  // Default each section to the latest (current) season once data loads.
  // allSeasons/gridAllSeasons are in ascending order, so the last entry is
  // the most recent.
  useEffect(() => {
    if (dexSeasonInitialized || allSeasons.length === 0) return;
    setDexActiveSeasons([allSeasons[allSeasons.length - 1]]);
    setDexSeasonInitialized(true);
  }, [allSeasons, dexSeasonInitialized]);

  useEffect(() => {
    if (gridSeasonInitialized || gridAllSeasons.length === 0) return;
    const matched = initialUrlSeason
      ? gridAllSeasons.find(
          (s) => s.toLowerCase() === initialUrlSeason.toLowerCase(),
        )
      : undefined;
    setGridActiveSeasons([
      matched ?? gridAllSeasons[gridAllSeasons.length - 1],
    ]);
    setGridSeasonInitialized(true);
  }, [gridAllSeasons, gridSeasonInitialized, initialUrlSeason]);

  // Keep the URL's `season` param in sync with the Grid tab's season filter
  // so the address bar (and anything shared from it) reflects exactly what's
  // on screen — a single selected season maps to `?season=`, otherwise (all
  // seasons, multiple seasons, or the Dex tab) the param is dropped.
  useEffect(() => {
    if (!gridSeasonInitialized) return;
    const next =
      activeTab === "grid" && gridActiveSeasons.length === 1
        ? gridActiveSeasons[0]
        : null;
    if (searchParams.get("season") === next) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("season", next);
    else params.delete("season");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [
    activeTab,
    gridActiveSeasons,
    gridSeasonInitialized,
    pathname,
    router,
    searchParams,
  ]);

  // Cache-busting `share` token from a "Share link" click (grid-section.tsx)
  // — only meant to make the very first fetch (Discord's, or this page load)
  // look unseen to link/image caches. It has no purpose once the page has
  // actually loaded, so it's dropped from the address bar right away. Unlike
  // `season` above, this one is never written back.
  useEffect(() => {
    if (!searchParams.get("share")) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("share");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [searchParams, pathname, router]);

  // Base filter: class + season + edition (used for accurate totals). Empty
  // arrays mean "all".
  const baseFiltered = useMemo(() => {
    return data.collections.filter(
      (c) =>
        (dexActiveClasses.length === 0 || dexActiveClasses.includes(c.class)) &&
        (dexActiveSeasons.length === 0 ||
          dexActiveSeasons.includes(c.season)) &&
        (dexActiveEditions.length === 0 ||
          dexActiveEditions.includes(
            editionByCollectionId.get(c.collectionId) as Edition,
          )),
    );
  }, [
    data,
    dexActiveClasses,
    dexActiveSeasons,
    dexActiveEditions,
    editionByCollectionId,
  ]);

  // Full filter including ownership toggles (used for display)
  const filtered = useMemo(
    () =>
      baseFiltered.filter(
        (c) =>
          !displayOwnershipLoaded ||
          ((!unownedOnly || c.ownedCount === 0) &&
            (!ownedOnly || c.ownedCount > 0)),
      ),
    [baseFiltered, displayOwnershipLoaded, unownedOnly, ownedOnly],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const c of filtered) {
      const arr = map.get(c.season) ?? [];
      arr.push(c);
      map.set(c.season, arr);
    }
    return map;
  }, [filtered]);

  // Grid tab has its own season+edition scope, independent of Dex's.
  const gridGrouped = useMemo(() => {
    if (!gridMintData) return new Map<string, ProgressCollection[]>();
    const bySeasonEdition = data.collections
      .map((c) => ({
        ...c,
        gridMintCount: gridMintData.counts[c.collectionId] ?? 0,
      }))
      .filter(
        (c) =>
          (gridActiveSeasons.length === 0 ||
            gridActiveSeasons.includes(c.season)) &&
          (gridActiveEditions.length === 0 ||
            gridActiveEditions.includes(
              editionByCollectionId.get(c.collectionId) as Edition,
            )),
      );
    const map = new Map<string, ProgressCollection[]>();
    for (const c of bySeasonEdition) {
      const arr = map.get(c.season) ?? [];
      arr.push(c);
      map.set(c.season, arr);
    }
    return map;
  }, [
    data,
    gridMintData,
    gridActiveSeasons,
    gridActiveEditions,
    editionByCollectionId,
  ]);

  // Whether the current Grid-tab filters leave any board renderable —
  // GridSection only draws a board for editions that have a First-class
  // collection, so a season/edition combo can be non-empty in gridGrouped
  // yet still draw nothing (e.g. an edition with only Special copies).
  const gridHasBoards = useMemo(() => {
    for (const cols of gridGrouped.values()) {
      if (cols.some((c) => c.class === "First")) return true;
    }
    return false;
  }, [gridGrouped]);

  const resetDexFilters = useCallback(() => {
    setDexActiveClasses([]);
    setDexActiveSeasons([]);
    setDexActiveEditions([]);
    setUnownedOnly(false);
    setOwnedOnly(false);
  }, []);

  const resetGridFilters = useCallback(() => {
    setGridActiveSeasons([]);
    setGridActiveEditions([]);
  }, []);

  // Header totals are always the member's full, unfiltered collection — they
  // shouldn't shift depending on which tab or filters are active.
  const totals = useMemo(() => {
    return countsForProgress(data.collections);
  }, [data]);

  const effectiveArtist = data.artist || earlyArtist;
  const effectiveHasEditions = hasEditions || guessedHasEditions;
  const displayTotals =
    displayOwnershipLoaded && tradabilityLoaded ? totals : earlyTotals;
  // Ownership and totals are two fetches but one perceived scan, so they share
  // a single status line and resolve into a single check.
  const scan = useScanComplete(
    !ownershipError && (!displayOwnershipLoaded || !displayTotals),
  );

  const [sharing, setSharing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Above this many cards the share image gets large/slow — warn first.
  const SHARE_WARN_THRESHOLD = 100;

  const doShare = useCallback(async () => {
    if (!displayOwnershipLoaded || !tradabilityLoaded) return;
    // Share the exact set on screen so the card follows every active Dex
    // filter (season, class, owned/unowned only).
    const shareCols = filtered;
    if (shareCols.length === 0) {
      toast.error("Nothing to share for this filter.");
      return;
    }
    setSharing(true);
    const toastId = `progress-card-${data.member}-${Date.now()}`;
    toast.loading(`Generating ${data.member} card…`, {
      id: toastId,
      description: "Loading objekts — you can keep browsing while this runs.",
    });
    try {
      const { owned, total } = countsForProgress(shareCols);

      // Subtitle carries the active artist + season (+ class) filter context.
      const artistLabel = data.artist === "artms" ? "ARTMS" : data.artist;
      const ownershipLabel = unownedOnly
        ? "Missing"
        : ownedOnly
          ? "Owned"
          : null;
      const seasonLabel =
        dexActiveSeasons.length === 0
          ? "All seasons"
          : dexActiveSeasons.join(", ");
      const classLabel =
        dexActiveClasses.length === 0 ? null : dexActiveClasses.join(", ");
      const subtitle = [artistLabel, seasonLabel, classLabel, ownershipLabel]
        .filter(Boolean)
        .join("  ·  ");

      const canvas = await renderProgressCardToCanvas(
        {
          username: data.nickname,
          title: data.member,
          subtitle,
          date: new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          }),
          owned,
          total,
          items: shareCols.map((c) => ({
            thumbnailImage: c.thumbnailImage,
            owned: c.ownedCount > 0,
          })),
          verifyHandle: data.nickname,
          strictImages: true,
          onProgress: (done, total) => {
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            toast.loading(`Generating ${data.member} card… ${pct}%`, {
              id: toastId,
              description: `Loaded ${done}/${total} objekts — you can keep browsing.`,
            });
          },
        },
        "dark",
      );
      toast.loading("Finishing card…", {
        id: toastId,
        description: "Almost there.",
      });
      const outcome = await shareOrDownloadCanvas(
        canvas,
        `${data.member}-progress-${Date.now()}.png`,
      );
      if (outcome === "shared")
        toast.success("Card shared!", { id: toastId, description: undefined });
      else if (outcome === "downloaded")
        toast.success("Card downloaded!", {
          id: toastId,
          description: undefined,
        });
      else toast.dismiss(toastId);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        toast.dismiss(toastId);
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Failed to generate progress card:", err);
      toast.error("Couldn't generate card", { id: toastId, description: msg });
    } finally {
      setSharing(false);
    }
  }, [
    data,
    filtered,
    dexActiveSeasons,
    dexActiveClasses,
    unownedOnly,
    ownedOnly,
    displayOwnershipLoaded,
    tradabilityLoaded,
  ]);

  const handleShare = useCallback(() => {
    if (filtered.length > SHARE_WARN_THRESHOLD) {
      setConfirmOpen(true);
      return;
    }
    void doShare();
  }, [filtered.length, doShare]);

  const _handleShareLink = useCallback(async () => {
    const token = Math.random().toString(36).slice(2, 8);
    const params = new URLSearchParams({ share: token });
    const url = sectionAbsoluteUrl(
      `/collection/${encodeURIComponent(nickname)}/${encodeURIComponent(member)}?${params}`,
    );
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy link");
    }
  }, [nickname, member]);

  const dexContent = (
    <div className="space-y-4">
      <SeasonChipRow
        seasons={allSeasons}
        active={dexActiveSeasons}
        artist={effectiveArtist}
        seasonColors={seasonColors}
        onToggle={(s) => setDexActiveSeasons((prev) => toggleValue(prev, s))}
        onClear={() => setDexActiveSeasons([])}
      />

      {allClasses.length > 0 && (
        <>
          <MobileMultiSelectDropdown
            label="Type"
            allLabel="All types"
            summaryAllLabel="All"
            active={dexActiveClasses}
            options={allClasses}
            onToggle={(cls) =>
              setDexActiveClasses((prev) => toggleValue(prev, cls))
            }
            onClear={() => setDexActiveClasses([])}
          />
          <div className="hidden flex-wrap gap-1.5 sm:flex">
            <button
              type="button"
              onClick={() => setDexActiveClasses([])}
              className={chipClass(dexActiveClasses.length === 0)}
            >
              All
            </button>
            {allClasses.map((cls) => (
              <button
                key={cls}
                type="button"
                onClick={() =>
                  setDexActiveClasses((prev) => toggleValue(prev, cls))
                }
                className={chipClass(dexActiveClasses.includes(cls))}
              >
                {cls}
              </button>
            ))}
          </div>
        </>
      )}

      {effectiveHasEditions && (
        <>
          <MobileMultiSelectDropdown
            label="Editions"
            allLabel="All editions"
            summaryAllLabel="All"
            active={dexActiveEditions}
            options={[1, 2, 3] as const}
            onToggle={(ed) =>
              setDexActiveEditions((prev) => toggleValue(prev, ed))
            }
            onClear={() => setDexActiveEditions([])}
            renderOption={(ed) => EDITION_LABELS[ed as Edition]}
          />
          <div className="hidden sm:block">
            <EditionChipRow
              active={dexActiveEditions}
              onToggle={(ed) =>
                setDexActiveEditions((prev) => toggleValue(prev, ed))
              }
              onClear={() => setDexActiveEditions([])}
            />
          </div>
        </>
      )}

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Unowned only</span>
          <Switch
            checked={unownedOnly}
            disabled={!displayOwnershipLoaded}
            onCheckedChange={(v) => {
              setUnownedOnly(v);
              if (v) setOwnedOnly(false);
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Owned only</span>
          <Switch
            checked={ownedOnly}
            disabled={!displayOwnershipLoaded}
            onCheckedChange={(v) => {
              setOwnedOnly(v);
              if (v) setUnownedOnly(false);
            }}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <LayoutGridIcon className="h-4 w-4" />
              {perRow} / row
              <ChevronDownIcon className="h-3.5 w-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={String(perRow)}
              onValueChange={(v) => setPerRow(Number(v))}
            >
              {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                <DropdownMenuRadioItem key={n} value={String(n)}>
                  {n} per row
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="sm"
          variant="outline"
          onClick={handleShare}
          disabled={
            sharing ||
            !displayOwnershipLoaded ||
            !tradabilityLoaded ||
            totals.total === 0
          }
          className="ml-auto gap-2"
        >
          {sharing ? (
            <Loader2Icon className="h-4 w-4 animate-spin" />
          ) : (
            <ShareIcon className="h-4 w-4" />
          )}
          Share card
        </Button>
      </div>

      <div className="space-y-8">
        {grouped.size === 0 ? (
          <EmptyFilterState onReset={resetDexFilters} />
        ) : (
          [...grouped.entries()].map(([season, cols]) => (
            <SeasonSection
              key={season}
              season={season}
              collections={cols}
              perRow={perRow}
              address={data.address}
              ownershipLoaded={displayOwnershipLoaded}
              tradabilityLoaded={tradabilityLoaded}
            />
          ))
        )}
      </div>
    </div>
  );

  const gridContent = (
    <div className="space-y-4">
      <SeasonChipRow
        seasons={gridAllSeasons}
        active={gridActiveSeasons}
        artist={effectiveArtist}
        seasonColors={seasonColors}
        onToggle={(s) => setGridActiveSeasons((prev) => toggleValue(prev, s))}
        onClear={() => setGridActiveSeasons([])}
      />

      <MobileMultiSelectDropdown
        label="Editions"
        allLabel="All editions"
        summaryAllLabel="All"
        active={gridActiveEditions}
        options={[1, 2, 3] as const}
        onToggle={(ed) =>
          setGridActiveEditions((prev) => toggleValue(prev, ed))
        }
        onClear={() => setGridActiveEditions([])}
        renderOption={(ed) => EDITION_LABELS[ed as Edition]}
      />

      <div className="hidden sm:block">
        <EditionChipRow
          active={gridActiveEditions}
          onToggle={(ed) =>
            setGridActiveEditions((prev) => toggleValue(prev, ed))
          }
          onClear={() => setGridActiveEditions([])}
        />
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Show Gridded</span>
          <Switch checked={viewConsumed} onCheckedChange={setViewConsumed} />
        </div>
      </div>

      <div className={cn("t-skel", gridMintData && "is-revealed")}>
        <div className="t-skel-skeleton is-pulsing space-y-8">
          <GridBoardsRowSkeleton />
        </div>
        <div className="t-skel-content space-y-8">
          {gridMintData &&
            (gridHasBoards ? (
              [...gridGrouped.entries()].map(([season, cols]) => (
                <GridSection
                  key={season}
                  member={member}
                  season={season}
                  collections={cols}
                  address={data.address}
                  nickname={data.nickname}
                  viewConsumed={viewConsumed}
                  ownershipLoaded={displayOwnershipLoaded}
                  tradabilityLoaded={tradabilityLoaded}
                />
              ))
            ) : (
              <EmptyFilterState onReset={resetGridFilters} />
            ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="max-w-xl">
        <ProgressSearch
          defaultNickname={data.nickname}
          showLabel={false}
          placeholder="Search another Cosmo username"
          buildHref={buildSameMemberHref}
          onNavigationChange={setSwitchingTo}
        />
      </div>

      <div className="space-y-0.5">
        <h1 className="text-lg font-bold sm:text-2xl">{data.member}</h1>
        {switchingTo ? (
          <ObjektScanStatus
            compact
            label={
              switchingTo.phase === "resolving"
                ? `Finding ${switchingTo.nickname}…`
                : `Opening ${switchingTo.nickname}'s collection…`
            }
          />
        ) : ownershipError ? (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Ownership temporarily unavailable
          </p>
        ) : scan.visible && !scan.exiting ? (
          // This slot has no skeleton to overlap — the count replaces the
          // status outright, so hand over as soon as the check has drawn
          // rather than sitting on a finished check through the exit phase.
          <ObjektScanStatus
            compact
            label={
              displayOwnershipLoaded
                ? "Checking collection totals…"
                : "Matching owned objekts…"
            }
            done={scan.done}
            longWait
          />
        ) : displayTotals ? (
          <div className="flex items-center gap-1 text-muted-foreground">
            <span>
              {displayTotals.owned}/{displayTotals.total} collected
            </span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <InfoIcon className="h-5 w-5 shrink-0 text-muted-foreground outline-none" />
                </TooltipTrigger>
                <TooltipContent className="max-w-72 text-xs">
                  <p className="font-md">Counted</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    <li>Collections with a tradable copy in circulation</li>
                  </ul>
                  <p className="mt-2 font-md">Not counted</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    <li>Welcome Class Objekts (WCO)</li>
                    <li>
                      Objekts with no tradable copy anywhere rewards that never
                      entered circulation
                    </li>
                  </ul>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        ) : null}
      </div>

      {!switchingTo && ownershipError && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          The catalog is still viewable. Try refreshing to check ownership
          again.
        </p>
      )}

      <div
        className={cn(
          "transition-[filter,opacity] duration-200 ease-in-out motion-reduce:transition-none",
          switchingTo && "pointer-events-none opacity-45 blur-sm select-none",
        )}
        aria-hidden={switchingTo ? true : undefined}
      >
        {effectiveHasEditions ? (
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "dex" | "grid")}
            className="gap-4"
          >
            <TabsList
              variant="line"
              className="-mx-1 h-auto w-full justify-start border-b border-border px-1 pb-0"
            >
              <TabsTrigger
                value="dex"
                className="rounded-none px-3 pb-3 text-lg font-bold text-foreground/75 data-[state=active]:after:opacity-100 group-data-[orientation=horizontal]/tabs:after:bottom-0 group-data-[orientation=horizontal]/tabs:after:h-1 after:rounded-full"
              >
                Collection
              </TabsTrigger>
              <TabsTrigger
                value="grid"
                className="rounded-none px-3 pb-3 text-lg font-bold text-foreground/75 data-[state=active]:after:opacity-100 group-data-[orientation=horizontal]/tabs:after:bottom-0 group-data-[orientation=horizontal]/tabs:after:h-1 after:rounded-full"
              >
                Grid
              </TabsTrigger>
            </TabsList>

            <TabsContent value="dex" className="pt-3 sm:pt-4">
              {dexContent}
            </TabsContent>
            <TabsContent value="grid" className="pt-3 sm:pt-4">
              {gridContent}
            </TabsContent>
          </Tabs>
        ) : (
          dexContent
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate a large card?</AlertDialogTitle>
            <AlertDialogDescription>
              This will render {filtered.length} objekts into one image. It may
              take a while and produce a large file. You can narrow the filters
              (season, class, owned/unowned) to make it smaller.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doShare()}>
              Generate anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
