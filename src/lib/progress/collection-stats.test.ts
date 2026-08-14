import assert from "node:assert/strict";
import test, { after } from "node:test";
import { redis } from "@/lib/redis";
import {
  type CollectionStatsSnapshot,
  getCollectionTradability,
  hasTradableCopy,
} from "./collection-stats";

// collection-stats.ts imports the shared ioredis client, which connects
// eagerly on import and would otherwise keep the test runner alive
// indefinitely after these (pure, network-free) assertions finish.
after(() => {
  redis.disconnect();
});

const exactSnapshot: CollectionStatsSnapshot = {
  mode: "exact",
  byId: new Map([
    ["tradable", { totalCount: 10, tradableCount: 3 }],
    ["untradable", { totalCount: 5, tradableCount: 0 }],
  ]),
};

const unfilteredSnapshot: CollectionStatsSnapshot = {
  mode: "unfiltered",
  byId: new Map(),
};

test("exact mode: a collection with a tradable copy counts as tradable", () => {
  assert.equal(hasTradableCopy(exactSnapshot, "tradable"), true);
});

test("exact mode: a collection with zero tradable copies does not count", () => {
  assert.equal(hasTradableCopy(exactSnapshot, "untradable"), false);
});

test("exact mode: a collection missing from the sheet (newly minted since last refresh) does not count", () => {
  assert.equal(hasTradableCopy(exactSnapshot, "newly-minted"), false);
});

test("unfiltered mode: every collection counts as tradable when the sheet is absent", () => {
  assert.equal(hasTradableCopy(unfilteredSnapshot, "anything"), true);
});

test("exact mode: raw counts come straight from the sheet", () => {
  assert.deepEqual(getCollectionTradability(exactSnapshot, "tradable"), {
    totalCount: 10,
    tradableCount: 3,
  });
});

test("exact mode: a missing collection reports real zeroes, not the unknown sentinel", () => {
  assert.deepEqual(getCollectionTradability(exactSnapshot, "newly-minted"), {
    totalCount: 0,
    tradableCount: 0,
  });
});

test("unfiltered mode: counts report the -1 unknown sentinel, not zero", () => {
  const counts = getCollectionTradability(unfilteredSnapshot, "anything");
  assert.equal(counts.totalCount, -1);
  assert.equal(counts.tradableCount, -1);
});

test("owned never exceeds total once both sides apply the same tradability filter", () => {
  const allCollectionIds = ["tradable", "untradable", "newly-minted"];
  const ownedCollectionIds = ["tradable", "untradable", "newly-minted"];

  for (const snapshot of [exactSnapshot, unfilteredSnapshot]) {
    const total = allCollectionIds.filter((id) =>
      hasTradableCopy(snapshot, id),
    ).length;
    const owned = ownedCollectionIds.filter((id) =>
      hasTradableCopy(snapshot, id),
    ).length;
    assert.ok(
      owned <= total,
      `owned (${owned}) exceeded total (${total}) in ${snapshot.mode} mode`,
    );
  }
});
