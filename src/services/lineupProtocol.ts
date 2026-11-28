import {
  isCustomUnavailable,
  type LineupController,
  type LineupLibraryItem,
  type LineupMutation,
  type LineupMutationResult,
  type LineupQuery,
  type LineupQueryResult,
} from "../stores/lineup";
import { useSettings } from "../stores/settings";
import { resolveLocale } from "./locale";
import { CUSTOM_CATEGORIES_ENABLED } from "./lineupCapabilities";
import {
  LineupManagementError,
  withRemoteManagement,
  type LineupManagementContext,
} from "./lineupManagement";
import type { LineupOrderMode, LineupSection, OrderPlacement } from "./lineup";

export type RemoteLineupMutation =
  | { type: "playlist.reset" }
  | { type: "category-order.reset"; section: LineupSection }
  | { type: "category-order.mode"; section: LineupSection; mode: LineupOrderMode }
  | { type: "item-order.reset"; categoryKey: string }
  | { type: "item-order.mode"; categoryKey: string; mode: LineupOrderMode }
  | { type: "item.place"; categoryKey: string; placement: OrderPlacement }
  | { type: "channel.rename"; channelId: string; name: string | null }
  | { type: "channel.number"; channelId: string; number: number | null }
  | { type: "channel.visibility"; channelId: string; hidden: boolean }
  | { type: "channels.visibility"; categoryKey: string; hidden: boolean }
  | { type: "category.rename"; categoryKey: string; name: string | null }
  | { type: "category.visibility"; categoryKey: string; hidden: boolean }
  | { type: "categories.visibility"; contentKind: "live" | "movie" | "series"; hidden: boolean }
  | { type: "category.place"; placement: OrderPlacement }
  | { type: "channel.place"; categoryKey: string; placement: OrderPlacement }
  | { type: "personal-category.create"; name: string }
  | { type: "personal-category.rename"; categoryId: string; name: string }
  | { type: "personal-category.delete"; categoryId: string }
  | { type: "personal-category.memberships"; channelId: string; categoryIds: string[] }
  | { type: "personal-category.place-channel"; categoryId: string; placement: OrderPlacement }
  | { type: "unavailable.remove"; key: string };

export type RemoteLineupQuery = LineupQuery & { sourceVersion?: number };

export type LineupMutationRequest = {
  id: string;
  playlistId: string;
  revision: number;
  sourceVersion?: number;
  mutation: RemoteLineupMutation;
};

const completed = new Map<string, LineupMutationResult>();
const running = new Map<string, Promise<LineupMutationResult>>();

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exact(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = keys.slice().sort();
  return (
    actual.length === expected.length && actual.every((key, index) => key === expected[index])
  );
}

function codePoints(value: string) {
  return Array.from(value).length;
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && codePoints(value) <= 512;
}

function name(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && codePoints(value) <= 200;
}

function revision(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function sourceVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function placement(value: unknown): OrderPlacement | null {
  const input = record(value);
  if (!input || !identifier(input.itemId)) return null;
  const keys = Object.keys(input);
  if (keys.some((key) => key !== "itemId" && key !== "beforeId" && key !== "afterId"))
    return null;
  const beforeId = input.beforeId;
  const afterId = input.afterId;
  if (beforeId !== undefined && !identifier(beforeId)) return null;
  if (afterId !== undefined && !identifier(afterId)) return null;
  if (beforeId !== undefined && afterId !== undefined) return null;
  return {
    itemId: input.itemId,
    ...(typeof beforeId === "string" ? { beforeId } : {}),
    ...(typeof afterId === "string" ? { afterId } : {}),
  };
}

export function parseLineupQuery(value: unknown): RemoteLineupQuery | null {
  const input = record(value);
  if (!input) return null;
  const allowed = new Set([
    "playlistId",
    "revision",
    "scope",
    "categoryKey",
    "contentKind",
    "query",
    "includeHidden",
    "cursor",
    "offset",
    "limit",
    "sourceVersion",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) return null;
  if (
    !identifier(input.playlistId) ||
    !revision(input.revision) ||
    (input.scope !== "channels" &&
      input.scope !== "categories" &&
      input.scope !== "items" &&
      (input.scope !== "personal-categories" || !CUSTOM_CATEGORIES_ENABLED))
  ) {
    return null;
  }
  if (
    input.contentKind !== undefined &&
    input.contentKind !== "live" &&
    input.contentKind !== "movie" &&
    input.contentKind !== "series"
  ) {
    return null;
  }
  if (input.categoryKey !== undefined && !identifier(input.categoryKey)) return null;
  if (
    input.query !== undefined &&
    (typeof input.query !== "string" || codePoints(input.query) > 200)
  ) {
    return null;
  }
  if (
    input.cursor !== undefined &&
    (typeof input.cursor !== "string" ||
      input.cursor.length > 2048 ||
      !/^[\x20-\x7e]+$/.test(input.cursor))
  ) {
    return null;
  }
  if (
    input.offset !== undefined &&
    (input.cursor !== undefined ||
      typeof input.offset !== "number" ||
      !Number.isSafeInteger(input.offset) ||
      input.offset < 0)
  ) {
    return null;
  }
  if (input.includeHidden !== undefined && typeof input.includeHidden !== "boolean")
    return null;
  if (
    input.limit !== undefined &&
    (typeof input.limit !== "number" ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100)
  ) {
    return null;
  }
  if (input.sourceVersion !== undefined && !sourceVersion(input.sourceVersion)) return null;
  return {
    playlistId: input.playlistId,
    revision: input.revision,
    scope: input.scope,
    ...(typeof input.categoryKey === "string" ? { categoryKey: input.categoryKey } : {}),
    ...(input.contentKind === "live" ||
    input.contentKind === "movie" ||
    input.contentKind === "series"
      ? { contentKind: input.contentKind }
      : {}),
    ...(typeof input.query === "string" ? { query: input.query } : {}),
    ...(typeof input.includeHidden === "boolean" ? { includeHidden: input.includeHidden } : {}),
    ...(typeof input.cursor === "string" ? { cursor: input.cursor } : {}),
    ...(typeof input.offset === "number" ? { offset: input.offset } : {}),
    ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
    ...(typeof input.sourceVersion === "number" ? { sourceVersion: input.sourceVersion } : {}),
  };
}

function orderMode(value: unknown): value is LineupOrderMode {
  return (
    value === "provider" || value === "alphabetical" || value === "number" || value === "custom"
  );
}

function parseRemoteMutation(value: unknown): RemoteLineupMutation | null {
  const input = record(value);
  if (!input || typeof input.type !== "string") return null;
  if (input.type === "playlist.reset" && exact(input, ["type"])) {
    return { type: input.type };
  }
  if (
    input.type === "category-order.reset" &&
    exact(input, ["type", "section"]) &&
    (input.section === "live" || input.section === "movie" || input.section === "series")
  ) {
    return { type: input.type, section: input.section };
  }
  if (
    input.type === "item-order.reset" &&
    exact(input, ["type", "categoryKey"]) &&
    identifier(input.categoryKey)
  ) {
    return { type: input.type, categoryKey: input.categoryKey };
  }
  if (
    input.type === "category-order.mode" &&
    exact(input, ["type", "section", "mode"]) &&
    (input.section === "live" || input.section === "movie" || input.section === "series") &&
    orderMode(input.mode)
  ) {
    return { type: input.type, section: input.section, mode: input.mode };
  }
  if (
    input.type === "item-order.mode" &&
    exact(input, ["type", "categoryKey", "mode"]) &&
    identifier(input.categoryKey) &&
    orderMode(input.mode)
  ) {
    return { type: input.type, categoryKey: input.categoryKey, mode: input.mode };
  }
  if (
    input.type === "item.place" &&
    exact(input, ["type", "categoryKey", "placement"]) &&
    identifier(input.categoryKey)
  ) {
    const parsed = placement(input.placement);
    return parsed
      ? { type: input.type, categoryKey: input.categoryKey, placement: parsed }
      : null;
  }
  if (
    input.type === "channel.rename" &&
    exact(input, ["type", "channelId", "name"]) &&
    identifier(input.channelId)
  ) {
    return input.name === null || name(input.name)
      ? { type: input.type, channelId: input.channelId, name: input.name }
      : null;
  }
  if (
    input.type === "channel.number" &&
    exact(input, ["type", "channelId", "number"]) &&
    identifier(input.channelId)
  ) {
    return input.number === null ||
      (typeof input.number === "number" &&
        Number.isSafeInteger(input.number) &&
        input.number > 0)
      ? { type: input.type, channelId: input.channelId, number: input.number }
      : null;
  }
  if (
    input.type === "channel.visibility" &&
    exact(input, ["type", "channelId", "hidden"]) &&
    identifier(input.channelId) &&
    typeof input.hidden === "boolean"
  ) {
    return { type: input.type, channelId: input.channelId, hidden: input.hidden };
  }
  if (
    input.type === "channels.visibility" &&
    exact(input, ["type", "categoryKey", "hidden"]) &&
    identifier(input.categoryKey) &&
    typeof input.hidden === "boolean"
  ) {
    return { type: input.type, categoryKey: input.categoryKey, hidden: input.hidden };
  }
  if (
    (input.type === "category.rename" || input.type === "category.visibility") &&
    identifier(input.categoryKey)
  ) {
    if (input.type === "category.rename" && exact(input, ["type", "categoryKey", "name"])) {
      return input.name === null || name(input.name)
        ? { type: input.type, categoryKey: input.categoryKey, name: input.name }
        : null;
    }
    if (
      input.type === "category.visibility" &&
      exact(input, ["type", "categoryKey", "hidden"]) &&
      typeof input.hidden === "boolean"
    ) {
      return { type: input.type, categoryKey: input.categoryKey, hidden: input.hidden };
    }
  }
  if (
    input.type === "categories.visibility" &&
    exact(input, ["type", "contentKind", "hidden"]) &&
    (input.contentKind === "live" ||
      input.contentKind === "movie" ||
      input.contentKind === "series") &&
    typeof input.hidden === "boolean"
  ) {
    return { type: input.type, contentKind: input.contentKind, hidden: input.hidden };
  }
  if (input.type === "category.place" && exact(input, ["type", "placement"])) {
    const parsed = placement(input.placement);
    return parsed ? { type: input.type, placement: parsed } : null;
  }
  if (
    input.type === "channel.place" &&
    exact(input, ["type", "categoryKey", "placement"]) &&
    identifier(input.categoryKey)
  ) {
    const parsed = placement(input.placement);
    return parsed
      ? { type: input.type, categoryKey: input.categoryKey, placement: parsed }
      : null;
  }
  if (
    CUSTOM_CATEGORIES_ENABLED &&
    input.type === "personal-category.create" &&
    exact(input, ["type", "name"]) &&
    name(input.name)
  ) {
    return { type: input.type, name: input.name };
  }
  if (
    CUSTOM_CATEGORIES_ENABLED &&
    (input.type === "personal-category.rename" || input.type === "personal-category.delete") &&
    identifier(input.categoryId)
  ) {
    if (
      input.type === "personal-category.rename" &&
      exact(input, ["type", "categoryId", "name"]) &&
      name(input.name)
    ) {
      return { type: input.type, categoryId: input.categoryId, name: input.name };
    }
    if (input.type === "personal-category.delete" && exact(input, ["type", "categoryId"])) {
      return { type: input.type, categoryId: input.categoryId };
    }
  }
  if (
    CUSTOM_CATEGORIES_ENABLED &&
    input.type === "personal-category.memberships" &&
    exact(input, ["type", "channelId", "categoryIds"]) &&
    identifier(input.channelId) &&
    Array.isArray(input.categoryIds) &&
    input.categoryIds.length <= 128 &&
    input.categoryIds.every(identifier)
  ) {
    return { type: input.type, channelId: input.channelId, categoryIds: input.categoryIds };
  }
  if (
    CUSTOM_CATEGORIES_ENABLED &&
    input.type === "personal-category.place-channel" &&
    exact(input, ["type", "categoryId", "placement"]) &&
    identifier(input.categoryId)
  ) {
    const parsed = placement(input.placement);
    return parsed
      ? { type: input.type, categoryId: input.categoryId, placement: parsed }
      : null;
  }
  if (
    input.type === "unavailable.remove" &&
    exact(input, ["type", "key"]) &&
    identifier(input.key)
  ) {
    return { type: input.type, key: input.key };
  }
  return null;
}

export function parseLineupMutationRequest(value: unknown): LineupMutationRequest | null {
  const input = record(value);
  if (!input) return null;
  const keys = Object.keys(input);
  const allowed = ["id", "playlistId", "revision", "mutation", "sourceVersion"];
  if (
    keys.some((key) => allowed.indexOf(key) < 0) ||
    ["id", "playlistId", "revision", "mutation"].some((key) => !(key in input))
  ) {
    return null;
  }
  const mutation = parseRemoteMutation(input.mutation);
  if (
    typeof input.id !== "string" ||
    input.id.length === 0 ||
    codePoints(input.id) > 128 ||
    !identifier(input.playlistId) ||
    !revision(input.revision) ||
    (input.sourceVersion !== undefined && !sourceVersion(input.sourceVersion)) ||
    !mutation
  ) {
    return null;
  }
  return {
    id: input.id,
    playlistId: input.playlistId,
    revision: input.revision,
    ...(typeof input.sourceVersion === "number" ? { sourceVersion: input.sourceVersion } : {}),
    mutation,
  };
}

function unavailable(revision = 0): LineupMutationResult {
  return { ok: false, revision, reason: "unavailable" };
}

function invalidMutation(revision = 0): LineupMutationResult {
  return { ok: false, revision, reason: "invalid" };
}

function invalidQuery(revision = 0): LineupQueryResult {
  return { ok: false, reason: "invalid", revision };
}

function unavailableQuery(revision = 0): LineupQueryResult {
  return { ok: false, reason: "unavailable", revision };
}

function notFoundQuery(): LineupQueryResult {
  return { ok: false, reason: "notFound", revision: 0 };
}

function conflictQuery(revision: number): LineupQueryResult {
  return { ok: false, reason: "conflict", revision };
}

function remember(id: string, result: LineupMutationResult) {
  completed.set(id, result);
  if (completed.size > 64) completed.delete(completed.keys().next().value as string);
  return result;
}

type OwnedState = ReturnType<LineupController["store"]["getState"]>;

function ownedState(context: LineupManagementContext): OwnedState {
  return context.controller.store.getState();
}

function contextRevision(context: LineupManagementContext): number {
  return ownedState(context).revision;
}

function channelRef(state: OwnedState, id: string) {
  return state.managedChannels.find((item) => item.ref.id === id)?.ref ?? null;
}

function categoryKey(state: OwnedState, id: string) {
  const category = state.managedCategories.find(
    (item) => item.key === id || (item.personal && item.key === `personal:${id}`),
  );
  return category?.key ?? null;
}

function managedCategory(state: OwnedState, key: string) {
  return state.managedCategories.find((item) => item.key === key) ?? null;
}

function customKey(state: OwnedState, key: string | null): boolean {
  if (CUSTOM_CATEGORIES_ENABLED || !key) return false;
  const managed = managedCategory(state, key);
  return managed ? managed.personal : key.startsWith("personal:");
}

function customUnavailable(record: OwnedState["unavailable"][number]): boolean {
  return isCustomUnavailable(record);
}

function contextQuery(
  context: LineupManagementContext,
  query: LineupQuery,
): LineupQueryResult | null {
  const state = ownedState(context);
  if (state.playlistId !== query.playlistId) {
    return { ok: false, reason: "notFound", revision: state.revision };
  }
  if (query.revision !== state.revision) return conflictQuery(state.revision);
  return null;
}

function contextBlocked(
  context: LineupManagementContext,
  query: RemoteLineupQuery,
): LineupQueryResult | null {
  if (!context.isCurrent()) return unavailableQuery(contextRevision(context));
  if (query.sourceVersion !== undefined && query.sourceVersion !== context.sourceVersion) {
    return unavailableQuery(contextRevision(context));
  }
  return contextQuery(context, query);
}

async function vodProviderOrder(
  context: LineupManagementContext,
  kind: "movie" | "series",
  key: string,
  expectedRevision: number,
): Promise<readonly string[] | null> {
  if (context.playlist.source.kind !== "xtream") return null;
  await context.library.getState().loadCategory(kind, key);
  if (!context.isCurrent()) return null;
  const state = ownedState(context);
  if (state.playlistId !== context.playlist.id || state.revision !== expectedRevision) {
    return null;
  }
  const raw = context.library.getState().categoryItems[key]?.items;
  return raw ? raw.map((item) => item.key) : null;
}

async function prepareDomainMutation(
  mutation: RemoteLineupMutation,
  context: LineupManagementContext,
  expectedRevision: number,
): Promise<LineupMutation | null> {
  const state = ownedState(context);
  if (mutation.type === "playlist.reset") return mutation;
  if (mutation.type === "category-order.reset") {
    if (!["live", "movie", "series"].includes(mutation.section)) return null;
    return { type: mutation.type, section: mutation.section };
  }
  if (mutation.type === "category-order.mode") {
    if (mutation.mode === "number") return null;
    return { type: mutation.type, section: mutation.section, mode: mutation.mode };
  }
  if (mutation.type === "item-order.reset") {
    const key = categoryKey(state, mutation.categoryKey);
    if (!key || customKey(state, key)) return null;
    const category = managedCategory(state, key);
    if (!category) return null;
    const providerOrder =
      category.kind === "live"
        ? context.controller.defaultItemOrder(key)
        : await vodProviderOrder(context, category.kind, key, expectedRevision);
    if (!providerOrder) return null;
    return { type: mutation.type, categoryKey: key };
  }
  if (mutation.type === "item-order.mode") {
    const key = categoryKey(state, mutation.categoryKey);
    if (!key || customKey(state, key)) return null;
    const category = managedCategory(state, key);
    if (!category || (mutation.mode === "number" && category.kind !== "live")) return null;
    return { type: mutation.type, categoryKey: key, mode: mutation.mode };
  }
  if (mutation.type === "item.place") {
    const key = categoryKey(state, mutation.categoryKey);
    if (!key || customKey(state, key)) return null;
    const category = managedCategory(state, key);
    if (!category) return null;
    const providerOrder =
      category.kind === "live"
        ? context.controller.defaultItemOrder(key)
        : await vodProviderOrder(context, category.kind, key, expectedRevision);
    if (!providerOrder) return null;
    return {
      type: mutation.type,
      categoryKey: key,
      placement: mutation.placement,
      providerOrder,
    };
  }
  if (mutation.type === "personal-category.create") return mutation;
  if (mutation.type === "unavailable.remove") {
    const record = state.unavailable.find((item) => item.key === mutation.key);
    if (!record || (!CUSTOM_CATEGORIES_ENABLED && customUnavailable(record))) return null;
    return mutation;
  }
  if (
    mutation.type === "channel.rename" ||
    mutation.type === "channel.number" ||
    mutation.type === "channel.visibility"
  ) {
    const channel = channelRef(state, mutation.channelId);
    if (!channel) return null;
    if (mutation.type === "channel.rename")
      return { type: mutation.type, channel, name: mutation.name };
    if (mutation.type === "channel.number")
      return { type: mutation.type, channel, number: mutation.number };
    return { type: mutation.type, channel, hidden: mutation.hidden };
  }
  if (mutation.type === "categories.visibility") {
    const categoryKeys = state.managedCategories
      .filter((item) => !item.personal && item.kind === mutation.contentKind)
      .map((item) => item.key);
    return categoryKeys.length
      ? { type: mutation.type, categoryKeys, hidden: mutation.hidden }
      : null;
  }
  if (mutation.type === "channels.visibility") {
    const key = categoryKey(state, mutation.categoryKey);
    if (!key || key === "favourites" || customKey(state, key)) return null;
    const category = managedCategory(state, key);
    if (!category || category.kind !== "live") return null;
    return { type: mutation.type, categoryKey: key, hidden: mutation.hidden };
  }
  if (mutation.type === "category.rename" || mutation.type === "category.visibility") {
    const category = state.managedCategories.find(
      (item) => !item.personal && item.key === mutation.categoryKey,
    );
    const key = category?.key ?? null;
    if (!key) return null;
    return mutation.type === "category.rename"
      ? { type: mutation.type, categoryKey: key, name: mutation.name }
      : { type: mutation.type, categoryKey: key, hidden: mutation.hidden };
  }
  if (mutation.type === "category.place") {
    const itemId = categoryKey(state, mutation.placement.itemId);
    const beforeId = mutation.placement.beforeId
      ? categoryKey(state, mutation.placement.beforeId)
      : undefined;
    const afterId = mutation.placement.afterId
      ? categoryKey(state, mutation.placement.afterId)
      : undefined;
    if (
      !itemId ||
      customKey(state, itemId) ||
      customKey(state, beforeId ?? null) ||
      customKey(state, afterId ?? null) ||
      (mutation.placement.beforeId && !beforeId) ||
      (mutation.placement.afterId && !afterId)
    )
      return null;
    return {
      type: mutation.type,
      placement: { itemId, ...(beforeId ? { beforeId } : {}), ...(afterId ? { afterId } : {}) },
    };
  }
  if (mutation.type === "channel.place") {
    const key = categoryKey(state, mutation.categoryKey);
    if (!key || customKey(state, key) || !channelRef(state, mutation.placement.itemId))
      return null;
    return { type: mutation.type, categoryKey: key, placement: mutation.placement };
  }
  if (
    mutation.type === "personal-category.rename" ||
    mutation.type === "personal-category.delete"
  ) {
    return categoryKey(state, mutation.categoryId)?.startsWith("personal:") ? mutation : null;
  }
  if (mutation.type === "personal-category.memberships") {
    const channel = channelRef(state, mutation.channelId);
    if (
      !channel ||
      mutation.categoryIds.some((id) => categoryKey(state, id) !== `personal:${id}`)
    )
      return null;
    return { type: mutation.type, channel, categoryIds: mutation.categoryIds };
  }
  if (mutation.type === "personal-category.place-channel") {
    if (
      categoryKey(state, mutation.categoryId) !== `personal:${mutation.categoryId}` ||
      !channelRef(state, mutation.placement.itemId)
    )
      return null;
    return mutation;
  }
  return null;
}

const SYNTHETIC_VOD_CATEGORIES = new Set([
  "movie:all",
  "movie:continue",
  "movie:favourites",
  "series:all",
  "series:continue",
  "series:favourites",
]);

const contentVersions = new WeakMap<object, string>();
let contentVersionSeq = 0;

function contentVersionFor(items: readonly unknown[]): string {
  const key = items as unknown as object;
  let token = contentVersions.get(key);
  if (!token) {
    token = `v${++contentVersionSeq}`;
    contentVersions.set(key, token);
  }
  return token;
}

async function queryVodItems(
  context: LineupManagementContext,
  query: RemoteLineupQuery,
): Promise<LineupQueryResult> {
  const kind = query.contentKind;
  const categoryKey = query.categoryKey ?? "";
  if (
    (kind !== "movie" && kind !== "series") ||
    !categoryKey ||
    SYNTHETIC_VOD_CATEGORIES.has(categoryKey)
  ) {
    return invalidQuery(contextRevision(context));
  }
  const blocked = contextBlocked(context, query);
  if (blocked) return blocked;
  await context.library.getState().loadCategories(kind);
  const afterCategories = contextBlocked(context, query);
  if (afterCategories) return afterCategories;
  const categories = context.library.getState().categories[kind];
  if (categories.state !== "loaded" && categories.state !== "empty") {
    return unavailableQuery(contextRevision(context));
  }
  const adopted = ownedState(context).managedCategories.some(
    (item) => item.key === categoryKey && item.kind === kind && !item.personal,
  );
  if (!adopted) return invalidQuery(contextRevision(context));
  await context.library.getState().loadCategory(kind, categoryKey);
  const afterItems = contextBlocked(context, query);
  if (afterItems) return afterItems;
  const library = context.library.getState();
  const resource = library.itemsFor(kind, categoryKey);
  if (resource.state !== "loaded" && resource.state !== "empty") {
    return unavailableQuery(contextRevision(context));
  }
  const locale = resolveLocale(useSettings.getState().locale);
  const search = (query.query ?? "").toLocaleLowerCase(locale);
  const items: LineupLibraryItem[] = resource.value
    .filter((item) => !search || item.name.toLocaleLowerCase(locale).includes(search))
    .map((item) => ({ kind: "item", id: item.key, name: item.name, contentKind: kind }));
  const raw = library.categoryItems[categoryKey]?.items;
  return context.controller.pageLineupItems(query, items, raw ? contentVersionFor(raw) : "");
}

export async function queryRemoteLineup(value: unknown): Promise<LineupQueryResult> {
  const query = parseLineupQuery(value);
  if (!query) return invalidQuery();
  try {
    return await withRemoteManagement(query.playlistId, async (context) => {
      try {
        if (query.scope === "items") return await queryVodItems(context, query);
        const blocked = contextBlocked(context, query);
        if (blocked) return blocked;
        const kind = query.contentKind;
        if (query.scope !== "categories" || kind === "live") {
          return context.controller.queryLineup(query);
        }
        const kinds: readonly ("movie" | "series")[] = kind ? [kind] : ["movie", "series"];
        for (const contentKind of kinds) {
          await context.library.getState().loadCategories(contentKind);
        }
        const afterCategories = contextBlocked(context, query);
        if (afterCategories) return afterCategories;
        const result = context.controller.queryLineup(query);
        if (!result.ok) return result;
        const library = context.library.getState();
        const counts = new Map(
          kinds.flatMap((contentKind) =>
            library.categories[contentKind].items.map(
              (category) => [category.key, category.count] as const,
            ),
          ),
        );
        return {
          ...result,
          page: {
            ...result.page,
            items: result.page.items.map((item) => {
              if (
                item.kind !== "category" ||
                (item.contentKind !== "movie" && item.contentKind !== "series")
              ) {
                return item;
              }
              const count = counts.get(item.id);
              return count === undefined ? item : { ...item, count };
            }),
          },
        };
      } catch {
        return unavailableQuery(contextRevision(context));
      }
    });
  } catch (error) {
    if (error instanceof LineupManagementError) {
      return error.reason === "notFound" ? notFoundQuery() : unavailableQuery();
    }
    return unavailableQuery();
  }
}

export function mutateRemoteLineup(
  value: unknown,
  requesterId = "",
): Promise<LineupMutationResult> {
  const request = parseLineupMutationRequest(value);
  if (!request) return Promise.resolve(invalidMutation());
  const fence = request.sourceVersion === undefined ? "" : `\u0000v${request.sourceVersion}`;
  const requestKey = `${requesterId}\u0000${request.playlistId}\u0000${request.id}${fence}`;
  const previous = completed.get(requestKey);
  if (previous) return Promise.resolve(previous);
  const pending = running.get(requestKey);
  if (pending) return pending;
  const result = withRemoteManagement(request.playlistId, async (context) => {
    const state = ownedState(context);
    if (state.playlistId !== request.playlistId) {
      return unavailable(state.revision);
    }
    if (
      request.sourceVersion !== undefined &&
      request.sourceVersion !== context.sourceVersion
    ) {
      return unavailable(contextRevision(context));
    }
    if (request.revision !== state.revision) {
      return { ok: false as const, reason: "conflict" as const, revision: state.revision };
    }
    if (!context.isCurrent()) return unavailable(contextRevision(context));
    const mutation = await prepareDomainMutation(request.mutation, context, request.revision);
    if (!context.isCurrent()) return unavailable(contextRevision(context));
    const current = ownedState(context);
    if (current.playlistId !== request.playlistId) {
      return unavailable(current.revision);
    }
    if (
      request.sourceVersion !== undefined &&
      request.sourceVersion !== context.sourceVersion
    ) {
      return unavailable(contextRevision(context));
    }
    if (request.revision !== current.revision) {
      return { ok: false as const, reason: "conflict" as const, revision: current.revision };
    }
    if (!mutation) return invalidMutation(current.revision);
    return context.controller.applyLineupMutation(request.revision, mutation);
  }).then(
    (outcome) => {
      running.delete(requestKey);
      return remember(requestKey, outcome);
    },
    () => {
      running.delete(requestKey);
      return remember(requestKey, unavailable());
    },
  );
  running.set(requestKey, result);
  return result;
}
