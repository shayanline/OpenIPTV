import { sendKey } from "../hooks/useRemote";
import { APP_VERSION, REPO_URL } from "../meta";
import { clearCache, clearPlaylistCache, useChannels } from "../stores/channels";
import { useSetup } from "../stores/setup";
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
import {
  m3uSource,
  nameFromUrl,
  type PlaylistSource,
  type XtreamSource,
  xtreamSource,
} from "./playlistUrl";
import {
  listPairedDevices,
  renamePairedDevice,
  revokePairedDevice,
  type PairedDevice,
} from "./deviceAccess";
import { forgetRepairHosts, forgetRepairSource, stopRepair } from "./repair";
import type { XtreamAccount } from "./xtream";

type BooleanSetting =
  | "showNumbers"
  | "showLogos"
  | "showClock"
  | "resumeLast"
  | "sortAlphabetically"
  | "compatibility"
  | "showPlaybackStats";
type ChoiceSetting = "locale" | "fontSizeId" | "aspectId";
type SettingCommand =
  | { type: "setting"; key: BooleanSetting; value: boolean }
  | { type: "setting"; key: "locale"; value: LocalePreference }
  | { type: "setting"; key: "fontSizeId"; value: string }
  | { type: "setting"; key: "aspectId"; value: AspectId };

type RemoteXtreamSource = Omit<XtreamSource, "password"> & { hasPassword: boolean };
type RemotePlaylistSource = Exclude<PlaylistSource, XtreamSource> | RemoteXtreamSource;
type RemotePlaylist = Omit<Playlist, "source"> & {
  source: RemotePlaylistSource;
  account?: XtreamAccount;
};

export type RemoteCommand =
  | SettingCommand
  | { type: "setup"; locale: LocalePreference; name: string; source: PlaylistSource }
  | { type: "setup.preview"; name: string; source: PlaylistSource }
  | { type: "playlist.add"; name: string; source: PlaylistSource }
  | { type: "playlist.update"; id: string; name: string; source: PlaylistSource }
  | { type: "playlist.remove"; id: string }
  | { type: "playlist.activate"; id: string }
  | { type: "playlist.refresh" }
  | { type: "cache.clear" }
  | { type: "device.rename"; id: string; name: string }
  | { type: "device.revoke"; id: string }
  | { type: "remote.key"; code: number };

export interface RemoteSnapshot {
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
    showPlaybackStats: boolean;
  };
  playlists: RemotePlaylist[];
  activePlaylistId: string;
  setup: { name: string; source: RemotePlaylistSource };
  devices: PairedDevice[];
  about: { version: string; repository: string };
  operation: { loading: boolean; error: string; errorKey: string; errorDetail: string };
}

export interface CommandRequest {
  id: string;
  revision: number;
  command: RemoteCommand;
}

export interface CommandResult {
  ok: boolean;
  reason?: "conflict" | "invalid" | "failed" | "notFound";
  snapshot: RemoteSnapshot;
}

const BOOLEAN_SETTINGS = new Set<BooleanSetting>([
  "showNumbers",
  "showLogos",
  "showClock",
  "resumeLast",
  "sortAlphabetically",
  "compatibility",
  "showPlaybackStats",
]);
const CHOICE_SETTINGS = new Set<ChoiceSetting>(["locale", "fontSizeId", "aspectId"]);
const REMOTE_KEYS = new Set([
  13, 37, 38, 39, 40, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 403, 404, 405, 406, 412, 413, 415,
  417, 427, 428, 448, 449, 10009, 10232, 10233, 10252,
]);
const completed = new Map<string, CommandResult>();
let revision = 0;
let commandQueue: Promise<void> = Promise.resolve();

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

function playlistSource(value: unknown): PlaylistSource | null {
  const source = record(value);
  if (!source || !text(source.kind)) return null;
  if (source.kind === "m3u" && exact(source, ["kind", "url"]) && text(source.url)) {
    return { kind: "m3u", url: source.url };
  }
  if (
    source.kind === "xtream" &&
    exact(source, ["kind", "server", "username", "password", "output"]) &&
    text(source.server) &&
    text(source.username) &&
    text(source.password) &&
    (source.output === "m3u8" || source.output === "ts")
  ) {
    return {
      kind: "xtream",
      server: source.server,
      username: source.username,
      password: source.password,
      output: source.output,
    };
  }
  return null;
}

function remoteSource(source: PlaylistSource): RemotePlaylistSource {
  if (source.kind === "m3u") return source;
  return {
    kind: "xtream",
    server: source.server,
    username: source.username,
    output: source.output,
    hasPassword: !!source.password,
  };
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

export function parseRemoteCommand(value: unknown): RemoteCommand | null {
  const input = record(value);
  if (!input || !text(input.type)) return null;
  if (input.type === "setting" && exact(input, ["type", "key", "value"])) {
    return validSetting(input.key, input.value);
  }
  if (
    input.type === "setup" &&
    exact(input, ["type", "locale", "name", "source"]) &&
    isLocalePreference(input.locale) &&
    text(input.name)
  ) {
    const source = playlistSource(input.source);
    return source ? { type: input.type, locale: input.locale, name: input.name, source } : null;
  }
  if (
    input.type === "setup.preview" &&
    exact(input, ["type", "name", "source"]) &&
    text(input.name)
  ) {
    const source = playlistSource(input.source);
    return source ? { type: input.type, name: input.name, source } : null;
  }
  if (
    (input.type === "playlist.add" || input.type === "playlist.update") &&
    exact(
      input,
      input.type === "playlist.add"
        ? ["type", "name", "source"]
        : ["type", "id", "name", "source"],
    ) &&
    (input.type === "playlist.add" || text(input.id)) &&
    text(input.name)
  ) {
    const source = playlistSource(input.source);
    if (!source) return null;
    return input.type === "playlist.add"
      ? { type: input.type, name: input.name, source }
      : { type: input.type, id: input.id as string, name: input.name, source };
  }
  if (
    (input.type === "playlist.remove" ||
      input.type === "playlist.activate" ||
      input.type === "device.revoke") &&
    exact(input, ["type", "id"]) &&
    text(input.id)
  ) {
    return { type: input.type, id: input.id };
  }
  if (
    input.type === "device.rename" &&
    exact(input, ["type", "id", "name"]) &&
    text(input.id) &&
    text(input.name)
  ) {
    return { type: input.type, id: input.id, name: input.name };
  }
  if (
    input.type === "remote.key" &&
    exact(input, ["type", "code"]) &&
    typeof input.code === "number" &&
    REMOTE_KEYS.has(input.code)
  ) {
    return { type: input.type, code: input.code };
  }
  if (
    (input.type === "playlist.refresh" || input.type === "cache.clear") &&
    exact(input, ["type"])
  ) {
    return { type: input.type };
  }
  return null;
}

export function remoteSnapshot(): RemoteSnapshot {
  const settings = useSettings.getState();
  const channels = useChannels.getState();
  const setup = useSetup.getState();
  const locale = resolveLocale(settings.locale);
  const t = (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) =>
    translate(locale, key, values);
  return {
    revision,
    locale,
    direction: directionFor(locale),
    labels: {
      title: "OpenIPTV",
      pairTitle: t("remote.setupTitle"),
      pairBody: t("remote.setupBody"),
      deviceName: t("remote.deviceName"),
      code: t("remote.codeHint"),
      pair: t("remote.add"),
      setupTitle: t("playlist.addToStart"),
      playlistName: t("onboarding.playlistName"),
      playlistAddress: t("onboarding.playlistAddress"),
      m3uPlaylist: t("onboarding.m3uPlaylist"),
      xtreamLogin: t("onboarding.xtreamLogin"),
      serverAddress: t("onboarding.serverAddress"),
      username: t("onboarding.username"),
      password: t("onboarding.password"),
      streamFormat: t("onboarding.streamFormat"),
      hls: t("onboarding.hls"),
      mpegTs: t("onboarding.mpegTs"),
      language: t("settings.language"),
      finish: t("common.addPlaylist"),
      setupCompleteTitle: t("remote.setupCompleteTitle"),
      setupCompleteBody: t("remote.setupCompleteBody", {
        count: channels.channels.length,
      }),
      setupFailedTitle: t("remote.setupFailedTitle"),
      setupLoadFailed: t("remote.setupLoadFailed"),
      manage: t("settings.title"),
      connecting: t("picture.connecting"),
      checkingPlaylist: t("app.loadingPlaylist"),
      saving: `${t("common.save")}…`,
      saved: t("playlist.saved", { name: t("settings.title") }),
      playlists: t("settings.playlists"),
      appearance: t("settings.appearance"),
      playback: t("settings.playback"),
      general: t("settings.general"),
      devices: t("settings.remoteAccess"),
      about: t("settings.about"),
      aboutVersion: t("about.version", { version: APP_VERSION }),
      aboutDescription: t("about.description"),
      aboutDisclaimer: t("about.disclaimer"),
      remoteClose: t("common.close"),
      remoteUp: t("common.up"),
      remoteRight: t("common.right"),
      remoteDown: t("common.down"),
      remoteLeft: t("common.left"),
      remoteSelect: t("common.select"),
      remoteReturn: t("common.returnKey"),
      remotePlayPause: t("remote.remotePlayPause"),
      remoteVolumeUp: t("common.volumeUp"),
      remoteVolumeDown: t("common.volumeDown"),
      remoteChannelUp: t("common.channelUp"),
      remoteChannelDown: t("common.channelDown"),
      remoteRewind: t("common.rewind"),
      remoteFastForward: t("common.fastForward"),
      remoteStop: t("common.stop"),
      remotePlay: t("common.play"),
      remotePrevious: t("common.trackPrevious"),
      remoteNext: t("common.trackNext"),
      remoteRed: t("common.red"),
      remoteGreen: t("common.green"),
      remoteYellow: t("common.yellow"),
      remoteBlue: t("common.blue"),
      addPlaylist: t("common.addPlaylist"),
      remove: t("common.remove"),
      edit: t("common.edit"),
      refresh: t("common.refreshPlaylist"),
      active: t("common.active"),
      activate: t("remote.activate"),
      invalidUrl: t("validation.completeAddress"),
      changeFailed: t("remote.changeFailed"),
      pairingFailed: t("remote.pairingFailed"),
      retry: t("remote.retry"),
      cache: t("settings.clearCache"),
      cacheConfirm: t("settings.clearCacheQuestion"),
      removeConfirm: t("playlist.removeBody"),
      conflict: t("remote.conflict"),
      unavailable: t("remote.tvUnavailable"),
      revoked: t("remote.revoked"),
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
      playbackInfo: t("settings.playbackInfo"),
      resumeLast: t("settings.resumeLast"),
      applicationData: t("settings.applicationData"),
      noDevices: t("remote.noDevices"),
      thisDevice: t("remote.thisDevice"),
      rename: t("common.edit"),
      revoke: t("remote.revoke"),
      revokeConfirm: t("remote.revokeBody"),
      revokeSelfConfirm: t("remote.revokeSelfBody"),
      trustedNetwork: t("remote.trustedNetwork"),
      accountActive: t("playlist.accountActive"),
      accountInactive: t("playlist.accountInactive"),
      accountExpired: t("playlist.accountExpired"),
      accountTrial: t("playlist.accountTrial"),
      accountExpiryUnknown: t("playlist.accountExpiryUnknown"),
      accountExpires: t("playlist.accountExpires", { date: "{date}" }),
      accountConnections: t("playlist.accountConnections", {
        active: "{active}",
        maximum: "{maximum}",
      }),
      save: t("common.save"),
      open: t("common.open"),
      close: t("common.close"),
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
      showPlaybackStats: settings.showPlaybackStats,
    },
    playlists: settings.playlists.map((playlist) => ({
      ...playlist,
      source: remoteSource(playlist.source),
      ...(channels.accounts[playlist.id] ? { account: channels.accounts[playlist.id] } : {}),
    })),
    activePlaylistId: settings.activePlaylistId,
    setup: { name: setup.name, source: remoteSource(setup.source) },
    devices: listPairedDevices(),
    about: { version: APP_VERSION, repository: REPO_URL },
    operation: {
      loading: channels.loading,
      error: channels.error ? t("remote.changeFailed") : "",
      errorKey: channels.errorKey,
      errorDetail: "",
    },
  };
}

function result(ok: boolean, reason?: CommandResult["reason"]): CommandResult {
  return { ok, ...(reason ? { reason } : {}), snapshot: remoteSnapshot() };
}

function remember(id: string, value: CommandResult): CommandResult {
  completed.set(id, value);
  if (completed.size > 64) completed.delete(completed.keys().next().value as string);
  return value;
}

function playlistId(): string {
  const existing = new Set(useSettings.getState().playlists.map((playlist) => playlist.id));
  const root = `pl-remote-${Date.now().toString(36)}`;
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

function replacesSourceAccount(left: PlaylistSource, right: PlaylistSource): boolean {
  return (
    left.kind !== right.kind ||
    (left.kind === "xtream" &&
      right.kind === "xtream" &&
      (left.server !== right.server || left.username !== right.username))
  );
}

function validSource(source: PlaylistSource, password = ""): PlaylistSource | null {
  if (source.kind === "m3u") return m3uSource(source.url);
  return xtreamSource(
    source.server,
    source.username,
    source.password || password,
    source.output,
  );
}

async function perform(command: RemoteCommand): Promise<CommandResult["reason"] | undefined> {
  const settings = useSettings.getState();
  const channels = useChannels.getState();
  if (command.type === "remote.key") {
    sendKey(command.code);
    return;
  }
  if (command.type === "setting") {
    await applySetting(command);
    return;
  }
  if (command.type === "setup.preview") {
    useSetup.getState().set({ name: command.name, source: command.source });
    return;
  }
  if (command.type === "setup") {
    const source = validSource(command.source);
    if (!source) return "invalid";
    const validation = await channels.validatePlaylist(command.name, source);
    if (validation.error || !validation.count) return "failed";
    const playlist = {
      id: playlistId(),
      name:
        command.name.trim() || nameFromUrl(source.kind === "m3u" ? source.url : source.server),
      source,
      sourceVersion: 1,
      hiddenCategories: [],
      hiddenCategoryMode: "exclude" as const,
    };
    settings.replacePlaylists([playlist], playlist.id, command.locale);
    await channels.load(true);
    useSetup.getState().clear();
    return;
  }
  if (command.type === "playlist.add") {
    const source = validSource(command.source);
    if (!source) return "invalid";
    settings.addPlaylist(
      command.name.trim() || nameFromUrl(source.kind === "m3u" ? source.url : source.server),
      source,
    );
    return;
  }
  if (command.type === "playlist.update") {
    const playlist = settings.playlists.find((item) => item.id === command.id);
    if (!playlist) return "notFound";
    const password = playlist.source.kind === "xtream" ? playlist.source.password : "";
    const source = validSource(command.source, password);
    if (!source) return "invalid";
    const reload =
      settings.activePlaylistId === command.id &&
      JSON.stringify(playlist.source) !== JSON.stringify(source);
    settings.updatePlaylist(
      command.id,
      command.name.trim() || nameFromUrl(source.kind === "m3u" ? source.url : source.server),
      source,
    );
    if (replacesSourceAccount(playlist.source, source)) {
      await clearPlaylistCache(playlist);
      forgetRepairSource(playlist.id);
    }
    if (reload) await channels.load(true);
    return;
  }
  if (command.type === "playlist.remove") {
    const playlist = settings.playlists.find((item) => item.id === command.id);
    if (!playlist) return "notFound";
    const active = settings.activePlaylistId === command.id;
    settings.removePlaylist(command.id);
    await clearPlaylistCache(playlist);
    forgetRepairSource(playlist.id);
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
  if (command.type === "device.rename") {
    return renamePairedDevice(command.id, command.name) ? undefined : "notFound";
  }
  return revokePairedDevice(command.id) ? undefined : "notFound";
}

async function applyRemoteCommandNow(request: CommandRequest): Promise<CommandResult> {
  const done = completed.get(request.id);
  if (done) return done;
  const command = parseRemoteCommand(request.command);
  if (!request.id || !Number.isInteger(request.revision) || !command) {
    const invalid = result(false, "invalid");
    return request.id ? remember(request.id, invalid) : invalid;
  }
  if (command.type === "setup.preview" || command.type === "remote.key") {
    const failure = await perform(command);
    return remember(request.id, result(!failure, failure));
  }
  if (request.revision !== revision) return remember(request.id, result(false, "conflict"));

  const failure = await perform(command);
  if (failure) return remember(request.id, result(false, failure));
  revision += 1;
  return remember(request.id, result(true));
}

export function applyRemoteCommand(request: CommandRequest): Promise<CommandResult> {
  const running = commandQueue.then(() => applyRemoteCommandNow(request));
  commandQueue = running.then(
    () => undefined,
    () => undefined,
  );
  return running;
}
