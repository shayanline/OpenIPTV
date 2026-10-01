import { clearCache, useChannels } from "../stores/channels";
import {
  ASPECTS,
  FONT_SIZES,
  type AspectId,
  type Playlist,
  useSettings,
} from "../stores/settings";
import {
  directionFor,
  isLocalePreference,
  LOCALE_OPTIONS,
  resolveLocale,
  translate,
  type LocalePreference,
} from "./locale";
import { checkPlaylistUrl } from "./playlistUrl";
import {
  listPairedPhones,
  renamePairedPhone,
  revokePairedPhone,
  type PairedPhone,
} from "./phoneAccess";
import { forgetRepairHosts, stopRepair } from "./repair";

type BooleanSetting =
  | "showNumbers"
  | "showLogos"
  | "showClock"
  | "resumeLast"
  | "sortAlphabetically"
  | "compatibility";
type ChoiceSetting = "locale" | "fontSizeId" | "aspectId";
type SettingCommand =
  | { type: "setting"; key: BooleanSetting; value: boolean }
  | { type: "setting"; key: "locale"; value: LocalePreference }
  | { type: "setting"; key: "fontSizeId"; value: string }
  | { type: "setting"; key: "aspectId"; value: AspectId };

export type PhoneCommand =
  | SettingCommand
  | { type: "setup"; locale: LocalePreference; name: string; url: string }
  | { type: "playlist.add"; name: string; url: string }
  | { type: "playlist.update"; id: string; name: string; url: string }
  | { type: "playlist.remove"; id: string }
  | { type: "playlist.activate"; id: string }
  | { type: "playlist.refresh" }
  | { type: "cache.clear" }
  | { type: "phone.rename"; id: string; name: string }
  | { type: "phone.revoke"; id: string };

export interface PhoneSnapshot {
  revision: number;
  locale: string;
  direction: "ltr" | "rtl";
  labels: Record<string, string>;
  localeOptions: { id: LocalePreference; label: string }[];
  settings: {
    locale: LocalePreference;
    fontSizeId: string;
    showNumbers: boolean;
    showLogos: boolean;
    aspectId: AspectId;
    showClock: boolean;
    resumeLast: boolean;
    sortAlphabetically: boolean;
    compatibility: boolean;
  };
  playlists: Playlist[];
  activePlaylistId: string;
  phones: PairedPhone[];
  operation: { loading: boolean; error: string; errorKey: string; errorDetail: string };
}

export interface CommandRequest {
  id: string;
  revision: number;
  command: PhoneCommand;
}

export interface CommandResult {
  ok: boolean;
  reason?: "conflict" | "invalid" | "failed" | "notFound";
  snapshot: PhoneSnapshot;
}

const BOOLEAN_SETTINGS = new Set<BooleanSetting>([
  "showNumbers",
  "showLogos",
  "showClock",
  "resumeLast",
  "sortAlphabetically",
  "compatibility",
]);
const CHOICE_SETTINGS = new Set<ChoiceSetting>(["locale", "fontSizeId", "aspectId"]);
const completed = new Map<string, CommandResult>();
let revision = 0;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exact(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...keys].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function text(value: unknown): value is string {
  return typeof value === "string";
}

function validSetting(key: unknown, value: unknown): SettingCommand | null {
  if (!text(key)) return null;
  if (BOOLEAN_SETTINGS.has(key as BooleanSetting) && typeof value === "boolean") {
    return { type: "setting", key: key as BooleanSetting, value };
  }
  if (!CHOICE_SETTINGS.has(key as ChoiceSetting) || !text(value)) return null;
  if (key === "locale" && isLocalePreference(value)) return { type: "setting", key, value };
  if (key === "fontSizeId" && FONT_SIZES.some((option) => option.id === value)) {
    return { type: "setting", key, value };
  }
  if (key === "aspectId" && ASPECTS.some((option) => option.id === value)) {
    return { type: "setting", key, value: value as AspectId };
  }
  return null;
}

export function parsePhoneCommand(value: unknown): PhoneCommand | null {
  const input = record(value);
  if (!input || !text(input.type)) return null;
  if (input.type === "setting" && exact(input, ["type", "key", "value"])) {
    return validSetting(input.key, input.value);
  }
  if (
    input.type === "setup" &&
    exact(input, ["type", "locale", "name", "url"]) &&
    isLocalePreference(input.locale) &&
    text(input.name) &&
    text(input.url)
  ) {
    return { type: input.type, locale: input.locale, name: input.name, url: input.url };
  }
  if (
    (input.type === "playlist.add" || input.type === "playlist.update") &&
    exact(input, input.type === "playlist.add" ? ["type", "name", "url"] : ["type", "id", "name", "url"]) &&
    (input.type === "playlist.add" || text(input.id)) &&
    text(input.name) &&
    text(input.url)
  ) {
    return input.type === "playlist.add"
      ? { type: input.type, name: input.name, url: input.url }
      : { type: input.type, id: input.id as string, name: input.name, url: input.url };
  }
  if (
    (input.type === "playlist.remove" ||
      input.type === "playlist.activate" ||
      input.type === "phone.revoke") &&
    exact(input, ["type", "id"]) &&
    text(input.id)
  ) {
    return { type: input.type, id: input.id };
  }
  if (
    input.type === "phone.rename" &&
    exact(input, ["type", "id", "name"]) &&
    text(input.id) &&
    text(input.name)
  ) {
    return { type: input.type, id: input.id, name: input.name };
  }
  if (
    (input.type === "playlist.refresh" || input.type === "cache.clear") &&
    exact(input, ["type"])
  ) {
    return { type: input.type };
  }
  return null;
}

export function phoneSnapshot(): PhoneSnapshot {
  const settings = useSettings.getState();
  const channels = useChannels.getState();
  const locale = resolveLocale(settings.locale);
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  return {
    revision,
    locale,
    direction: directionFor(locale),
    labels: {
      title: "OpenIPTV",
      pairTitle: t("phone.setupTitle"),
      pairBody: t("phone.setupBody"),
      phoneName: t("phone.phoneName"),
      code: t("phone.codeHint"),
      pair: t("phone.add"),
      setupTitle: t("playlist.addToStart"),
      playlistName: t("onboarding.playlistName"),
      playlistAddress: t("onboarding.playlistAddress"),
      language: t("settings.language"),
      finish: t("common.addPlaylist"),
      playlists: t("settings.playlists"),
      appearance: t("settings.appearance"),
      playback: t("settings.playback"),
      general: t("settings.general"),
      phones: t("settings.phoneAccess"),
      addPlaylist: t("common.addPlaylist"),
      remove: t("common.remove"),
      edit: t("common.edit"),
      refresh: t("common.refreshPlaylist"),
      active: t("common.active"),
      cache: t("settings.clearCache"),
      cacheConfirm: t("settings.clearCacheQuestion"),
      removeConfirm: t("playlist.removeBody"),
      conflict: t("phone.conflict"),
      unavailable: t("phone.tvUnavailable"),
      revoked: t("phone.revoked"),
      textSize: t("settings.textSize"),
      small: t("settings.small"),
      medium: t("settings.medium"),
      large: t("settings.large"),
      extraLarge: t("settings.extraLarge"),
      showNumbers: t("settings.showNumbers"),
      showLogos: t("settings.showLogos"),
      showClock: t("settings.showClock"),
      sortAlphabetically: t("settings.sortAlphabetically"),
      screenFit: t("settings.screenFit"),
      fill: t("settings.fill"),
      fit: t("settings.fit"),
      stretch: t("settings.stretch"),
      compatibility: t("settings.compatibility"),
      resumeLast: t("settings.resumeLast"),
      noPhones: t("phone.noPhones"),
      rename: t("common.edit"),
      revoke: t("phone.revoke"),
      save: t("common.save"),
      cancel: t("common.cancel"),
    },
    localeOptions: LOCALE_OPTIONS.map((option) => ({
      id: option.id,
      label: option.id === "system" ? t("language.system") : option.nativeLabel,
    })),
    settings: {
      locale: settings.locale,
      fontSizeId: settings.fontSizeId,
      showNumbers: settings.showNumbers,
      showLogos: settings.showLogos,
      aspectId: settings.aspectId,
      showClock: settings.showClock,
      resumeLast: settings.resumeLast,
      sortAlphabetically: settings.sortAlphabetically,
      compatibility: settings.compatibility,
    },
    playlists: settings.playlists.map((playlist) => ({ ...playlist })),
    activePlaylistId: settings.activePlaylistId,
    phones: listPairedPhones(),
    operation: {
      loading: channels.loading,
      error: channels.error,
      errorKey: channels.errorKey,
      errorDetail: channels.errorDetail,
    },
  };
}

function result(ok: boolean, reason?: CommandResult["reason"]): CommandResult {
  return { ok, ...(reason ? { reason } : {}), snapshot: phoneSnapshot() };
}

function remember(id: string, value: CommandResult): CommandResult {
  completed.set(id, value);
  if (completed.size > 64) completed.delete(completed.keys().next().value as string);
  return value;
}

function playlistId(): string {
  const existing = new Set(useSettings.getState().playlists.map((playlist) => playlist.id));
  const root = `pl-phone-${Date.now().toString(36)}`;
  let id = root;
  for (let suffix = 2; existing.has(id); suffix += 1) id = `${root}-${suffix}`;
  return id;
}

async function applySetting(command: SettingCommand): Promise<void> {
  const settings = useSettings.getState();
  if (command.key === "locale") settings.set("locale", command.value);
  else if (command.key === "fontSizeId") settings.set("fontSizeId", command.value);
  else if (command.key === "aspectId") settings.set("aspectId", command.value);
  else settings.set(command.key, command.value);

  if (command.key === "compatibility" && !command.value) stopRepair();
  if (
    command.key === "sortAlphabetically" ||
    (command.key === "locale" && useSettings.getState().sortAlphabetically)
  ) {
    await useChannels.getState().load();
  }
}

async function perform(command: PhoneCommand): Promise<CommandResult["reason"] | undefined> {
  const settings = useSettings.getState();
  const channels = useChannels.getState();
  if (command.type === "setting") {
    await applySetting(command);
    return;
  }
  if (command.type === "setup") {
    if (!checkPlaylistUrl(command.url).ok) return "invalid";
    const validation = await channels.validatePlaylist(command.name, command.url.trim());
    if (validation.error || !validation.count) return "failed";
    const playlist = {
      id: playlistId(),
      name: command.name.trim() || new URL(command.url).hostname,
      url: command.url.trim(),
    };
    settings.replacePlaylists([playlist], playlist.id, command.locale);
    await channels.load(true);
    return;
  }
  if (command.type === "playlist.add") {
    if (!checkPlaylistUrl(command.url).ok) return "invalid";
    settings.addPlaylist(command.name, command.url);
    return;
  }
  if (command.type === "playlist.update") {
    if (!settings.playlists.some((playlist) => playlist.id === command.id)) return "notFound";
    if (!checkPlaylistUrl(command.url).ok) return "invalid";
    const active = settings.activePlaylistId === command.id;
    settings.updatePlaylist(command.id, command.name, command.url);
    if (active) await channels.load(true);
    return;
  }
  if (command.type === "playlist.remove") {
    if (!settings.playlists.some((playlist) => playlist.id === command.id)) return "notFound";
    const active = settings.activePlaylistId === command.id;
    settings.removePlaylist(command.id);
    if (active) await channels.load();
    return;
  }
  if (command.type === "playlist.activate") {
    if (!settings.playlists.some((playlist) => playlist.id === command.id)) return "notFound";
    settings.set("activePlaylistId", command.id);
    await channels.load();
    return;
  }
  if (command.type === "playlist.refresh") {
    await channels.load(true);
    return;
  }
  if (command.type === "cache.clear") {
    await clearCache();
    forgetRepairHosts();
    return;
  }
  if (command.type === "phone.rename") {
    return renamePairedPhone(command.id, command.name) ? undefined : "notFound";
  }
  return revokePairedPhone(command.id) ? undefined : "notFound";
}

export async function applyPhoneCommand(request: CommandRequest): Promise<CommandResult> {
  const done = completed.get(request.id);
  if (done) return done;
  if (!request.id || !Number.isInteger(request.revision) || !parsePhoneCommand(request.command)) {
    return remember(request.id, result(false, "invalid"));
  }
  if (request.revision !== revision) return remember(request.id, result(false, "conflict"));

  const failure = await perform(request.command);
  if (failure) return remember(request.id, result(false, failure));
  revision += 1;
  return remember(request.id, result(true));
}
