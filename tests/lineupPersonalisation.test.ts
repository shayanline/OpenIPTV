import assert from "node:assert/strict";
import { test } from "vitest";
import {
  applyPlacements,
  channelRef,
  emptyPersonalisation,
  materialiseLineup,
  naturalCompare,
  parseStoredLineup,
  personalCategoryKey,
  reconcilePersonalisation,
  type LineupPersonalisation,
  type ProviderLineup,
} from "../src/services/lineup";
import type { Channel } from "../src/types";

const channel = (id: string, name: string, number: number, group = "News"): Channel => ({
  id,
  name,
  number,
  group,
  categoryKey: group,
  logo: "",
  quality: "",
  url: `http://example.invalid/${id}`,
  sourceFingerprint: `${id.padEnd(16, "0").slice(0, 16)}`,
});

const alpha = channel("a", "Provider News 10", 10);
const beta = channel("b", "Provider News 2", 2);
const gamma = channel("c", "Provider News 3", 3, "Sport");

const provider = (): ProviderLineup => ({
  channels: [alpha, beta, gamma],
  categories: [
    { key: "News", name: "News", kind: "live", channels: [alpha, beta] },
    { key: "Sport", name: "Sport", kind: "live", channels: [gamma] },
  ],
});

const personalised = (change: Partial<LineupPersonalisation>): LineupPersonalisation => ({
  ...emptyPersonalisation(),
  ...change,
});

test("managed VOD category counts preserve provider totals and distinguish unknown from zero", () => {
  const catalogue: ProviderLineup = {
    ...provider(),
    categories: [
      ...provider().categories,
      { key: "movie:1", name: "Films", kind: "movie", channels: [], count: 12 },
      { key: "movie:2", name: "Empty films", kind: "movie", channels: [], count: 0 },
      { key: "series:1", name: "Shows", kind: "series", channels: [] },
    ],
  };
  const result = materialiseLineup(catalogue, emptyPersonalisation(), "en");
  const byKey = new Map(result.managedCategories.map((category) => [category.key, category]));
  assert.equal(byKey.get("News")?.count, 2);
  assert.equal(byKey.get("Sport")?.count, 1);
  assert.equal(byKey.get("movie:1")?.count, 12);
  assert.equal(byKey.get("movie:2")?.count, 0);
  assert.equal(byKey.get("series:1")?.count, undefined);
});

test("placements support before, after, end and replacement", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(
    applyPlacements(items, [{ itemId: "c", beforeId: "a" }], (item) => item.id).items.map(
      (item) => item.id,
    ),
    ["c", "a", "b"],
  );
  assert.deepEqual(
    applyPlacements(items, [{ itemId: "a", afterId: "b" }], (item) => item.id).items.map(
      (item) => item.id,
    ),
    ["b", "a", "c"],
  );
  assert.deepEqual(
    applyPlacements(items, [{ itemId: "a" }], (item) => item.id).items.map((item) => item.id),
    ["b", "c", "a"],
  );
  assert.deepEqual(
    applyPlacements(
      items,
      [
        { itemId: "a", beforeId: "b" },
        { itemId: "a", afterId: "c" },
      ],
      (item) => item.id,
    ).items.map((item) => item.id),
    ["b", "c", "a"],
  );
});

test("a missing item or anchor leaves provider order and reports the placement", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const placements = [
    { itemId: "b", beforeId: "gone" },
    { itemId: "missing", afterId: "a" },
  ];
  const result = applyPlacements(items, placements, (item) => item.id);
  assert.deepEqual(
    result.items.map((item) => item.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(result.unresolved, placements);
});

test("a placement applies again when its missing anchor returns", () => {
  const placement = [{ itemId: "c", beforeId: "b" }];
  const absent = applyPlacements([{ id: "a" }, { id: "c" }], placement, (item) => item.id);
  assert.deepEqual(
    absent.items.map((item) => item.id),
    ["a", "c"],
  );
  assert.deepEqual(absent.unresolved, placement);
  const returned = applyPlacements(
    [{ id: "a" }, { id: "b" }, { id: "c" }],
    placement,
    (item) => item.id,
  );
  assert.deepEqual(
    returned.items.map((item) => item.id),
    ["a", "c", "b"],
  );
  assert.deepEqual(returned.unresolved, []);
});

test("stored records merge defaults, retain known fields and cap personal categories", () => {
  const stored = parseStoredLineup({
    version: 1,
    revision: 3,
    personalisation: {
      channels: { a: { name: "Mine", number: 8, ignored: "value" }, empty: {} },
      categories: { favourites: { hidden: true }, News: { hidden: true } },
      personalCategories: Array.from({ length: 129 }, (_, index) => ({
        id: String(index),
        name: `List ${index}`,
        channels: [],
      })),
      orderMode: "custom",
      ignored: true,
    },
  });
  assert.equal(stored.revision, 3);
  assert.deepEqual(stored.personalisation.channels, { a: { name: "Mine", number: 8 } });
  assert.deepEqual(stored.personalisation.categories, { News: { hidden: true } });
  assert.equal(stored.personalisation.personalCategories.length, 128);
  assert.equal(stored.personalisation.orderMode, "custom");
});

test("stored personal memberships dedupe safe fingerprint identities", () => {
  const stored = parseStoredLineup({
    version: 1,
    revision: 1,
    personalisation: {
      personalCategories: [
        {
          id: "mine",
          name: "Mine",
          channels: [
            {
              id: "url:http://user:secret@example.invalid/live",
              sourceFingerprint: "0123456789abcdef",
            },
            { id: "another", sourceFingerprint: "0123456789abcdef" },
          ],
        },
      ],
    },
  });
  assert.deepEqual(stored.personalisation.personalCategories[0].channels, [
    { id: "m3u:0123456789abcdef", sourceFingerprint: "0123456789abcdef" },
  ]);
  assert.equal(JSON.stringify(stored).includes("secret"), false);
});

test("materialisation applies sparse names, numbers, categories and visibility without provider mutation", () => {
  const frozenAlpha = Object.freeze({ ...alpha });
  const catalogue: ProviderLineup = {
    channels: [frozenAlpha, beta, gamma],
    categories: [{ key: "News", name: "News", kind: "live", channels: [frozenAlpha, beta] }],
  };
  const result = materialiseLineup(
    catalogue,
    personalised({
      channels: {
        [channelRef(alpha).id]: {
          name: "My News",
          number: 801,
          sourceFingerprint: alpha.sourceFingerprint,
        },
        [channelRef(beta).id]: { hidden: true, sourceFingerprint: beta.sourceFingerprint },
      },
      categories: { News: { name: "Headlines" } },
    }),
    "en",
  );
  assert.equal(result.channels[0].name, "My News");
  assert.equal(result.channels[0].number, 801);
  assert.equal(result.categories[0].name, "Headlines");
  assert.deepEqual(
    result.browsableChannels.map((item) => item.id),
    ["a", "c"],
  );
  assert.equal(frozenAlpha.name, "Provider News 10");
  assert.equal(Object.isFrozen(frozenAlpha), true);
});

test("the natural comparator orders digit runs without newer runtime methods", () => {
  assert.equal(naturalCompare("News 2", "News 10", "en") < 0, true);
});

test("provider, alphabetical, number and custom modes retain stable ties", () => {
  assert.deepEqual(
    materialiseLineup(provider(), emptyPersonalisation(), "en").channels.map((item) => item.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    materialiseLineup(
      provider(),
      personalised({ orderMode: "alphabetical" }),
      "en",
    ).channels.map((item) => item.id),
    ["b", "c", "a"],
  );
  assert.deepEqual(
    materialiseLineup(provider(), personalised({ orderMode: "number" }), "en").channels.map(
      (item) => item.id,
    ),
    ["b", "c", "a"],
  );
  assert.deepEqual(
    materialiseLineup(
      provider(),
      personalised({
        orderMode: "custom",
        categories: { News: { channelOrder: [{ itemId: "b", beforeId: "a" }] } },
      }),
      "en",
    ).categories[0].channels.map((item) => item.id),
    ["b", "a"],
  );
});

test("personal categories preserve explicit membership and remain additional views", () => {
  const result = materialiseLineup(
    provider(),
    personalised({
      personalCategories: [
        { id: "mine", name: "Mine", channels: [channelRef(beta), channelRef(alpha)] },
      ],
    }),
    "en",
  );
  const personal = result.categories.find((item) => item.key === personalCategoryKey("mine"));
  assert.deepEqual(
    personal?.channels.map((item) => item.id),
    ["b", "a"],
  );
  assert.deepEqual(
    result.categories[0].channels.map((item) => item.id),
    ["a", "b"],
  );
});

test("hidden categories are excluded from browsing and search", () => {
  const result = materialiseLineup(
    provider(),
    personalised({ categories: { News: { hidden: true } } }),
    "en",
  );
  assert.deepEqual(
    result.browsableChannels.map((item) => item.id),
    ["c"],
  );
  assert.deepEqual(
    result.searchableChannels.map((item) => item.id),
    ["c"],
  );
});

test("number index excludes hidden content and keeps the first provider duplicate", () => {
  const duplicate = { ...gamma, number: 2 };
  const catalogue: ProviderLineup = {
    channels: [alpha, beta, duplicate],
    categories: provider().categories,
  };
  const result = materialiseLineup(
    catalogue,
    personalised({ orderMode: "alphabetical" }),
    "en",
  );
  assert.equal(result.numberIndex.get(2)?.id, "b");
  assert.equal(result.numberIndex.size, 2);
});

test("full fingerprint matching precedes unique base fallback", () => {
  const exact = { ...alpha, id: "new-a", sourceFingerprint: "0123456789abcdef00000002" };
  const exactResult = reconcilePersonalisation(
    personalised({
      channels: { old: { name: "Mine", sourceFingerprint: exact.sourceFingerprint } },
    }),
    { channels: [exact], categories: [] },
  );
  assert.equal(exactResult.personalisation.channels[channelRef(exact).id].name, "Mine");

  const movedOccurrence = { ...exact, sourceFingerprint: "0123456789abcdef00000003" };
  const fallback = reconcilePersonalisation(
    personalised({
      channels: { old: { name: "Base", sourceFingerprint: "0123456789abcdef" } },
    }),
    { channels: [movedOccurrence], categories: [] },
  );
  assert.equal(fallback.personalisation.channels[channelRef(movedOccurrence).id].name, "Base");
});

test("an occurrence suffix never falls back and duplicate claims remain unavailable", () => {
  const current = { ...alpha, id: "new-a", sourceFingerprint: "0123456789abcdef" };
  const staleOccurrence = personalised({
    channels: { old: { name: "Second", sourceFingerprint: "0123456789abcdef00000002" } },
  });
  const unavailable = reconcilePersonalisation(staleOccurrence, {
    channels: [current],
    categories: [],
  });
  assert.equal(unavailable.unavailable[0].kind, "channel-override");

  const duplicateClaims = reconcilePersonalisation(
    personalised({
      channels: {
        first: { name: "First", sourceFingerprint: current.sourceFingerprint },
        second: { name: "Second", sourceFingerprint: current.sourceFingerprint },
      },
    }),
    { channels: [current], categories: [] },
  );
  assert.equal(duplicateClaims.unavailable.length, 1);
  assert.equal(duplicateClaims.personalisation.channels[channelRef(current).id].name, "First");
});

test("personal memberships reseat uniquely and retain ambiguous references", () => {
  const current = { ...alpha, id: "new-a", sourceFingerprint: "0123456789abcdef" };
  const unique = reconcilePersonalisation(
    personalised({
      personalCategories: [
        {
          id: "mine",
          name: "Mine",
          channels: [{ id: "old", sourceFingerprint: current.sourceFingerprint }],
        },
      ],
    }),
    { channels: [current], categories: [] },
  );
  assert.deepEqual(unique.personalisation.personalCategories[0].channels, [
    channelRef(current),
  ]);

  const ambiguous = reconcilePersonalisation(
    personalised({
      personalCategories: [
        {
          id: "mine",
          name: "Mine",
          channels: [{ id: "old", sourceFingerprint: "0123456789abcdef" }],
        },
      ],
    }),
    {
      channels: [
        { ...current, sourceFingerprint: "0123456789abcdef00000002" },
        { ...current, id: "other", sourceFingerprint: "0123456789abcdef00000003" },
      ],
      categories: [],
    },
  );
  assert.equal(ambiguous.unavailable[0].kind, "personal-membership");
});

test("unavailable channel labels and persisted ids never expose source credentials", () => {
  const parsed = parseStoredLineup({
    version: 1,
    revision: 1,
    personalisation: {
      channels: {
        "url:http://viewer:secret@example.invalid/live": {
          name: "",
          hidden: true,
          sourceFingerprint: "0123456789abcdef",
        },
      },
    },
  });
  const result = reconcilePersonalisation(parsed.personalisation, {
    channels: [],
    categories: [],
  });
  assert.equal(result.unavailable[0].label, "Channel 01234567");
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(JSON.stringify(result.personalisation).includes("http://"), false);
});

test("category reconciliation uses one exact display match and retains ambiguity", () => {
  const overlay = personalised({ categories: { Old: { name: "Mine" } } });
  const unique = reconcilePersonalisation(overlay, {
    channels: [],
    categories: [{ key: "new", name: "Old", kind: "live", channels: [] }],
  });
  assert.equal(unique.personalisation.categories.new.name, "Mine");
  const ambiguous = reconcilePersonalisation(overlay, {
    channels: [],
    categories: [
      { key: "one", name: "Old", kind: "live", channels: [] },
      { key: "two", name: "Old", kind: "movie", channels: [] },
    ],
  });
  assert.equal(ambiguous.unavailable[0].kind, "category-override");
});
