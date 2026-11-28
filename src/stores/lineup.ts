import { create } from "zustand";
import type { UseBoundStore, StoreApi } from "zustand";
import { CUSTOM_CATEGORIES_ENABLED } from "../services/lineupCapabilities";
import {
  clearLineups,
  readLineup,
  removeLineup,
  writeLineup,
  writeLineupIfAbsent,
} from "../services/personalDisk";
import { whenIdle } from "../services/idle";
import { recordFromEntries } from "../services/record";
import {
  MAX_PERSONAL_CATEGORIES,
  applyPlacements,
  channelRef,
  emptyPersonalisation,
  materialiseLineup,
  orderedItems,
  parseStoredLineup,
  personalCategoryKey,
  reconcilePersonalisation,
  type ChannelRef,
  type LineupMaterialisation,
  type LineupOrderMode,
  type ManagedChannel,
  type LineupPersonalisation,
  type LineupSection,
  type OrderPlacement,
  type SectionOrderModes,
  type ProviderCategory,
  type ProviderLineup,
  type ReconciliationResult,
  type StoredLineupV1,
  type UnavailableRecord,
} from "../services/lineup";
import type { Playlist } from "./settings";

export type LineupMutation =
  | { type: "playlist.reset" }
  | { type: "order.mode"; mode: LineupOrderMode }
  | { type: "category-order.mode"; section: LineupSection; mode: LineupOrderMode }
  | { type: "category-order.reset"; section: LineupSection }
  | { type: "item-order.mode"; categoryKey: string; mode: LineupOrderMode }
  | { type: "item-order.reset"; categoryKey: string }
  | { type: "channel.rename"; channel: ChannelRef; name: string | null }
  | { type: "channel.number"; channel: ChannelRef; number: number | null }
  | { type: "channel.visibility"; channel: ChannelRef; hidden: boolean }
  | { type: "channels.visibility"; categoryKey: string; hidden: boolean }
  | { type: "category.rename"; categoryKey: string; name: string | null }
  | { type: "category.visibility"; categoryKey: string; hidden: boolean }
  | { type: "categories.visibility"; categoryKeys: string[]; hidden: boolean }
  | { type: "category.place"; section?: LineupSection; placement: OrderPlacement }
  | { type: "channel.place"; categoryKey: string; placement: OrderPlacement }
  | {
      type: "item.place";
      categoryKey: string;
      placement: OrderPlacement;
      providerOrder: readonly string[];
    }
  | { type: "personal-category.create"; name: string }
  | { type: "personal-category.rename"; categoryId: string; name: string }
  | { type: "personal-category.delete"; categoryId: string }
  | { type: "personal-category.memberships"; channel: ChannelRef; categoryIds: string[] }
  | { type: "personal-category.place-channel"; categoryId: string; placement: OrderPlacement }
  | { type: "unavailable.remove"; key: string };

export type LineupMutationResult =
  | { ok: true; revision: number; affectedIds: string[] }
  | {
      ok: false;
      revision: number;
      reason:
        | "conflict"
        | "invalid"
        | "duplicate-number"
        | "limit"
        | "unavailable"
        | "persistence";
    };

export type LineupScope = "channels" | "categories" | "personal-categories" | "items";

export type LineupQuery = {
  playlistId: string;
  revision: number;
  scope: LineupScope;
  categoryKey?: string;
  contentKind?: LineupSection;
  query?: string;
  includeHidden?: boolean;
  cursor?: string;
  offset?: number;
  limit?: number;
};

export type LineupChannelItem = {
  kind: "channel";
  id: string;
  name: string;
  providerName: string;
  number: number;
  providerNumber: number;
  hidden: boolean;
  categoryKeys: string[];
  personalCategoryIds: string[];
};

export type LineupCategoryItem = {
  kind: "category" | "personal-category";
  id: string;
  contentKind?: "live" | "movie" | "series";
  name: string;
  providerName: string;
  hidden: boolean;
  count?: number;
  unavailableCount: number;
};

export type LineupUnavailableItem = {
  kind: "unavailable";
  key: string;
  recordKind: UnavailableRecord["kind"];
  itemId: string;
  label: string;
  personalCategoryId?: string;
};

export type LineupLibraryItem = {
  kind: "item";
  id: string;
  name: string;
  contentKind: "movie" | "series";
};

export type LineupPageItem =
  | LineupChannelItem
  | LineupCategoryItem
  | LineupLibraryItem
  | LineupUnavailableItem;

export type LineupPage<T> = {
  revision: number;
  items: T[];
  nextCursor: string | null;
  total: number;
  orderMode?: LineupOrderMode;
  sectionCounts?: Record<LineupSection, number>;
};

export type LineupQueryResult<T extends LineupPageItem = LineupPageItem> =
  | { ok: true; page: LineupPage<T> }
  | {
      ok: false;
      reason: "conflict" | "invalid" | "notFound" | "unavailable";
      revision: number;
    };

export type LineupSummary = {
  playlistId: string;
  revision: number;
  ready: boolean;
};

export interface PreparedLineup {
  playlistId: string;
  generation: number;
  controllerId: string;
  stored: StoredLineupV1;
  hasStored: boolean;
  legacyHiddenCategories: string[];
  legacyOrderMode: LineupOrderMode | null;
  migrationEpoch: number;
}

export interface LineupState extends LineupMaterialisation {
  playlistId: string;
  revision: number;
  durableRevision: number;
  orderMode: LineupOrderMode;
  categoryOrderModes: SectionOrderModes;
  itemOrderModes: Record<string, LineupOrderMode>;
  saving: boolean;
  saveError: string;
  provider: ProviderLineup;
  queryLineup: (query: LineupQuery) => LineupQueryResult;
  lineupSummary: () => LineupSummary | null;
}

const EMPTY_PROVIDER: ProviderLineup = { channels: [], categories: [] };
const EMPTY_MATERIALISATION = materialiseLineup(EMPTY_PROVIDER, emptyPersonalisation(), "en");

let controllerSequence = 0;
const idleController = createLineupController({ locale: "en" });

export const useLineup = create<LineupState>(() => idleController.store.getState());

const facadeSetState = useLineup.setState;
let facadeController: LineupController | null = null;
let facadeUnsub: (() => void) | null = null;

interface DurableSnapshot {
  stored: StoredLineupV1;
}

interface PendingMutation {
  owner: string;
  epoch: number;
  revision: number;
  affectedIds: string[];
  settled: boolean;
  resolve: (result: LineupMutationResult) => void;
}

type CursorPayload = {
  revision: number;
  index: number;
  tag: string;
  contentVersion: string;
  identity: {
    playlistId: string;
    scope: LineupScope;
    categoryKey: string;
    contentKind: string;
    query: string;
    includeHidden: boolean;
  };
};

const cursorNonce = `${Date.now().toString(36)}:${Math.random().toString(36)}`;

function cursorTag(
  revision: number,
  index: number,
  identity: CursorPayload["identity"],
  contentVersion: string,
) {
  const input = `${cursorNonce}:${revision}:${index}:${contentVersion}:${JSON.stringify(identity)}`;
  let hash = 2166136261;
  for (let position = 0; position < input.length; position += 1) {
    hash ^= input.charCodeAt(position);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function encodeCursor(value: Omit<CursorPayload, "tag">) {
  const payload = {
    ...value,
    tag: cursorTag(value.revision, value.index, value.identity, value.contentVersion),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeCursor(value: string): CursorPayload | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<CursorPayload>;
    const identity = parsed.identity;
    if (
      !identity ||
      typeof parsed.revision !== "number" ||
      !Number.isSafeInteger(parsed.revision) ||
      parsed.revision < 0 ||
      typeof parsed.index !== "number" ||
      !Number.isSafeInteger(parsed.index) ||
      parsed.index <= 0 ||
      typeof parsed.tag !== "string" ||
      typeof parsed.contentVersion !== "string" ||
      typeof identity.playlistId !== "string" ||
      !["channels", "categories", "personal-categories", "items"].includes(
        identity.scope ?? "",
      ) ||
      typeof identity.categoryKey !== "string" ||
      typeof identity.contentKind !== "string" ||
      typeof identity.query !== "string" ||
      typeof identity.includeHidden !== "boolean"
    ) {
      return null;
    }
    if (
      parsed.tag !==
      cursorTag(
        parsed.revision,
        parsed.index,
        identity as CursorPayload["identity"],
        parsed.contentVersion,
      )
    ) {
      return null;
    }
    return parsed as CursorPayload;
  } catch {
    return null;
  }
}

function queryIdentity(query: LineupQuery): CursorPayload["identity"] {
  return {
    playlistId: query.playlistId,
    scope: query.scope,
    categoryKey: query.categoryKey ?? "",
    contentKind: query.contentKind ?? "",
    query: query.query ?? "",
    includeHidden: query.includeHidden === true,
  };
}

function sameQueryIdentity(left: CursorPayload["identity"], right: CursorPayload["identity"]) {
  return (
    left.playlistId === right.playlistId &&
    left.scope === right.scope &&
    left.categoryKey === right.categoryKey &&
    left.contentKind === right.contentKind &&
    left.query === right.query &&
    left.includeHidden === right.includeHidden
  );
}

function unavailableItem(record: UnavailableRecord): LineupUnavailableItem {
  return {
    kind: "unavailable",
    key: record.key,
    recordKind: record.kind,
    itemId: record.itemId,
    label: record.label,
    ...(record.kind === "personal-membership"
      ? { personalCategoryId: record.personalCategoryId }
      : {}),
  };
}

function categoryUnavailableCount(key: string, records: readonly UnavailableRecord[]) {
  const personalId = key.startsWith("personal:") ? key.slice("personal:".length) : "";
  return records.filter((record) => {
    if (record.kind === "personal-membership") return record.personalCategoryId === personalId;
    if (record.kind === "category-override" || record.kind === "category-placement") {
      return record.itemId === key;
    }
    return (
      record.kind === "channel-placement" && record.key.startsWith(`channel-placement:${key}:`)
    );
  }).length;
}

export function isCustomUnavailable(record: UnavailableRecord): boolean {
  if (record.kind === "personal-membership") return true;
  if (record.kind === "category-override" || record.kind === "category-placement") {
    return record.itemId.startsWith("personal:");
  }
  return (
    record.kind === "channel-placement" && record.key.startsWith("channel-placement:personal:")
  );
}

function visibleUnavailable(
  records: readonly UnavailableRecord[],
  scope: "channels" | "categories",
  categoryKey: string,
  personalScope: boolean,
  contentKind?: "live" | "movie" | "series",
) {
  return records.filter((record) => {
    if (!CUSTOM_CATEGORIES_ENABLED && isCustomUnavailable(record)) return false;
    if (personalScope) return record.kind === "personal-membership";
    if (scope === "channels") {
      if (record.kind === "channel-override") return !categoryKey;
      if (record.kind === "channel-placement") {
        return !categoryKey || record.key.startsWith(`channel-placement:${categoryKey}:`);
      }
      return false;
    }
    return (
      record.kind === "category-override" ||
      record.kind === "category-placement" ||
      (record.kind === "channel-override" && (!contentKind || contentKind === "live"))
    );
  });
}

function hasStoredLineupValue(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { version?: unknown }).version === 1
  );
}

export function createLineupController(options?: {
  revisionFloor?: number;
  locale?: string;
  playlistId?: string;
  sourceVersion?: number;
}): LineupController {
  const revisionFloor = options?.revisionFloor ?? 0;
  const controllerId = `lineup-${Date.now().toString(36)}-${Math.random().toString(36)}-${controllerSequence++}`;
  let disposed = false;
  let preparedEntry: {
    playlistId: string;
    generation: number;
    promise: Promise<PreparedLineup>;
  } | null = null;
  const store = create<LineupState>(() => ({
    playlistId: "",
    revision: 0,
    durableRevision: 0,
    orderMode: "provider",
    categoryOrderModes: { live: "provider", movie: "provider", series: "provider" },
    itemOrderModes: {},
    saving: false,
    saveError: "",
    provider: EMPTY_PROVIDER,
    ...EMPTY_MATERIALISATION,
    queryLineup,
    lineupSummary,
  }));

  let generation = 0;
  let personalisation = emptyPersonalisation();
  let catalogue: ProviderLineup = EMPTY_PROVIDER;
  let locale = options?.locale ?? "en";
  let durable: DurableSnapshot = {
    stored: { version: 1, revision: 0, personalisation: emptyPersonalisation() },
  };
  let pending: PendingMutation[] = [];
  let inFlight: PendingMutation[] = [];
  let cancelPendingWrite: (() => void) | null = null;
  let activeWrite: Promise<void> | null = null;
  let writeEpoch = 0;
  let personalId = 0;
  let drainPromise: Promise<void> | null = null;
  const capturedOwner =
    options?.playlistId !== undefined && options?.sourceVersion !== undefined
      ? { id: options.playlistId, sourceVersion: options.sourceVersion }
      : null;
  const available = () =>
    !disposed && (capturedOwner === null || !sourceBlocked(capturedOwner));

  function pageItems(state: LineupState, query: LineupQuery): LineupPageItem[] {
    const search = (query.query ?? "").toLocaleLowerCase(locale);
    const visible = (hidden: boolean) => query.includeHidden === true || !hidden;
    const matches = (value: string) =>
      !search || value.toLocaleLowerCase(locale).includes(search);
    if (query.scope === "channels") {
      const requestedCategory = query.categoryKey ?? "";
      const categoryKey = personalisation.personalCategories.some(
        (item) => item.id === requestedCategory,
      )
        ? personalCategoryKey(requestedCategory)
        : requestedCategory;
      let ordered: ManagedChannel[];
      if (categoryKey) {
        const effective = state.categories.find((category) => category.key === categoryKey);
        if (effective) {
          const byRef = new Map(state.managedChannels.map((item) => [item.ref.id, item]));
          ordered = effective.channels
            .map((channel) => byRef.get(channelRef(channel).id))
            .filter((item): item is ManagedChannel => item !== undefined);
        } else {
          ordered = state.managedChannels.filter((channel) =>
            channel.categoryKeys.includes(categoryKey),
          );
        }
      } else {
        ordered = state.managedChannels;
      }
      const items: LineupPageItem[] = ordered
        .filter((channel) => !categoryKey || channel.categoryKeys.includes(categoryKey))
        .filter((channel) => visible(channel.hidden) && matches(channel.effective.name))
        .map((channel) => ({
          kind: "channel",
          id: channel.ref.id,
          name: channel.effective.name,
          providerName: channel.providerName,
          number: channel.effective.number,
          providerNumber: channel.providerNumber,
          hidden: channel.hidden,
          categoryKeys: channel.categoryKeys.filter((key) => !key.startsWith("personal:")),
          personalCategoryIds: CUSTOM_CATEGORIES_ENABLED
            ? channel.categoryKeys
                .filter((key) => key.startsWith("personal:"))
                .map((key) => key.slice("personal:".length))
            : [],
        }));
      const unavailable = visibleUnavailable(state.unavailable, "channels", categoryKey, false);
      return items.concat(
        unavailable.filter((item) => matches(item.label)).map(unavailableItem),
      );
    }
    const personalScope = query.scope === "personal-categories" && CUSTOM_CATEGORIES_ENABLED;
    const categories: LineupPageItem[] = state.managedCategories
      .filter((category) => category.personal === personalScope)
      .filter(
        (category) =>
          (!query.contentKind || category.kind === query.contentKind) &&
          visible(category.hidden) &&
          matches(category.name),
      )
      .map((category) => ({
        kind: personalScope ? "personal-category" : "category",
        id: personalScope ? category.key.slice("personal:".length) : category.key,
        ...(personalScope ? {} : { contentKind: category.kind }),
        name: category.name,
        providerName: category.providerName,
        hidden: category.hidden,
        ...(category.count !== undefined ? { count: category.count } : {}),
        unavailableCount: categoryUnavailableCount(category.key, state.unavailable),
      }));
    const unavailable = visibleUnavailable(
      state.unavailable,
      "categories",
      "",
      personalScope,
      query.contentKind,
    );
    return categories.concat(
      unavailable.filter((item) => matches(item.label)).map(unavailableItem),
    );
  }

  function effectiveOrderMode(query: LineupQuery): LineupOrderMode {
    const state = store.getState();
    if (query.scope === "categories") {
      return query.contentKind ? state.categoryOrderModes[query.contentKind] : state.orderMode;
    }
    const requested = query.categoryKey ?? "";
    if (!requested) return state.orderMode;
    const key = personalisation.personalCategories.some((item) => item.id === requested)
      ? personalCategoryKey(requested)
      : requested;
    return state.itemOrderModes[key] ?? "provider";
  }

  function sectionCounts(): Record<LineupSection, number> {
    const counts: Record<LineupSection, number> = { live: 0, movie: 0, series: 0 };
    for (const category of store.getState().managedCategories) {
      if (!CUSTOM_CATEGORIES_ENABLED && category.personal) continue;
      counts[category.kind] += 1;
    }
    return counts;
  }

  function pageLineupItems<T extends LineupPageItem>(
    query: LineupQuery,
    items: readonly T[],
    contentVersion = "",
  ): LineupQueryResult<T> {
    const state = store.getState();
    if (!available()) {
      return { ok: false, reason: "unavailable", revision: state.revision };
    }
    if (!state.playlistId || query.playlistId !== state.playlistId) {
      return { ok: false, reason: "notFound", revision: state.revision };
    }
    if (query.revision !== state.revision) {
      return { ok: false, reason: "conflict", revision: state.revision };
    }
    const limit = query.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return { ok: false, reason: "invalid", revision: state.revision };
    }
    if (
      query.offset !== undefined &&
      (query.cursor !== undefined || !Number.isSafeInteger(query.offset) || query.offset < 0)
    ) {
      return { ok: false, reason: "invalid", revision: state.revision };
    }
    const identity = queryIdentity(query);
    let start = 0;
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      if (!cursor) return { ok: false, reason: "invalid", revision: state.revision };
      if (cursor.revision !== state.revision) {
        return { ok: false, reason: "conflict", revision: state.revision };
      }
      if (!sameQueryIdentity(cursor.identity, identity)) {
        return { ok: false, reason: "invalid", revision: state.revision };
      }
      if (cursor.contentVersion !== contentVersion) {
        return { ok: false, reason: "conflict", revision: state.revision };
      }
      start = cursor.index;
    }
    if (query.offset !== undefined) {
      start = query.offset;
      if (query.offset > 0 && query.offset >= items.length) {
        return { ok: false, reason: "invalid", revision: state.revision };
      }
    }
    if (query.cursor && start >= items.length) {
      return { ok: false, reason: "invalid", revision: state.revision };
    }
    const end = Math.min(start + limit, items.length);
    return {
      ok: true,
      page: {
        revision: state.revision,
        items: items.slice(start, end),
        nextCursor:
          end < items.length
            ? encodeCursor({
                revision: state.revision,
                index: end,
                identity,
                contentVersion,
              })
            : null,
        total: items.length,
        orderMode: effectiveOrderMode(query),
        sectionCounts: sectionCounts(),
      },
    };
  }

  function personalCategoryQuery(query: LineupQuery): boolean {
    const requested = query.categoryKey ?? "";
    if (!requested) return false;
    const managed = store.getState().managedCategories.find((item) => item.key === requested);
    if (managed) return managed.personal;
    return (
      requested.startsWith("personal:") ||
      personalisation.personalCategories.some((item) => item.id === requested)
    );
  }

  function queryLineup(query: LineupQuery): LineupQueryResult {
    const state = store.getState();
    if (!available()) {
      return { ok: false, reason: "unavailable", revision: state.revision };
    }
    if (!state.playlistId || query.playlistId !== state.playlistId) {
      return { ok: false, reason: "notFound", revision: state.revision };
    }
    if (
      query.scope === "items" ||
      (!CUSTOM_CATEGORIES_ENABLED &&
        (query.scope === "personal-categories" || personalCategoryQuery(query)))
    ) {
      return { ok: false, reason: "invalid", revision: state.revision };
    }
    return pageLineupItems(query, pageItems(state, query));
  }

  function lineupSummary(): LineupSummary | null {
    const state = store.getState();
    if (!available()) return null;
    return state.playlistId
      ? { playlistId: state.playlistId, revision: state.revision, ready: true }
      : null;
  }

  function clonePersonalisation(value: LineupPersonalisation) {
    return parseStoredLineup({ version: 1, revision: 0, personalisation: value })
      .personalisation;
  }

  function publish(
    playlistId: string,
    revision: number,
    durableRevision: number,
    saving: boolean,
    saveError = "",
    reconciliation?: ReconciliationResult,
  ) {
    const materialisation = materialiseLineup(
      catalogue,
      personalisation,
      locale,
      reconciliation,
    );
    store.setState({
      playlistId,
      revision,
      durableRevision,
      orderMode:
        personalisation.orderMode ??
        personalisation.categories[
          catalogue.categories.find((category) => category.kind === "live")?.key ?? ""
        ]?.itemOrderMode ??
        personalisation.categoryOrderModes.live ??
        "provider",
      categoryOrderModes: { ...personalisation.categoryOrderModes },
      itemOrderModes: recordFromEntries(
        Object.entries(personalisation.categories).map(
          ([key, value]) => [key, value.itemOrderMode ?? "provider"] as const,
        ),
      ),
      saving,
      saveError,
      provider: catalogue,
      ...materialisation,
    });
  }

  function sameCatalogue(left: ProviderLineup, right: ProviderLineup) {
    if (
      left.channels.length !== right.channels.length ||
      left.categories.length !== right.categories.length
    ) {
      return false;
    }
    for (let index = 0; index < left.channels.length; index += 1) {
      const a = left.channels[index];
      const b = right.channels[index];
      if (
        a.id !== b.id ||
        a.sourceFingerprint !== b.sourceFingerprint ||
        a.name !== b.name ||
        a.number !== b.number ||
        a.group !== b.group ||
        a.categoryKey !== b.categoryKey
      ) {
        return false;
      }
    }
    for (let index = 0; index < left.categories.length; index += 1) {
      const a = left.categories[index];
      const b = right.categories[index];
      if (
        a.key !== b.key ||
        a.name !== b.name ||
        a.kind !== b.kind ||
        a.count !== b.count ||
        a.channels.length !== b.channels.length ||
        a.channels.some((channel, channelIndex) => channel.id !== b.channels[channelIndex]?.id)
      ) {
        return false;
      }
    }
    return true;
  }

  function settleMutation(item: PendingMutation, result: LineupMutationResult) {
    if (item.settled) return;
    item.settled = true;
    item.resolve(result);
  }

  function failMutations(items: PendingMutation[], revision: number) {
    for (const item of items) {
      settleMutation(item, { ok: false, reason: "persistence", revision });
    }
  }

  function scheduleWrite() {
    if (cancelPendingWrite || activeWrite || !pending.length) return;
    cancelPendingWrite = whenIdle(() => {
      cancelPendingWrite = null;
      void flushWrite();
    }, 1000);
  }

  function flushWrite(): Promise<void> {
    if (activeWrite || !pending.length) return activeWrite ?? Promise.resolve();
    const batch = pending;
    pending = [];
    inFlight = batch;
    const owner = batch[0].owner;
    const epoch = batch[0].epoch;
    const target: StoredLineupV1 = {
      version: 1,
      revision: batch[batch.length - 1].revision,
      personalisation: clonePersonalisation(personalisation),
    };
    const running = (async () => {
      try {
        await writeLineup(owner, target);
        if (epoch !== writeEpoch || store.getState().playlistId !== owner) return;
        durable = { stored: target };
        store.setState({
          durableRevision: target.revision,
          saving: pending.length > 0,
          saveError: "",
        });
        for (const item of batch) {
          settleMutation(item, {
            ok: true,
            revision: item.revision,
            affectedIds: item.affectedIds,
          });
        }
      } catch {
        if (epoch !== writeEpoch || store.getState().playlistId !== owner) return;
        const failed = [
          ...batch,
          ...pending.filter((item) => item.owner === owner && item.epoch === epoch),
        ];
        pending = pending.filter((item) => item.owner !== owner || item.epoch !== epoch);
        personalisation = clonePersonalisation(durable.stored.personalisation);
        const rollbackRevision = Math.max(durable.stored.revision, revisionFloor);
        publish(
          owner,
          rollbackRevision,
          durable.stored.revision,
          false,
          "lineup.persistenceFailed",
        );
        failMutations(failed, rollbackRevision);
      } finally {
        activeWrite = null;
        if (inFlight === batch) inFlight = [];
        scheduleWrite();
      }
    })();
    activeWrite = running;
    return running;
  }

  function queueMutation(revision: number, affectedIds: string[]) {
    const owner = store.getState().playlistId;
    const epoch = writeEpoch;
    store.setState({ saving: true, saveError: "" });
    return new Promise<LineupMutationResult>((resolve) => {
      pending.push({ owner, epoch, revision, affectedIds, settled: false, resolve });
      scheduleWrite();
    });
  }

  function prepareLineup(playlist: Playlist): Promise<PreparedLineup> {
    if (!available()) {
      return Promise.reject(new Error(disposed ? "lineup.disposed" : "lineup.unavailable"));
    }
    if (preparedEntry && preparedEntry.playlistId === playlist.id) {
      return preparedEntry.promise;
    }
    const owner = ++generation;
    const migrationEpoch = migrationEpochFor(playlist.id);
    const reading = waitForMigration(playlist.id).then(() => readLineup(playlist.id));
    const settings = import("./settings");
    const promise = Promise.all([reading, settings]).then(
      ([value, { legacyLineupOrderMode }]): PreparedLineup => ({
        controllerId,
        playlistId: playlist.id,
        generation: owner,
        migrationEpoch,
        stored: parseStoredLineup(value),
        hasStored: hasStoredLineupValue(value),
        legacyHiddenCategories: playlist.hiddenCategories?.slice() ?? [],
        legacyOrderMode: legacyLineupOrderMode(),
      }),
    );
    preparedEntry = { playlistId: playlist.id, generation: owner, promise };
    void promise.catch(() => {
      if (preparedEntry?.promise === promise) preparedEntry = null;
    });
    return promise;
  }

  async function adoptCatalogue(
    playlist: Playlist,
    nextCatalogue: ProviderLineup,
    prepared: Promise<PreparedLineup>,
    canAdopt?: () => boolean,
  ): Promise<void> {
    if (!available()) return;
    const awaited = await prepared;
    const current = () =>
      available() &&
      awaited.controllerId === controllerId &&
      awaited.generation === generation &&
      awaited.playlistId === playlist.id &&
      (canAdopt === undefined || canAdopt());
    if (!current()) return;
    let ready = awaited;
    await waitForMigration(playlist.id);
    if (!current()) return;
    const epoch = migrationEpochFor(playlist.id);
    if (epoch !== awaited.migrationEpoch) {
      const value = await readLineup(playlist.id);
      if (!current()) return;
      ready = {
        ...awaited,
        stored: parseStoredLineup(value),
        hasStored: hasStoredLineupValue(value),
        migrationEpoch: epoch,
      };
    }
    if (!current()) return;
    if (preparedEntry?.generation === awaited.generation) preparedEntry = null;
    const previous = store.getState();
    const initial = previous.playlistId !== playlist.id;
    const migrated = clonePersonalisation(
      initial ? ready.stored.personalisation : personalisation,
    );
    let orderMigration = false;
    let hiddenMigration = false;
    if (initial && !ready.hasStored && ready.legacyOrderMode) {
      migrated.categoryOrderModes.live = ready.legacyOrderMode;
      orderMigration = true;
    }
    if (initial) {
      for (const saved of ready.legacyHiddenCategories) {
        if (!saved) continue;
        let key = nextCatalogue.categories.some((category) => category.key === saved)
          ? saved
          : "";
        if (!key) {
          const label = saved.startsWith("Live · ") ? saved.slice(7) : saved;
          const matches = nextCatalogue.categories.filter(
            (category) => category.name === label,
          );
          if (matches.length === 1) key = matches[0].key;
        }
        const target = key || saved;
        if (!migrated.categories[target]?.hidden) {
          migrated.categories[target] = { ...migrated.categories[target], hidden: true };
          hiddenMigration = true;
        }
      }
    }
    const reconciliation = reconcilePersonalisation(migrated, nextCatalogue);
    if (hiddenMigration || orderMigration) reconciliation.changed = true;
    const catalogueChanged = !initial && !sameCatalogue(catalogue, nextCatalogue);
    const baseRevision = initial
      ? Math.max(ready.stored.revision, revisionFloor)
      : previous.revision;
    const revision = baseRevision + (reconciliation.changed || catalogueChanged ? 1 : 0);
    if (initial) durable = { stored: ready.stored };
    personalisation = reconciliation.personalisation;
    catalogue = nextCatalogue;
    publish(
      playlist.id,
      revision,
      durable.stored.revision,
      previous.saving || reconciliation.changed,
      "",
      reconciliation,
    );
    if (reconciliation.changed) {
      void queueMutation(
        revision,
        reconciliation.unavailable.map((item) => item.itemId),
      ).then((result) => {
        if (result.ok && (ready.legacyHiddenCategories.length || ready.legacyOrderMode)) {
          void import("./settings").then(
            ({ completeHiddenCategoryMigration, completeOrderModeMigration }) => {
              if (ready.legacyHiddenCategories.length)
                completeHiddenCategoryMigration(playlist.id);
              if (ready.legacyOrderMode) completeOrderModeMigration(playlist.id);
            },
          );
        }
      });
    } else if (initial && (ready.legacyHiddenCategories.length || ready.legacyOrderMode)) {
      void import("./settings").then(
        ({ completeHiddenCategoryMigration, completeOrderModeMigration }) => {
          if (ready.legacyHiddenCategories.length) completeHiddenCategoryMigration(playlist.id);
          if (ready.legacyOrderMode) completeOrderModeMigration(playlist.id);
        },
      );
    }
  }

  async function adoptCategorySummaries(
    playlist: Playlist,
    categories: readonly ProviderCategory[],
  ): Promise<void> {
    if (!available() || store.getState().playlistId !== playlist.id) return;
    const kinds = new Set(categories.map((category) => category.kind));
    const next = {
      channels: catalogue.channels,
      categories: [
        ...catalogue.categories.filter((category) => !kinds.has(category.kind)),
        ...categories,
      ],
    };
    const state = store.getState();
    const reconciliation = reconcilePersonalisation(personalisation, next);
    const catalogueChanged = !sameCatalogue(catalogue, next);
    if (!reconciliation.changed && !catalogueChanged) return;
    const revision = state.revision + 1;
    personalisation = reconciliation.personalisation;
    catalogue = next;
    publish(
      playlist.id,
      revision,
      durable.stored.revision,
      state.saving || reconciliation.changed,
    );
    if (reconciliation.changed) {
      void queueMutation(
        revision,
        reconciliation.unavailable.map((item) => item.itemId),
      );
    }
  }

  function hasChannel(reference: ChannelRef) {
    if (catalogue.channels.some((channel) => channelRef(channel).id === reference.id))
      return true;
    if (personalisation.channels[reference.id]) return true;
    return personalisation.personalCategories.some((category) =>
      category.channels.some((channel) => channel.id === reference.id),
    );
  }

  function hasCategory(key: string) {
    return (
      catalogue.categories.some((category) => category.key === key) ||
      personalisation.personalCategories.some(
        (category) => personalCategoryKey(category.id) === key,
      ) ||
      Boolean(personalisation.categories[key])
    );
  }

  function defaultCategoryOrder(section: LineupSection): string[] {
    const keys = catalogue.categories
      .filter((category) => category.kind === section)
      .map((category) => category.key);
    if (section === "live") {
      keys.push(
        ...personalisation.personalCategories.map((category) =>
          personalCategoryKey(category.id),
        ),
      );
    }
    return keys;
  }

  function defaultItemOrder(categoryKey: string): string[] {
    const personal = personalisation.personalCategories.find(
      (category) => personalCategoryKey(category.id) === categoryKey,
    );
    if (personal) {
      const available = new Set(catalogue.channels.map((channel) => channelRef(channel).id));
      return personal.channels
        .filter((channel) => available.has(channel.id))
        .map((channel) => channel.id);
    }
    return (
      catalogue.categories.find((category) => category.key === categoryKey)?.channels ?? []
    ).map((channel) => channelRef(channel).id);
  }

  function isDefaultPlacementOrder(
    ids: readonly string[],
    placements: readonly OrderPlacement[],
  ) {
    const { items, unresolved } = applyPlacements(ids, placements, (id) => id);
    return !unresolved.length && items.every((id, index) => id === ids[index]);
  }

  function isDefaultCategoryOrder(section: LineupSection): boolean {
    return isDefaultPlacementOrder(
      defaultCategoryOrder(section),
      personalisation.categoryOrders[section],
    );
  }

  function isDefaultItemOrder(
    categoryKey: string,
    providerOrder: readonly string[] = defaultItemOrder(categoryKey),
  ): boolean {
    return isDefaultPlacementOrder(
      providerOrder,
      personalisation.categories[categoryKey]?.itemOrder ?? [],
    );
  }

  function replacePlacement(placements: OrderPlacement[], placement: OrderPlacement) {
    return [...placements.filter((item) => item.itemId !== placement.itemId), placement];
  }

  function placeCategoryItem(
    categoryKey: string,
    providerOrder: readonly string[],
    placement: OrderPlacement,
  ) {
    const current = { ...personalisation.categories[categoryKey] };
    const placements = replacePlacement(current.itemOrder ?? [], placement);
    if (isDefaultPlacementOrder(providerOrder, placements)) {
      delete current.itemOrder;
    } else {
      current.itemOrder = placements;
    }
    current.itemOrderMode = "custom";
    personalisation.categories[categoryKey] = current;
    clearEmptyCategory(categoryKey);
  }

  function orderedCategoryItems<T>(
    categoryKey: string,
    items: readonly T[],
    idOf: (item: T) => string,
    nameOf: (item: T) => string,
  ): T[] {
    const override = personalisation.categories[categoryKey];
    return orderedItems(
      items,
      override?.itemOrderMode ?? "provider",
      locale,
      override?.itemOrder ?? [],
      idOf,
      nameOf,
    );
  }

  function clearEmptyChannel(id: string) {
    const override = personalisation.channels[id];
    if (override && Object.keys(override).every((key) => key === "sourceFingerprint")) {
      delete personalisation.channels[id];
    }
  }

  function clearEmptyCategory(key: string) {
    const override = personalisation.categories[key];
    if (override && Object.keys(override).length === 0) delete personalisation.categories[key];
  }

  function invalid(
    revision: number,
    reason: "invalid" | "duplicate-number" | "limit" | "unavailable",
  ) {
    return Promise.resolve<LineupMutationResult>({ ok: false, revision, reason });
  }

  function applyLineupMutation(
    expectedRevision: number,
    mutation: LineupMutation,
  ): Promise<LineupMutationResult> {
    const state = store.getState();
    if (!available() || !state.playlistId) return invalid(state.revision, "unavailable");
    if (expectedRevision !== state.revision) {
      return Promise.resolve({ ok: false, revision: state.revision, reason: "conflict" });
    }
    if (mutation.type === "order.mode" && mutation.mode === state.orderMode) {
      return Promise.resolve({ ok: true, revision: state.revision, affectedIds: [] });
    }
    const before = JSON.stringify(personalisation);
    personalisation = clonePersonalisation(personalisation);
    const affectedIds: string[] = [];
    if (mutation.type === "playlist.reset") {
      personalisation = emptyPersonalisation();
      affectedIds.push(`playlist:${state.playlistId}`);
    } else if (mutation.type === "category-order.reset") {
      if (!["live", "movie", "series"].includes(mutation.section)) {
        return invalid(state.revision, "invalid");
      }
      personalisation.categoryOrderModes[mutation.section] = "provider";
      personalisation.categoryOrders[mutation.section] = [];
      affectedIds.push(`categoryOrderMode:${mutation.section}`);
    } else if (mutation.type === "item-order.reset") {
      if (!hasCategory(mutation.categoryKey)) return invalid(state.revision, "unavailable");
      const current = { ...personalisation.categories[mutation.categoryKey] };
      delete current.itemOrder;
      delete current.channelOrder;
      current.itemOrderMode = "provider";
      personalisation.categories[mutation.categoryKey] = current;
      affectedIds.push(mutation.categoryKey);
    } else if (
      mutation.type === "order.mode" ||
      mutation.type === "category-order.mode" ||
      mutation.type === "item-order.mode"
    ) {
      if (!["provider", "alphabetical", "number", "custom"].includes(mutation.mode)) {
        return invalid(state.revision, "invalid");
      }
      if (mutation.type === "category-order.mode") {
        personalisation.categoryOrderModes[mutation.section] = mutation.mode;
        affectedIds.push(`categoryOrderMode:${mutation.section}`);
      } else if (mutation.type === "item-order.mode") {
        if (!hasCategory(mutation.categoryKey)) return invalid(state.revision, "unavailable");
        personalisation.categories[mutation.categoryKey] = {
          ...personalisation.categories[mutation.categoryKey],
          itemOrderMode: mutation.mode,
        };
        affectedIds.push(mutation.categoryKey);
      } else {
        personalisation.orderMode = mutation.mode;
        for (const category of catalogue.categories.filter((item) => item.kind === "live")) {
          personalisation.categories[category.key] = {
            ...personalisation.categories[category.key],
            itemOrderMode: mutation.mode,
          };
        }
        affectedIds.push("orderMode");
      }
    } else if (
      mutation.type === "channel.rename" ||
      mutation.type === "channel.number" ||
      mutation.type === "channel.visibility"
    ) {
      if (!hasChannel(mutation.channel)) return invalid(state.revision, "unavailable");
      const current = { ...personalisation.channels[mutation.channel.id] };
      if (mutation.type === "channel.rename") {
        if (mutation.name !== null && !mutation.name.trim())
          return invalid(state.revision, "invalid");
        if (mutation.name === null) delete current.name;
        else current.name = mutation.name.trim();
      } else if (mutation.type === "channel.number") {
        if (
          mutation.number !== null &&
          (!Number.isInteger(mutation.number) || mutation.number <= 0)
        ) {
          return invalid(state.revision, "invalid");
        }
        if (mutation.number !== null) {
          const collision = state.channels.some(
            (channel) =>
              channelRef(channel).id !== mutation.channel.id &&
              channel.number === mutation.number,
          );
          if (collision && current.number !== mutation.number) {
            return invalid(state.revision, "duplicate-number");
          }
          current.number = mutation.number;
        } else delete current.number;
      } else {
        if (mutation.hidden) current.hidden = true;
        else delete current.hidden;
      }
      if (mutation.channel.sourceFingerprint)
        current.sourceFingerprint = mutation.channel.sourceFingerprint;
      personalisation.channels[mutation.channel.id] = current;
      clearEmptyChannel(mutation.channel.id);
      affectedIds.push(mutation.channel.id);
    } else if (mutation.type === "category.rename" || mutation.type === "category.visibility") {
      if (mutation.categoryKey === "favourites" || !hasCategory(mutation.categoryKey)) {
        return invalid(state.revision, "unavailable");
      }
      const current = { ...personalisation.categories[mutation.categoryKey] };
      if (mutation.type === "category.rename") {
        if (mutation.name !== null && !mutation.name.trim())
          return invalid(state.revision, "invalid");
        if (mutation.name === null) delete current.name;
        else current.name = mutation.name.trim();
      } else if (mutation.hidden) current.hidden = true;
      else delete current.hidden;
      personalisation.categories[mutation.categoryKey] = current;
      clearEmptyCategory(mutation.categoryKey);
      affectedIds.push(mutation.categoryKey);
    } else if (mutation.type === "categories.visibility") {
      if (
        mutation.categoryKeys.some((key) => key === "favourites" || !hasCategory(key)) ||
        !mutation.categoryKeys.length
      ) {
        return invalid(state.revision, "unavailable");
      }
      for (const key of mutation.categoryKeys) {
        const current = { ...personalisation.categories[key] };
        if (mutation.hidden) current.hidden = true;
        else delete current.hidden;
        personalisation.categories[key] = current;
        clearEmptyCategory(key);
        affectedIds.push(key);
      }
    } else if (mutation.type === "channels.visibility") {
      const category = state.managedCategories.find(
        (item) => item.key === mutation.categoryKey && item.kind === "live",
      );
      if (
        !category ||
        category.key === "favourites" ||
        (!CUSTOM_CATEGORIES_ENABLED && category.personal)
      ) {
        return invalid(state.revision, "unavailable");
      }
      const members = state.managedChannels.filter((channel) =>
        channel.categoryKeys.includes(mutation.categoryKey),
      );
      if (!members.length) return invalid(state.revision, "unavailable");
      for (const channel of members) {
        const current = { ...personalisation.channels[channel.ref.id] };
        if (mutation.hidden) current.hidden = true;
        else delete current.hidden;
        if (channel.ref.sourceFingerprint)
          current.sourceFingerprint = channel.ref.sourceFingerprint;
        personalisation.channels[channel.ref.id] = current;
        clearEmptyChannel(channel.ref.id);
      }
      affectedIds.push(mutation.categoryKey);
    } else if (mutation.type === "category.place") {
      const anchorId = mutation.placement.beforeId ?? mutation.placement.afterId;
      const section =
        mutation.section ??
        state.managedCategories.find((category) => category.key === mutation.placement.itemId)
          ?.kind;
      const sectionIds = state.managedCategories
        .filter((category) => category.kind === section)
        .map((category) => category.key);
      if (
        !section ||
        !sectionIds.includes(mutation.placement.itemId) ||
        (anchorId !== undefined && !sectionIds.includes(anchorId)) ||
        (mutation.placement.beforeId !== undefined && mutation.placement.afterId !== undefined)
      ) {
        return invalid(state.revision, "unavailable");
      }
      const placements = replacePlacement(
        personalisation.categoryOrders[section],
        mutation.placement,
      );
      const isDefault = isDefaultPlacementOrder(defaultCategoryOrder(section), placements);
      personalisation.categoryOrders[section] = isDefault ? [] : placements;
      personalisation.categoryOrderModes[section] = "custom";
      affectedIds.push(mutation.placement.itemId);
    } else if (mutation.type === "channel.place" || mutation.type === "item.place") {
      const category = state.categories.find((item) => item.key === mutation.categoryKey);
      const ids = category?.channels.map((item) => channelRef(item).id) ?? [];
      const anchorId = mutation.placement.beforeId ?? mutation.placement.afterId;
      if (
        !category ||
        (mutation.type === "channel.place" &&
          (!ids.includes(mutation.placement.itemId) ||
            (anchorId !== undefined && !ids.includes(anchorId)))) ||
        (mutation.type === "item.place" &&
          (!mutation.providerOrder.includes(mutation.placement.itemId) ||
            (anchorId !== undefined && !mutation.providerOrder.includes(anchorId)))) ||
        (mutation.placement.beforeId !== undefined && mutation.placement.afterId !== undefined)
      ) {
        return invalid(state.revision, "unavailable");
      }
      placeCategoryItem(
        mutation.categoryKey,
        mutation.type === "item.place"
          ? mutation.providerOrder
          : defaultItemOrder(mutation.categoryKey),
        mutation.placement,
      );
      affectedIds.push(mutation.placement.itemId);
    } else if (mutation.type === "personal-category.create") {
      if (!mutation.name.trim()) return invalid(state.revision, "invalid");
      if (personalisation.personalCategories.length >= MAX_PERSONAL_CATEGORIES) {
        return invalid(state.revision, "limit");
      }
      personalId += 1;
      const id = `${Date.now().toString(36)}-${personalId.toString(36)}`;
      personalisation.personalCategories.push({ id, name: mutation.name.trim(), channels: [] });
      affectedIds.push(personalCategoryKey(id));
    } else if (mutation.type === "personal-category.rename") {
      const category = personalisation.personalCategories.find(
        (item) => item.id === mutation.categoryId,
      );
      if (!category) return invalid(state.revision, "unavailable");
      if (!mutation.name.trim()) return invalid(state.revision, "invalid");
      category.name = mutation.name.trim();
      affectedIds.push(personalCategoryKey(category.id));
    } else if (mutation.type === "personal-category.delete") {
      const before = personalisation.personalCategories.length;
      personalisation.personalCategories = personalisation.personalCategories.filter(
        (item) => item.id !== mutation.categoryId,
      );
      if (before === personalisation.personalCategories.length)
        return invalid(state.revision, "unavailable");
      const key = personalCategoryKey(mutation.categoryId);
      delete personalisation.categories[key];
      personalisation.categoryOrders.live = personalisation.categoryOrders.live.filter(
        (placement) =>
          placement.itemId !== key && placement.beforeId !== key && placement.afterId !== key,
      );
      affectedIds.push(key);
    } else if (mutation.type === "personal-category.memberships") {
      if (!hasChannel(mutation.channel)) return invalid(state.revision, "unavailable");
      if (
        mutation.categoryIds.some(
          (id) => !personalisation.personalCategories.some((category) => category.id === id),
        )
      ) {
        return invalid(state.revision, "unavailable");
      }
      for (const category of personalisation.personalCategories) {
        const contains = mutation.categoryIds.includes(category.id);
        const existing = category.channels.find((item) => item.id === mutation.channel.id);
        const without = category.channels.filter((item) => item.id !== mutation.channel.id);
        const reference = {
          ...mutation.channel,
          ...(mutation.channel.sourceFingerprint || existing?.sourceFingerprint
            ? {
                sourceFingerprint:
                  mutation.channel.sourceFingerprint ?? existing?.sourceFingerprint,
              }
            : {}),
        };
        category.channels = contains ? [...without, reference] : without;
      }
      affectedIds.push(mutation.channel.id, ...mutation.categoryIds.map(personalCategoryKey));
    } else if (mutation.type === "personal-category.place-channel") {
      const category = personalisation.personalCategories.find(
        (item) => item.id === mutation.categoryId,
      );
      const ids = category?.channels.map((item) => item.id) ?? [];
      const anchorId = mutation.placement.beforeId ?? mutation.placement.afterId;
      if (
        !category ||
        !ids.includes(mutation.placement.itemId) ||
        (anchorId !== undefined && !ids.includes(anchorId)) ||
        (mutation.placement.beforeId !== undefined && mutation.placement.afterId !== undefined)
      ) {
        return invalid(state.revision, "unavailable");
      }
      const key = personalCategoryKey(category.id);
      placeCategoryItem(key, defaultItemOrder(key), mutation.placement);
      affectedIds.push(mutation.placement.itemId, key);
    } else if (mutation.type === "unavailable.remove") {
      const unavailable = state.unavailable.find((item) => item.key === mutation.key);
      if (!unavailable) return invalid(state.revision, "unavailable");
      if (unavailable.kind === "channel-override")
        delete personalisation.channels[unavailable.itemId];
      else if (unavailable.kind === "category-override")
        delete personalisation.categories[unavailable.itemId];
      else if (unavailable.kind === "personal-membership") {
        const category = personalisation.personalCategories.find(
          (item) => item.id === unavailable.personalCategoryId,
        );
        if (category)
          category.channels = category.channels.filter(
            (item) => item.id !== unavailable.itemId,
          );
      } else if (unavailable.kind === "category-placement") {
        for (const section of ["live", "movie", "series"] as const) {
          personalisation.categoryOrders[section] = personalisation.categoryOrders[
            section
          ].filter((item) => item.itemId !== unavailable.itemId);
        }
      } else {
        for (const [key, override] of Object.entries(personalisation.categories)) {
          if (`channel-placement:${key}:${unavailable.itemId}` !== unavailable.key) continue;
          override.itemOrder = override.itemOrder?.filter(
            (item) => item.itemId !== unavailable.itemId,
          );
        }
      }
      affectedIds.push(unavailable.itemId);
    }
    if (JSON.stringify(personalisation) === before) {
      return Promise.resolve({ ok: true, revision: state.revision, affectedIds: [] });
    }
    const revision = state.revision + 1;
    publish(state.playlistId, revision, state.durableRevision, true);
    return queueMutation(revision, affectedIds);
  }

  function rematerialise(nextLocale: string): void {
    if (!available()) return;
    const state = store.getState();
    if (locale === nextLocale) return;
    locale = nextLocale;
    publish(
      state.playlistId,
      state.playlistId ? state.revision + 1 : state.revision,
      state.durableRevision,
      state.saving,
      state.saveError,
    );
  }

  async function refreshCatalogue(
    playlist: Playlist,
    nextProvider: ProviderLineup,
    canRefresh?: () => boolean,
  ): Promise<void> {
    if (!available()) return;
    const state = store.getState();
    if (state.playlistId !== playlist.id) return;
    if (canRefresh && !canRefresh()) return;
    const reconciliation = reconcilePersonalisation(personalisation, nextProvider);
    const catalogueChanged = !sameCatalogue(catalogue, nextProvider);
    const revision = state.revision + (reconciliation.changed || catalogueChanged ? 1 : 0);
    personalisation = reconciliation.personalisation;
    catalogue = nextProvider;
    publish(
      playlist.id,
      revision,
      durable.stored.revision,
      state.saving || reconciliation.changed,
    );
    if (reconciliation.changed) {
      void queueMutation(
        revision,
        reconciliation.unavailable.map((item) => item.itemId),
      );
    }
  }

  async function flushWrites(): Promise<void> {
    for (;;) {
      if (!activeWrite && pending.length) void flushWrite();
      const running = activeWrite;
      if (!running) return;
      await running;
    }
  }

  function dispose(discardPending: boolean): Promise<void> {
    if (disposed) return drainPromise ?? Promise.resolve();
    disposed = true;
    preparedEntry = null;
    generation += 1;
    cancelPendingWrite?.();
    cancelPendingWrite = null;
    drainPromise = (async () => {
      if (discardPending) {
        writeEpoch += 1;
        const doomed = [...pending, ...inFlight];
        pending = [];
        inFlight = [];
        failMutations(doomed, durable.stored.revision);
        if (store.getState().playlistId) {
          store.setState({ saving: false, saveError: "lineup.persistenceFailed" });
        }
        await (activeWrite ?? Promise.resolve());
      } else {
        await flushWrites();
      }
      personalisation = emptyPersonalisation();
      catalogue = EMPTY_PROVIDER;
      durable = {
        stored: { version: 1, revision: 0, personalisation: emptyPersonalisation() },
      };
      publish("", 0, 0, false);
    })();
    return drainPromise;
  }

  function clearLineupError(): void {
    store.setState({ saveError: "" });
  }

  return {
    controllerId,
    get disposed() {
      return disposed;
    },
    store,
    ownerId: options?.playlistId ?? "",
    ownerSourceVersion: options?.sourceVersion ?? 0,
    prepareLineup,
    adoptCatalogue,
    refreshCatalogue,
    adoptCategorySummaries,
    queryLineup,
    lineupSummary,
    pageLineupItems,
    defaultItemOrder,
    isDefaultCategoryOrder,
    isDefaultItemOrder,
    orderedCategoryItems,
    applyLineupMutation,
    rematerialise,
    clearLineupError,
    flushWrites,
    dispose,
  };
}

export type LineupRole = "playback" | "tv" | "remote";

export interface LineupLease {
  readonly controller: LineupController;
  readonly playlistId: string;
  readonly sourceVersion: number;
  isCurrent(): boolean;
  release(): Promise<void>;
}

export interface LineupController {
  readonly controllerId: string;
  readonly ownerId: string;
  readonly ownerSourceVersion: number;
  readonly disposed: boolean;
  readonly store: UseBoundStore<StoreApi<LineupState>>;
  prepareLineup(playlist: Playlist): Promise<PreparedLineup>;
  adoptCatalogue(
    playlist: Playlist,
    nextCatalogue: ProviderLineup,
    prepared: Promise<PreparedLineup>,
    canAdopt?: () => boolean,
  ): Promise<void>;
  refreshCatalogue(
    playlist: Playlist,
    nextProvider: ProviderLineup,
    canRefresh?: () => boolean,
  ): Promise<void>;
  adoptCategorySummaries(
    playlist: Playlist,
    categories: readonly ProviderCategory[],
  ): Promise<void>;
  queryLineup(query: LineupQuery): LineupQueryResult;
  lineupSummary(): LineupSummary | null;
  pageLineupItems<T extends LineupPageItem>(
    query: LineupQuery,
    items: readonly T[],
    contentVersion?: string,
  ): LineupQueryResult<T>;
  defaultItemOrder(categoryKey: string): string[];
  isDefaultCategoryOrder(section: LineupSection): boolean;
  isDefaultItemOrder(categoryKey: string, providerOrder?: readonly string[]): boolean;
  orderedCategoryItems<T>(
    categoryKey: string,
    items: readonly T[],
    idOf: (item: T) => string,
    nameOf: (item: T) => string,
  ): T[];
  applyLineupMutation(
    expectedRevision: number,
    mutation: LineupMutation,
  ): Promise<LineupMutationResult>;
  rematerialise(nextLocale: string): void;
  clearLineupError(): void;
  flushWrites(): Promise<void>;
  dispose(discardPending: boolean): Promise<void>;
}

class AcquisitionBlocked extends Error {}

interface RoleSlot {
  playlistId: string;
  sourceVersion: number;
  controller: LineupController;
  token: symbol;
}

const slots: Record<LineupRole, RoleSlot | null> = {
  playback: null,
  tv: null,
  remote: null,
};
const retained = new Set<LineupController>();
const draining = new Map<LineupController, Promise<void>>();
const revisionUnsubs = new Map<LineupController, () => void>();
const sourceFences = new Map<string, number>();
const sourceReservations = new Map<string, Map<symbol, number>>();
const removalTasks = new Map<string, Promise<void>>();
const lastSeenRevisions = new Map<string, number>();
const migrationTasks = new Map<string, Promise<void>>();
const migrationEpochs = new Map<string, number>();
let transitionChain: Promise<void> = Promise.resolve();
let resetting = false;
let resetPromise: Promise<void> | null = null;
let rememberedLocale = "en";
let leaseSequence = 0;
let playbackWatchUnsub: (() => void) | null = null;

function migrationEpochFor(playlistId: string): number {
  return migrationEpochs.get(playlistId) ?? 0;
}

function waitForMigration(playlistId: string): Promise<void> {
  return migrationTasks.get(playlistId) ?? Promise.resolve();
}

function sourceBlocked(playlist: Pick<Playlist, "id" | "sourceVersion">): boolean {
  if (resetting || resetPromise !== null) return true;
  if (removalTasks.has(playlist.id)) return true;
  const fence = sourceFences.get(playlist.id);
  if (fence !== undefined && playlist.sourceVersion <= fence) return true;
  return (sourceReservations.get(playlist.id)?.size ?? 0) > 0;
}

function reserveSourceFence(
  playlist: Pick<Playlist, "id" | "sourceVersion">,
): (commit: boolean) => void {
  const token = Symbol(`fence-${playlist.id}`);
  let reservations = sourceReservations.get(playlist.id);
  if (!reservations) {
    reservations = new Map();
    sourceReservations.set(playlist.id, reservations);
  }
  reservations.set(token, playlist.sourceVersion);
  return (commit: boolean) => {
    const held = sourceReservations.get(playlist.id);
    held?.delete(token);
    if (held && held.size === 0) sourceReservations.delete(playlist.id);
    if (commit) {
      sourceFences.set(
        playlist.id,
        Math.max(sourceFences.get(playlist.id) ?? 0, playlist.sourceVersion),
      );
    }
  };
}

function advanceVersionFence(playlist: Pick<Playlist, "id" | "sourceVersion">): void {
  if (playlist.sourceVersion > 1) {
    sourceFences.set(
      playlist.id,
      Math.max(sourceFences.get(playlist.id) ?? 0, playlist.sourceVersion - 1),
    );
  }
}

function enqueueTransition<T>(work: () => Promise<T>): Promise<T> {
  const run = transitionChain.then(work);
  transitionChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function allControllers(): LineupController[] {
  const seen = new Set<LineupController>([idleController]);
  for (const role of ["playback", "tv", "remote"] as const) {
    const slot = slots[role];
    if (slot) seen.add(slot.controller);
  }
  for (const controller of retained) seen.add(controller);
  for (const controller of draining.keys()) seen.add(controller);
  return [...seen];
}

function controllerForPlaylist(
  playlist: Pick<Playlist, "id" | "sourceVersion">,
): LineupController | null {
  for (const controller of retained) {
    if (
      controller.ownerId === playlist.id &&
      controller.ownerSourceVersion === playlist.sourceVersion &&
      !controller.disposed
    ) {
      return controller;
    }
  }
  return null;
}

function findControllerById(controllerId: string): LineupController | null {
  for (const controller of allControllers()) {
    if (controller.controllerId === controllerId) return controller;
  }
  return null;
}

function ensureController(playlist: Pick<Playlist, "id" | "sourceVersion">): LineupController {
  const existing = controllerForPlaylist(playlist);
  if (existing) return existing;
  const floor = lastSeenRevisions.has(playlist.id)
    ? (lastSeenRevisions.get(playlist.id) ?? 0) + 1
    : 0;
  const controller = createLineupController({
    revisionFloor: floor,
    locale: rememberedLocale,
    playlistId: playlist.id,
    sourceVersion: playlist.sourceVersion,
  });
  retained.add(controller);
  revisionUnsubs.set(
    controller,
    controller.store.subscribe((state) => {
      if (!state.playlistId) return;
      const seen = lastSeenRevisions.get(playlist.id);
      if (seen === undefined || state.revision > seen) {
        lastSeenRevisions.set(playlist.id, state.revision);
      }
    }),
  );
  return controller;
}

function slotHolds(controller: LineupController): boolean {
  return (
    slots.playback?.controller === controller ||
    slots.tv?.controller === controller ||
    slots.remote?.controller === controller
  );
}

function trackDrain(controller: LineupController, drain: Promise<void>): void {
  draining.set(controller, drain);
  void drain.then(
    () => {
      draining.delete(controller);
      revisionUnsubs.get(controller)?.();
      revisionUnsubs.delete(controller);
    },
    () => {
      draining.delete(controller);
      revisionUnsubs.get(controller)?.();
      revisionUnsubs.delete(controller);
    },
  );
}

function retireController(controller: LineupController, discardPending: boolean): void {
  if (controller.disposed || slotHolds(controller) || !retained.has(controller)) return;
  retained.delete(controller);
  trackDrain(controller, controller.dispose(discardPending));
}

async function retireOlderVersions(
  playlist: Pick<Playlist, "id" | "sourceVersion">,
): Promise<void> {
  const older: LineupController[] = [];
  for (const role of ["playback", "tv", "remote"] as const) {
    const slot = slots[role];
    if (
      slot &&
      slot.playlistId === playlist.id &&
      slot.sourceVersion < playlist.sourceVersion
    ) {
      slots[role] = null;
      if (role === "playback" && facadeController === slot.controller) {
        detachFacade();
      }
      older.push(slot.controller);
    }
  }
  for (const controller of older) retireController(controller, false);
  const stale = [...draining.entries()].filter(
    ([controller]) =>
      controller.ownerId === playlist.id &&
      controller.ownerSourceVersion < playlist.sourceVersion,
  );
  if (stale.length) await Promise.all(stale.map(([, drain]) => drain));
}

async function ensureAcquisitionController(
  playlist: Pick<Playlist, "id" | "sourceVersion">,
): Promise<LineupController> {
  const live = controllerForPlaylist(playlist);
  if (live) return live;
  const drains = [...draining.entries()]
    .filter(([controller]) => controller.ownerId === playlist.id)
    .map(([, drain]) => drain);
  if (drains.length) await Promise.all(drains);
  if (sourceBlocked(playlist)) {
    throw new AcquisitionBlocked("lineup.sourceBlocked");
  }
  return controllerForPlaylist(playlist) ?? ensureController(playlist);
}

function publishController(controller: LineupController): void {
  if (facadeUnsub) {
    facadeUnsub();
    facadeUnsub = null;
  }
  facadeController = controller;
  useLineup.setState = controller.store.setState;
  facadeUnsub = controller.store.subscribe((state) => {
    facadeSetState(state);
  });
  facadeSetState(controller.store.getState());
}

function detachFacade(): void {
  playbackWatchUnsub?.();
  playbackWatchUnsub = null;
  if (facadeUnsub) {
    facadeUnsub();
    facadeUnsub = null;
  }
}

function armPlaybackWatch(controller: LineupController, playlistId: string): void {
  playbackWatchUnsub?.();
  playbackWatchUnsub = null;
  if (facadeController === controller && facadeUnsub) return;
  const check = (state: LineupState) => {
    if (state.playlistId !== playlistId) return;
    if (slots.playback?.controller !== controller) return;
    playbackWatchUnsub?.();
    playbackWatchUnsub = null;
    publishController(controller);
  };
  playbackWatchUnsub = controller.store.subscribe(check);
  check(controller.store.getState());
}

function facadeEngine(): LineupController {
  return facadeController ?? idleController;
}

export function prepareLineup(playlist: Playlist): Promise<PreparedLineup> {
  if (sourceBlocked(playlist)) {
    const blocked = Promise.reject<PreparedLineup>(
      new AcquisitionBlocked("lineup.sourceBlocked"),
    );
    void blocked.catch(() => {});
    return blocked;
  }
  advanceVersionFence(playlist);
  const request = enqueueTransition(async () => {
    await retireOlderVersions(playlist);
    if (sourceBlocked(playlist)) {
      throw new AcquisitionBlocked("lineup.sourceBlocked");
    }
    const previous = slots.playback;
    if (
      previous &&
      (previous.playlistId !== playlist.id ||
        previous.sourceVersion !== playlist.sourceVersion ||
        previous.controller.disposed)
    ) {
      slots.playback = null;
      detachFacade();
      retireController(previous.controller, true);
    }
    let slot = slots.playback;
    if (
      !slot ||
      slot.playlistId !== playlist.id ||
      slot.sourceVersion !== playlist.sourceVersion ||
      slot.controller.disposed
    ) {
      const controller = await ensureAcquisitionController(playlist);
      if (sourceBlocked(playlist) || controller.disposed) {
        throw new AcquisitionBlocked("lineup.sourceBlocked");
      }
      slot = {
        playlistId: playlist.id,
        sourceVersion: playlist.sourceVersion,
        controller,
        token: Symbol(`playback-${++leaseSequence}`),
      };
      slots.playback = slot;
      armPlaybackWatch(controller, playlist.id);
    }
    return slot.controller;
  }).then((controller) => controller.prepareLineup(playlist));
  void request.catch(() => {});
  return request;
}

export async function adoptCatalogue(
  playlist: Playlist,
  nextCatalogue: ProviderLineup,
  prepared: Promise<PreparedLineup>,
): Promise<void> {
  let ready: PreparedLineup;
  try {
    ready = await prepared;
  } catch (error) {
    if (error instanceof AcquisitionBlocked) return;
    throw error;
  }
  const controller = findControllerById(ready.controllerId);
  if (!controller) return;
  await controller.adoptCatalogue(playlist, nextCatalogue, Promise.resolve(ready));
}

export async function adoptCategorySummaries(
  playlist: Playlist,
  categories: readonly ProviderCategory[],
): Promise<void> {
  const controller = controllerForPlaylist(playlist);
  if (!controller) return;
  await controller.adoptCategorySummaries(playlist, categories);
}

export async function refreshCatalogue(
  playlist: Playlist,
  nextProvider: ProviderLineup,
  canRefresh?: () => boolean,
): Promise<void> {
  const controller = controllerForPlaylist(playlist);
  if (!controller) return;
  await controller.refreshCatalogue(playlist, nextProvider, canRefresh);
}

export function acquireLineup(playlist: Playlist, role: "tv" | "remote"): Promise<LineupLease> {
  if (sourceBlocked(playlist)) {
    return Promise.reject(new AcquisitionBlocked("lineup.sourceBlocked"));
  }
  advanceVersionFence(playlist);
  return enqueueTransition(async () => {
    await retireOlderVersions(playlist);
    if (sourceBlocked(playlist)) {
      throw new AcquisitionBlocked("lineup.sourceBlocked");
    }
    const previous = slots[role];
    const sameOwner =
      previous !== null &&
      previous.playlistId === playlist.id &&
      previous.sourceVersion === playlist.sourceVersion &&
      !previous.controller.disposed;
    if (previous && !sameOwner) {
      slots[role] = null;
      retireController(previous.controller, false);
    }
    const controller =
      previous && sameOwner ? previous.controller : await ensureAcquisitionController(playlist);
    if (sourceBlocked(playlist) || controller.disposed) {
      throw new AcquisitionBlocked("lineup.sourceBlocked");
    }
    const slot: RoleSlot = {
      playlistId: playlist.id,
      sourceVersion: playlist.sourceVersion,
      controller,
      token: Symbol(`lease-${++leaseSequence}`),
    };
    slots[role] = slot;
    const held = slot;
    return {
      controller: held.controller,
      playlistId: held.playlistId,
      sourceVersion: held.sourceVersion,
      isCurrent() {
        return (
          slots[role]?.token === held.token &&
          !held.controller.disposed &&
          !sourceBlocked({
            id: held.playlistId,
            sourceVersion: held.sourceVersion,
          })
        );
      },
      release() {
        return enqueueTransition(async () => {
          if (slots[role]?.token !== held.token) return;
          slots[role] = null;
          retireController(held.controller, false);
        });
      },
    };
  });
}

export function queryLineup(query: LineupQuery): LineupQueryResult {
  return facadeEngine().queryLineup(query);
}

export function lineupSummary(): LineupSummary | null {
  return facadeEngine().lineupSummary();
}

export function pageLineupItems<T extends LineupPageItem>(
  query: LineupQuery,
  items: readonly T[],
  contentVersion = "",
): LineupQueryResult<T> {
  return facadeEngine().pageLineupItems(query, items, contentVersion);
}

export function defaultItemOrder(categoryKey: string): string[] {
  return facadeEngine().defaultItemOrder(categoryKey);
}

export function isDefaultCategoryOrder(section: LineupSection): boolean {
  return facadeEngine().isDefaultCategoryOrder(section);
}

export function isDefaultItemOrder(
  categoryKey: string,
  providerOrder: readonly string[] = facadeEngine().defaultItemOrder(categoryKey),
): boolean {
  return facadeEngine().isDefaultItemOrder(categoryKey, providerOrder);
}

export function orderedCategoryItems<T>(
  categoryKey: string,
  items: readonly T[],
  idOf: (item: T) => string,
  nameOf: (item: T) => string,
): T[] {
  return facadeEngine().orderedCategoryItems(categoryKey, items, idOf, nameOf);
}

export function applyLineupMutation(
  expectedRevision: number,
  mutation: LineupMutation,
): Promise<LineupMutationResult> {
  return facadeEngine().applyLineupMutation(expectedRevision, mutation);
}

export function rematerialise(nextLocale: string): void {
  rememberedLocale = nextLocale;
  for (const controller of allControllers()) controller.rematerialise(nextLocale);
}

export function clearLineupError(): void {
  facadeEngine().clearLineupError();
}

export function removePlaylistLineup(
  playlist: Pick<Playlist, "id" | "sourceVersion">,
): Promise<void> {
  const existing = removalTasks.get(playlist.id);
  if (existing) return existing;
  const task = (async () => {
    const finalize = reserveSourceFence(playlist);
    let facadeDoomed = false;
    try {
      const doomed = allControllers().filter(
        (controller) => controller.ownerId === playlist.id && !controller.disposed,
      );
      const doomedSet = new Set(doomed);
      for (const role of ["playback", "tv", "remote"] as const) {
        const slot = slots[role];
        if (slot && doomedSet.has(slot.controller)) slots[role] = null;
      }
      facadeDoomed = facadeController !== null && doomedSet.has(facadeController);
      if (facadeDoomed) {
        detachFacade();
        facadeSetState({ playlistId: "", saving: false });
      }
      for (const controller of doomed) retireController(controller, true);
      const ownerDrains = () =>
        [...draining.entries()]
          .filter(([controller]) => controller.ownerId === playlist.id)
          .map(([, drain]) => drain);
      await Promise.all([...ownerDrains(), waitForMigration(playlist.id)]);
      await removeLineup(playlist.id);
      finalize(true);
    } catch (error) {
      finalize(false);
      throw error;
    }
    if (facadeDoomed) publishController(idleController);
  })();
  removalTasks.set(playlist.id, task);
  const cleanup = () => {
    if (removalTasks.get(playlist.id) === task) removalTasks.delete(playlist.id);
  };
  void task.then(cleanup, cleanup);
  return task;
}

export function resetLineups(
  playlists: readonly Pick<Playlist, "id" | "sourceVersion">[],
): Promise<void> {
  if (resetPromise !== null) return resetPromise;
  const task = (async () => {
    resetting = true;
    const finalizers = playlists.map((playlist) => reserveSourceFence(playlist));
    const doomed = allControllers().filter(
      (controller) => controller !== idleController && !controller.disposed,
    );
    for (const role of ["playback", "tv", "remote"] as const) slots[role] = null;
    detachFacade();
    facadeSetState({ playlistId: "", saving: false });
    for (const controller of doomed) retireController(controller, true);
    try {
      await Promise.all([...draining.values(), ...migrationTasks.values()]);
      await clearLineups();
      for (const finalize of finalizers) finalize(true);
    } catch (error) {
      for (const finalize of finalizers) finalize(false);
      resetting = false;
      throw error;
    }
    resetting = false;
    publishController(idleController);
  })();
  resetPromise = task;
  const cleanup = () => {
    if (resetPromise === task) resetPromise = null;
  };
  void task.then(cleanup, cleanup);
  return task;
}

export function migrateLegacyOrder(
  playlist: Pick<Playlist, "id" | "sourceVersion">,
  mode: LineupOrderMode,
): Promise<void> {
  const id = playlist.id;
  const existing = migrationTasks.get(id);
  if (existing) return existing;
  migrationEpochs.set(id, (migrationEpochs.get(id) ?? 0) + 1);
  const task = Promise.resolve().then(async () => {
    try {
      const writes = allControllers()
        .filter((controller) => controller.ownerId === id && !controller.disposed)
        .map((controller) => controller.flushWrites());
      await Promise.all(writes);
      const fenced = () => sourceBlocked(playlist);
      if (fenced()) return;
      const value = await readLineup(id);
      if (fenced()) return;
      const stored = parseStoredLineup(value);
      if (!hasStoredLineupValue(value)) {
        stored.personalisation.categoryOrderModes.live = mode;
        const inserted = await writeLineupIfAbsent(id, stored);
        if (!inserted) {
          const again = await readLineup(id);
          if (!hasStoredLineupValue(again)) return;
        }
      }
      const { completeOrderModeMigration } = await import("./settings");
      completeOrderModeMigration(id);
    } finally {
      if (migrationTasks.get(id) === task) migrationTasks.delete(id);
    }
  });
  migrationTasks.set(id, task);
  return task;
}

publishController(idleController);
