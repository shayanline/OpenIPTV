import { sendKey } from "../hooks/useRemote";
import { APP_VERSION, REPO_URL } from "../meta";
import { clearCache, clearPlaylistCache, useChannels } from "../stores/channels";
import { rematerialise, type LineupSummary, useLineup } from "../stores/lineup";
import { useSetup } from "../stores/setup";
import {
  ASPECTS,
  FONT_SIZES,
  isStartupPlaylist,
  type AspectId,
  type Playlist,
  type StartupPlaylist,
  useSettings,
} from "../stores/settings";
import { useStartup } from "../stores/startup";
import {
  directionFor,
  isLocalePreference,
  localeLabelKey,
  LOCALE_OPTIONS,
  resolveLocale,
  translate,
  type LocalePreference,
  type MessageKey,
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
import { forgetAll } from "./disk";
import { clearDeviceAccess } from "./deviceAccess";
import { CUSTOM_CATEGORIES_ENABLED } from "./lineupCapabilities";
import {
  PLAYLIST_ENTRY_MESSAGE,
  PlaylistEntryError,
  type PlaylistEntryProblem,
} from "./playlistEntry";
import type { XtreamAccount } from "./xtream";

type BooleanSetting =
  | "showNumbers"
  | "showLogos"
  | "showClock"
  | "showPlaybackStats"
  | "resumeLast"
  | "compatibility"
  | "continuousReconnect"
  | "hideEmptyCategories"
  | "playlistShortcut"
  | "showLive"
  | "showMovies"
  | "showSeries";
type ChoiceSetting = "locale" | "fontSizeId" | "aspectId";
type SettingCommand =
  | { type: "setting"; key: BooleanSetting; value: boolean }
  | { type: "setting"; key: "locale"; value: LocalePreference }
  | { type: "setting"; key: "fontSizeId"; value: string }
  | { type: "setting"; key: "aspectId"; value: AspectId }
  | { type: "setting"; key: "startupPlaylist"; value: StartupPlaylist };

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
  | { type: "playlist.refresh"; id: string }
  | { type: "cache.clear" }
  | { type: "app.reset" }
  | { type: "device.rename"; id: string; name: string }
  | { type: "device.revoke"; id: string }
  | { type: "remote.key"; code: number };

export interface RemoteSnapshot {
  revision: number;
  locale: string;
  direction: "ltr" | "rtl";
  startupPending: boolean;
  labels: Record<string, string>;
  localeOptions: { id: LocalePreference; label: string; secondary?: string }[];
  settings: {
    locale: LocalePreference;
    fontSizeId: string;
    showNumbers: boolean;
    showLogos: boolean;
    aspectId: AspectId;
    showClock: boolean;
    showPlaybackStats: boolean;
    resumeLast: boolean;
    compatibility: boolean;
    continuousReconnect: boolean;
    hideEmptyCategories: boolean;
    playlistShortcut: boolean;
    startupPlaylist: StartupPlaylist;
    showLive: boolean;
    showMovies: boolean;
    showSeries: boolean;
  };
  capabilities: { customCategories: boolean };
  playlists: RemotePlaylist[];
  activePlaylistId: string;
  lineup: LineupSummary | null;
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
  message?: string;
  cancelled?: boolean;
  snapshot: RemoteSnapshot;
}

const BOOLEAN_SETTINGS = new Set<BooleanSetting>([
  "showNumbers",
  "showLogos",
  "showClock",
  "showPlaybackStats",
  "resumeLast",
  "compatibility",
  "continuousReconnect",
  "hideEmptyCategories",
  "playlistShortcut",
  "showLive",
  "showMovies",
  "showSeries",
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

function remoteM3uUrl(value: string) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(?:user(?:name)?|pass(?:word)?|token|auth|credential|key)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return "";
  }
}

function remoteSource(source: PlaylistSource): RemotePlaylistSource {
  if (source.kind === "m3u") return { kind: "m3u", url: remoteM3uUrl(source.url) };
  let server = "";
  try {
    const url = new URL(source.server);
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
      server = url.toString();
    } else {
      server = source.server;
    }
  } catch {
    server = "";
  }
  return {
    kind: "xtream",
    server,
    username: source.username,
    output: source.output,
    hasPassword: !!source.password,
  };
}

function validSetting(key: unknown, value: unknown): SettingCommand | null {
  if (!text(key)) return null;
  if (key === "startupPlaylist" && isStartupPlaylist(value)) {
    return { type: "setting", key, value };
  }
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
  if (input.type === "playlist.refresh" && exact(input, ["type", "id"]) && text(input.id)) {
    return { type: input.type, id: input.id };
  }
  if (input.type === "cache.clear" && exact(input, ["type"])) {
    return { type: input.type };
  }
  if (input.type === "app.reset" && exact(input, ["type"])) {
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
  const summary = useLineup.getState().lineupSummary();
  const activeSummary =
    summary && summary.playlistId === settings.activePlaylistId ? summary : null;
  return {
    revision,
    locale,
    direction: directionFor(locale),
    startupPending: useStartup.getState().pending,
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
      setupSavedEmpty: t("playlist.savedNoChannels", { name: "{name}" }),
      setupFailedTitle: t("remote.setupFailedTitle"),
      setupLoadFailed: t("remote.setupLoadFailed"),
      manage: t("settings.title"),
      connecting: t("picture.connecting"),
      checkingPlaylist: t("app.loadingPlaylist"),
      saving: `${t("common.save")}…`,
      saved: t("playlist.saved", { name: t("settings.title") }),
      playlists: t("settings.playlists"),
      savedPlaylists: t("playlist.savedPlaylists"),
      playlistUnavailable: t("playlist.unavailable"),
      playlistSavedContent: t("playlist.savedContent"),
      playlistUpdated: t("playlist.updated", { name: "{name}" }),
      refreshing: t("playlist.refreshing"),
      lineup: t("remote.lineup"),
      lineupChannels: t("remote.lineupChannels"),
      lineupMovies: t("content.movies"),
      lineupSeries: t("content.series"),
      lineupCategories: t("remote.lineupCategories"),
      lineupPersonalCategories: t("remote.lineupPersonalCategories"),
      lineupSearch: t("remote.lineupSearch"),
      lineupSearchCategories: t("remote.lineupSearchCategories"),
      lineupSearchChannels: t("search.ariaLabel"),
      lineupSearchTitles: t("remote.lineupSearchTitles"),
      lineupRevealHidden: t("remote.lineupRevealHidden"),
      lineupResults: t("remote.lineupResults", { shown: "{shown}", total: "{total}" }),
      lineupLoadMore: t("remote.lineupLoadMore"),
      lineupLoading: t("remote.lineupLoading"),
      lineupEmpty: t("remote.lineupEmpty"),
      lineupConflict: t("remote.lineupConflict"),
      lineupHidden: t("lineup.hidden"),
      lineupUnavailableItem: t("lineup.unavailable"),
      lineupRestore: t("remote.lineupRestore"),
      lineupRename: t("remote.lineupRename"),
      lineupEditChannel: t("lineup.editChannel"),
      lineupEditCategory: t("lineup.renameCategory"),
      lineupNumber: t("remote.lineupNumber"),
      lineupHide: t("remote.lineupHide"),
      lineupShow: t("remote.lineupShow"),
      lineupCreateCategory: t("remote.lineupCreateCategory"),
      lineupDeleteCategory: t("remote.lineupDeleteCategory"),
      lineupAddMembership: t("remote.lineupAddMembership"),
      lineupRemoveMembership: t("remote.lineupRemoveMembership"),
      lineupRemoveUnavailable: t("remote.lineupRemoveUnavailable"),
      lineupMembers: t("remote.lineupMembers"),
      lineupCount: t("remote.lineupChannelCount"),
      lineupBulkHide: t("lineup.hideAll"),
      lineupBulkShow: t("playlist.showAllCategories"),
      lineupPlaylistSettings: t("lineup.playlistSettings"),
      lineupCategoryVisibility: t("lineup.categoryVisibility"),
      lineupChannelVisibility: t("lineup.channelVisibility"),
      lineupChannelOrder: t("lineup.channelOrder"),
      lineupMovieOrder: t("lineup.movieOrder"),
      lineupSeriesOrder: t("lineup.seriesOrder"),
      lineupEditCustomOrder: t("lineup.editCustomOrder"),
      lineupAllCategoriesIn: t("lineup.allCategoriesIn", { section: "{section}" }),
      lineupHideAllQuestion: t("lineup.hideAllCategoriesQuestion"),
      lineupHideAllBody: t("lineup.hideAllCategoriesBody", {
        section: "{section}",
        playlist: "{playlist}",
      }),
      lineupLive: t("content.live"),
      lineupPrevious: t("common.previous"),
      lineupNext: t("common.next"),
      lineupPage: t("lineup.page", { current: "{current}", total: "{total}" }),
      lineupReorder: t("lineup.sort"),
      lineupGrab: t("lineup.grab"),
      lineupRelease: t("lineup.release"),
      lineupReorderHelp: t("remote.lineupReorderHelp"),
      lineupManageVisibility: t("lineup.manageVisibility"),
      lineupVisibilityHelp: t("lineup.visibilityHelp"),
      lineupBack: t("common.back"),
      lineupSearchToggle: t("common.search"),
      lineupCategorySettings: t("lineup.categorySettings"),
      lineupChannelSettings: t("lineup.channelSettings"),
      lineupMovieSettings: t("lineup.movieSettings"),
      lineupSeriesSettings: t("lineup.seriesSettings"),
      lineupManageCategoryVisibility: t("lineup.manageCategoryVisibility"),
      lineupManageChannelVisibility: t("lineup.manageChannelVisibility"),
      lineupRenameCategories: t("lineup.renameCategories"),
      lineupEditNamesNumbers: t("lineup.editNamesNumbers"),
      lineupContentManagement: t("lineup.contentManagement", { kind: "{kind}" }),
      lineupManageContentHint: t("lineup.manageContentHint"),
      lineupShowAll: t("lineup.showAllItems"),
      lineupHideAll: t("lineup.hideAllItems"),
      lineupHideAllChannelsQuestion: t("lineup.hideAllChannelsQuestion"),
      lineupHideAllChannelsBody: t("lineup.hideAllChannelsBody", {
        category: "{category}",
        playlist: "{playlist}",
      }),
      lineupRemoveUnavailableQuestion: t("lineup.removeUnavailableQuestion"),
      lineupRemoveUnavailableBody: t("lineup.removeUnavailableBody"),
      lineupItemOrder: t("lineup.itemOrder"),
      lineupCategoryOrder: t("lineup.categoryOrder"),
      lineupLoadFailed: t("remote.lineupLoadFailed"),
      lineupFieldName: t("lineup.customName"),
      lineupFieldNumber: t("lineup.channelNumber"),
      lineupVisible: t("lineup.visible"),
      lineupDuplicateNumber: t("lineup.duplicateNumber"),
      lineupInvalidValue: t("lineup.invalidNumber"),
      lineupPersistenceFailed: t("lineup.persistenceFailed"),
      xtreamDetected: t("onboarding.xtreamDetected"),
      keepM3u: t("onboarding.keepM3u"),
      useXtream: t("onboarding.useXtream"),
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
      refresh: t("common.refreshPlaylist"),
      active: t("common.active"),
      activate: t("remote.activate"),
      noAction: t("common.noAction"),
      invalidUrl: t("validation.completeAddress"),
      changeFailed: t("remote.changeFailed"),
      pairingFailed: t("remote.pairingFailed"),
      retry: t("remote.retry"),
      cache: t("settings.clearCache"),
      cacheConfirm: t("settings.clearCacheQuestion"),
      removeConfirm: t("playlist.removeBody"),
      playlistRemoveQuestion: t("playlist.removeQuestion", { name: "{name}" }),
      categoryRemoveQuestion: t("lineup.deletePersonalQuestion"),
      categoryRemoveBody: t("lineup.deletePersonalBody"),
      conflict: t("remote.conflict"),
      unavailable: t("remote.tvUnavailable"),
      revoked: t("remote.revoked"),
      unavailableTitle: t("remote.unavailableTitle"),
      displayOptions: t("remote.displayOptions"),
      actions: t("remote.actions"),
      pairedDevices: t("remote.pairedDevices"),
      deviceNameIphone: t("remote.deviceNameIphone"),
      deviceNameIpad: t("remote.deviceNameIpad"),
      deviceNameAndroidPhone: t("remote.deviceNameAndroidPhone"),
      deviceNameAndroidTablet: t("remote.deviceNameAndroidTablet"),
      deviceNameMac: t("remote.deviceNameMac"),
      deviceNameWindows: t("remote.deviceNameWindows"),
      deviceNameLinux: t("remote.deviceNameLinux"),
      deviceNameBrowser: t("remote.deviceNameBrowser"),
      textSize: t("settings.textSize"),
      small: t("settings.small"),
      medium: t("settings.medium"),
      large: t("settings.large"),
      extraLarge: t("settings.extraLarge"),
      showNumbers: t("settings.showNumbers"),
      showLogos: t("settings.showLogos"),
      showClock: t("settings.showClock"),
      playbackInfo: t("settings.playbackInfo"),
      lineupOrder: t("lineup.order" as MessageKey),
      orderProvider: t("lineup.orderProvider" as MessageKey),
      orderAlphabetical: t("lineup.orderAlphabetical" as MessageKey),
      orderNumber: t("lineup.orderNumber" as MessageKey),
      orderCustom: t("lineup.orderCustom" as MessageKey),
      screenFit: t("settings.screenFit"),
      fill: t("settings.fill"),
      fit: t("settings.fit"),
      stretch: t("settings.stretch"),
      compatibility: t("settings.compatibility"),
      continuousReconnect: t("settings.continuousReconnect"),
      resumeLast: t("settings.resumeLast"),
      hideEmptyCategories: t("settings.hideEmptyCategories"),
      hideEmptyCategoriesHint: t("settings.hideEmptyCategoriesHint"),
      playlistShortcut: t("settings.playlistShortcut"),
      playlistShortcutHint: t("settings.playlistShortcutHint"),
      startupPlaylist: t("settings.startupPlaylist"),
      startupPlaylistHint: t("settings.startupPlaylistHint"),
      startupLast: t("settings.startupLast"),
      startupAsk: t("settings.startupAsk"),
      startupSpecific: t("settings.startupSpecific"),
      startupSelection: t("settings.startupSelection"),
      showLive: t("settings.showLive"),
      showMovies: t("settings.showMovies"),
      showSeries: t("settings.showSeries"),
      content: t("settings.content"),
      managePlaylists: t("playlist.managePlaylists"),
      searchPlaylists: t("playlist.searchPlaylists"),
      lineupNoMatches: t("lineup.noMatches"),
      keepSectionHint: t("settings.keepSectionHint"),
      sectionUnsupportedHint: t("settings.sectionUnsupportedHint"),
      sectionVisibilityHint: t("settings.sectionVisibilityHint"),
      resetRemoteHint: t("settings.resetRemoteHint"),
      resetQuestion: t("playlist.resetQuestion", { name: "{name}" }),
      resetBody: t("playlist.resetBody"),
      resetToDefault: t("lineup.resetDetails"),
      resetData: t("settings.resetData"),
      resetDataQuestion: t("settings.resetDataQuestion"),
      resetDataBody: t("settings.resetDataBody"),
      resetDone: t("settings.resetDone"),
      clearCacheDone: t("settings.clearCacheDone"),
      accountConnectionsCompact: t("playlist.accountConnectionsCompact", {
        active: "{active}",
        maximum: "{maximum}",
      }),
      accountConnectionsOnly: t("playlist.accountConnectionsOnly", {
        active: "{active}",
        total: "{total}",
      }),
      applicationData: t("settings.applicationData"),
      noDevices: t("remote.noDevices"),
      thisDevice: t("remote.thisDevice"),
      lastUsed: t("remote.lastUsed", { when: "{when}" }),
      rename: t("common.rename"),
      revoke: t("remote.revoke"),
      revokeConfirm: t("remote.revokeBody"),
      revokeSelfConfirm: t("remote.revokeSelfBody"),
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
      clear: t("common.clear"),
      manageNav: t("remote.manageNav"),
      menu: t("remote.menu"),
      manageContent: t("remote.manageContent"),
      editCredentials: t("playlist.editCredentials"),
      editAddress: t("playlist.editAddress"),
      removePlaylist: t("remote.removePlaylist"),
      breadcrumbs: t("remote.breadcrumbs"),
      lineupAddChannels: t("remote.lineupAddChannels"),
    },
    localeOptions: LOCALE_OPTIONS.map((option) => ({
      id: option.id,
      label: option.nativeLabel,
      secondary: t(localeLabelKey(option.id)),
    })),
    settings: {
      locale: settings.locale,
      fontSizeId: settings.fontSizeId,
      showNumbers: settings.showNumbers,
      showLogos: settings.showLogos,
      aspectId: settings.aspectId,
      showClock: settings.showClock,
      showPlaybackStats: settings.showPlaybackStats,
      resumeLast: settings.resumeLast,
      compatibility: settings.compatibility,
      continuousReconnect: settings.continuousReconnect,
      hideEmptyCategories: settings.hideEmptyCategories,
      playlistShortcut: settings.playlistShortcut,
      startupPlaylist: settings.startupPlaylist,
      showLive: settings.showLive,
      showMovies: settings.showMovies,
      showSeries: settings.showSeries,
    },
    capabilities: { customCategories: CUSTOM_CATEGORIES_ENABLED },
    playlists: settings.playlists.map((playlist) => ({
      ...playlist,
      source: remoteSource(playlist.source),
      ...(channels.accounts[playlist.id] ? { account: channels.accounts[playlist.id] } : {}),
    })),
    activePlaylistId: settings.activePlaylistId,
    lineup: activeSummary,
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

function result(
  ok: boolean,
  reason?: CommandResult["reason"],
  message?: string,
  cancelled?: boolean,
): CommandResult {
  return {
    ok,
    ...(reason ? { reason } : {}),
    ...(message ? { message } : {}),
    ...(cancelled ? { cancelled: true } : {}),
    snapshot: remoteSnapshot(),
  };
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

async function applySetting(
  command: SettingCommand,
): Promise<"conflict" | "failed" | undefined> {
  const settings = useSettings.getState();
  if (command.key === "locale") {
    settings.set("locale", command.value);
    rematerialise(resolveLocale(command.value));
  } else if (command.key === "fontSizeId") settings.set("fontSizeId", command.value);
  else if (command.key === "aspectId") settings.set("aspectId", command.value);
  else if (command.key === "startupPlaylist") {
    const preference = command.value;
    if (
      preference.mode === "specific" &&
      !settings.playlists.some((playlist) => playlist.id === preference.playlistId)
    ) {
      return "conflict";
    }
    settings.set("startupPlaylist", preference);
  } else settings.set(command.key, command.value);
  if (command.key === "compatibility" && !command.value) stopRepair();
  return;
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

async function perform(
  command: RemoteCommand,
): Promise<CommandResult["reason"] | "cancelled" | undefined> {
  const settings = useSettings.getState();
  const channels = useChannels.getState();
  if (command.type === "remote.key") {
    sendKey(command.code);
    return;
  }
  if (command.type === "setting") return applySetting(command);
  if (command.type === "setup.preview") {
    useSetup.getState().set({ name: command.name, source: command.source });
    return;
  }
  if (command.type === "setup") {
    const source = validSource(command.source);
    if (!source) return "invalid";
    const emptyAtStart = settings.playlists.length === 0;
    const validation = await channels.validatePlaylist(command.name, source);
    if (validation.cancelled) return "cancelled";
    if (validation.error) {
      throw new PlaylistEntryError(validation.problem ?? "network");
    }
    if (!emptyAtStart || useSettings.getState().playlists.length !== 0) {
      return "conflict";
    }
    const playlist = {
      id: playlistId(),
      name:
        command.name.trim() || nameFromUrl(source.kind === "m3u" ? source.url : source.server),
      source,
      sourceVersion: 1,
    };
    settings.replacePlaylists([playlist], playlist.id, command.locale);
    const activation = await channels.activatePlaylist(playlist.id);
    if (activation.error) return "failed";
    useSetup.getState().clear();
    return;
  }
  if (command.type === "playlist.add") {
    const source = validSource(command.source);
    if (!source) return "invalid";
    const validation = await channels.validatePlaylist(command.name, source);
    if (validation.cancelled) return "cancelled";
    if (validation.error) {
      throw new PlaylistEntryError(validation.problem ?? "network");
    }
    const first = useSettings.getState().playlists.length === 0;
    settings.addPlaylist(
      command.name.trim() || nameFromUrl(source.kind === "m3u" ? source.url : source.server),
      source,
    );
    if (first) {
      const active = useSettings.getState().activePlaylistId;
      const activation = await channels.activatePlaylist(active);
      if (activation.error) return "failed";
    }
    return;
  }
  if (command.type === "playlist.update") {
    const playlist = settings.playlists.find((item) => item.id === command.id);
    if (!playlist) return "notFound";
    const password = playlist.source.kind === "xtream" ? playlist.source.password : "";
    const source = validSource(command.source, password);
    if (!source) return "invalid";
    const validation = await channels.validatePlaylist(command.name, source);
    if (validation.cancelled) return "cancelled";
    if (validation.error) {
      throw new PlaylistEntryError(validation.problem ?? "network");
    }
    const current = useSettings.getState();
    const stillThere = current.playlists.find((item) => item.id === command.id);
    if (!stillThere) return "notFound";
    if (
      stillThere.sourceVersion !== playlist.sourceVersion ||
      (playlist.sourceVersion === undefined &&
        JSON.stringify(stillThere.source) !== JSON.stringify(playlist.source))
    ) {
      return "conflict";
    }
    const reload =
      current.activePlaylistId === command.id &&
      JSON.stringify(playlist.source) !== JSON.stringify(source);
    const updated = await settings.updatePlaylist(
      command.id,
      command.name.trim() || nameFromUrl(source.kind === "m3u" ? source.url : source.server),
      source,
    );
    if (!updated) return "failed";
    if (replacesSourceAccount(playlist.source, source)) {
      await clearPlaylistCache(playlist);
      forgetRepairSource(playlist.id);
    }
    if (reload && useSettings.getState().activePlaylistId === command.id) {
      await channels.activatePlaylist(command.id);
    }
    return;
  }
  if (command.type === "playlist.remove") {
    const playlist = settings.playlists.find((item) => item.id === command.id);
    if (!playlist) return "notFound";
    const active = settings.activePlaylistId === command.id;
    if (!(await settings.removePlaylist(command.id))) return "failed";
    await clearPlaylistCache(playlist);
    forgetRepairSource(playlist.id);
    if (active) {
      const promoted = useSettings.getState().activePlaylistId;
      if (promoted) {
        await channels.activatePlaylist(promoted);
      } else await channels.load();
    }
    return;
  }
  if (command.type === "playlist.activate") {
    if (
      useSettings.getState().activePlaylistId === command.id &&
      !useStartup.getState().pending
    ) {
      return;
    }
    const result = await channels.activatePlaylist(command.id);
    return result.activated ? undefined : "notFound";
  }
  if (command.type === "playlist.refresh") {
    const playlist = settings.playlists.find((item) => item.id === command.id);
    if (!playlist) return "notFound";
    const loaded =
      settings.activePlaylistId === playlist.id
        ? await channels.load(true)
        : await channels.refreshPlaylist(playlist);
    return loaded.error ? "failed" : undefined;
  }
  if (command.type === "cache.clear") {
    await clearCache();
    forgetRepairHosts();
    return;
  }
  if (command.type === "app.reset") {
    if (!(await settings.reset())) return "failed";
    await forgetAll();
    stopRepair();
    forgetRepairHosts();
    clearDeviceAccess();
    await channels.load();
    return;
  }
  if (command.type === "device.rename") {
    return renamePairedDevice(command.id, command.name) ? undefined : "notFound";
  }
  return revokePairedDevice(command.id) ? undefined : "notFound";
}

interface GuardedOutcome {
  reason?: CommandResult["reason"];
  message?: string;
  cancelled?: boolean;
}

function safeEntryMessage(problem: PlaylistEntryProblem): string {
  const locale = resolveLocale(useSettings.getState().locale);
  return translate(locale, PLAYLIST_ENTRY_MESSAGE[problem]);
}

function commandSuccessMessage(
  command: RemoteCommand,
  previousName: string,
): string | undefined {
  const settings = useSettings.getState();
  const locale = resolveLocale(settings.locale);
  const t = (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) =>
    translate(locale, key, values);
  const playlist =
    "id" in command ? settings.playlists.find((item) => item.id === command.id) : undefined;
  if (command.type === "playlist.refresh") {
    return t("playlist.refreshed", { count: playlist?.channelCount ?? 0 });
  }
  if (command.type === "playlist.activate") {
    const count = playlist?.channelCount ?? 0;
    return count > 0
      ? t("playlist.loaded", { name: playlist?.name ?? previousName, count })
      : t("playlist.savedNoChannels", { name: playlist?.name ?? previousName });
  }
  if (command.type === "playlist.update") {
    return t("playlist.updated", { name: playlist?.name ?? previousName });
  }
  if (command.type === "playlist.remove") {
    return t("playlist.removed", { name: previousName });
  }
  if (command.type === "playlist.add") {
    const name =
      command.name.trim() ||
      nameFromUrl(command.source.kind === "m3u" ? command.source.url : command.source.server);
    if (settings.playlists.length !== 1) return t("playlist.saved", { name });
    const count = settings.playlists[0].channelCount ?? 0;
    return count > 0
      ? t("playlist.loaded", { name, count })
      : t("playlist.savedNoChannels", { name });
  }
  if (command.type === "setting") return t("playlist.saved", { name: t("settings.title") });
  if (command.type === "cache.clear") return t("settings.clearCacheDone");
  if (command.type === "app.reset") return t("settings.resetDone");
}

async function performGuarded(command: RemoteCommand): Promise<GuardedOutcome> {
  try {
    const previousName =
      "id" in command
        ? (useSettings.getState().playlists.find((playlist) => playlist.id === command.id)
            ?.name ?? "")
        : "";
    const reason = await perform(command);
    if (reason === "cancelled") return { cancelled: true };
    return {
      reason,
      message: reason ? undefined : commandSuccessMessage(command, previousName),
    };
  } catch (error) {
    if (error instanceof PlaylistEntryError) {
      return { reason: "failed", message: safeEntryMessage(error.problem) };
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      return { cancelled: true };
    }
    const locale = resolveLocale(useSettings.getState().locale);
    return { reason: "failed", message: translate(locale, "remote.changeFailed") };
  }
}

async function applyRemoteCommandNow(request: CommandRequest): Promise<CommandResult> {
  const done = completed.get(request.id);
  if (done) return { ...done, snapshot: remoteSnapshot() };
  const command = parseRemoteCommand(request.command);
  if (!request.id || !Number.isInteger(request.revision) || !command) {
    const invalid = result(false, "invalid");
    return request.id ? remember(request.id, invalid) : invalid;
  }
  if (command.type === "setup.preview" || command.type === "remote.key") {
    const outcome = await performGuarded(command);
    if (outcome.cancelled)
      return remember(request.id, result(true, undefined, undefined, true));
    return remember(request.id, result(!outcome.reason, outcome.reason, outcome.message));
  }
  if (request.revision !== revision) return remember(request.id, result(false, "conflict"));

  const outcome = await performGuarded(command);
  if (outcome.cancelled) {
    return remember(request.id, result(true, undefined, undefined, true));
  }
  if (outcome.reason) {
    return remember(request.id, result(false, outcome.reason, outcome.message));
  }
  revision += 1;
  return remember(request.id, result(true, undefined, outcome.message));
}

export function applyRemoteCommand(request: CommandRequest): Promise<CommandResult> {
  const running = commandQueue.then(() => applyRemoteCommandNow(request));
  commandQueue = running.then(
    () => undefined,
    () => undefined,
  );
  return running;
}
