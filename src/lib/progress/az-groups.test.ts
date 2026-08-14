import assert from "node:assert/strict";
import test from "node:test";
import { groupAzVariants } from "./az-groups";

function collection(collectionNo: string, season = "Atom01") {
  return {
    collectionNo,
    season,
    id: `${season}-${collectionNo}`,
    onOffline: collectionNo.toUpperCase().endsWith("A") ? "offline" : "online",
  };
}

test("an A/Z pair folds into one group", () => {
  const groups = groupAzVariants([collection("101A"), collection("101Z")]);

  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0]?.variants.map((variant) => variant.collectionNo).sort(),
    ["101A", "101Z"],
  );
});

test("the Z twin represents the group, so rollups bucket it as online", () => {
  const groups = groupAzVariants([collection("101A"), collection("101Z")]);

  assert.equal(groups[0]?.representative.collectionNo, "101Z");
  assert.equal(groups[0]?.representative.onOffline, "online");
});

test("a lone A represents its own group and keeps its offline bucket", () => {
  const groups = groupAzVariants([collection("201A")]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.representative.collectionNo, "201A");
  assert.equal(groups[0]?.representative.onOffline, "offline");
});

test("the same collectionNo in different seasons stays separate", () => {
  const groups = groupAzVariants([
    collection("101Z", "Atom01"),
    collection("101Z", "Binary01"),
  ]);

  assert.equal(groups.length, 2);
});

test("a suffixless collectionNo groups alone", () => {
  const groups = groupAzVariants([collection("301"), collection("302")]);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups.flatMap((group) => group.variants).length, 2);
});

test("every input row lands in exactly one group's variants", () => {
  const rows = [
    collection("101A"),
    collection("101Z"),
    collection("102Z"),
    collection("201A"),
    collection("301"),
  ];

  const grouped = groupAzVariants(rows).flatMap((group) => group.variants);

  assert.equal(grouped.length, rows.length);
  assert.deepEqual(new Set(grouped).size, rows.length);
});

test("owning either twin counts the card once, so owned cannot exceed total", () => {
  // The 535/500 regression: A and Z were counted as two owned cards against a
  // deduped total of one.
  const catalog = [
    collection("101A"),
    collection("101Z"),
    collection("102A"),
    collection("102Z"),
  ];
  const ownedIds = new Set(catalog.map((c) => c.id));

  const groups = groupAzVariants(catalog);
  const total = groups.length;
  const owned = groups.filter((group) =>
    group.variants.some((variant) => ownedIds.has(variant.id)),
  ).length;

  assert.equal(total, 2);
  assert.equal(owned, 2);
  assert.ok(owned <= total, `owned (${owned}) exceeded total (${total})`);
});

test("owning only the offline twin still counts the card as collected", () => {
  const groups = groupAzVariants([collection("101A"), collection("101Z")]);
  const ownedIds = new Set(["Atom01-101A"]);

  const owned = groups.filter((group) =>
    group.variants.some((variant) => ownedIds.has(variant.id)),
  ).length;

  assert.equal(owned, 1);
});
