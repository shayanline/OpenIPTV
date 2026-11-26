import type { FavouriteSnapshot } from "../stores/personal";
import { recordFromEntries } from "./record";
import type { Channel } from "../types";

/**
 * How the channel lists are built, and how channel up and down move through one.
 *
 * Both are arithmetic over lists, both were wrong in ways nothing on screen announced, and
 * both are pure, which is why they are here rather than inside a component: a mistake in
 * either shows up as the interface quietly going somewhere the viewer did not ask to go.
 */

export const FAVOURITES = "Favourites";
export const MAX_PERSONAL_CATEGORIES = 128;

export interface ChannelRef {
  id: string;
  sourceFingerprint?: string;
}

export interface OrderPlacement {
  itemId: string;
  beforeId?: string;
  afterId?: string;
}

export interface ChannelOverride {
  name?: string;
  number?: number;
  hidden?: boolean;
  sourceFingerprint?: string;
}

export interface CategoryOverride {
  name?: string;
  hidden?: boolean;
  itemOrderMode?: LineupOrderMode;
  itemOrder?: OrderPlacement[];
  channelOrder?: OrderPlacement[];
}

export interface PersonalCategory {
  id: string;
  name: string;
  channels: ChannelRef[];
}

export type LineupOrderMode = "provider" | "alphabetical" | "number" | "custom";
export type LineupSection = "live" | "movie" | "series";
export type SectionOrderModes = Record<LineupSection, LineupOrderMode>;
export type SectionOrders = Record<LineupSection, OrderPlacement[]>;

export interface LineupPersonalisation {
  channels: Record<string, ChannelOverride>;
  categories: Record<string, CategoryOverride>;
  categoryOrderModes: SectionOrderModes;
  categoryOrders: SectionOrders;
  personalCategories: PersonalCategory[];
  categoryOrder?: OrderPlacement[];
  orderMode?: LineupOrderMode;
}

export interface StoredLineupV1 {
  version: 1;
  revision: number;
  personalisation: LineupPersonalisation;
}

export interface ProviderCategory {
  key: string;
  name: string;
  kind: "live" | "movie" | "series";
  channels: readonly Channel[];
  count?: number;
}

export interface ProviderLineup {
  channels: readonly Channel[];
  categories: readonly ProviderCategory[];
}

export interface EffectiveCategory extends ProviderCategory {
  hidden: boolean;
  personal: boolean;
}

export interface ManagedChannel {
  ref: ChannelRef;
  providerName: string;
  providerNumber: number;
  effective: Channel;
  hidden: boolean;
  categoryKeys: string[];
}

export interface ManagedCategory {
  key: string;
  kind: "live" | "movie" | "series";
  providerName: string;
  name: string;
  hidden: boolean;
  personal: boolean;
  count?: number;
}

export type UnavailableRecord =
  | {
      key: string;
      kind: "channel-override";
      itemId: string;
      label: string;
      sourceFingerprint?: string;
    }
  | { key: string; kind: "category-override"; itemId: string; label: string }
  | {
      key: string;
      kind: "personal-membership";
      itemId: string;
      label: string;
      sourceFingerprint?: string;
      personalCategoryId: string;
    }
  | {
      key: string;
      kind: "channel-placement" | "category-placement";
      itemId: string;
      label: string;
      anchorId?: string;
    };

export interface LineupMaterialisation {
  channels: Channel[];
  categories: EffectiveCategory[];
  managedChannels: ManagedChannel[];
  managedCategories: ManagedCategory[];
  browsableChannels: Channel[];
  searchableChannels: Channel[];
  numberIndex: ReadonlyMap<number, Channel>;
  unavailable: UnavailableRecord[];
}

export interface ReconciliationResult {
  personalisation: LineupPersonalisation;
  unavailable: UnavailableRecord[];
  changed: boolean;
}

export const emptyPersonalisation = (): LineupPersonalisation => ({
  channels: {},
  categories: {},
  categoryOrderModes: { live: "provider", movie: "provider", series: "provider" },
  categoryOrders: { live: [], movie: [], series: [] },
  personalCategories: [],
});

/**
 * Move an index by one and come out the other side.
 *
 * Samsung's input guidance says the opposite: "Focus does not loop in a list. Thus, focus stops
 * moving when it reaches the first or last item in a list." That holds for focus, and it is what
 * the panel and the buttons do. Channel up is not focus: it wraps, on this app and on every
 * television ever made, and the channel keys and the arrows share one list, so stopping dead at
 * the end while the keys came round would be two ways of reaching the same channel disagreeing
 * about what happens at the end.
 */
export const wrap = (index: number, length: number) =>
  length < 1 ? 0 : ((index % length) + length) % length;

/**
 * Where the cursor in the channel column lands, with or without a search field above the rows.
 *
 * The field is index -1, so a searched column spans `-1` to `count - 1` and a category spans
 * `0` to `count - 1`.
 *
 * It clamps rather than wraps, because this is focus: Samsung's input guidance is explicit that
 * focus stops at the first and last item in a list. Channel up and down still wrap, through
 * `nextChannel`, because a channel key is not focus and never has been.
 */
export function stepColumn(index: number, delta: number, count: number, withField: boolean) {
  const low = withField ? -1 : 0;
  const high = Math.max(low, count - 1);
  return Math.max(low, Math.min(high, index + delta));
}

export interface ChannelList {
  key: string;
  name: string;
  channels: readonly Channel[];
  hidden?: boolean;
  synthetic?: "favourites";
}

export const isFavouritesList = (list: ChannelList | undefined) =>
  list?.synthetic === "favourites";

interface Visibility {
  hiddenCategories: readonly string[];
  hiddenChannels?: readonly string[];
  hideEmptyCategories?: boolean;
}

const VISIBLE: Visibility = {
  hiddenCategories: [],
  hiddenChannels: [],
};

/**
 * The playlist's own categories, with Favourites first while there is something in it.
 *
 * An empty row is a row that says nothing, and a rail that opens with one is a rail whose
 * first line is an apology. So it appears with the first favourite and goes with the last.
 *
 * That costs something, and the cost is paid in App: inserting a list at position zero moves
 * every category down by one, and a viewer who pressed the green key asked to favourite a
 * channel, not to be taken somewhere else. The green key is the only thing that can add or
 * remove this row, so it is the one place that corrects for it.
 */
export function lineupOf(
  channels: Channel[],
  categories: ChannelList[],
  favourites: readonly (string | FavouriteSnapshot)[],
  visibility: Visibility = VISIBLE,
): {
  lists: ChannelList[];
  browsableChannels: Channel[];
  searchableChannels: Channel[];
} {
  const hidden = new Set(visibility.hiddenCategories);
  for (const category of categories) {
    if (category.hidden) hidden.add(category.key);
  }
  const hiddenChannels = new Set(visibility.hiddenChannels ?? []);
  const browsableChannels = channels.filter(
    (channel) =>
      !hiddenChannels.has(channel.id) &&
      !hiddenChannels.has(channelRef(channel).id) &&
      !hidden.has(channel.xtream?.categoryKey ?? channel.categoryKey ?? channel.group),
  );
  const visibleCategories = categories
    .filter((category) => !category.hidden && !hidden.has(category.key))
    .map((category) => ({
      ...category,
      channels: category.channels.filter(
        (channel) =>
          !hiddenChannels.has(channel.id) && !hiddenChannels.has(channelRef(channel).id),
      ),
    }))
    .filter(
      (category) => visibility.hideEmptyCategories === false || category.channels.length > 0,
    );
  const searchableChannels = browsableChannels;
  const wanted = new Set(
    favourites.map((favourite) =>
      typeof favourite === "string" ? favourite : favourite.itemKey,
    ),
  );
  const mine = searchableChannels.filter((channel) => wanted.has(channel.id));
  const lists: ChannelList[] = mine.length
    ? [
        { key: "favourites", name: FAVOURITES, channels: mine, synthetic: "favourites" },
        ...visibleCategories,
      ]
    : visibleCategories;
  return { lists, browsableChannels, searchableChannels };
}

/**
 * Where channel up or down lands, given the channel playing now.
 *
 * It wraps, which Samsung's input guidance does not ask for in a list. That is deliberate:
 * channel up wraps on every television ever made, and the channel keys and this share one
 * list, so stopping dead at the end while the keys came round would be two ways of reaching
 * the same channel disagreeing about what happens at the end.
 *
 * Returns -1 when there is nowhere to go at all.
 *
 * The awkward case is a playing channel that is not in this list, which happens whenever the
 * viewer has changed category without choosing anything. Up should then land on the first
 * row and down on the last. The arithmetic used to treat "not found" as position zero, so up
 * went to the second channel and skipped the first.
 */
export function nextChannel(list: Channel[], playingId: string, delta: number): number {
  if (!list.length) return -1;
  const at = list.findIndex((c) => c.id === playingId);
  const from = at === -1 ? (delta > 0 ? -1 : 0) : at;
  return wrap(from + delta, list.length);
}

const objectValue = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const safeStoredId = (value: string) => !value.includes("://") && !value.startsWith("url:");

function parsePlacement(value: unknown): OrderPlacement | null {
  const item = objectValue(value);
  if (!item || !nonempty(item.itemId) || !safeStoredId(item.itemId)) return null;
  if (
    (nonempty(item.beforeId) && !safeStoredId(item.beforeId)) ||
    (nonempty(item.afterId) && !safeStoredId(item.afterId))
  ) {
    return null;
  }
  const beforeId =
    nonempty(item.beforeId) && safeStoredId(item.beforeId) ? item.beforeId : undefined;
  const afterId =
    nonempty(item.afterId) && safeStoredId(item.afterId) ? item.afterId : undefined;
  if (beforeId && afterId) return null;
  return {
    itemId: item.itemId,
    ...(beforeId ? { beforeId } : {}),
    ...(afterId ? { afterId } : {}),
  };
}

function parsePlacements(value: unknown): OrderPlacement[] {
  if (!Array.isArray(value)) return [];
  const placements = new Map<string, OrderPlacement>();
  for (const candidate of value) {
    const placement = parsePlacement(candidate);
    if (placement) placements.set(placement.itemId, placement);
  }
  return Array.from(placements.values());
}

function fingerprintValue(value: unknown): string | undefined {
  return nonempty(value) && /^[0-9a-f]{16}(?:[0-9a-f]{8})?$/.test(value) ? value : undefined;
}

function fingerprintIdentity(fingerprint: string) {
  return `m3u:${fingerprint}`;
}

function parseChannelRef(value: unknown): ChannelRef | null {
  const item = objectValue(value);
  if (!item || !nonempty(item.id)) return null;
  const sourceFingerprint = fingerprintValue(item.sourceFingerprint);
  if (!sourceFingerprint && !safeStoredId(item.id)) return null;
  return {
    id: sourceFingerprint ? fingerprintIdentity(sourceFingerprint) : item.id,
    ...(sourceFingerprint ? { sourceFingerprint } : {}),
  };
}

function parseChannelOverride(value: unknown): ChannelOverride | null {
  const item = objectValue(value);
  if (!item) return null;
  const result: ChannelOverride = {};
  if (nonempty(item.name)) result.name = item.name;
  if (typeof item.number === "number" && Number.isInteger(item.number) && item.number > 0) {
    result.number = item.number;
  }
  if (typeof item.hidden === "boolean") result.hidden = item.hidden;
  const sourceFingerprint = fingerprintValue(item.sourceFingerprint);
  if (sourceFingerprint) result.sourceFingerprint = sourceFingerprint;
  return Object.keys(result).length ? result : null;
}

function orderMode(value: unknown): LineupOrderMode {
  return value === "alphabetical" || value === "number" || value === "custom"
    ? value
    : "provider";
}

function parseCategoryOverride(value: unknown): CategoryOverride | null {
  const item = objectValue(value);
  if (!item) return null;
  const result: CategoryOverride = {};
  if (nonempty(item.name)) result.name = item.name;
  if (typeof item.hidden === "boolean") result.hidden = item.hidden;
  const itemOrder = parsePlacements(item.itemOrder ?? item.channelOrder);
  if (itemOrder.length) result.itemOrder = itemOrder;
  if (item.itemOrderMode !== undefined) result.itemOrderMode = orderMode(item.itemOrderMode);
  else if (itemOrder.length) result.itemOrderMode = "custom";
  return Object.keys(result).length ? result : null;
}

export function parseStoredLineup(value: unknown): StoredLineupV1 {
  const stored = objectValue(value);
  const source = objectValue(stored?.personalisation);
  const channels: Record<string, ChannelOverride> = {};
  const categories: Record<string, CategoryOverride> = {};
  const rawChannels = objectValue(source?.channels);
  const rawCategories = objectValue(source?.categories);
  if (rawChannels) {
    for (const [id, candidate] of Object.entries(rawChannels)) {
      if (!nonempty(id)) continue;
      const override = parseChannelOverride(candidate);
      if (override) {
        if (!override.sourceFingerprint && !safeStoredId(id)) continue;
        const safeId = override.sourceFingerprint
          ? fingerprintIdentity(override.sourceFingerprint)
          : id;
        channels[safeId] = override;
      }
    }
  }
  if (rawCategories) {
    for (const [key, candidate] of Object.entries(rawCategories)) {
      if (!nonempty(key) || key === "favourites") continue;
      const override = parseCategoryOverride(candidate);
      if (override) categories[key] = override;
    }
  }
  const personalCategories: PersonalCategory[] = [];
  if (Array.isArray(source?.personalCategories)) {
    for (const candidate of source.personalCategories) {
      if (personalCategories.length >= MAX_PERSONAL_CATEGORIES) break;
      const category = objectValue(candidate);
      if (!category || !nonempty(category.id) || !nonempty(category.name)) continue;
      if (
        category.id === "favourites" ||
        personalCategories.some((item) => item.id === category.id)
      ) {
        continue;
      }
      const channels: ChannelRef[] = [];
      if (Array.isArray(category.channels)) {
        for (const value of category.channels) {
          const reference = parseChannelRef(value);
          if (reference && !channels.some((item) => item.id === reference.id))
            channels.push(reference);
        }
      }
      personalCategories.push({ id: category.id, name: category.name, channels });
    }
  }
  const savedCategoryModes = objectValue(source?.categoryOrderModes);
  const savedCategoryOrders = objectValue(source?.categoryOrders);
  return {
    version: 1,
    revision:
      typeof stored?.revision === "number" &&
      Number.isInteger(stored.revision) &&
      stored.revision >= 0
        ? stored.revision
        : 0,
    personalisation: {
      channels,
      categories,
      categoryOrderModes: {
        live: orderMode(savedCategoryModes?.live ?? source?.orderMode),
        movie: orderMode(savedCategoryModes?.movie),
        series: orderMode(savedCategoryModes?.series),
      },
      categoryOrders: {
        live: parsePlacements(savedCategoryOrders?.live ?? source?.categoryOrder),
        movie: parsePlacements(savedCategoryOrders?.movie),
        series: parsePlacements(savedCategoryOrders?.series),
      },
      personalCategories,
      ...(source?.orderMode !== undefined ? { orderMode: orderMode(source.orderMode) } : {}),
    },
  };
}

export function channelRef(channel: Channel): ChannelRef {
  return {
    id: channel.sourceFingerprint ? fingerprintIdentity(channel.sourceFingerprint) : channel.id,
    ...(channel.sourceFingerprint ? { sourceFingerprint: channel.sourceFingerprint } : {}),
  };
}

export function personalCategoryKey(id: string): string {
  return `personal:${id}`;
}

export function applyPlacements<T>(
  source: readonly T[],
  placements: readonly OrderPlacement[],
  idOf: (item: T) => string,
): { items: T[]; unresolved: OrderPlacement[] } {
  const byItem = new Map<string, OrderPlacement>();
  for (const placement of placements) byItem.set(placement.itemId, placement);
  const items = source.slice();
  const unresolved: OrderPlacement[] = [];
  for (const placement of byItem.values()) {
    const itemIndex = items.findIndex((item) => idOf(item) === placement.itemId);
    if (itemIndex < 0) {
      unresolved.push(placement);
      continue;
    }
    const anchorId = placement.beforeId ?? placement.afterId;
    if (anchorId && !items.some((item) => idOf(item) === anchorId)) {
      unresolved.push(placement);
      continue;
    }
    const moved = items[itemIndex];
    items.splice(itemIndex, 1);
    if (!anchorId) {
      items.push(moved);
      continue;
    }
    const anchorIndex = items.findIndex((item) => idOf(item) === anchorId);
    items.splice(anchorIndex + (placement.afterId ? 1 : 0), 0, moved);
  }
  return { items, unresolved };
}

function fingerprintBase(value: string | undefined) {
  return value?.slice(0, 16);
}

export function reconcilePersonalisation(
  personalisation: LineupPersonalisation,
  catalogue: ProviderLineup,
): ReconciliationResult {
  const channelsByIdentity = new Map(
    catalogue.channels.map((channel) => [channelRef(channel).id, channel]),
  );
  const channelsByProviderId = new Map(
    catalogue.channels.map((channel) => [channel.id, channel]),
  );
  const channelsByFingerprint = new Map<string, Channel[]>();
  const channelsByFingerprintBase = new Map<string, Channel[]>();
  for (const channel of catalogue.channels) {
    if (!channel.sourceFingerprint) continue;
    const exact = channelsByFingerprint.get(channel.sourceFingerprint) ?? [];
    exact.push(channel);
    channelsByFingerprint.set(channel.sourceFingerprint, exact);
    const base = fingerprintBase(channel.sourceFingerprint);
    if (base) {
      const matches = channelsByFingerprintBase.get(base) ?? [];
      matches.push(channel);
      channelsByFingerprintBase.set(base, matches);
    }
  }
  const categoriesByKey = new Map(
    catalogue.categories.map((category) => [category.key, category]),
  );
  const categoryKeysByName = new Map<string, string[]>();
  for (const category of catalogue.categories) {
    const keys = categoryKeysByName.get(category.name) ?? [];
    keys.push(category.key);
    categoryKeysByName.set(category.name, keys);
  }
  const reseatedChannels = new Map<string, string>();
  for (const channel of catalogue.channels) {
    const identity = channelRef(channel).id;
    if (channel.id !== identity) reseatedChannels.set(channel.id, identity);
  }
  const reseatedCategories = new Map<string, string>();
  const unavailable: UnavailableRecord[] = [];
  const channels: Record<string, ChannelOverride> = {};
  const claimedChannels = new Set<string>();
  let changed = false;
  const resolveChannel = (id: string, sourceFingerprint?: string) => {
    const identityMatch = channelsByIdentity.get(id);
    if (identityMatch) return identityMatch;
    if (!sourceFingerprint) return channelsByProviderId.get(id);
    const exact = channelsByFingerprint.get(sourceFingerprint) ?? [];
    if (exact.length === 1) return exact[0];
    if (sourceFingerprint.length !== 16) return undefined;
    const matches =
      channelsByFingerprintBase.get(fingerprintBase(sourceFingerprint) ?? "") ?? [];
    return matches.length === 1 ? matches[0] : undefined;
  };
  const unavailableChannelLabel = (
    name: string | undefined,
    sourceFingerprint: string | undefined,
  ) =>
    name ||
    (sourceFingerprint ? `Channel ${sourceFingerprint.slice(0, 8)}` : "Unavailable channel");
  for (const [id, override] of Object.entries(personalisation.channels)) {
    const matched = resolveChannel(id, override.sourceFingerprint);
    const nextId = matched ? channelRef(matched).id : id;
    if (!matched || claimedChannels.has(nextId)) {
      unavailable.push({
        key: `channel-override:${id}`,
        kind: "channel-override",
        itemId: id,
        label: unavailableChannelLabel(override.name, override.sourceFingerprint),
        ...(override.sourceFingerprint
          ? { sourceFingerprint: override.sourceFingerprint }
          : {}),
      });
      channels[id] = override;
      continue;
    }
    claimedChannels.add(nextId);
    const nextOverride = {
      ...override,
      ...(matched.sourceFingerprint ? { sourceFingerprint: matched.sourceFingerprint } : {}),
    };
    if (nextId !== id || nextOverride.sourceFingerprint !== override.sourceFingerprint) {
      reseatedChannels.set(id, nextId);
      changed = true;
    }
    channels[nextId] = nextOverride;
  }
  const categories: Record<string, CategoryOverride> = {};
  for (const [key, override] of Object.entries(personalisation.categories)) {
    let nextKey = key;
    if (!categoriesByKey.has(key)) {
      const matches = categoryKeysByName.get(key) ?? [];
      if (matches.length === 1) nextKey = matches[0];
    }
    if (!categoriesByKey.has(nextKey) && !nextKey.startsWith("personal:")) {
      unavailable.push({
        key: `category-override:${key}`,
        kind: "category-override",
        itemId: key,
        label: override.name ?? key,
      });
    }
    if (nextKey !== key) {
      reseatedCategories.set(key, nextKey);
      changed = true;
    }
    const { channelOrder: _channelOrder, ...cleanOverride } = override;
    categories[nextKey] = {
      ...cleanOverride,
      ...(override.itemOrderMode || personalisation.orderMode
        ? { itemOrderMode: override.itemOrderMode ?? personalisation.orderMode }
        : {}),
      ...((override.itemOrder ?? override.channelOrder)
        ? {
            itemOrder: (override.itemOrder ?? override.channelOrder ?? []).map((placement) => {
              const itemId = reseatedChannels.get(placement.itemId) ?? placement.itemId;
              const beforeId = placement.beforeId
                ? (reseatedChannels.get(placement.beforeId) ?? placement.beforeId)
                : undefined;
              const afterId = placement.afterId
                ? (reseatedChannels.get(placement.afterId) ?? placement.afterId)
                : undefined;
              if (
                itemId !== placement.itemId ||
                beforeId !== placement.beforeId ||
                afterId !== placement.afterId
              ) {
                changed = true;
              }
              return {
                itemId,
                ...(beforeId ? { beforeId } : {}),
                ...(afterId ? { afterId } : {}),
              };
            }),
          }
        : {}),
    };
  }
  const personalCategories = personalisation.personalCategories.map((category) => {
    const references: ChannelRef[] = [];
    for (const reference of category.channels) {
      const matched = resolveChannel(reference.id, reference.sourceFingerprint);
      if (!matched) {
        unavailable.push({
          key: `personal-membership:${category.id}:${reference.id}`,
          kind: "personal-membership",
          itemId: reference.id,
          label: unavailableChannelLabel(undefined, reference.sourceFingerprint),
          ...(reference.sourceFingerprint
            ? { sourceFingerprint: reference.sourceFingerprint }
            : {}),
          personalCategoryId: category.id,
        });
        references.push(reference);
        continue;
      }
      const next = channelRef(matched);
      if (next.id !== reference.id || next.sourceFingerprint !== reference.sourceFingerprint) {
        reseatedChannels.set(reference.id, next.id);
        changed = true;
      }
      if (!references.some((item) => item.id === next.id)) references.push(next);
    }
    return { ...category, channels: references };
  });
  const categoryOrders = recordFromEntries(
    (["live", "movie", "series"] as const).map(
      (section) =>
        [
          section,
          (section === "live" && personalisation.categoryOrder
            ? personalisation.categoryOrder
            : personalisation.categoryOrders[section]
          ).map((placement) => {
            const itemId = reseatedCategories.get(placement.itemId) ?? placement.itemId;
            const beforeId = placement.beforeId
              ? (reseatedCategories.get(placement.beforeId) ?? placement.beforeId)
              : undefined;
            const afterId = placement.afterId
              ? (reseatedCategories.get(placement.afterId) ?? placement.afterId)
              : undefined;
            if (
              itemId !== placement.itemId ||
              beforeId !== placement.beforeId ||
              afterId !== placement.afterId
            ) {
              changed = true;
            }
            return {
              itemId,
              ...(beforeId ? { beforeId } : {}),
              ...(afterId ? { afterId } : {}),
            };
          }),
        ] as const,
    ),
  ) as SectionOrders;
  return {
    personalisation: {
      channels,
      categories,
      categoryOrderModes: {
        ...personalisation.categoryOrderModes,
        ...(personalisation.orderMode ? { live: personalisation.orderMode } : {}),
      },
      categoryOrders,
      personalCategories,
    },
    unavailable,
    changed,
  };
}

export function naturalCompare(left: string, right: string, locale: string): number {
  const a = left.toLocaleLowerCase(locale);
  const b = right.toLocaleLowerCase(locale);
  let ai = 0;
  let bi = 0;
  while (ai < a.length && bi < b.length) {
    const aDigit = a.charCodeAt(ai) >= 48 && a.charCodeAt(ai) <= 57;
    const bDigit = b.charCodeAt(bi) >= 48 && b.charCodeAt(bi) <= 57;
    let ae = ai + 1;
    let be = bi + 1;
    while (ae < a.length && (a.charCodeAt(ae) >= 48 && a.charCodeAt(ae) <= 57) === aDigit)
      ae += 1;
    while (be < b.length && (b.charCodeAt(be) >= 48 && b.charCodeAt(be) <= 57) === bDigit)
      be += 1;
    let av = a.slice(ai, ae);
    let bv = b.slice(bi, be);
    if (aDigit && bDigit) {
      av = av.replace(/^0+/, "") || "0";
      bv = bv.replace(/^0+/, "") || "0";
      if (av.length !== bv.length) return av.length - bv.length;
    }
    if (av !== bv) return av < bv ? -1 : 1;
    ai = ae;
    bi = be;
  }
  if (ai !== a.length || bi !== b.length) return a.length - b.length;
  return left === right ? 0 : left < right ? -1 : 1;
}

export function orderedItems<T>(
  items: readonly T[],
  mode: LineupOrderMode,
  locale: string,
  placements: readonly OrderPlacement[],
  idOf: (item: T) => string,
  nameOf: (item: T) => string,
  numberOf?: (item: T) => number,
) {
  if (mode === "provider" || (mode === "number" && !numberOf)) return items.slice();
  if (mode === "alphabetical") {
    return items
      .slice()
      .sort((left, right) => naturalCompare(nameOf(left), nameOf(right), locale));
  }
  if (mode === "number" && numberOf) {
    return items
      .map((item, index) => ({ item, index }))
      .sort(
        (left, right) => numberOf(left.item) - numberOf(right.item) || left.index - right.index,
      )
      .map((entry) => entry.item);
  }
  return applyPlacements(items, placements, idOf).items;
}

function orderedChannels(
  channels: readonly Channel[],
  mode: LineupOrderMode,
  locale: string,
  placements: readonly OrderPlacement[],
) {
  return orderedItems(
    channels,
    mode,
    locale,
    placements,
    (channel) => channelRef(channel).id,
    (channel) => channel.name,
    (channel) => channel.number,
  );
}

export function materialiseLineup(
  catalogue: ProviderLineup,
  input: LineupPersonalisation,
  locale: string,
  reconciled = reconcilePersonalisation(input, catalogue),
): LineupMaterialisation {
  const personalisation = reconciled.personalisation;
  const effectiveById = new Map<string, Channel>();
  const effectiveByRef = new Map<string, Channel>();
  const hiddenChannels = new Set<string>();
  for (const provider of catalogue.channels) {
    const override = personalisation.channels[channelRef(provider).id];
    const effective = {
      ...provider,
      ...(override?.name ? { name: override.name } : {}),
      ...(override?.number ? { number: override.number } : {}),
    };
    effectiveById.set(provider.id, effective);
    effectiveByRef.set(channelRef(provider).id, effective);
    if (override?.hidden) hiddenChannels.add(provider.id);
  }
  const providerCategories: EffectiveCategory[] = catalogue.categories.map((provider) => {
    const override = personalisation.categories[provider.key];
    const channels = provider.channels
      .map((channel) => effectiveById.get(channel.id))
      .filter((channel): channel is Channel => channel !== undefined);
    return {
      ...provider,
      name: override?.name ?? provider.name,
      channels: orderedChannels(
        channels,
        override?.itemOrderMode ?? "provider",
        locale,
        override?.itemOrder ?? [],
      ),
      hidden: override?.hidden ?? false,
      personal: false,
    };
  });
  const personalCategories: EffectiveCategory[] = personalisation.personalCategories.map(
    (personal) => {
      const key = personalCategoryKey(personal.id);
      const override = personalisation.categories[key];
      const channels = personal.channels
        .map((reference) => effectiveByRef.get(reference.id))
        .filter((channel): channel is Channel => channel !== undefined);
      return {
        key,
        name: override?.name ?? personal.name,
        kind: "live",
        channels: orderedChannels(
          channels,
          override?.itemOrderMode ?? "provider",
          locale,
          override?.itemOrder ?? [],
        ),
        hidden: override?.hidden ?? false,
        personal: true,
      };
    },
  );
  const allCategories = [...providerCategories, ...personalCategories];
  const categoryPlacements = (["live", "movie", "series"] as const).map((section) => {
    const source = allCategories.filter((category) => category.kind === section);
    const placements = personalisation.categoryOrders[section];
    return {
      section,
      result: applyPlacements(source, placements, (category) => category.key),
      items: orderedItems(
        source,
        personalisation.categoryOrderModes[section],
        locale,
        placements,
        (category) => category.key,
        (category) => category.name,
      ),
    };
  });
  const categories = categoryPlacements.flatMap((entry) => entry.items);
  const hiddenCategoryKeys = new Set(
    categories.filter((category) => category.hidden).map((category) => category.key),
  );
  const providerCategoryByChannel = new Map<string, string[]>();
  for (const category of providerCategories) {
    for (const channel of category.channels) {
      const keys = providerCategoryByChannel.get(channel.id) ?? [];
      keys.push(category.key);
      providerCategoryByChannel.set(channel.id, keys);
    }
  }
  const effectiveChannels = catalogue.channels
    .map((channel) => effectiveById.get(channel.id))
    .filter((channel): channel is Channel => channel !== undefined);
  const channels = input.orderMode
    ? orderedChannels(effectiveChannels, input.orderMode, locale, [])
    : effectiveChannels;
  const browsableChannels = channels.filter((channel) => {
    if (hiddenChannels.has(channel.id)) return false;
    const keys = providerCategoryByChannel.get(channel.id) ?? [];
    return !keys.some((key) => hiddenCategoryKeys.has(key));
  });
  const searchableChannels = browsableChannels;
  const numberIndex = new Map<number, Channel>();
  const browsableIds = new Set(browsableChannels.map((channel) => channel.id));
  for (const provider of catalogue.channels) {
    const channel = effectiveById.get(provider.id);
    if (channel && browsableIds.has(channel.id) && !numberIndex.has(channel.number)) {
      numberIndex.set(channel.number, channel);
    }
  }
  const managedCategoryByChannel = new Map<string, string[]>();
  for (const [id, keys] of providerCategoryByChannel)
    managedCategoryByChannel.set(id, keys.slice());
  for (const category of personalCategories) {
    for (const channel of category.channels) {
      const keys = managedCategoryByChannel.get(channel.id) ?? [];
      keys.push(category.key);
      managedCategoryByChannel.set(channel.id, keys);
    }
  }
  const providerById = new Map(catalogue.channels.map((channel) => [channel.id, channel]));
  const managedChannels = channels.map((channel) => {
    const provider = providerById.get(channel.id);
    return {
      ref: channelRef(channel),
      providerName: provider?.name ?? channel.name,
      providerNumber: provider?.number ?? channel.number,
      effective: channel,
      hidden: hiddenChannels.has(channel.id),
      categoryKeys: managedCategoryByChannel.get(channel.id) ?? [],
    };
  });
  const providerCategoryByKey = new Map(
    catalogue.categories.map((category) => [category.key, category]),
  );
  const managedCategories = categories.map((category) => {
    const provider = providerCategoryByKey.get(category.key);
    const count = category.kind === "live" ? category.channels.length : provider?.count;
    return {
      key: category.key,
      kind: category.kind,
      providerName: provider?.name ?? category.name,
      name: category.name,
      hidden: category.hidden,
      personal: category.personal,
      ...(count !== undefined ? { count } : {}),
    };
  });
  const unavailable = reconciled.unavailable.slice();
  for (const entry of categoryPlacements) {
    for (const placement of entry.result.unresolved) {
      unavailable.push({
        key: `category-placement:${entry.section}:${placement.itemId}`,
        kind: "category-placement",
        itemId: placement.itemId,
        label: placement.itemId,
        ...(placement.beforeId || placement.afterId
          ? { anchorId: placement.beforeId ?? placement.afterId }
          : {}),
      });
    }
  }
  for (const category of categories) {
    if (category.kind !== "live") continue;
    const placements = personalisation.categories[category.key]?.itemOrder ?? [];
    const result = applyPlacements(
      category.channels,
      placements,
      (channel) => channelRef(channel).id,
    );
    for (const placement of result.unresolved) {
      unavailable.push({
        key: `channel-placement:${category.key}:${placement.itemId}`,
        kind: "channel-placement",
        itemId: placement.itemId,
        label: placement.itemId,
        ...(placement.beforeId || placement.afterId
          ? { anchorId: placement.beforeId ?? placement.afterId }
          : {}),
      });
    }
  }
  return {
    channels,
    categories,
    managedChannels,
    managedCategories,
    browsableChannels,
    searchableChannels,
    numberIndex,
    unavailable,
  };
}
