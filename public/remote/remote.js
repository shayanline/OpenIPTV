(function () {
  var root = document.getElementById("app");
  var auth = readAuth();
  var current = null;
  var busy = false;
  var commandInFlight = false;
  var playlistFormEpoch = 0;
  var renderedPlaylistFormEpoch = -1;
  var operationDisabled = [];
  var operationScopeQuery = null;
  var operationScopeKey = "";
  var operationOwner = null;
  var remoteCommandLane = Promise.resolve();
  var playlistRowOperations = new Map();
  var foregroundOperationMessage = "";
  var previewTimer = null;
  var toastTimer = null;
  var toastSequence = 0;
  var notificationHost = null;
  var previewQueue = Promise.resolve();
  var setupDraft = {
    locale: "system",
    name: "",
    url: "",
    server: "",
    username: "",
    password: "",
    output: "m3u8",
  };
  var setupSource = "m3u";
  var addPlaylistSource = "m3u";
  var addPlaylistDraft = {
    name: "",
    url: "",
    server: "",
    username: "",
    password: "",
    output: "m3u8",
  };
  var editingPlaylist = "";
  var editingPlaylistSource = "m3u";
  var addPlaylistDismissedXtream = "";
  var editPlaylistDismissedXtream = "";
  var editingPlaylistDraft = {
    name: "",
    url: "",
    server: "",
    username: "",
    password: "",
    output: "m3u8",
  };
  var editingDevice = "";
  var editingDeviceDraft = "";
  var editingDeviceReturn = null;
  var editingPlaylistReturn = null;
  var contentPlaylistId = "";
  var contentReturnFocus = null;
  var manageView = { page: "playlists", sub: "", subId: "" };
  var itemMenu = null;
  var itemMenuReturn = null;
  var itemMenuSource = null;
  var activeOptionPicker = null;
  var managementViewAnimation = null;
  var managementConfirmation = null;
  var lastRouteHash = "";
  var managementActive = false;
  var addPlaylistDraftActive = false;
  var playlistPage = 0;
  var playlistQuery = "";
  var playlistSearchOpen = false;
  var playlistErrors = {};
  var playlistFormError = "";
  var pairDraft = null;
  var lineupSearchTimer = null;
  var lineupRequestGeneration = 0;
  var preRenderLineupFocus = null;
  var lineupSortDrag = null;
  var lineupBrowseSnapshot = null;
  var pendingLineupBrowseRestore = null;
  var lineupParents = [];
  var lineupResultsHeight = 0;
  var lineupSortAnimations = new Map();
  var lineupSortClickSuppress = { id: "", timer: null };
  var toastOwner = null;
  var TOAST_LIFETIME = {
    neutral: 4000,
    success: 3200,
    error: 5200,
    information: 4000,
    warning: 5200,
  };
  var lineup = {
    playlistId: "",
    sourceVersion: null,
    revision: 0,
    scope: "categories",
    contentKind: "live",
    categoryKey: "",
    categoryName: "",
    categoryKind: "live",
    categoryPersonal: false,
    membershipCategory: "",
    query: "",
    searchOpen: false,
    items: [],
    nextCursor: null,
    cursors: [null],
    pageIndex: 0,
    total: 0,
    orderMode: "provider",
    sectionCounts: null,
    reorder: false,
    loading: false,
    mutating: false,
    error: "",
    notice: "",
    loaded: false,
    hasLoadedPage: false,
    conflictRetried: false,
    editor: null,
    sort: null,
    createDraft: "",
    orderDialog: null,
  };
  var fallback = {
    title: "OpenIPTV",
    pairTitle: "Connect to your TV",
    pairBody: "Keep OpenIPTV open on your television.",
    deviceName: "Device name",
    code: "Pairing code",
    pair: "Connect",
    setupTitle: "Add your first playlist",
    playlistName: "Playlist name",
    playlistAddress: "Playlist address",
    m3uPlaylist: "M3U playlist",
    xtreamLogin: "Xtream login",
    serverAddress: "Server address",
    username: "Username",
    password: "Password",
    streamFormat: "Stream format",
    hls: "HLS (Recommended)",
    mpegTs: "MPEG TS",
    language: "Language",
    finish: "Finish setup",
    setupCompleteTitle: "Your playlist is ready",
    setupCompleteBody:
      "Channels were added to OpenIPTV. Continue on your TV, or open Settings here to manage your playlists and preferences.",
    setupSavedEmpty: "{name} was saved, but it contained no channels.",
    setupFailedTitle: "Couldn’t add this playlist",
    setupLoadFailed: "No channels were found at this address. Check the address and try again.",
    manage: "Settings",
    connecting: "Connecting",
    checkingPlaylist: "Loading the playlist…",
    saving: "Save…",
    saved: "Settings saved.",
    noAction: "No action",
    playlists: "Playlists",
    savedPlaylists: "Saved playlists",
    content: "Content & playlists",
    managePlaylists: "Manage playlists",
    searchPlaylists: "Search playlists",
    lineupNoMatches: "No matching items.",
    hideEmptyCategories: "Hide empty categories",
    hideEmptyCategoriesHint: "Categories with nothing in them are left out.",
    playlistShortcut: "Playlist Shortcut",
    playlistShortcutHint: "Show the active playlist in the main menu for quick switching.",
    showLive: "Live TV",
    showMovies: "Movies",
    showSeries: "Series",
    keepSectionHint: "At least one supported section must stay on.",
    sectionUnsupportedHint: "Available when the active playlist supports this section.",
    sectionVisibilityHint: "Include {section} in the main menu and search results.",
    lineup: "Channels & categories",
    lineupChannels: "Channels",
    lineupCategories: "Categories",
    lineupPersonalCategories: "Custom categories",
    lineupSearch: "Search lineup",
    lineupRevealHidden: "Show hidden",
    lineupResults: "{shown} of {total} items",
    lineupLoadMore: "Load more",
    lineupPrevious: "Previous",
    lineupNext: "Next",
    lineupPage: "Page {current} of {total}",
    lineupLoading: "Loading lineup…",
    lineupEmpty: "No matching lineup items.",
    lineupLoadFailed: "Content could not be loaded. Try again.",
    lineupConflict: "The lineup changed on the TV. The latest page has been loaded.",
    lineupReorder: "Custom Order",
    lineupGrab: "Move",
    lineupRelease: "Place here",
    lineupReorderHelp:
      "Drag the handle to move an item, or select an item and then select where to place it.",
    lineupManageVisibility: "Manage visibility",
    lineupVisibilityHelp: "Select an item to show or hide it.",
    lineupRemoveUnavailableQuestion: "Remove this unavailable personalisation?",
    lineupRemoveUnavailableBody:
      "Only this unavailable override, membership, or position will be removed.",
    lineupFieldName: "Custom name",
    lineupFieldNumber: "Channel number",
    lineupVisible: "Visible",
    lineupItemOrder: "Item order",
    lineupCategoryOrder: "Category order",
    lineupPlaylistSettings: "Playlist settings",
    lineupCategoryVisibility: "Category visibility",
    lineupChannelVisibility: "Channel visibility",
    lineupChannelOrder: "Channel order",
    lineupMovieOrder: "Movie order",
    lineupSeriesOrder: "Series order",
    lineupEditCustomOrder: "Edit custom order",
    lineupAllCategoriesIn: "All categories in {section}",
    lineupDuplicateNumber: "That channel number is already in use.",
    lineupInvalidValue: "Check the values and try again.",
    lineupPersistenceFailed: "The change could not be saved.",
    lineupHidden: "Hidden",
    lineupUnavailableItem: "Unavailable",
    lineupRestore: "Restore provider value",
    lineupRename: "Rename",
    lineupEditChannel: "Edit channel details",
    lineupEditCategory: "Rename category",
    lineupNumber: "Change number",
    lineupHide: "Hide",
    lineupShow: "Show",
    lineupCreateCategory: "Create custom category",
    lineupDeleteCategory: "Delete custom category",
    lineupAddMembership: "Add to category",
    lineupAddChannels: "Add channels",
    lineupRemoveMembership: "Remove from category",
    lineupRemoveUnavailable: "Remove unavailable record",
    lineupMembers: "members",
    lineupCount: "channels",
    lineupBack: "Back",
    lineupSearchToggle: "Search",
    lineupCategorySettings: "Category settings",
    lineupChannelSettings: "Channel settings",
    lineupMovieSettings: "Movie settings",
    lineupSeriesSettings: "Series settings",
    lineupManageCategoryVisibility: "Manage category visibility",
    lineupManageChannelVisibility: "Manage channel visibility",
    lineupRenameCategories: "Rename categories",
    lineupEditNamesNumbers: "Edit channels",
    lineupContentManagement: "Content management ({kind})",
    lineupManageContentHint: "Here you can manage your playlist content.",
    lineupShowAll: "Show All",
    lineupHideAll: "Hide All",
    appearance: "Appearance",
    playback: "Playback",
    devices: "Remote access",
    pairedDevices: "Paired devices",
    about: "About",
    aboutVersion: "Version",
    aboutDescription: "A fast, private IPTV player designed for Samsung TVs.",
    aboutDisclaimer: "OpenIPTV does not provide channels or playlists.",
    remoteClose: "Close",
    remoteUp: "Up",
    remoteRight: "Right",
    remoteDown: "Down",
    remoteLeft: "Left",
    remoteSelect: "Select",
    remoteReturn: "Return",
    remotePlayPause: "Play/Pause",
    remoteVolumeUp: "Volume up",
    remoteVolumeDown: "Volume down",
    remoteChannelUp: "Channel up",
    remoteChannelDown: "Channel down",
    remoteRewind: "Rewind",
    remoteFastForward: "Fast forward",
    remoteStop: "Stop",
    remotePlay: "Play",
    remotePrevious: "Track previous",
    remoteNext: "Track next",
    remoteRed: "Red",
    remoteGreen: "Green",
    remoteYellow: "Yellow",
    remoteBlue: "Blue",
    addPlaylist: "Add playlist",
    remove: "Remove",
    refresh: "Refresh",
    active: "Active",
    activate: "Make active",
    invalidUrl: "That is not a complete web address.",
    changeFailed: "The change could not be saved.",
    pairingFailed: "The pairing code is invalid or has expired.",
    retry: "Try again",
    cache: "Clear downloaded cache",
    cacheConfirm: "Clear downloaded cache?",
    removeConfirm: "This removes the playlist from this device. You can add it again later.",
    playlistRemoveQuestion: "Remove {name}?",
    categoryRemoveQuestion: "Delete this custom category?",
    categoryRemoveBody:
      "The category and its member order will be removed. Provider categories and channels stay unchanged.",
    conflict: "Settings changed on another device. Review and try again.",
    unavailable: "The TV is unavailable. Keep OpenIPTV open and try again.",
    revoked: "This device no longer has access.",
    textSize: "Text size",
    small: "Small",
    medium: "Medium",
    large: "Large",
    extraLarge: "Extra large",
    showNumbers: "Show channel numbers",
    showLogos: "Show channel logos",
    showClock: "Show clock",
    playbackInfo: "Playback information",
    lineupOrder: "Channel order",
    orderProvider: "Provider order",
    orderAlphabetical: "Alphabetical",
    orderNumber: "Channel number",
    orderCustom: "Custom Order",
    lineupLive: "Live",
    lineupMovies: "Movies",
    lineupSeries: "Series",
    lineupSearchCategories: "Search categories",
    lineupSearchChannels: "Search channels",
    lineupSearchTitles: "Search titles",
    manageNav: "Management",
    menu: "Menu",
    manageContent: "Manage content",
    editCredentials: "Edit credentials",
    editAddress: "Edit playlist address",
    removePlaylist: "Remove playlist",
    breadcrumbs: "Breadcrumb",
    xtreamDetected: "This address contains an Xtream login.",
    keepM3u: "Keep M3U",
    useXtream: "Use Xtream",
    screenFit: "Screen fit",
    fill: "Fill",
    fit: "Fit",
    stretch: "Stretch",
    compatibility: "Compatibility mode",
    continuousReconnect: "Continuous reconnect",
    resumeLast: "Resume last channel",
    applicationData: "Application data",
    noDevices: "No devices are authorised.",
    thisDevice: "This device",
    lastUsed: "Last used {when}",
    rename: "Rename",
    revoke: "Remove access",
    revokeConfirm: "This device will need to scan a new QR code before it can connect again.",
    revokeSelfConfirm:
      "This is the device you are using. Removing access will disconnect it, and you will need to add it again.",
    accountActive: "Active",
    accountInactive: "Inactive",
    accountExpired: "Expired",
    accountTrial: "trial",
    accountExpiryUnknown: "Expiry unknown",
    accountExpires: "Expires {date}",
    accountConnections: "{active} of {maximum} connections active",
    accountConnectionsCompact: "{active} of {maximum} connections",
    accountConnectionsOnly: "{active} active connections",
    resetToDefault: "Reset to default",
    resetQuestion: "Reset {name} to default?",
    resetBody:
      "Restore provider names, numbers, visibility and orders. Remove custom categories. Keep the playlist, credentials, favourites, viewing history and app preferences.",
    resetRemoteHint: "This will also disconnect paired devices. Pair again to reconnect.",
    resetData: "Reset app data",
    resetDataQuestion: "Reset app data?",
    resetDataBody:
      "This removes your playlists, favourites, preferences, cached data, and compatibility data from this device.",
    resetDone: "App data reset.",
    clearCacheDone: "Cache cleared.",
    save: "Save",
    open: "Open",
    close: "Close",
    cancel: "Cancel",
    clear: "Clear",
    unavailableTitle: "Cannot reach your TV",
    displayOptions: "Display options",
    actions: "Actions",
    playlistUnavailable: "Unavailable",
    playlistSavedContent: "Saved content",
    playlistUpdated: "{name} updated.",
    refreshing: "Refreshing…",
    deviceNameIphone: "iPhone",
    deviceNameIpad: "iPad",
    deviceNameAndroidPhone: "Android phone",
    deviceNameAndroidTablet: "Android tablet",
    deviceNameMac: "Mac",
    deviceNameWindows: "Windows PC",
    deviceNameLinux: "Linux PC",
    deviceNameBrowser: "Web browser",
  };

  var icons = {
    appearance: '<path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/>',
    playback: '<path d="m17 2-5 5-5-5"/><rect width="20" height="15" x="2" y="7" rx="2"/>',
    playlists: '<path d="M21 5H3M10 12H3M10 19H3"/><path d="M15 12.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997a1 1 0 0 1-1.517-.86z"/>',
    devices: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
    about: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    remote: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    return: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
    play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
    previous: '<path d="M17.971 4.285A2 2 0 0 1 21 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432z"/><path d="M3 20V4"/>',
    rewind: '<path d="M12 6a2 2 0 0 0-3.414-1.414l-6 6a2 2 0 0 0 0 2.828l6 6A2 2 0 0 0 12 18z"/><path d="M22 6a2 2 0 0 0-3.414-1.414l-6 6a2 2 0 0 0 0 2.828l6 6A2 2 0 0 0 22 18z"/>',
    stop: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
    forward: '<path d="M12 6a2 2 0 0 1 3.414-1.414l6 6a2 2 0 0 1 0 2.828l-6 6A2 2 0 0 1 12 18z"/><path d="M2 6a2 2 0 0 1 3.414-1.414l6 6a2 2 0 0 1 0 2.828l-6 6A2 2 0 0 1 2 18z"/>',
    next: '<path d="M21 4v16"/><path d="M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    minus: '<path d="M5 12h14"/>',
    refresh:
      '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    sort: '<path d="M8 5v14"/><path d="m4 9 4-4 4 4"/><path d="M16 19V5"/><path d="m12 15 4 4 4-4"/>',
    categories:
      '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    live: '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49"/><path d="M7.76 16.24a6 6 0 0 1 0-8.49"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M4.93 19.07a10 10 0 0 1 0-14.14"/>',
    movie:
      '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M17 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
    series:
      '<path d="m12 2 10 5-10 5L2 7l10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
    check: '<path d="m9 12 2 2 4-4"/><circle cx="12" cy="12" r="10"/>',
    warn: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    visible:
      '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
    hidden:
      '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
    remove:
      '<path d="M10 11v6M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    clear:
      '<path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"/><path d="m5.082 11.09 8.828 8.828"/>',
  };

  function icon(name, className) {
    return '<svg class="' + (className || "remote-icon") + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + icons[name] + "</svg>";
  }

  function navIcon(name) {
    return icon(name, "tab-icon");
  }

  function remoteOverlayMarkup(l) {
    var digits = "";
    for (var digit = 1; digit <= 9; digit += 1) {
      digits += '<button type="button" data-remote-key="' + (48 + digit) + '">' + digit + "</button>";
    }
    digits += '<span></span><button type="button" data-remote-key="48">0</button><span></span>';
    return (
      '<div class="remote-overlay" data-remote-overlay hidden><button type="button" class="remote-backdrop" data-action="close-remote" aria-label="' + escape(l.remoteClose) + '"></button><section class="remote-sheet" role="dialog" aria-modal="true" aria-labelledby="remote-title"><header><h2 id="remote-title">Smart Remote</h2><button type="button" class="remote-close" data-action="close-remote" aria-label="' + escape(l.remoteClose) + '">' + icon("close") + '</button></header><div class="remote-carousel" data-remote-carousel><div class="remote-track" data-remote-track>' +
      '<div class="remote-page"><div class="mobile-remote"><div class="touch-dpad"><button type="button" class="touch-key up" data-remote-key="38" aria-label="' + escape(l.remoteUp) + '">' + icon("up") + '</button><button type="button" class="touch-key right" data-remote-key="39" aria-label="' + escape(l.remoteRight) + '">' + icon("right") + '</button><button type="button" class="touch-key down" data-remote-key="40" aria-label="' + escape(l.remoteDown) + '">' + icon("down") + '</button><button type="button" class="touch-key left" data-remote-key="37" aria-label="' + escape(l.remoteLeft) + '">' + icon("left") + '</button><button type="button" class="touch-key ok" data-remote-key="13" aria-label="' + escape(l.remoteSelect) + '">OK</button></div><div class="touch-primary"><button type="button" data-remote-key="10009" aria-label="' + escape(l.remoteReturn) + '">' + icon("return") + '<span>' + escape(l.remoteReturn) + '</span></button><button type="button" data-remote-key="10252" aria-label="' + escape(l.remotePlayPause) + '">' + icon("play") + '<span>Play/Pause</span></button></div><div class="touch-rockers"><div class="touch-rocker"><span>VOL</span><div><button type="button" data-remote-key="448" aria-label="' + escape(l.remoteVolumeUp) + '">' + icon("plus") + '</button><button type="button" data-remote-key="449" aria-label="' + escape(l.remoteVolumeDown) + '">' + icon("minus") + '</button></div></div><div class="touch-rocker"><span>CH</span><div><button type="button" data-remote-key="427" aria-label="' + escape(l.remoteChannelUp) + '">' + icon("plus") + '</button><button type="button" data-remote-key="428" aria-label="' + escape(l.remoteChannelDown) + '">' + icon("minus") + '</button></div></div></div></div></div>' +
      '<div class="remote-page"><div class="remote-keypad"><div class="keypad-digits">' + digits + '</div><div class="keypad-transport"><button type="button" data-remote-key="10232" aria-label="' + escape(l.remotePrevious) + '">' + icon("previous", "transport-icon") + '</button><button type="button" data-remote-key="412" aria-label="' + escape(l.remoteRewind) + '">' + icon("rewind", "transport-icon") + '</button><button type="button" data-remote-key="413" aria-label="' + escape(l.remoteStop) + '">' + icon("stop", "transport-icon") + '</button><button type="button" data-remote-key="417" aria-label="' + escape(l.remoteFastForward) + '">' + icon("forward", "transport-icon") + '</button><button type="button" data-remote-key="10233" aria-label="' + escape(l.remoteNext) + '">' + icon("next", "transport-icon") + '</button></div><div class="keypad-colours"><button type="button" class="red" data-remote-key="403" aria-label="' + escape(l.remoteRed) + '"></button><button type="button" class="green" data-remote-key="404" aria-label="' + escape(l.remoteGreen) + '"></button><button type="button" class="yellow" data-remote-key="405" aria-label="' + escape(l.remoteYellow) + '"></button><button type="button" class="blue" data-remote-key="406" aria-label="' + escape(l.remoteBlue) + '"></button></div></div></div></div></div><div class="remote-pages" role="tablist" aria-label="Remote pages"><button type="button" data-remote-page="0" aria-label="Main controls" aria-selected="true"></button><button type="button" data-remote-page="1" aria-label="Keypad controls" aria-selected="false"></button></div></section></div>'
    );
  }

  function remoteLauncherMarkup(l) {
    return (
      '<button type="button" class="manage-remote" data-action="open-remote" aria-label="Smart Remote" aria-expanded="false">' +
      icon("remote") +
      "</button>"
    );
  }

  function managementNavMarkup(l) {
    var items = [
      ["appearance", "appearance", l.appearance],
      ["playback", "playback", l.playback],
      ["playlists", "playlists", l.content],
      ["devices", "devices", l.devices],
      ["about", "about", l.about],
    ];
    return items
      .map(function (item) {
        var current = manageView.page === item[0];
        return (
          '<a class="manage-nav-link" href="#' +
          item[0] +
          '" data-focus-key="nav-' +
          item[0] +
          '"' +
          (current ? ' aria-current="page"' : "") +
          ">" +
          navIcon(item[1]) +
          "<span>" +
          escape(item[2]) +
          "</span></a>"
        );
      })
      .join("");
  }

  function labels() {
    return Object.assign({}, fallback, current && current.labels ? current.labels : {});
  }

  function escape(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sourceFromDraft(kind, draft) {
    return kind === "m3u"
      ? { kind: "m3u", url: draft.url.trim() }
      : {
          kind: "xtream",
          server: draft.server.trim(),
          username: draft.username.trim(),
          password: draft.password,
          output: draft.output,
        };
  }

  function sourceAddress(source) {
    return source.kind === "m3u" ? source.url : source.server;
  }

  function validEntrySource(source, allowSavedPassword) {
    try {
      var address = new URL(sourceAddress(source));
      return (address.protocol === "http:" || address.protocol === "https:") &&
        !!address.hostname &&
        (source.kind === "m3u" ||
          (!!source.username.trim() && (allowSavedPassword || !!source.password.trim())));
    } catch (_error) {
      return false;
    }
  }

  function accountStatus(account, l) {
    if (!account) return "";
    var status = String(account.status || "").toLowerCase();
    var expired = account.expiresAt && account.expiresAt <= Math.floor(Date.now() / 1000);
    var state =
      status === "expired" || expired
        ? l.accountExpired
        : status === "active"
          ? ""
          : l.accountInactive;
    if (account.isTrial) state = state ? state + " " + l.accountTrial : l.accountTrial;
    var segments = [];
    if (state) segments.push(state);
    segments.push(
      account.expiresAt
        ? l.accountExpires.replace(
            "{date}",
            new Date(account.expiresAt * 1000).toLocaleDateString(current.locale),
          )
        : l.accountExpiryUnknown,
    );
    if (account.activeConnections != null) {
      if (typeof account.maxConnections === "number" && account.maxConnections > 0) {
        segments.push(
          (l.accountConnectionsCompact || l.accountConnections)
            .replace("{active}", account.activeConnections)
            .replace("{maximum}", account.maxConnections),
        );
      } else if (l.accountConnectionsOnly) {
        segments.push(
          l.accountConnectionsOnly
            .replace("{active}", account.activeConnections)
            .replace("{total}", account.activeConnections),
        );
      }
    }
    return (
      '<span class="account-status management-row-meta">' +
      escape(segments.join(" · ")) +
      "</span>"
    );
  }

  function sourceOptions(source, l, disabled) {
    disabled = disabled || "";
    return (
      '<div class="source-options"><button type="button" data-source="m3u" aria-pressed="' +
      (source === "m3u") + '"' + disabled + ">" + escape(l.m3uPlaylist) +
      '</button><button type="button" data-source="xtream" aria-pressed="' +
      (source === "xtream") + '"' + disabled + ">" + escape(l.xtreamLogin) + "</button></div>"
    );
  }

  function xtreamFields(prefix, draft, l, disabled, pairCredentials, customPicker) {
    disabled = disabled || "";
    var credentials =
      '<label>' + escape(l.username) + '<input name="' + prefix + 'Username" dir="ltr" value="' + escape(draft.username) + '" required' + disabled + '></label>' +
      '<label>' + escape(l.password) + '<input name="' + prefix + 'Password" type="password" dir="ltr" value="' + escape(draft.password) + '"' + (prefix === "edit" ? "" : " required") + disabled + "></label>";
    if (pairCredentials) {
      credentials = '<div class="xtream-credentials">' + credentials + "</div>";
    }
    var outputField = customPicker
      ? '<div class="option-picker-field"><span>' +
        escape(l.streamFormat) +
        "</span>" +
        optionPickerMarkup({
          name: prefix + "Output",
          label: l.streamFormat,
          value: draft.output,
          options: [
            ["m3u8", l.hls],
            ["ts", l.mpegTs],
          ],
          disabled: !!disabled,
        }) +
        "</div>"
      : '<label>' + escape(l.streamFormat) + '<select name="' + prefix + 'Output"' + disabled + '><option value="m3u8"' +
        (draft.output === "m3u8" ? " selected" : "") + '>' + escape(l.hls) + '</option><option value="ts"' +
        (draft.output === "ts" ? " selected" : "") + '>' + escape(l.mpegTs) + "</option></select></label>";
    return (
      '<label>' + escape(l.serverAddress) + '<input name="' + prefix + 'Server" type="url" inputmode="url" dir="ltr" value="' + escape(draft.server) + '" required' + disabled + '></label>' +
      credentials +
      outputField
    );
  }

  function parseXtreamTemplateUrl(raw, defaultOutput) {
    try {
      var url = new URL(String(raw || "").trim());
      var username = url.searchParams.get("username") || "";
      var password = url.searchParams.get("password") || "";
      var typeParam = url.searchParams.get("type");
      var type = typeParam === null ? "m3u_plus" : typeParam;
      var outputParam = url.searchParams.get("output");
      var requestedOutput = outputParam === null ? defaultOutput || "ts" : outputParam;
      var output = requestedOutput === "mpegts" ? "ts" : requestedOutput;
      if (
        !/\/get\.php$/i.test(url.pathname) ||
        (type !== "m3u_plus" && type !== "m3u") ||
        (output !== "m3u8" && output !== "ts")
      ) {
        return null;
      }
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      if (!url.hostname.includes(".")) return null;
      url.pathname = url.pathname.replace(/\/get\.php$/i, "").replace(/\/+$/, "");
      url.search = "";
      url.hash = "";
      return {
        kind: "xtream",
        server: url.toString().replace(/\/$/, ""),
        username: username.trim(),
        password: password,
        output: output,
      };
    } catch (_error) {
      return null;
    }
  }

  function xtreamSuggestionFor(draft, dismissed) {
    if (!draft || !draft.url || draft.url === dismissed) return null;
    return parseXtreamTemplateUrl(draft.url, "m3u8");
  }

  function xtreamSuggestionMarkup(l, form, draft, dismissed, disabled) {
    disabled = disabled || "";
    return (
      '<div class="xtream-suggestion" data-xtream-suggestion data-form="' + form + '"' +
      (xtreamSuggestionFor(draft, dismissed) ? "" : " hidden") +
      "><p>" + escape(l.xtreamDetected) + '</p><div>' +
      '<button type="button" data-xtream-choice="keep" data-form="' + form + '"' + disabled + ">" +
      escape(l.keepM3u) +
      '</button><button type="button" data-xtream-choice="use" data-form="' + form + '"' + disabled + ">" +
      escape(l.useXtream) +
      "</button></div></div>"
    );
  }

  function syncXtreamSuggestion(input) {
    var scope = input.closest(".add-source-fields");
    var banner = scope ? scope.querySelector("[data-xtream-suggestion]") : null;
    if (!banner) return;
    var isAdd = input.name === "newUrl";
    var draft = isAdd ? addPlaylistDraft : editingPlaylistDraft;
    draft.url = input.value;
    banner.hidden = !xtreamSuggestionFor(
      draft,
      isAdd ? addPlaylistDismissedXtream : editPlaylistDismissedXtream,
    );
  }

  function readAddPlaylistDraft() {
    var draft = Object.assign({}, addPlaylistDraft);
    var name = root.querySelector('[name="newName"]');
    if (name) draft.name = name.value;
    if (addPlaylistSource === "m3u") {
      var url = root.querySelector('[name="newUrl"]');
      if (url) draft.url = url.value;
    } else {
      draft.server = root.querySelector('[name="newServer"]').value;
      draft.username = root.querySelector('[name="newUsername"]').value;
      draft.password = root.querySelector('[name="newPassword"]').value;
      draft.output = root.querySelector('[name="newOutput"]').value;
    }
    return draft;
  }

  function beginPlaylistEdit(playlist) {
    var source = playlist.source;
    editingPlaylist = playlist.id;
    editingPlaylistSource = source.kind;
    editPlaylistDismissedXtream = "";
    editingPlaylistDraft = {
      name: playlist.name,
      url: source.kind === "m3u" ? source.url : "",
      server: source.kind === "xtream" ? source.server : "",
      username: source.kind === "xtream" ? source.username : "",
      password: "",
      output: source.kind === "xtream" ? source.output : "m3u8",
    };
  }

  function readEditPlaylistDraft() {
    var draft = Object.assign({}, editingPlaylistDraft);
    draft.name = root.querySelector('[name="editName"]').value;
    if (editingPlaylistSource === "m3u") {
      draft.url = root.querySelector('[name="editUrl"]').value;
    } else {
      draft.server = root.querySelector('[name="editServer"]').value;
      draft.username = root.querySelector('[name="editUsername"]').value;
      draft.password = root.querySelector('[name="editPassword"]').value;
      draft.output = root.querySelector('[name="editOutput"]').value;
    }
    return draft;
  }

  function readAuth() {
    try {
      var stored = localStorage.getItem("openiptv.remote");
      var legacy = !stored && localStorage.getItem("openiptv.phone");
      var value = JSON.parse(stored || legacy || "null");
      var deviceId = value && (value.deviceId || value.phoneId);
      if (typeof deviceId !== "string" || typeof value.credential !== "string") return null;
      var migrated = { deviceId: deviceId, credential: value.credential };
      if (legacy) {
        localStorage.setItem("openiptv.remote", JSON.stringify(migrated));
        localStorage.removeItem("openiptv.phone");
      }
      return migrated;
    } catch (_error) {
      return null;
    }
  }

  function saveAuth(value) {
    if (auth !== value) {
      managementConfirmation = null;
      editingPlaylist = "";
      editingPlaylistReturn = null;
      playlistFormEpoch += 1;
    }
    auth = value;
    if (value) localStorage.setItem("openiptv.remote", JSON.stringify(value));
    else localStorage.removeItem("openiptv.remote");
  }

  function parsePairSecret() {
    try {
      return new URLSearchParams(window.location.hash.slice(1)).get("pair") || "";
    } catch (_error) {
      return "";
    }
  }

  function defaultDeviceKind() {
    try {
      var agent = String((navigator && navigator.userAgent) || "");
      var data = navigator && navigator.userAgentData;
      var platform = data && data.platform ? String(data.platform) : "";
      var mobile = !!(data && data.mobile);
      if (/iPad/.test(agent) || (platform === "macOS" && mobile)) return "Ipad";
      if (platform === "iOS" || /iPhone/.test(agent)) return "Iphone";
      if (platform === "Android" || /Android/.test(agent)) {
        return mobile || /Mobile/.test(agent) ? "AndroidPhone" : "AndroidTablet";
      }
      if (platform === "Windows" || /Windows/.test(agent)) return "Windows";
      if (platform === "macOS" || /Mac OS X|Macintosh/.test(agent)) return "Mac";
      if (platform === "Linux" || /Linux/.test(agent)) return "Linux";
    } catch (_error) {}
    return "Browser";
  }

  function pairDraftState() {
    if (!pairDraft) {
      var l = labels();
      pairDraft = { name: l["deviceName" + defaultDeviceKind()] || "", code: "" };
    }
    return pairDraft;
  }

  function headers(json) {
    var result = {};
    if (json) result["Content-Type"] = "application/json";
    if (auth) result.Authorization = "Bearer " + auth.deviceId + ":" + auth.credential;
    return result;
  }

  async function request(path, options, failureScope) {
    var scoped = failureScope === "lineup" || failureScope === "confirmation" || failureScope === "operation";
    var requestAuth = auth;
    try {
      var response = await fetch(path, options || { headers: headers(false) });
      if (response.status === 401 && requestAuth) {
        if (auth !== requestAuth) return null;
        var revokedLabel = labels().revoked;
        saveAuth(null);
        invalidateLineupWriteQueues();
        current = null;
        resetPlaylistContent();
        syncLineupOverlayScroll();
        renderPair(revokedLabel);
        return null;
      }
      var body = await response.json();
      if (requestAuth && auth !== requestAuth) return null;
      return { status: response.status, body: body };
    } catch (_error) {
      if (requestAuth && auth !== requestAuth) return null;
      if (scoped) return { status: 0, body: { error: "unavailable" } };
      renderUnavailable();
      return null;
    }
  }

  function managementToastView() {
    return JSON.stringify([
      manageView.page,
      manageView.sub,
      manageView.subId,
      contentPlaylistId,
      currentLineupSignature(),
      lineup.reorder,
      playlistPage,
      lineup.pageIndex,
      playlistQuery,
      lineup.query,
    ]);
  }

  function applyManagementViewAnimation() {
    var normalizedSub = manageView.sub;
    if (
      manageView.page === "playlists" &&
      (normalizedSub === "add" ||
        normalizedSub === "edit" ||
        normalizedSub === "list")
    ) {
      normalizedSub = "list";
    } else if (manageView.page === "playlists" && normalizedSub === "") {
      normalizedSub = "landing";
    }
    var outerKey = JSON.stringify([
      manageView.page,
      normalizedSub,
      normalizedSub === "content" ? contentPlaylistId : "",
    ]);
    var isContent = manageView.page === "playlists" && normalizedSub === "content";
    var innerKey = isContent
      ? JSON.stringify([
          lineup.scope,
          lineup.contentKind,
          lineup.categoryKey,
          lineup.categoryPersonal,
          lineup.membershipCategory,
          !!lineup.reorder,
        ])
      : "";
    var previous = managementViewAnimation;
    var scope = "page";
    var startedAt = Date.now();
    if (previous && previous.auth === auth && previous.outerKey === outerKey) {
      scope = previous.scope;
      startedAt = previous.startedAt;
      if (isContent && previous.innerKey !== innerKey) {
        scope = "content";
        startedAt = Date.now();
      }
    }
    managementViewAnimation = {
      auth: auth,
      outerKey: outerKey,
      innerKey: innerKey,
      startedAt: startedAt,
      scope: scope,
    };
    var target =
      scope === "content"
        ? root.querySelector(".lineup-content")
        : root.querySelector(".manage-page");
    if (
      !target ||
      target.querySelector('[role="dialog"], [role="alertdialog"], dialog')
    ) {
      return;
    }
    target.classList.add("management-view-enter");
    target.style.animationDelay =
      "-" + Math.max(0, Date.now() - startedAt) + "ms";
  }

  function toastIconName(kind) {
    return kind === "success"
      ? "check"
      : kind === "error" || kind === "warning"
      ? "warn"
      : "about";
  }

  function clearNotification(id) {
    if (id != null && (!toastOwner || toastOwner.id !== id)) return;
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = null;
    toastOwner = null;
    toastSequence += 1;
    if (notificationHost) {
      notificationHost.querySelectorAll("[data-operation-status]").forEach(function (notice) {
        notice.remove();
      });
    }
  }

  function showNotification(message, kind, operation) {
    var text = String(message == null ? "" : message);
    if (!text.trim()) return;
    if (kind !== "loading" && !Object.prototype.hasOwnProperty.call(TOAST_LIFETIME, kind)) kind = "neutral";
    var view = managementToastView();
    if (
      toastOwner &&
      toastOwner.auth === auth &&
      toastOwner.view === view &&
      toastOwner.operation === operation &&
      toastOwner.kind === kind &&
      toastOwner.message === text
    ) {
      return toastOwner.id;
    }
    if (!notificationHost || !notificationHost.isConnected) {
      notificationHost = document.createElement("div");
      notificationHost.className = "notification-host";
      notificationHost.innerHTML = '<div role="status" aria-atomic="true"></div><div role="alert" aria-atomic="true"></div>';
      document.body.appendChild(notificationHost);
    }
    clearNotification();
    var notice = document.createElement("div");
    notice.dataset.operationStatus = "true";
    notice.className = "toast " + kind;
    notice.dataset.toastKind = kind;
    notice.innerHTML =
      (kind === "loading" ? '<span class="form-spinner toast-icon" aria-hidden="true"></span>' : icon(toastIconName(kind), "toast-icon")) +
      "<span>" +
      escape(text) +
      "</span>";
    notificationHost.querySelector(kind === "error" ? '[role="alert"]' : '[role="status"]').appendChild(notice);
    var id = ++toastSequence;
    toastOwner = { id: id, auth: auth, view: view, kind: kind, message: text, operation: operation };
    if (kind !== "loading") {
      toastTimer = setTimeout(function () {
        clearNotification(id);
      }, TOAST_LIFETIME[kind]);
    }
    return id;
  }

  function resolveNotification(id, message, kind) {
    if (!toastOwner || toastOwner.id !== id) return;
    if (toastOwner.auth !== auth || toastOwner.view !== managementToastView()) {
      clearNotification(id);
      return;
    }
    if (!message) clearNotification(id);
    else showNotification(message, kind);
  }

  function operationStatus(message, failed, persistent) {
    if (persistent) {
      if (operationOwner) operationOwner.noticeId = showNotification(message, "loading", operationOwner);
      return;
    }
    showNotification(message, failed ? "error" : "success");
  }

  function isOperationCancel(control) {
    var action = control.dataset && control.dataset.action;
    var lineupAction = control.dataset && control.dataset.lineupAction;
    return (
      (typeof action === "string" && action.indexOf("cancel") === 0) ||
      (typeof lineupAction === "string" && lineupAction.indexOf("cancel") === 0) ||
      control.hasAttribute("data-playlist-add-dismiss") ||
      control.hasAttribute("data-playlist-edit-dismiss")
    );
  }

  function entryOverlayBusy(key) {
    return !!(
      busy &&
      operationOwner &&
      operationOwner.epoch === playlistFormEpoch &&
      operationScopeKey === key
    );
  }

  function operationScopeFor(source) {
    if (source && source.closest) {
      var overlay = source.closest("[data-form-overlay]");
      if (overlay && overlay.dataset.formOverlay) {
        var overlayKey = overlay.dataset.formOverlay;
        return {
          key: overlayKey,
          query: function () {
            return root.querySelector('[data-form-overlay="' + overlayKey + '"]');
          },
        };
      }
      if (source.closest(".setup")) {
        return {
          key: "setup",
          query: function () {
            return root.querySelector(".setup");
          },
        };
      }
    }
    return {
      key: "region",
      query: function () {
        return root.querySelector("#manage-main") || root.querySelector(".content") || root;
      },
    };
  }

  function disableOperationScope() {
    operationDisabled = [];
    var scope = operationScopeQuery && operationScopeQuery();
    if (!scope) return;
    scope.querySelectorAll("button, input, select").forEach(function (control) {
      if (isOperationCancel(control)) return;
      if (!control.disabled) {
        control.disabled = true;
        operationDisabled.push(control);
      } else if (control.hasAttribute("data-operation-disabled")) {
        operationDisabled.push(control);
      }
    });
  }

  function releaseOperation(owner) {
    if (owner && owner !== operationOwner) return;
    if (operationOwner && operationOwner.noticeId != null) clearNotification(operationOwner.noticeId);
    var submit = operationOwner && operationOwner.submit;
    if (submit && submit.node.isConnected) {
      submit.node.innerHTML = submit.markup;
      submit.node.removeAttribute("aria-busy");
    }
    busy = false;
    foregroundOperationMessage = "";
    root.removeAttribute("aria-busy");
    operationScopeQuery = null;
    operationScopeKey = "";
    operationOwner = null;
    operationDisabled.forEach(function (control) {
      if (control.isConnected) {
        control.disabled = false;
        control.removeAttribute("data-operation-disabled");
      }
    });
    operationDisabled = [];
  }

  function beginOperation(message, source, quiet, owner) {
    if (busy) return false;
    busy = true;
    operationOwner = owner || captureCommandOwner();
    foregroundOperationMessage = message;
    root.setAttribute("aria-busy", "true");
    if (root.querySelector("[data-form-overlay]")) captureLineupFocus();
    var scope = operationScopeFor(source);
    operationScopeKey = scope.key;
    operationScopeQuery = scope.query;
    var region = scope.query();
    var submit = region && region.querySelector('button[type="submit"]');
    if (submit) {
      operationOwner.submit = { node: submit, markup: submit.innerHTML };
      submit.setAttribute("aria-busy", "true");
      submit.insertAdjacentHTML("afterbegin", '<span class="form-spinner" aria-hidden="true"></span>');
    }
    disableOperationScope();
    if (source && source.tagName === "BUTTON" && source.textContent.trim() && !source.querySelector("svg")) {
      source.textContent = message;
    }
    if (!quiet) operationStatus(message, false, true);
    return true;
  }

  function finishOperation(message, failed) {
    releaseOperation();
    operationStatus(message, failed);
  }

  function syncEntrySaveAvailability() {
    if (busy || commandInFlight) return;
    root
      .querySelectorAll(
        "[data-action='add-playlist'], [data-action='save-playlist'], [data-edit-device] button[type='submit']"
      )
      .forEach(function (button) {
        if (!button.disabled) return;
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.removeAttribute("aria-label");
        var label = button.querySelector(".form-spinner");
        if (label) {
          label.remove();
          button.insertAdjacentHTML("afterbegin", icon("check"));
        }
      });
  }

  function optionPickerOwnerKey() {
    var editor = lineup.editor;
    var playlist = editingPlaylist ? playlistById(editingPlaylist) : null;
    return JSON.stringify([
      manageView.page,
      manageView.sub,
      manageView.subId,
      contentPlaylistId,
      lineup.scope,
      lineup.contentKind,
      lineup.categoryKey,
      lineup.categoryPersonal,
      lineup.membershipCategory,
      editor ? editor.kind : "",
      editor ? editor.id : "",
      addPlaylistDraftActive,
      editingPlaylist,
      editingDevice,
      playlist ? playlistRowSourceVersion(playlist) : null,
    ]);
  }

  function syncOptionPickerValue(nativeSelect) {
    var wrapper = nativeSelect.closest('.option-picker');
    var trigger = wrapper && wrapper.querySelector('[data-picker-trigger]');
    if (!trigger) return;
    var selected = nativeSelect.options[nativeSelect.selectedIndex];
    var valueLabel = selected ? selected.textContent || '' : '';
    trigger.querySelector('.option-picker-value').textContent = valueLabel;
    trigger.setAttribute('aria-label',
      (nativeSelect.getAttribute('aria-label') || '') + ', ' + valueLabel);
  }

  function optionPickerFocusOption(picker, value) {
    var options = Array.from(
      picker.popup.querySelectorAll(".option-picker-option:not(:disabled)"),
    );
    var option = options.find(function (entry) {
      return entry.dataset.pickerValue === value;
    });
    if (!option) option = options[0];
    if (!option) return;
    picker.highlightValue = option.dataset.pickerValue;
    options.forEach(function (entry) {
      entry.classList.toggle("highlighted", entry === option);
    });
    option.focus({ preventScroll: true });
    if (option.offsetTop < picker.popup.scrollTop) {
      picker.popup.scrollTop = option.offsetTop;
    } else if (
      option.offsetTop + option.offsetHeight >
      picker.popup.scrollTop + picker.popup.clientHeight
    ) {
      picker.popup.scrollTop =
        option.offsetTop + option.offsetHeight - picker.popup.clientHeight;
    }
  }

  function positionOptionPicker() {
    var picker = activeOptionPicker;
    if (!picker || !picker.trigger.isConnected || !picker.popup.isConnected) return;
    var rect = picker.trigger.getBoundingClientRect();
    var viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    var viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    var safe = 16;
    var gap = 8;
    var width = Math.max(0, Math.min(Math.max(rect.width, 280), viewportWidth - safe * 2));
    picker.popup.style.width = width + "px";
    picker.popup.style.maxHeight = Math.max(0, Math.min(360, viewportHeight - safe * 2)) + "px";
    var borderHeight = picker.popup.offsetHeight - picker.popup.clientHeight;
    var naturalHeight = Math.min(360, picker.popup.scrollHeight + borderHeight);
    var below = Math.max(0, viewportHeight - safe - rect.bottom - gap);
    var above = Math.max(0, rect.top - gap - safe);
    var openAbove = naturalHeight > below && above > below;
    var available = Math.min(
      openAbove ? above : below,
      Math.max(0, viewportHeight - safe * 2),
    );
    var height = Math.min(naturalHeight, available);
    picker.popup.style.maxHeight = height + "px";
    var top = openAbove ? rect.top - gap - height : rect.bottom + gap;
    top = Math.max(safe, Math.min(top, viewportHeight - safe - height));
    var rtl = getComputedStyle(picker.trigger).direction === "rtl";
    var left = rtl ? rect.left : rect.right - width;
    left = Math.max(safe, Math.min(left, viewportWidth - safe - width));
    picker.popup.style.top = top + "px";
    picker.popup.style.left = left + "px";
  }

  function closeOptionPicker(restoreFocus) {
    var picker = activeOptionPicker;
    if (!picker) return;
    window.removeEventListener("keydown", picker.keyListener, true);
    document.removeEventListener("pointerdown", picker.pointerListener, true);
    window.removeEventListener("resize", picker.positionListener);
    window.removeEventListener("scroll", picker.positionListener, true);
    picker.popup.remove();
    if (picker.trigger.isConnected) {
      picker.trigger.setAttribute("aria-expanded", "false");
      picker.trigger.removeAttribute("aria-controls");
    }
    activeOptionPicker = null;
    if (restoreFocus && picker.trigger.isConnected && !picker.trigger.disabled) {
      picker.trigger.focus({ preventScroll: true });
    }
  }

  function captureOptionPicker() {
    var picker = activeOptionPicker;
    if (!picker) return null;
    var active = document.activeElement;
    var popupFocus = !!(active && picker.popup.contains(active));
    var triggerFocus = active === picker.trigger;
    if (!popupFocus && !triggerFocus) return null;
    return {
      auth: picker.auth,
      ownerKey: picker.ownerKey,
      key: picker.key,
      highlightValue: picker.highlightValue,
      scrollTop: picker.popup.scrollTop,
      popupFocus: popupFocus,
      triggerFocus: triggerFocus,
    };
  }

  function restoreOptionPicker(snapshot, retainBusy) {
    if (
      !snapshot ||
      retainBusy ||
      !managementActive ||
      auth !== snapshot.auth ||
      optionPickerOwnerKey() !== snapshot.ownerKey
    ) {
      return;
    }
    var trigger = Array.from(root.querySelectorAll("[data-picker-trigger]")).find(
      function (entry) {
        return entry.dataset.pickerTrigger === snapshot.key;
      },
    );
    if (!trigger || trigger.disabled) return;
    openOptionPicker(trigger, false);
    if (!activeOptionPicker) return;
    activeOptionPicker.highlightValue = snapshot.highlightValue;
    if (snapshot.popupFocus) {
      optionPickerFocusOption(activeOptionPicker, snapshot.highlightValue);
    } else if (snapshot.triggerFocus) {
      trigger.focus({ preventScroll: true });
    }
    activeOptionPicker.popup.scrollTop = snapshot.scrollTop;
  }

  function openOptionPicker(trigger, keyboard) {
    closeOptionPicker(false);
    var wrapper = trigger.closest(".option-picker");
    var nativeSelect = wrapper && wrapper.querySelector("[data-picker-native]");
    if (
      !wrapper ||
      !nativeSelect ||
      trigger.disabled ||
      nativeSelect.disabled ||
      busy
    ) {
      return;
    }
    var key = trigger.dataset.pickerTrigger;
    var popup = document.createElement("div");
    popup.className = "option-picker-list";
    popup.id = key + "-list";
    popup.setAttribute("role", "listbox");
    popup.setAttribute("aria-label", nativeSelect.getAttribute("aria-label") || "");
    Array.from(nativeSelect.options).forEach(function (nativeOption) {
      var option = document.createElement("button");
      option.type = "button";
      option.className = "option-picker-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(nativeOption.selected));
      option.setAttribute("tabindex", "-1");
      option.dataset.pickerValue = nativeOption.value;
      option.disabled = nativeOption.disabled;
      var text = document.createElement("span");
      text.className = "option-picker-text";
      var primary = document.createElement("span");
      primary.dir = "auto";
      primary.textContent = nativeOption.textContent || "";
      text.appendChild(primary);
      if (nativeOption.dataset.secondary) {
        var secondary = document.createElement("span");
        secondary.className = "option-picker-secondary";
        secondary.dir = "auto";
        secondary.textContent = nativeOption.dataset.secondary;
        text.appendChild(secondary);
      }
      var check = document.createElement("span");
      check.className = "option-picker-check";
      check.setAttribute("aria-hidden", "true");
      if (nativeOption.selected) {
        check.insertAdjacentHTML("beforeend", icon("check"));
      }
      option.appendChild(text);
      option.appendChild(check);
      popup.appendChild(option);
    });
    var owner =
      nativeSelect.closest('[role="dialog"]') || root.querySelector("#manage-main");
    if (!owner) return;
    owner.appendChild(popup);
    trigger.setAttribute("aria-expanded", "true");
    trigger.setAttribute("aria-controls", popup.id);
    var selected = nativeSelect.value;
    var picker = {
      auth: auth,
      ownerKey: optionPickerOwnerKey(),
      key: key,
      nativeSelect: nativeSelect,
      trigger: trigger,
      popup: popup,
      highlightValue: selected,
      keyListener: null,
      pointerListener: null,
      positionListener: null,
    };
    activeOptionPicker = picker;
    picker.keyListener = onOptionPickerKey;
    picker.pointerListener = function (event) {
      var target = event.target;
      if (
        target &&
        (picker.trigger.contains(target) || picker.popup.contains(target))
      ) {
        return;
      }
      closeOptionPicker(false);
    };
    picker.positionListener = positionOptionPicker;
    popup.querySelectorAll(".option-picker-option").forEach(function (option) {
      option.addEventListener("pointerenter", function () {
        if (option.disabled) return;
        optionPickerFocusOption(picker, option.dataset.pickerValue);
      });
      option.addEventListener("click", function () {
        if (!option.disabled) chooseOptionPicker(picker, option.dataset.pickerValue);
      });
    });
    window.addEventListener("keydown", picker.keyListener, true);
    document.addEventListener("pointerdown", picker.pointerListener, true);
    window.addEventListener("resize", picker.positionListener);
    window.addEventListener("scroll", picker.positionListener, true);
    positionOptionPicker();
    if (keyboard) optionPickerFocusOption(picker, selected);
    else trigger.focus({ preventScroll: true });
  }

  function chooseOptionPicker(picker, value) {
    if (
      activeOptionPicker !== picker ||
      !picker.nativeSelect.isConnected ||
      busy
    ) {
      return;
    }
    var option = Array.from(picker.nativeSelect.options).find(function (entry) {
      return entry.value === value;
    });
    if (!option || option.disabled || picker.nativeSelect.disabled) return;
    picker.nativeSelect.value = value;
    var select = picker.nativeSelect;
    syncOptionPickerValue(select);
    closeOptionPicker(true);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function onOptionPickerKey(event) {
    var picker = activeOptionPicker;
    if (!picker) return;
    if (
      !managementActive ||
      auth !== picker.auth ||
      optionPickerOwnerKey() !== picker.ownerKey
    ) {
      closeOptionPicker(false);
      return;
    }
    var target = document.activeElement;
    if (
      !target ||
      (!picker.trigger.contains(target) && !picker.popup.contains(target))
    ) {
      closeOptionPicker(false);
      return;
    }
    var key = event.key;
    var code = event.keyCode;
    if (key === "Escape" || code === 27 || code === 10009) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeOptionPicker(true);
      return;
    }
    if (key === "ArrowLeft" || key === "ArrowRight" || code === 37 || code === 39) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeOptionPicker(true);
      return;
    }
    if (key === "Tab" || code === 9) {
      closeOptionPicker(true);
      return;
    }
    var enabled = Array.from(
      picker.popup.querySelectorAll(".option-picker-option:not(:disabled)"),
    );
    if (!enabled.length) return;
    var currentIndex = enabled.findIndex(function (option) {
      return option.dataset.pickerValue === picker.highlightValue;
    });
    if (key === "ArrowDown" || code === 40) {
      event.preventDefault();
      event.stopImmediatePropagation();
      optionPickerFocusOption(
        picker,
        enabled[Math.min(enabled.length - 1, Math.max(0, currentIndex) + 1)]
          .dataset.pickerValue,
      );
    } else if (key === "ArrowUp" || code === 38) {
      event.preventDefault();
      event.stopImmediatePropagation();
      optionPickerFocusOption(
        picker,
        enabled[Math.max(0, currentIndex <= 0 ? 0 : currentIndex - 1)]
          .dataset.pickerValue,
      );
    } else if (key === "Home" || code === 36) {
      event.preventDefault();
      event.stopImmediatePropagation();
      optionPickerFocusOption(picker, enabled[0].dataset.pickerValue);
    } else if (key === "End" || code === 35) {
      event.preventDefault();
      event.stopImmediatePropagation();
      optionPickerFocusOption(
        picker,
        enabled[enabled.length - 1].dataset.pickerValue,
      );
    } else if (
      key === "Enter" ||
      key === " " ||
      code === 13 ||
      code === 32
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      chooseOptionPicker(picker, picker.highlightValue);
    }
  }

  function resetRender(keepBusy, keepToast) {
    document.documentElement.classList.remove("lineup-reordering");
    if (!keepBusy) {
      if (operationOwner && operationOwner.noticeId != null) clearNotification(operationOwner.noticeId);
      busy = false;
      foregroundOperationMessage = "";
      root.removeAttribute("aria-busy");
      operationScopeQuery = null;
      operationScopeKey = "";
      operationOwner = null;
      operationDisabled = [];
    }
    closeOptionPicker(false);
    document.body.style.overflow = "";
    cancelLineupSortDrag();
    cancelLineupSortAnimations();
    if (!keepToast) {
      clearNotification();
    }
    lineupTabInkTargets = null;
    if (lineupTabInkFrame !== null) {
      cancelAnimationFrame(lineupTabInkFrame);
      lineupTabInkFrame = null;
    }
    if (lineupTabInkObserver) {
      lineupTabInkObserver.disconnect();
      lineupTabInkObserver = null;
    }
  }

  function shell(content, message, failed) {
    managementActive = false;
    managementViewAnimation = null;
    resetRender();
    var l = labels();
    root.innerHTML =
      '<div class="public-shell"><header class="top"><img class="brand-mark" src="/icon.svg" alt=""><strong>' +
      escape(l.title) +
      '</strong></header><main class="content">' + content + "</main></div>";
    if (message) operationStatus(message, failed, false);
  }

  function renderUnavailable() {
    lineupRequestGeneration += 1;
    var l = labels();
    shell(
      '<section class="connection-state"><span class="connection-state-icon" aria-hidden="true">' +
        icon("playback") +
        '</span><h1>' +
        escape(l.unavailableTitle) +
        '</h1><p role="alert">' +
        escape(l.unavailable) +
        '</p><button type="button" data-action="retry">' +
        escape(l.retry) +
        "</button></section>",
    );
    root.querySelector("[data-action=retry]").addEventListener("click", function (event) {
      if (!beginOperation(l.connecting, event.currentTarget)) return;
      void start();
    });
  }

  function renderPair(message) {
    lineupRequestGeneration += 1;
    itemMenu = null;
    itemMenuReturn = null;
    itemMenuSource = null;
    var l = labels();
    var secret = parsePairSecret();
    var draft = pairDraftState();
    shell(
      '<section class="hero pair"><h1>' +
        escape(l.pairTitle) +
        "</h1><p>" +
        escape(l.pairBody) +
        "</p>" +
        '<form><label>' +
        escape(l.deviceName) +
        '<input name="deviceName" autocomplete="off" required value="' +
        escape(draft.name) +
        '"></label>' +
        (secret
          ? ""
          : '<label>' +
            escape(l.code) +
            '<input name="code" dir="ltr" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required value="' +
            escape(draft.code) +
            '"></label>') +
        '<button type="submit">' +
        escape(l.pair) +
        "</button></form></section>",
      message,
      true,
    );
    root.querySelector("form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      pairDraft.name = form.elements.deviceName.value;
      pairDraft.code = secret ? "" : form.elements.code.value;
      var name = pairDraft.name.trim();
      var payload = { name: name };
      if (secret) payload.secret = secret;
      else payload.code = pairDraft.code.trim();
      if (!beginOperation(l.connecting, form.querySelector('button[type="submit"]'))) return;
      var paired = await request("/api/v1/pair", {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify(payload),
      });
      if (!paired) return;
      if (paired.status !== 200) {
        renderPair(l.pairingFailed);
        return;
      }
      saveAuth({ deviceId: paired.body.deviceId, credential: paired.body.credential });
      window.history.replaceState({}, "", window.location.pathname);
      await loadState();
    });
  }

  function applyLocale() {
    if (!current) return;
    document.documentElement.lang = current.locale || "en";
    document.documentElement.dir = current.direction || "ltr";
  }

  function localeOptions(selected) {
    return (current.localeOptions || [])
      .map(function (option) {
        return (
          '<option value="' +
          escape(option.id) +
          '"' +
          (option.id === selected ? " selected" : "") +
          ">" +
          escape(option.label) +
          "</option>"
        );
      })
      .join("");
  }

  function setupValues(form) {
    var xtream = setupSource === "xtream";
    var server = xtream ? form.elements.xtreamServer.value : setupDraft.server;
    var username = xtream ? form.elements.xtreamUsername.value : setupDraft.username;
    var password = xtream ? form.elements.xtreamPassword.value : setupDraft.password;
    var output = xtream ? form.elements.xtreamOutput.value : setupDraft.output;
    var url = xtream ? setupDraft.url : form.elements.playlistUrl.value;
    return {
      locale: form.elements.locale.value,
      name: form.elements.playlistName.value,
      url: url,
      server: server,
      username: username,
      password: password,
      output: output,
      source: sourceFromDraft(xtream ? "xtream" : "m3u", {
        url: url,
        server: server,
        username: username,
        password: password,
        output: output,
      }),
    };
  }

  async function sendSetupPreview(draft, retry) {
    var response = await request("/api/v1/command", {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify({
        id: commandId(),
        revision: current.revision,
        command: {
          type: "setup.preview",
          name: draft.name,
          source: draft.source,
        },
      }),
    }, "operation");
    if (!response) return;
    if (response.body && response.body.snapshot) {
      adoptRemoteSnapshot(response.body.snapshot);
    }
    if (response.status === 409 && retry) {
      await sendSetupPreview(draft, false);
      return;
    }
    if (response.status === 200) applyLocale();
  }

  function queueSetupPreview(form, immediate) {
    setupDraft = setupValues(form);
    if (previewTimer !== null) clearTimeout(previewTimer);
    var run = function () {
      previewTimer = null;
      var draft = Object.assign({}, setupDraft);
      previewQueue = previewQueue.then(function () {
        return sendSetupPreview(draft, true);
      });
    };
    if (immediate) run();
    else previewTimer = setTimeout(run, 250);
  }

  async function flushSetupPreview(form) {
    setupDraft = setupValues(form);
    if (previewTimer !== null) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
    await previewQueue;
  }

  function renderSetup(error, success) {
    var l = labels();
    var sourceFields = setupSource === "m3u"
      ? '<label>' + escape(l.playlistAddress) + '<input name="playlistUrl" type="url" inputmode="url" dir="ltr" value="' + escape(setupDraft.url) + '" required></label>'
      : xtreamFields("xtream", setupDraft, l);
    shell(
      '<section class="setup"><h1>' +
        escape(l.setupTitle) +
        '</h1><form>' + sourceOptions(setupSource, l) + sourceFields + '<label>' +
        escape(l.playlistName) +
        '<input name="playlistName" value="' +
        escape(setupDraft.name) +
        '"></label><label>' +
        escape(l.language) +
        '<select name="locale">' +
        localeOptions(setupDraft.locale) +
        '</select></label><button type="submit">' +
        icon("check") +
        escape(l.finish) +
        "</button></form></section>",
      error,
      !!error && !success,
    );
    var form = root.querySelector("form");
    root.querySelectorAll("[data-source]").forEach(function (button) {
      button.addEventListener("click", function () {
        setupDraft = setupValues(form);
        setupSource = button.dataset.source;
        playlistFormEpoch += 1;
        renderSetup();
        root.querySelector(setupSource === "m3u" ? '[name="playlistUrl"]' : '[name="xtreamServer"]')?.focus();
      });
    });
    form.querySelectorAll('[name="playlistName"], [name="playlistUrl"], [name^="xtream"]').forEach(function (control) {
      control.addEventListener("input", function () {
        var inlineError = form.querySelector(".playlist-form-error");
        if (inlineError) inlineError.remove();
        queueSetupPreview(form, false);
      });
      if (control.tagName === "SELECT") {
        control.addEventListener("change", function () {
          var inlineError = form.querySelector(".playlist-form-error");
          if (inlineError) inlineError.remove();
          queueSetupPreview(form, false);
        });
      }
    });
    form.elements.locale.addEventListener("change", function () {
      queueSetupPreview(form, true);
      void previewQueue.then(function () {
        return sendCommand(
          { type: "setting", key: "locale", value: setupDraft.locale },
          false,
          form.elements.locale,
        );
      });
    });
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (busy || commandInFlight) return;
      setupDraft = setupValues(form);
      if (!validEntrySource(setupDraft.source)) {
        var validation = form.querySelector(".playlist-form-error");
        if (!validation) {
          validation = document.createElement("p");
          validation.className = "playlist-form-error";
          validation.setAttribute("role", "alert");
          form.appendChild(validation);
        }
        validation.textContent = labels().invalidUrl;
        return;
      }
      var submit = form.querySelector('button[type="submit"]');
      if (!beginOperation(labels().checkingPlaylist, submit)) return;
      await flushSetupPreview(form);
      await sendCommand(
        {
          type: "setup",
          locale: setupDraft.locale,
          name: setupDraft.name,
          source: setupDraft.source,
        },
        true,
        submit,
        true,
      );
    });
  }

  function renderSetupResult(success, title, description) {
    var l = labels();
    var action = success ? "open-settings" : "retry-setup";
    var actionLabel = success ? l.manage : l.retry;
    shell(
      '<section class="setup-result ' +
        (success ? "success" : "error") +
        '" data-setup-result="' +
        (success ? "success" : "error") +
        '" role="' +
        (success ? "status" : "alert") +
        '" aria-labelledby="setup-result-title"><span class="setup-result-mark" aria-hidden="true"></span><h1 id="setup-result-title">' +
        escape(title) +
        '</h1><p class="setup-result-description">' +
        escape(description) +
        "</p>" +
        '<button type="button" data-action="' +
        action +
        '">' +
        escape(actionLabel) +
        "</button></section>",
    );
    var button = root.querySelector('[data-action="' + action + '"]');
    button.addEventListener("click", function () {
      if (success) {
        managementActive = true;
        var routeHash = window.location.hash || "#playlists";
        lastRouteHash = routeHash;
        applyParsedRoute(parseManagementHash(routeHash), routeHash);
        canonicalizeManagementRoute(routeHash);
      } else {
        renderSetup();
        root.querySelector('[name="playlistUrl"]')?.focus();
      }
    });
    button.focus();
  }

  function settingToggle(key, label) {
    return (
      '<label class="setting"><span>' +
      escape(label) +
      '</span><input type="checkbox" data-setting="' +
      key +
      '"' +
      (current.settings[key] ? " checked" : "") +
      "></label>"
    );
  }

  function optionPickerMarkup(spec) {
    var key = spec.setting ? "setting-" + spec.setting : spec.name;
    var currentOption =
      spec.options.find(function (option) {
        return option[0] === spec.value;
      }) || spec.options[0];
    var nativeOptions = spec.options
      .map(function (option) {
        return (
          '<option value="' +
          escape(option[0]) +
          '"' +
          (option[2] ? ' data-secondary="' + escape(option[2]) + '"' : "") +
          (option[0] === spec.value ? " selected" : "") +
          ">" +
          escape(option[1]) +
          "</option>"
        );
      })
      .join("");
    var setting = spec.setting
      ? ' data-setting="' + escape(spec.setting) + '"'
      : "";
    var name = spec.name ? ' name="' + escape(spec.name) + '"' : "";
    var pickerSetting = spec.setting
      ? ' data-picker-setting="' + escape(spec.setting) + '"'
      : "";
    var pickerName = spec.name ? ' data-picker-name="' + escape(spec.name) + '"' : "";
    var disabled = spec.disabled ? " disabled" : "";
    return (
      '<div class="option-picker" data-picker-key="' +
      escape(key) +
      '"><select data-picker-native data-picker-key="' +
      escape(key) +
      '"' +
      setting +
      name +
      ' aria-label="' +
      escape(spec.label) +
      '" hidden tabindex="-1" aria-hidden="true"' +
      disabled +
      ">" +
      nativeOptions +
      '</select><button type="button" class="option-picker-current" data-picker-trigger="' +
      escape(key) +
      '" data-focus-key="picker-' +
      escape(key) +
      '"' +
      pickerSetting +
      pickerName +
      ' aria-haspopup="listbox" aria-expanded="false" aria-label="' +
      escape(spec.label + ", " + (currentOption ? currentOption[1] : "")) +
      '"' +
      disabled +
      '><span class="option-picker-value">' +
      escape(currentOption ? currentOption[1] : "") +
      '</span><span class="option-picker-chevron" aria-hidden="true">' +
      icon("down", "option-picker-chevron-icon") +
      "</span></button></div>"
    );
  }

  function settingSelect(key, label, options) {
    return (
      '<div class="select-setting"><span>' +
      escape(label) +
      "</span>" +
      optionPickerMarkup({
        setting: key,
        label: label,
        value: current.settings[key],
        options: options,
      }) +
      "</div>"
    );
  }

  function lineupQueryBody(cursor, offset) {
    var body = {
      playlistId: lineup.playlistId,
      revision: lineup.revision,
      scope: lineup.scope,
    };
    if (lineup.scope === "channels" || lineup.scope === "items") {
      if (lineup.categoryKey) body.categoryKey = lineup.categoryKey;
    }
    if (lineup.scope !== "channels" && lineup.contentKind) body.contentKind = lineup.contentKind;
    if (lineup.query) body.query = lineup.query;
    body.includeHidden = true;
    if (typeof lineup.sourceVersion === "number") body.sourceVersion = lineup.sourceVersion;
    if (cursor) body.cursor = cursor;
    else if (typeof offset === "number") body.offset = offset;
    return body;
  }

  function resetLineupPage() {
    lineup.items = [];
    lineup.sort = null;
    lineup.nextCursor = null;
    lineup.cursors = [null];
    lineup.pageIndex = 0;
    lineup.total = 0;
    lineup.orderMode = "provider";
    lineup.loaded = false;
    lineup.error = "";
    lineup.conflictRetried = false;
  }

  function savedContentSourceVersion(id) {
    var playlists = current && current.playlists;
    if (!playlists) return null;
    for (var index = 0; index < playlists.length; index += 1) {
      if (playlists[index].id === id) return playlists[index].sourceVersion;
    }
    return null;
  }

  function contentViewActive() {
    return !!(
      contentPlaylistId &&
      lineup.playlistId === contentPlaylistId &&
      lineup.sourceVersion !== null &&
      savedContentSourceVersion(contentPlaylistId) === lineup.sourceVersion
    );
  }

  function lineupRequestSignature() {
    var saved = savedContentSourceVersion(lineup.playlistId);
    return [
      lineup.playlistId,
      lineup.sourceVersion === null ? "none" : String(lineup.sourceVersion),
      saved === null || saved === undefined ? "missing" : String(saved),
      currentLineupSignature(),
      lineup.query,
    ].join("|");
  }

  function customCategoriesEnabled() {
    return !!(current && current.capabilities && current.capabilities.customCategories);
  }

  function resetPlaylistContent() {
    lineupRequestGeneration += 1;
    if (lineupSearchTimer !== null) {
      clearTimeout(lineupSearchTimer);
      lineupSearchTimer = null;
    }
    cancelLineupSortDrag();
    clearLineupSortClickSuppress();
    lineup.editor = null;
    lineup.sort = null;
    lineup.reorder = false;
    lineup.searchOpen = false;
    lineup.loading = false;
    lineup.mutating = false;
    lineupResultsHeight = 0;
    lineup.notice = "";
    lineupBrowseSnapshot = null;
    lineupParents = [];
    lineup.sectionCounts = null;
    lineup.hasLoadedPage = false;
    lineupEntryFocusTabs = false;
    resetLineupPage();
  }

  var lineupEntryFocusRow = false;
  var lineupEntryFocusTabs = false;

  function openPlaylistContent(id, opener, target) {
    target = target || {};
    contentPlaylistId = id;
    manageView = { page: "playlists", sub: "content", subId: id };
    contentReturnFocus = opener ? focusDescriptor(opener) : null;
    lineup.scope = target.scope || "categories";
    lineup.contentKind = target.contentKind || "live";
    lineup.categoryKey = target.categoryKey || "";
    lineup.categoryName = target.categoryName || "";
    lineup.categoryKind = target.categoryKind || "live";
    lineup.categoryPersonal = !!target.categoryPersonal;
    lineup.membershipCategory = target.membershipCategory || "";
    lineup.query = "";
    itemMenu = null;
    itemMenuReturn = null;
    itemMenuSource = null;
    resetPlaylistContent();
    var opened = playlistById(id);
    lineup.playlistId = id;
    lineup.sourceVersion = opened && typeof opened.sourceVersion === "number"
      ? opened.sourceVersion
      : null;
    lineup.revision =
      current && current.lineup && current.lineup.playlistId === id
        ? current.lineup.revision
        : 0;
    renderManage();
    focusViewHeading();
    lineupEntryFocusRow = true;
    lineupEntryFocusTabs = true;
  }

  function reconcileLineupSource() {
    if (!contentPlaylistId || lineup.playlistId !== contentPlaylistId) return false;
    var saved = savedContentSourceVersion(contentPlaylistId);
    if (typeof saved !== "number" || saved === lineup.sourceVersion) return false;
    lineup.sourceVersion = saved;
    lineup.revision = 0;
    lineup.hasLoadedPage = false;
    lineupRequestGeneration += 1;
    clearLineupTimers();
    lineup.scope = "categories";
    lineup.contentKind = "live";
    lineup.categoryKey = "";
    lineup.categoryName = "";
    lineup.categoryKind = "live";
    lineup.categoryPersonal = false;
    lineup.membershipCategory = "";
    lineup.query = "";
    lineup.editor = null;
    lineup.orderDialog = null;
    lineup.sort = null;
    lineup.reorder = false;
    lineup.searchOpen = false;
    lineup.loading = false;
    lineup.mutating = false;
    lineup.notice = "";
    lineupBrowseSnapshot = null;
    lineup.sectionCounts = null;
    cancelLineupSortDrag();
    clearLineupSortClickSuppress();
    resetLineupPage();
    invalidateLineupWriteQueues(contentPlaylistId);
    saveManagementRoute(true);
    return true;
  }

  function playlistById(id) {
    return current && current.playlists
      ? current.playlists.find(function (playlist) { return playlist.id === id; }) || null
      : null;
  }

  function deviceById(id) {
    return current && current.devices
      ? current.devices.find(function (device) { return device.id === id; }) || null
      : null;
  }

  function contentRouteHash(playlistId, view) {
    var params = new URLSearchParams();
    params.set("view", "content");
    params.set("playlist", playlistId);
    params.set("scope", view.scope || "categories");
    params.set("kind", view.contentKind || "live");
    if (view.scope === "channels" || view.scope === "items") {
      if (view.categoryKey) params.set("category", view.categoryKey);
    }
    if (
      view.scope === "personal-categories" ||
      view.categoryPersonal ||
      view.membershipCategory
    ) {
      params.set("custom", "1");
    }
    if (view.membershipCategory && !view.categoryKey) {
      params.set("membership", view.membershipCategory);
    }
    return "#playlists?" + params.toString();
  }

  function routeHashFor(route) {
    if (route.page !== "playlists") return "#" + route.page;
    if (route.view === "list") return "#playlists/list";
    var params = new URLSearchParams();
    if (route.view === "add") {
      params.set("view", "add");
    } else if (route.view === "edit") {
      params.set("view", "edit");
      params.set("playlist", route.playlistId);
    } else if (route.view === "content") {
      params.set("view", "content");
      params.set("playlist", route.playlistId);
      params.set("scope", route.scope);
      params.set("kind", route.kind);
      if (route.scope === "channels" || route.scope === "items") {
        if (route.category) params.set("category", route.category);
      }
      if (route.custom) params.set("custom", "1");
      if (route.membership) params.set("membership", route.membership);
    }
    var query = params.toString();
    return "#playlists" + (query ? "?" + query : "");
  }

  function currentRoute() {
    var route = {
      page: manageView.page,
      view: "",
      playlistId: "",
      scope: "categories",
      kind: "live",
      category: "",
      custom: false,
      membership: "",
    };
    if (manageView.page !== "playlists") return route;
    if (manageView.sub === "list") {
      route.view = "list";
    } else if (manageView.sub === "add") {
      route.view = "add";
    } else if (manageView.sub === "edit") {
      route.view = "edit";
      route.playlistId = manageView.subId;
    } else if (manageView.sub === "content" && contentPlaylistId) {
      route.view = "content";
      route.playlistId = contentPlaylistId;
      route.scope = lineup.scope;
      route.kind = lineup.contentKind || "live";
      route.category =
        lineup.scope === "channels" || lineup.scope === "items" ? lineup.categoryKey : "";
      route.custom = !!(
        lineup.scope === "personal-categories" ||
        lineup.categoryPersonal ||
        lineup.membershipCategory
      );
      route.membership =
        lineup.membershipCategory && !lineup.categoryKey ? lineup.membershipCategory : "";
    }
    return route;
  }

  var ROUTE_STATE_KEY = "openiptvRoute";

  function routeHistoryState(hash, name) {
    var state = {};
    state[ROUTE_STATE_KEY] = { hash: hash, name: name || "" };
    return state;
  }

  function routeDisplayName(hash) {
    var state = window.history.state;
    var meta = state && state[ROUTE_STATE_KEY];
    return meta && meta.hash === hash ? meta.name || "" : "";
  }

  function saveManagementRoute(replace) {
    var hash = routeHashFor(currentRoute());
    var name = lineup.categoryName || "";
    var currentHash = window.location.hash || "#playlists";
    if (hash === currentHash) {
      lastRouteHash = hash;
      return;
    }
    var state = routeHistoryState(hash, name);
    if (replace) window.history.replaceState(state, "", hash);
    else window.history.pushState(state, "", hash);
    lastRouteHash = hash;
  }

  function canonicalizeManagementRoute(appliedHash) {
    var canonical = routeHashFor(currentRoute());
    if (canonical === appliedHash) return;
    window.history.replaceState(
      routeHistoryState(canonical, lineup.categoryName || ""),
      "",
      canonical,
    );
    lastRouteHash = canonical;
  }

  function parseManagementHash(hash) {
    var raw = String(hash || "").replace(/^#/, "") || "playlists";
    var split = raw.indexOf("?");
    var page = split < 0 ? raw : raw.slice(0, split);
    var params = new URLSearchParams(split < 0 ? "" : raw.slice(split + 1));
    var route = {
      page: "playlists",
      view: "",
      playlistId: "",
      scope: "categories",
      kind: "live",
      category: "",
      custom: false,
      membership: "",
    };
    if (["appearance", "playback", "devices", "about"].indexOf(page) >= 0) {
      route.page = page;
      return route;
    }
    var listPath = page === "playlists/list";
    if ((!listPath && page !== "playlists") || !current || !current.playlists) return route;
    if (listPath) {
      route.view = "list";
      return route;
    }
    var view = params.get("view") || "";
    if (view === "add") {
      route.view = "add";
      return route;
    }
    var playlistId = params.get("playlist") || "";
    var playlist = playlistId ? playlistById(playlistId) : null;
    if (!playlist) return route;
    if (view === "edit") {
      route.view = "edit";
      route.playlistId = playlistId;
      return route;
    }
    if (view !== "content") return route;
    var scope = params.get("scope") || "categories";
    var kind = params.get("kind") || "live";
    var custom = params.get("custom") === "1";
    var category = params.get("category") || "";
    var membership = params.get("membership") || "";
    if (["categories", "channels", "items", "personal-categories"].indexOf(scope) < 0) {
      scope = "categories";
    }
    var customEntry =
      scope === "personal-categories" ||
      custom ||
      (scope === "channels" && membership !== "");
    if (customEntry && !customCategoriesEnabled()) {
      scope = "categories";
      custom = false;
      category = "";
      membership = "";
    }
    if (scope === "personal-categories") {
      kind = "live";
      custom = true;
      category = "";
      membership = "";
    } else if (scope === "categories") {
      custom = false;
      category = "";
      membership = "";
    } else if (scope === "channels") {
      kind = "live";
      if (custom) {
        if (!category && !membership) {
          scope = "personal-categories";
        } else if (category) {
          membership = "";
        }
      } else if (membership && !category) {
        custom = true;
      } else {
        membership = "";
      }
    } else if (scope === "items") {
      custom = false;
      membership = "";
      if (kind !== "movie" && kind !== "series") {
        scope = "channels";
        kind = "live";
      }
    }
    if (["live", "movie", "series"].indexOf(kind) < 0) kind = "live";
    if (playlist.source.kind === "m3u") {
      if (scope === "items" || kind !== "live") {
        scope = "categories";
        kind = "live";
        category = "";
        custom = false;
        membership = "";
      }
    } else if (scope === "items" && !category) {
      scope = "categories";
    }
    if (scope === "channels" && !category && !membership) {
      scope = "categories";
      custom = false;
    }
    route.view = "content";
    route.playlistId = playlistId;
    route.scope = scope;
    route.kind = kind;
    route.category = category;
    route.custom = custom;
    route.membership = membership;
    return route;
  }

  function genericContentName(route) {
    var l = labels();
    if (route.scope === "personal-categories") return l.lineupPersonalCategories;
    if (route.scope === "channels") {
      if (route.custom) return l.lineupPersonalCategories;
      return l.lineupChannels;
    }
    if (route.scope === "items") {
      return route.kind === "movie" ? l.lineupMovies : l.lineupSeries;
    }
    return "";
  }

  function routeContentTarget(route, hash) {
    var name = routeDisplayName(hash);
    var target = {
      playlistId: route.playlistId,
      scope: route.scope,
      contentKind: route.kind,
      categoryKey: route.category,
      categoryPersonal: route.custom && !!route.category && route.scope === "channels",
      membershipCategory:
        route.scope === "channels" && route.custom
          ? route.category || route.membership || ""
          : "",
      categoryName: name || genericContentName(route),
      categoryKind: route.scope === "items" ? route.kind : "live",
    };
    if (route.scope === "channels" && route.custom && route.membership && !route.category) {
      target.categoryName = name;
    }
    return target;
  }

  function clearPlaylistSubViews() {
    if (contentPlaylistId) {
      contentPlaylistId = "";
      contentReturnFocus = null;
      resetPlaylistContent();
    }
  }

  function lineupViewSignature(view) {
    return [
      view.scope,
      view.contentKind,
      view.categoryKey || "",
      view.categoryPersonal ? "1" : "0",
      view.membershipCategory || "",
    ].join("|");
  }

  function currentLineupSignature() {
    return lineupViewSignature({
      scope: lineup.scope,
      contentKind: lineup.contentKind,
      categoryKey: lineup.categoryKey,
      categoryPersonal: lineup.categoryPersonal,
      membershipCategory: lineup.membershipCategory,
    });
  }

  function enterLineupView(target, restoration) {
    if (busy || lineup.mutating || (lineup.editor && lineup.editor.saving)) return false;
    if (!target.playlistId || target.playlistId !== contentPlaylistId) return false;
    if (lineupViewSignature(target) === currentLineupSignature()) return false;
    lineupParents = [];
    lineup.scope = target.scope;
    lineup.contentKind = target.contentKind || "live";
    lineup.categoryKey = target.categoryKey || "";
    lineup.categoryName = target.categoryName || "";
    lineup.categoryKind = target.categoryKind || "live";
    lineup.categoryPersonal = !!target.categoryPersonal;
    lineup.membershipCategory = target.membershipCategory || "";
    lineup.query = restoration ? restoration.query : "";
    lineup.searchOpen = restoration ? restoration.searchOpen : false;
    lineup.editor = null;
    lineup.orderDialog = null;
    lineupBrowseSnapshot = null;
    cancelLineupSortDrag();
    clearLineupSortClickSuppress();
    lineup.sort = null;
    lineup.reorder = false;
    lineup.notice = "";
    lineupRequestGeneration += 1;
    clearLineupTimers();
    resetLineupPage();
    if (restoration) lineup.pageIndex = restoration.pageIndex;
    var generation = lineupRequestGeneration + 1;
    var signature = lineupBrowseSignature();
    var ownerAuth = auth;
    if (contentViewActive()) {
      var loading = loadLineupPage(
        restoration ? "current" : "reset",
        restoration ? false : undefined,
      );
      if (restoration) {
        void loading.then(function () {
          if (
            generation !== lineupRequestGeneration ||
            auth !== ownerAuth ||
            !contentViewActive() ||
            signature !== lineupBrowseSignature() ||
            lineup.sourceVersion !== restoration.sourceVersion ||
            !lineup.loaded ||
            lineup.loading ||
            lineup.error ||
            activeLineupDialog()
          ) return;
          var control =
            findFocusControl(restoration.focus) ||
            firstLineupRowControl() ||
            root.querySelector("[data-lineup-heading]");
          if (control && !control.disabled) control.focus({ preventScroll: true });
          if (typeof window.scrollTo === "function") window.scrollTo(0, restoration.scrollY);
        });
      }
    } else renderManage();
    focusViewHeading();
    lineupEntryFocusRow = !restoration;
    lineupEntryFocusTabs = false;
    return true;
  }

  function openLineupChild(target, source) {
    var parents = lineupParents.slice();
    var parent = {
      auth: auth,
      playlistId: contentPlaylistId,
      sourceVersion: lineup.sourceVersion,
      target: {
        playlistId: contentPlaylistId,
        scope: lineup.scope,
        contentKind: lineup.contentKind,
        categoryKey: lineup.categoryKey,
        categoryName: lineup.categoryName,
        categoryKind: lineup.categoryKind,
        categoryPersonal: lineup.categoryPersonal,
        membershipCategory: lineup.membershipCategory,
      },
      query: lineup.query,
      searchOpen: lineup.searchOpen,
      pageIndex: lineup.pageIndex,
      focus: focusDescriptor(source),
      scrollY: window.scrollY || window.pageYOffset || 0,
    };
    if (!enterLineupView(target)) return false;
    lineupParents = parents.concat([parent]).slice(-3);
    return true;
  }

  function applyContentRoute(route, hash) {
    var playlist = playlistById(route.playlistId);
    if (!playlist) {
      manageView = { page: "playlists", sub: "", subId: "" };
      clearPlaylistSubViews();
      renderManage();
      focusViewHeading();
      return;
    }
    var target = routeContentTarget(route, hash);
    if (contentPlaylistId !== route.playlistId) {
      openPlaylistContent(route.playlistId, null, target);
      return;
    }
    var alreadyContent = manageView.sub === "content" && manageView.subId === route.playlistId;
    manageView = { page: "playlists", sub: "content", subId: route.playlistId };
    if (!enterLineupView(target) && !alreadyContent) {
      renderManage();
      focusViewHeading();
    }
  }

  function applyEditRoute(playlistId) {
    var playlist = playlistById(playlistId);
    if (!playlist) {
      manageView = { page: "playlists", sub: "", subId: "" };
      clearPlaylistSubViews();
      renderManage();
      focusViewHeading();
      return;
    }
    manageView = { page: "playlists", sub: "edit", subId: playlistId };
    clearPlaylistSubViews();
    editingPlaylistReturn = null;
    if (editingPlaylist !== playlistId) beginPlaylistEdit(playlist);
    renderManage();
    root.querySelector(editingPlaylistSource === "m3u" ? '[name="editUrl"]' : '[name="editServer"]')?.focus();
  }

  function applyParsedRoute(route, hash) {
    manageView.page = route.page;
    if (route.page !== "playlists") {
      manageView.sub = "";
      manageView.subId = "";
      clearPlaylistSubViews();
      renderManage();
      focusViewHeading();
      return;
    }
    if (route.view === "add") {
      manageView.sub = "add";
      manageView.subId = "";
      clearPlaylistSubViews();
      addPlaylistDraftActive = true;
      playlistFormError = "";
      renderManage();
      root.querySelector(
        addPlaylistSource === "m3u" ? '[name="newUrl"]' : '[name="newServer"]',
      )?.focus();
      return;
    }
    if (route.view === "edit") {
      applyEditRoute(route.playlistId);
      return;
    }
    if (route.view === "content") {
      applyContentRoute(route, hash);
      return;
    }
    manageView.sub = route.view === "list" ? "list" : "";
    manageView.subId = "";
    var editOpener = editingPlaylistReturn;
    var opener = contentReturnFocus;
    editingPlaylistReturn = null;
    contentReturnFocus = null;
    clearPlaylistSubViews();
    renderManage();
    if (manageView.sub === "list") {
      if (editOpener) restoreLineupFocus(editOpener);
      else if (opener) restoreFocus(opener);
      else focusViewHeading();
    } else {
      focusViewHeading();
    }
  }

  function managementWriteBlocked() {
    return !!(
      busy ||
      lineup.mutating ||
      managementConfirmation ||
      (lineup.editor && lineup.editor.saving)
    );
  }

  function dismissTransientSurfaces() {
    var dismissed = false;
    if (managementConfirmation) {
      closeManagementConfirmation();
      dismissed = true;
    }
    if (lineup.editor) {
      closeActiveLineupDialog();
      dismissed = true;
    }
    var remoteOverlay = root.querySelector("[data-remote-overlay]");
    if (remoteOverlay && !remoteOverlay.hidden) {
      var closeRemote = remoteOverlay.querySelector("[data-action=close-remote]");
      if (closeRemote) closeRemote.click();
      else remoteOverlay.hidden = true;
      dismissed = true;
    }
    var drawer = root.querySelector("[data-nav-drawer]");
    if (drawer && drawer.open) {
      if (typeof drawer.close === "function") drawer.close();
      else drawer.removeAttribute("open");
      dismissed = true;
    }
    return dismissed;
  }

  function transientOverlayOpen() {
    if (managementConfirmation) return true;
    if (lineup.editor) return true;
    var remoteOverlay = root.querySelector("[data-remote-overlay]");
    if (remoteOverlay && !remoteOverlay.hidden) return true;
    var drawer = root.querySelector("[data-nav-drawer]");
    return !!(drawer && drawer.open);
  }

  function onManagementRouteChange() {
    var hash = window.location.hash || "#playlists";
    if (hash === lastRouteHash) return;
    if (
      !managementActive ||
      !auth ||
      !current ||
      !current.playlists ||
      !current.playlists.length
    ) {
      lastRouteHash = hash;
      return;
    }
    if (managementWriteBlocked()) {
      saveManagementRoute(false);
      return;
    }
    if (transientOverlayOpen()) {
      dismissTransientSurfaces();
      saveManagementRoute(false);
      return;
    }
    lastRouteHash = hash;
    applyParsedRoute(parseManagementHash(hash), hash);
    canonicalizeManagementRoute(hash);
  }

  function lineupConflictReload() {
    if (lineup.conflictRetried) {
      lineup.loading = false;
      lineup.notice = "";
      lineup.error = labels().lineupLoadFailed;
      lineup.loaded = false;
      renderManage();
      return;
    }
    lineup.conflictRetried = true;
    // A first read may be discovering this playlist's revision.
    if (lineup.hasLoadedPage) lineup.notice = labels().lineupConflict;
    lineup.items = [];
    lineup.loaded = false;
    lineup.nextCursor = null;
    lineup.cursors = [null];
    lineup.pageIndex = 0;
    void loadLineupPage("reset");
  }

  function acceptLineupRevision(revision) {
    if (revision !== lineup.revision && lineup.sort) {
      cancelLineupSortDrag();
      clearLineupSortClickSuppress();
      lineup.sort = null;
    }
    lineup.revision = revision;
    if (
      current &&
      current.lineup &&
      current.lineup.playlistId === lineup.playlistId
    ) {
      current.lineup.revision = revision;
    }
  }

  async function loadLineupPage(nav, restoreSortFocus, quietConflictRetried, targetOverride, focusFirstRow) {
    var generation = ++lineupRequestGeneration;
    lineupPageRequests += 1;
    if (!contentViewActive()) {
      lineup.loading = false;
      return;
    }
    var cursor = null;
    var offset = null;
    var targetPage = 0;
    if (nav === "next") {
      if (!lineup.nextCursor) return;
      cursor = lineup.nextCursor;
      targetPage = lineup.pageIndex + 1;
    } else if (nav === "prev") {
      if (lineup.pageIndex <= 0) return;
      targetPage = lineup.pageIndex - 1;
      cursor = lineup.cursors[targetPage] || null;
      if (!cursor && targetPage > 0) offset = targetPage * 50;
    } else if (nav === "current") {
      targetPage =
        typeof targetOverride === "number" ? targetOverride : lineup.pageIndex;
      offset = targetPage * 50;
    } else {
      cursor = null;
      targetPage = 0;
    }
    var resultsRegion = root.querySelector(".lineup-results-body");
    lineupResultsHeight =
      lineup.loaded && resultsRegion
        ? Math.max(280, Math.ceil(resultsRegion.getBoundingClientRect().height))
        : 0;
    lineup.loading = true;
    lineup.error = "";
    renderManage();
    var heldRevision = lineup.revision;
    var requestSignature = lineupRequestSignature();
    var requestOwner = {
      playlistId: lineup.playlistId,
      sourceVersion: lineup.sourceVersion,
      auth: auth,
    };
    var response = await request(
      "/api/v1/lineup/query",
      {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify(lineupQueryBody(cursor, offset)),
      },
      "lineup",
    );
    if (
      generation !== lineupRequestGeneration ||
      lineupRequestSignature() !== requestSignature
    ) {
      return;
    }
    if (!response) {
      lineup.loading = false;
      return;
    }
    if (response.status === 409) {
      var querySourceChanged = false;
      if (response.body.snapshot) {
        adoptRemoteSnapshot(response.body.snapshot);
        querySourceChanged = reconcileLineupSource();
      }
      if (querySourceChanged) {
        lineup.loading = false;
        renderManage();
        return;
      }
      var conflictQueue = lineupWriteQueueFor(
        requestOwner.playlistId,
        requestOwner.sourceVersion,
      );
      var ownQueuedRace = !!(
        conflictQueue &&
        conflictQueue.auth === auth &&
        (conflictQueue.pending.length > 0 || conflictQueue.revision > heldRevision)
      );
      if (ownQueuedRace) {
        acceptBackgroundLineupRevision(requestOwner, response.body.revision);
        if (!contentViewActive()) {
          lineup.loading = false;
          resetLineupPage();
          renderManage();
          return;
        }
        if (!quietConflictRetried) {
          return loadLineupPage("current", restoreSortFocus, true, targetPage, focusFirstRow);
        }
        await flushBackgroundLineupOwner(requestOwner);
        if (
          generation !== lineupRequestGeneration ||
          lineupRequestSignature() !== requestSignature ||
          auth !== requestOwner.auth ||
          !contentViewActive() ||
          lineup.playlistId !== requestOwner.playlistId
        ) {
          return;
        }
        return loadLineupPage("current", restoreSortFocus, true, targetPage, focusFirstRow);
      }
      acceptLineupRevision(response.body.revision);
      if (!contentViewActive()) {
        lineup.loading = false;
        resetLineupPage();
        renderManage();
        return;
      }
      lineupConflictReload();
      return;
    }
    if (response.status !== 200 || !response.body.page) {
      lineup.loading = false;
      lineup.error = labels().lineupLoadFailed;
      lineup.notice = "";
      lineup.loaded = false;
      renderManage();
      if (restoreSortFocus !== false) {
        if (focusFirstRow) focusLineupPageStart();
        else focusLineupSortPage();
      }
      return;
    }
    var page = response.body.page;
    var resultQueue = lineupWriteQueueFor(
      requestOwner.playlistId,
      requestOwner.sourceVersion,
    );
    var ownQueueWrite = !!(
      resultQueue &&
      resultQueue.auth === auth &&
      (resultQueue.pending.length > 0 || resultQueue.revision > heldRevision)
    );
    if (resultQueue && resultQueue.auth === auth && page.revision < resultQueue.revision) {
      if (!quietConflictRetried) {
        return loadLineupPage("current", restoreSortFocus, true, targetPage, focusFirstRow);
      }
      var staleQueue = lineupWriteQueueFor(
        requestOwner.playlistId,
        requestOwner.sourceVersion,
      );
      var staleRevision = staleQueue ? staleQueue.revision : -1;
      var stalePending = staleQueue ? staleQueue.pending.length : 0;
      await flushBackgroundLineupOwner(requestOwner);
      if (
        generation !== lineupRequestGeneration ||
        lineupRequestSignature() !== requestSignature ||
        auth !== requestOwner.auth ||
        !contentViewActive() ||
        lineup.playlistId !== requestOwner.playlistId
      ) {
        return;
      }
      var drainedQueue = lineupWriteQueueFor(
        requestOwner.playlistId,
        requestOwner.sourceVersion,
      );
      var ownProgress = !!(
        drainedQueue &&
        drainedQueue.auth === auth &&
        (drainedQueue.revision > staleRevision || stalePending > 0)
      );
      if (!ownProgress) {
        lineup.loading = false;
        lineup.error = labels().lineupLoadFailed;
        lineup.notice = "";
        lineup.loaded = false;
        renderManage();
        if (restoreSortFocus !== false) {
          if (focusFirstRow) focusLineupPageStart();
          else focusLineupSortPage();
        }
        return;
      }
      return loadLineupPage("current", restoreSortFocus, true, targetPage, focusFirstRow);
    }
    if (page.revision !== heldRevision && nav !== "reset") {
      if (ownQueueWrite) {
        acceptBackgroundLineupRevision(requestOwner, page.revision);
        if (!quietConflictRetried) {
          return loadLineupPage("current", restoreSortFocus, true, targetPage, focusFirstRow);
        }
        await flushBackgroundLineupOwner(requestOwner);
        if (
          generation !== lineupRequestGeneration ||
          lineupRequestSignature() !== requestSignature ||
          auth !== requestOwner.auth ||
          !contentViewActive() ||
          lineup.playlistId !== requestOwner.playlistId
        ) {
          return;
        }
        return loadLineupPage("current", restoreSortFocus, true, targetPage, focusFirstRow);
      }
      acceptLineupRevision(page.revision);
      lineupConflictReload();
      return;
    }
    lineup.items = page.items || [];
    acceptLineupRevision(page.revision);
    lineup.nextCursor = page.nextCursor || null;
    lineup.total = page.total;
    lineup.orderMode = page.orderMode || "provider";
    if (page.sectionCounts) lineup.sectionCounts = page.sectionCounts;
    lineup.cursors = lineup.cursors.slice(0, targetPage);
    lineup.cursors[targetPage] = cursor;
    lineup.pageIndex = targetPage;
    lineup.loading = false;
    lineup.loaded = true;
    lineup.hasLoadedPage = true;
    lineup.conflictRetried = false;
    projectPendingLineupIntents();
    var settledQueue = lineupWriteQueueFor(
      requestOwner.playlistId,
      requestOwner.sourceVersion,
    );
    if (
      settledQueue &&
      settledQueue.auth === auth &&
      !settledQueue.pending.length &&
      !settledQueue.running &&
      page.revision >= settledQueue.revision
    ) {
      settledQueue.acknowledgedView = copyLineupView();
      settledQueue.viewSignature = backgroundLineupViewSignature();
      settledQueue.revision = page.revision;
    }
    if (lineup.reorder) rebuildLineupSort(nav !== "reset", focusFirstRow);
    var loadedNotice = lineup.notice;
    lineup.notice = "";
    renderManage();
    if (loadedNotice) operationStatus(loadedNotice, false);
    if (focusFirstRow) {
      lineupEntryFocusRow = false;
      lineupEntryFocusTabs = false;
    }
    if (restoreSortFocus !== false) {
      if (focusFirstRow) focusLineupPageStart();
      else focusLineupSortPage();
    }
    if (lineupEntryFocusRow) {
      var preferEntryTabs = lineupEntryFocusTabs;
      lineupEntryFocusRow = false;
      lineupEntryFocusTabs = false;
      var entryTarget = preferEntryTabs
        ? root.querySelector('.lineup-tabs [role="tab"][aria-selected="true"]')
        : null;
      if (!entryTarget) entryTarget = firstLineupRowControl();
      if (entryTarget) entryTarget.focus();
    }
  }

  async function postLineupMutation(mutation, owner) {
    owner = owner || {};
    var playlistId = owner.playlistId || lineup.playlistId;
    var sourceVersion =
      owner.sourceVersion !== undefined ? owner.sourceVersion : lineup.sourceVersion;
    var revision = owner.revision !== undefined ? owner.revision : lineup.revision;
    var body = {
      id: commandId(),
      playlistId: playlistId,
      revision: revision,
      mutation: mutation,
    };
    if (typeof sourceVersion === "number") body.sourceVersion = sourceVersion;
    return request(
      "/api/v1/lineup/mutation",
      {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify(body),
      },
      "lineup",
    );
  }

  function lineupMutationReason(response) {
    var reason = response && response.body && response.body.reason;
    if (reason === "duplicate-number") return labels().lineupDuplicateNumber;
    if (reason === "invalid") return labels().lineupInvalidValue;
    if (reason === "persistence") return labels().lineupPersistenceFailed;
    return labels().changeFailed;
  }

  var lineupWriteQueues = new Map();
  var lineupQuietRefreshSeq = 0;
  var lineupPageRequests = 0;

  function backgroundLineupViewSignature() {
    return JSON.stringify([
      lineup.playlistId,
      lineup.sourceVersion,
      lineup.scope,
      lineup.contentKind,
      lineup.categoryKey || "",
      !!lineup.categoryPersonal,
      lineup.membershipCategory || "",
      lineup.query,
      lineup.pageIndex,
    ]);
  }

  function lineupWriteQueueKey(playlistId, sourceVersion) {
    return playlistId + ":" + sourceVersion;
  }

  function lineupWriteQueueFor(playlistId, sourceVersion) {
    return lineupWriteQueues.get(lineupWriteQueueKey(playlistId, sourceVersion)) || null;
  }

  function queueOwnerCurrent(queue) {
    return !!(
      queue &&
      auth &&
      queue.auth === auth &&
      playlistById(queue.playlistId) &&
      savedContentSourceVersion(queue.playlistId) === queue.sourceVersion
    );
  }

  function copyLineupView() {
    return {
      scope: lineup.scope,
      contentKind: lineup.contentKind,
      categoryKey: lineup.categoryKey,
      categoryPersonal: lineup.categoryPersonal,
      membershipCategory: lineup.membershipCategory,
      query: lineup.query,
      pageIndex: lineup.pageIndex,
      orderMode: lineup.orderMode,
      items: lineup.items.map(function (item) {
        return Object.assign({}, item);
      }),
    };
  }

  function cloneViewItems(items) {
    return items.map(function (item) {
      return Object.assign({}, item);
    });
  }

  function liveLineupView() {
    return {
      scope: lineup.scope,
      contentKind: lineup.contentKind,
      categoryKey: lineup.categoryKey,
      categoryPersonal: lineup.categoryPersonal,
      membershipCategory: lineup.membershipCategory,
      items: lineup.items,
      orderMode: lineup.orderMode,
    };
  }

  function applyLivePlacement(mutation, origin) {
    var sort = lineup.sort;
    if (!sort || !mutation || !mutation.placement) return;
    if (sort.grabbed || lineupSortDrag) return;
    if (!placementOriginMatches(liveLineupView(), origin, mutation.type)) return;
    sort.ids = applyPlacementToIds(sort.ids, mutation.placement);
  }

  function projectItemVisibility(view, predicate, hidden) {
    var items = view.items || [];
    for (var index = 0; index < items.length; index += 1) {
      if (predicate(items[index])) items[index].hidden = !!hidden;
    }
  }

  function applyPlacementToIds(ids, placement) {
    if (!placement || !placement.itemId) return ids;
    var at = ids.indexOf(placement.itemId);
    if (at < 0) return ids;
    var target = -1;
    if (placement.beforeId) {
      target = ids.indexOf(placement.beforeId);
      if (target < 0 || target === at) return ids;
      if (target > at) target -= 1;
    } else if (placement.afterId) {
      target = ids.indexOf(placement.afterId);
      if (target < 0 || target === at) return ids;
      if (target < at) target += 1;
    } else {
      return ids;
    }
    var next = ids.slice();
    var moved = next.splice(at, 1)[0];
    next.splice(target, 0, moved);
    return next;
  }

  function placementOriginMatches(view, origin, type) {
    if (!origin) return false;
    if (type === "category.place") {
      return (
        view.scope === "categories" &&
        origin.scope === "categories" &&
        view.contentKind === origin.contentKind
      );
    }
    if (type === "channel.place") {
      return (
        view.scope === "channels" &&
        !view.categoryPersonal &&
        origin.scope === "channels" &&
        !origin.categoryPersonal &&
        view.categoryKey === origin.categoryKey
      );
    }
    if (type === "item.place") {
      return (
        view.scope === "items" &&
        origin.scope === "items" &&
        view.categoryKey === origin.categoryKey
      );
    }
    if (type === "personal-category.place-channel") {
      return (
        view.scope === "channels" &&
        !!view.categoryPersonal &&
        origin.scope === "channels" &&
        !!origin.categoryPersonal &&
        view.membershipCategory === origin.membershipCategory
      );
    }
    return false;
  }

  function projectPlacementView(view, mutation) {
    var placement = mutation.placement;
    if (!placement) return;
    var items = view.items || [];
    var moved = null;
    for (var index = 0; index < items.length; index += 1) {
      if (items[index].id === placement.itemId) {
        moved = items[index];
        break;
      }
    }
    if (!moved) return;
    var kind = moved.kind;
    var ids = [];
    for (index = 0; index < items.length; index += 1) {
      if (items[index].kind === kind) ids.push(items[index].id);
    }
    var nextIds = applyPlacementToIds(ids, placement);
    if (nextIds === ids) return;
    var byId = {};
    for (index = 0; index < items.length; index += 1) {
      byId[items[index].id] = items[index];
    }
    var cursor = 0;
    for (index = 0; index < items.length; index += 1) {
      if (items[index].kind === kind) {
        items[index] = byId[nextIds[cursor]];
        cursor += 1;
      }
    }
  }

  function projectBackgroundMutation(view, mutation, origin) {
    if (!view || !mutation || !mutation.type) return;
    var type = mutation.type;
    if (type === "channel.visibility") {
      projectItemVisibility(
        view,
        function (item) {
          return (
            item.kind === "channel" &&
            (item.id === mutation.channelId || item.key === mutation.channelId)
          );
        },
        mutation.hidden,
      );
    } else if (type === "category.visibility") {
      projectItemVisibility(
        view,
        function (item) {
          return (
            item.kind === "category" &&
            (item.id === mutation.categoryKey || item.key === mutation.categoryKey)
          );
        },
        mutation.hidden,
      );
    } else if (type === "categories.visibility") {
      projectItemVisibility(
        view,
        function (item) {
          return item.kind === "category" && item.contentKind === mutation.contentKind;
        },
        mutation.hidden,
      );
    } else if (type === "channels.visibility") {
      if (view.scope === "channels" && (view.categoryKey || "") === (mutation.categoryKey || "")) {
        projectItemVisibility(view, function (item) { return item.kind === "channel"; }, mutation.hidden);
      }
    } else if (
      type === "category.place" ||
      type === "channel.place" ||
      type === "item.place" ||
      type === "personal-category.place-channel"
    ) {
      if (placementOriginMatches(view, origin, type)) {
        projectPlacementView(view, mutation);
      }
    } else if (
      type === "category-order.mode" ||
      type === "category-order.reset" ||
      type === "item-order.mode" ||
      type === "item-order.reset"
    ) {
      var isCategoryOrder = type.indexOf("category-order") === 0;
      var scopeMatches = isCategoryOrder
        ? view.scope === "categories" &&
          (!mutation.section || view.contentKind === mutation.section)
        : (view.scope === "items" || view.scope === "channels") &&
          (!mutation.categoryKey || view.categoryKey === mutation.categoryKey);
      if (!scopeMatches) return;
      if (type === "category-order.mode" || type === "item-order.mode") {
        if (typeof mutation.mode === "string") view.orderMode = mutation.mode;
      } else {
        view.orderMode = "provider";
      }
    }
  }

  function projectPendingLineupIntents() {
    if (!contentViewActive() || !lineup.loaded) return;
    var queue = lineupWriteQueueFor(lineup.playlistId, lineup.sourceVersion);
    if (!queue || !queue.pending.length) return;
    var view = liveLineupView();
    for (var index = 0; index < queue.pending.length; index += 1) {
      var pendingIntent = queue.pending[index];
      projectBackgroundMutation(view, pendingIntent.mutation, pendingIntent);
      applyLivePlacement(pendingIntent.mutation, pendingIntent);
    }
    lineup.orderMode = view.orderMode;
  }

  function renderBackgroundLineupView() {
    if (
      lineup.reorder &&
      lineup.sort &&
      (lineup.sort.grabbed || lineupSortDrag)
    ) {
      syncLineupSortRows();
      return;
    }
    var captured = captureCurrentFocus();
    renderManage("", false, true);
    restoreCapturedFocus(captured);
  }

  function publishBackgroundLineupView(queue) {
    if (!queueOwnerCurrent(queue) || !contentViewActive()) return;
    if (lineup.playlistId !== queue.playlistId) return;
    var signature = backgroundLineupViewSignature();
    if (!queue.acknowledgedView || queue.viewSignature !== signature) return;
    lineup.items = cloneViewItems(queue.acknowledgedView.items);
    lineup.orderMode = queue.acknowledgedView.orderMode;
    projectPendingLineupIntents();
    renderBackgroundLineupView();
  }

  function resolveLineupWriteWaiters(queue) {
    var waiters = queue.waiters;
    queue.waiters = [];
    for (var index = 0; index < waiters.length; index += 1) waiters[index]();
  }

  function invalidateLineupWriteQueues(playlistId) {
    lineupWriteQueues.forEach(function (queue) {
      if (playlistId && queue.playlistId !== playlistId) return;
      queue.pending = [];
      queue.generation += 1;
      resolveLineupWriteWaiters(queue);
    });
    if (!playlistId) lineupWriteQueues.clear();
  }

  function queueBackgroundLineupMutation(mutation, source) {
    if (!contentViewActive() || !lineup.loaded || lineup.playlistId !== contentPlaylistId) {
      return false;
    }
    if (typeof lineup.sourceVersion !== "number") return false;
    var key = lineupWriteQueueKey(lineup.playlistId, lineup.sourceVersion);
    var queue = lineupWriteQueues.get(key);
    if (queue && !queueOwnerCurrent(queue)) {
      queue.pending = [];
      queue.generation += 1;
      resolveLineupWriteWaiters(queue);
      queue = null;
    }
    if (!queue) {
      queue = {
        playlistId: lineup.playlistId,
        sourceVersion: lineup.sourceVersion,
        auth: auth,
        revision: lineup.revision,
        running: false,
        pending: [],
        acknowledgedView: null,
        viewSignature: "",
        generation: 0,
        waiters: [],
      };
      lineupWriteQueues.set(key, queue);
    }
    var signature = backgroundLineupViewSignature();
    if (!queue.pending.length && !queue.acknowledgedView) {
      queue.acknowledgedView = copyLineupView();
      queue.viewSignature = signature;
    }
    var intent = {
      mutation: mutation,
      viewSignature: signature,
      returnFocus: focusDescriptor(source),
      scope: lineup.scope,
      contentKind: lineup.contentKind,
      categoryKey: lineup.categoryKey,
      categoryPersonal: lineup.categoryPersonal,
      membershipCategory: lineup.membershipCategory,
    };
    queue.pending.push(intent);
    var view = liveLineupView();
    projectBackgroundMutation(view, mutation, intent);
    applyLivePlacement(mutation, intent);
    lineup.orderMode = view.orderMode;
    renderBackgroundLineupView();
    if (lineup.reorder && mutation.placement) {
      focusMovedLineupRow(mutation.placement.itemId);
    }
    void drainBackgroundLineupQueue(queue);
    return true;
  }

  function backgroundOwnerMatchesView(owner) {
    return (
      queueOwnerCurrent(owner) &&
      contentViewActive() &&
      lineup.playlistId === owner.playlistId &&
      lineup.sourceVersion === owner.sourceVersion
    );
  }

  function acceptBackgroundLineupRevision(owner, revision) {
    if (!queueOwnerCurrent(owner) || typeof revision !== "number") return;
    if (backgroundOwnerMatchesView(owner)) {
      lineup.revision = Math.max(lineup.revision, revision);
    }
    if (
      current &&
      current.lineup &&
      current.lineup.playlistId === owner.playlistId
    ) {
      current.lineup.revision = Math.max(current.lineup.revision, revision);
    }
  }

  async function refreshLineupQuietly(owner, viewSignature) {
    if (!owner || !contentViewActive() || lineup.playlistId !== owner.playlistId) return;
    if (lineup.loading) return;
    if (savedContentSourceVersion(owner.playlistId) !== owner.sourceVersion) return;
    if (viewSignature && backgroundLineupViewSignature() !== viewSignature) return;
    var generation = lineupRequestGeneration;
    var pageRequests = lineupPageRequests;
    var requestSignature = lineupRequestSignature();
    var refreshId = ++lineupQuietRefreshSeq;
    var targetPage = lineup.pageIndex;
    var offset = targetPage * 50;
    var body = lineupQueryBody(null, offset);
    if (typeof owner.sourceVersion === "number") body.sourceVersion = owner.sourceVersion;
    var response = await request(
      "/api/v1/lineup/query",
      { method: "POST", headers: headers(true), body: JSON.stringify(body) },
      "lineup",
    );
    if (
      refreshId !== lineupQuietRefreshSeq ||
      generation !== lineupRequestGeneration ||
      pageRequests !== lineupPageRequests ||
      lineupRequestSignature() !== requestSignature ||
      !contentViewActive() ||
      lineup.playlistId !== owner.playlistId ||
      savedContentSourceVersion(owner.playlistId) !== owner.sourceVersion
    ) {
      return;
    }
    if (response && response.status === 409 && response.body && response.body.revision) {
      acceptBackgroundLineupRevision(owner, response.body.revision);
      body.revision = response.body.revision;
      response = await request(
        "/api/v1/lineup/query",
        { method: "POST", headers: headers(true), body: JSON.stringify(body) },
        "lineup",
      );
      if (
        refreshId !== lineupQuietRefreshSeq ||
        generation !== lineupRequestGeneration ||
        pageRequests !== lineupPageRequests ||
        lineupRequestSignature() !== requestSignature ||
        !contentViewActive() ||
        lineup.playlistId !== owner.playlistId
      ) {
        return;
      }
    }
    if (!response || response.status !== 200 || !response.body.page) return;
    var page = response.body.page;
    var queue = lineupWriteQueueFor(owner.playlistId, owner.sourceVersion);
    if (queue && page.revision < queue.revision) return;
    var hasPending = !!(queue && queue.pending.length);
    lineup.items = page.items || [];
    acceptBackgroundLineupRevision(owner, page.revision);
    lineup.nextCursor = page.nextCursor || null;
    lineup.total = page.total;
    lineup.orderMode = page.orderMode || "provider";
    if (page.sectionCounts) lineup.sectionCounts = page.sectionCounts;
    lineup.cursors = lineup.cursors.slice(0, targetPage);
    lineup.cursors[targetPage] = null;
    lineup.pageIndex = targetPage;
    lineup.loaded = true;
    lineup.hasLoadedPage = true;
    if (
      !hasPending &&
      queue &&
      queueOwnerCurrent(queue) &&
      !queue.running &&
      page.revision >= queue.revision
    ) {
      queue.acknowledgedView = copyLineupView();
      queue.viewSignature = backgroundLineupViewSignature();
      queue.revision = page.revision;
    }
    if (hasPending) projectPendingLineupIntents();
    if (
      lineup.reorder &&
      !(lineup.sort && (lineup.sort.grabbed || lineupSortDrag))
    ) {
      rebuildLineupSort(true);
    }
    renderBackgroundLineupView();
  }

  async function drainBackgroundLineupQueue(queue) {
    if (queue.running) return;
    queue.running = true;
    var failed = false;
    try {
      while (queue.pending.length) {
        if (!queueOwnerCurrent(queue)) break;
        if (savedContentSourceVersion(queue.playlistId) !== queue.sourceVersion) break;
        var intent = queue.pending[0];
        var response = await postLineupMutation(intent.mutation, {
          playlistId: queue.playlistId,
          sourceVersion: queue.sourceVersion,
          revision: queue.revision,
        });
        if (!queueOwnerCurrent(queue)) break;
        if (response && response.status === 409) {
          if (response.body && response.body.snapshot) {
            adoptRemoteSnapshot(response.body.snapshot);
            if (reconcileLineupSource()) {
              invalidateLineupWriteQueues(queue.playlistId);
              break;
            }
          }
          if (
            response.body &&
            typeof response.body.revision === "number"
          ) {
            acceptBackgroundLineupRevision(queue, response.body.revision);
          }
        }
        if (response && response.status === 200 && response.body && response.body.ok) {
          queue.revision = response.body.revision;
          acceptBackgroundLineupRevision(queue, response.body.revision);
          queue.pending.shift();
          if (queue.acknowledgedView) {
            projectBackgroundMutation(queue.acknowledgedView, intent.mutation, intent);
          }
          publishBackgroundLineupView(queue);
          continue;
        }
        failed = true;
        break;
      }
    } finally {
      queue.running = false;
    }
    if (failed) {
      queue.pending = [];
      var signature = backgroundLineupViewSignature();
      var viewMatches = !!(
        queue.acknowledgedView &&
        queue.viewSignature === signature &&
        contentViewActive() &&
        lineup.playlistId === queue.playlistId &&
        lineup.sourceVersion === queue.sourceVersion
      );
      if (viewMatches) {
        lineup.items = cloneViewItems(queue.acknowledgedView.items);
        lineup.orderMode = queue.acknowledgedView.orderMode;
        cancelLineupSortDrag();
        clearLineupSortClickSuppress();
        lineup.sort = null;
        renderBackgroundLineupView();
        showNotification(lineupMutationReason(response), "error");
      }
      var owner = {
        playlistId: queue.playlistId,
        sourceVersion: queue.sourceVersion,
        auth: queue.auth,
      };
      void refreshLineupQuietly(owner, "");
    } else if (!queue.pending.length && queueOwnerCurrent(queue)) {
      var drainedOwner = {
        playlistId: queue.playlistId,
        sourceVersion: queue.sourceVersion,
        auth: queue.auth,
      };
      void refreshLineupQuietly(drainedOwner, "");
    }
    if (!queue.pending.length || !queueOwnerCurrent(queue)) {
      resolveLineupWriteWaiters(queue);
    }
  }

  function flushBackgroundLineupOwner(owner) {
    if (!owner || typeof owner.playlistId !== "string") return Promise.resolve();
    var sourceVersion =
      typeof owner.sourceVersion === "number" ? owner.sourceVersion : lineup.sourceVersion;
    var queue = lineupWriteQueueFor(owner.playlistId, sourceVersion);
    if (
      !queue ||
      !queueOwnerCurrent(queue) ||
      (!queue.pending.length && !queue.running)
    ) {
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      queue.waiters.push(resolve);
    });
  }

  function lineupBackgroundMutationSupported(mutation) {
    if (!mutation || typeof mutation.type !== "string") return false;
    var type = mutation.type;
    return (
      type === "channel.visibility" ||
      type === "category.visibility" ||
      type === "categories.visibility" ||
      type === "channels.visibility" ||
      type === "category.place" ||
      type === "channel.place" ||
      type === "item.place" ||
      type === "personal-category.place-channel" ||
      type === "category-order.mode" ||
      type === "item-order.mode" ||
      type === "category-order.reset" ||
      type === "item-order.reset"
    );
  }

  function clearLineupTimers() {
    if (lineupSearchTimer !== null) {
      clearTimeout(lineupSearchTimer);
      lineupSearchTimer = null;
    }
  }

  function restoreLineupFocus(descriptor) {
    restoreFocus(descriptor);
    if (activeLineupDialog()) return;
    var active = document.activeElement;
    if (active && active !== document.body) {
      if (active.closest("[data-lineup-editor], .lineup-editor-overlay")) {
        return;
      }
      if (root.contains(active)) return;
    }
    var fallbacks = [
      '[data-lineup-preference="order"]',
      "[data-lineup-mode-back]",
      "[data-lineup-search-toggle]",
      "[data-lineup-search]",
      "[data-lineup-heading]",
      ".crumbs a",
    ];
    for (var fallbackIndex = 0; fallbackIndex < fallbacks.length; fallbackIndex += 1) {
      var fallback = root.querySelector(fallbacks[fallbackIndex]);
      if (
        !fallback ||
        fallback.disabled ||
        fallback.getAttribute("aria-disabled") === "true"
      ) continue;
      if (fallback.hasAttribute("data-lineup-heading")) {
        fallback.focus({ preventScroll: true });
      } else {
        fallback.focus();
      }
      return;
    }
  }

  function focusViewHeading() {
    var section = root.querySelector(".manage-page");
    if (section && typeof section.scrollIntoView === "function") {
      section.scrollIntoView({ block: "start" });
    }
    if (manageView.page === "playlists" && manageView.sub === "list") {
      var firstCard = root.querySelector(".playlist-card");
      var listTarget = null;
      if (firstCard) {
        var firstLine = firstCard.querySelector(".playlist-card-line");
        listTarget =
          firstLine &&
          (firstLine.querySelector(".playlist-card-open:not(:disabled)") ||
            firstLine.querySelector("button:not(:disabled):not([aria-disabled='true'])"));
      } else {
        listTarget = root.querySelector("[data-action='open-add-playlist']");
      }
      if (listTarget && !listTarget.disabled) {
        listTarget.focus();
        return;
      }
    }
    var heading = root.querySelector("[data-lineup-heading]");
    if (heading) heading.focus({ preventScroll: true });
  }

  function firstLineupRowControl() {
    var row = root.querySelector("#lineup .lineup-list .lineup-row");
    if (!row) return null;
    var selectors = [
      ".lineup-row-open",
      "[data-lineup-edit]",
      ".lineup-row-menu-button",
      "[data-lineup-remove]",
      "[tabindex='0']",
    ];
    for (var index = 0; index < selectors.length; index += 1) {
      var control = row.querySelector(selectors[index]);
      if (control && !control.disabled) return control;
    }
    return null;
  }

  function revealLineupSortRow(target, pageTop) {
    var list = target.closest(".lineup-sort-list");
    var slot = target.closest("li");
    if (!list || !slot) return;
    if (pageTop) {
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    var header = root.querySelector(".manage-top");
    var visibleTop = (header ? header.getBoundingClientRect().bottom : 0) + 32;
    var visibleBottom = window.innerHeight - 32;
    var top = list.getBoundingClientRect().top + slot.offsetTop;
    var bottom = top + slot.offsetHeight;
    if (top < visibleTop) {
      window.scrollBy({ top: top - visibleTop, behavior: "auto" });
    } else if (bottom > visibleBottom) {
      window.scrollBy({ top: bottom - visibleBottom, behavior: "auto" });
    }
  }

  function focusMovedLineupRow(itemId, alignStart) {
    var target = null;
    if (itemId) {
      var rows = root.querySelectorAll("[data-lineup-sort]");
      for (var index = 0; index < rows.length; index += 1) {
        if (rows[index].dataset.id === itemId) {
          target = rows[index];
          break;
        }
      }
    }
    if (!target) {
      var fallbacks = [
        "[data-lineup-retry]",
        "[data-lineup-mode-back]",
        '[data-lineup-preference="custom-order"]',
        '[data-lineup-preference="order"]',
        "[data-lineup-search-toggle]",
        "[data-lineup-heading]",
      ];
      for (var fallbackIndex = 0; fallbackIndex < fallbacks.length; fallbackIndex += 1) {
        var candidate = root.querySelector(fallbacks[fallbackIndex]);
        if (candidate && !candidate.disabled) {
          target = candidate;
          break;
        }
      }
    }
    if (target) {
      if (target.hasAttribute("data-lineup-sort")) {
        target.focus({ preventScroll: true });
        revealLineupSortRow(target);
      } else if (alignStart) {
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: "start" });
      } else {
        target.focus();
      }
    }
  }

  function focusLineupSortPage() {
    if (!lineup.reorder || lineup.loading || lineup.mutating) return;
    if (lineup.error) {
      var retry = root.querySelector("[data-lineup-retry]");
      if (retry && !retry.disabled) {
        retry.focus();
        return;
      }
    }
    var heldId = lineup.sort && lineup.sort.grabbed ? lineup.sort.grabbed.id : "";
    if (heldId) {
      focusMovedLineupRow(heldId, true);
      return;
    }
    var firstRow = root.querySelector("[data-lineup-sort]");
    if (firstRow && !firstRow.disabled) {
      firstRow.focus();
      return;
    }
    var done = root.querySelector("[data-lineup-mode-back]");
    if (done && !done.disabled) done.focus();
  }

  function focusLineupPageStart() {
    if (!contentViewActive() || lineup.loading || lineup.mutating) return;
    if (lineup.reorder) {
      focusLineupSortPage();
      return;
    }
    var target = null;
    if (lineup.error) {
      var retry = root.querySelector("[data-lineup-retry]");
      if (retry && !retry.disabled) target = retry;
    }
    if (!target) target = firstLineupRowControl();
    if (!target) {
      var search = root.querySelector("[data-lineup-search-toggle]");
      if (search && !search.disabled) target = search;
    }
    if (!target) {
      var heading = root.querySelector("[data-lineup-heading]");
      if (heading) target = heading;
    }
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest" });
  }

  async function sendLineupMutation(mutation, source, options) {
    options = options || {};
    if (!contentViewActive() || lineup.mutating) return false;
    if (lineupBackgroundMutationSupported(mutation)) {
      return queueBackgroundLineupMutation(mutation, source);
    }
    var sentOwner = {
      playlistId: lineup.playlistId,
      sourceVersion: lineup.sourceVersion,
      auth: auth,
    };
    var sentViewSignature = backgroundLineupViewSignature();
    var returnFocus =
      (lineup.editor && lineup.editor.returnFocus) || focusDescriptor(source);
    await flushBackgroundLineupOwner(sentOwner);
    if (
      !contentViewActive() ||
      lineup.mutating ||
      auth !== sentOwner.auth ||
      lineup.playlistId !== sentOwner.playlistId ||
      lineup.sourceVersion !== sentOwner.sourceVersion ||
      backgroundLineupViewSignature() !== sentViewSignature
    ) {
      return false;
    }
    var sentPlaylistId = sentOwner.playlistId;
    var keepPageIndex = options.keepPage ? lineup.pageIndex : -1;
    var keepPageOrderMode = options.keepPage ? lineup.orderMode : "";
    var keepPageSignature = options.keepPage ? currentLineupSignature() : "";
    var generation = ++lineupRequestGeneration;
    var requestSignature = lineupRequestSignature();
    clearLineupTimers();
    lineup.loading = false;
    lineup.mutating = true;
    lineup.error = "";
    renderManage();
    var response = await postLineupMutation(mutation, sentOwner);
    if (
      generation !== lineupRequestGeneration ||
      lineupRequestSignature() !== requestSignature
    ) {
      return false;
    }
    if (!response || lineup.playlistId !== sentPlaylistId || !contentViewActive()) {
      lineup.mutating = false;
      if (current) renderManage();
      return false;
    }
    if (response.status === 409) {
      var mutationSourceChanged = false;
      if (response.body.snapshot) {
        adoptRemoteSnapshot(response.body.snapshot);
        mutationSourceChanged = reconcileLineupSource();
      }
      if (mutationSourceChanged) {
        lineup.mutating = false;
        renderManage();
        return false;
      }
      var stayInSort = !!(
        options.keepReorder &&
        lineup.reorder &&
        lineup.playlistId === sentPlaylistId &&
        contentViewActive()
      );
      acceptLineupRevision(response.body.revision);
      lineup.mutating = false;
      lineup.notice = labels().lineupConflict;
      lineup.editor = null;
      cancelLineupSortDrag();
      clearLineupSortClickSuppress();
      if (stayInSort) {
        lineup.sort = null;
        resetLineupPage();
        await loadLineupPage("reset", false);
        focusLineupSortPage();
        return false;
      }
      lineup.sort = null;
      lineup.reorder = false;
      resetLineupPage();
      if (!contentViewActive()) {
        renderManage();
        restoreLineupFocus(returnFocus);
        return false;
      }
      if (options.keepPage) {
        lineup.pageIndex = keepPageIndex;
        lineup.orderMode = keepPageOrderMode;
        var pageGeneration = lineupRequestGeneration + 1;
        await loadLineupPage("current", false);
        if (
          pageGeneration === lineupRequestGeneration &&
          lineup.playlistId === sentPlaylistId &&
          currentLineupSignature() === keepPageSignature &&
          lineupRequestSignature() === requestSignature &&
          contentViewActive()
        ) {
          restoreLineupFocus(returnFocus);
        }
      } else {
        await loadLineupPage("reset");
        restoreLineupFocus(returnFocus);
      }
      return false;
    }
    if (response.status !== 200 || !response.body.ok) {
      lineup.mutating = false;
      if (lineup.sort) {
        lineup.sort.grabbed = null;
        lineup.sort.ids = lineup.sort.originIds.slice();
        lineup.sort.dirty = false;
      }
      lineup.error = lineupMutationReason(response);
      renderManage(lineup.error, true);
      if (options.keepReorder) {
        var failedId = mutation && mutation.placement ? mutation.placement.itemId : "";
        focusMovedLineupRow(failedId);
      } else {
        restoreLineupFocus(returnFocus);
      }
      return false;
    }
    if (options.keepReorder && lineup.sort) {
      lineup.items = lineupSortDisplayIds()
        .map(function (id) {
          return lineupItemById(id);
        })
        .filter(Boolean);
    }
    acceptLineupRevision(response.body.revision);
    lineup.mutating = false;
    lineup.editor = null;
    if (!options.keepReorder) {
      cancelLineupSortDrag();
      lineup.sort = null;
      lineup.reorder = false;
    }
    lineup.notice = "";
    lineup.createDraft = "";
    if (options.keepPage) {
      lineup.cursors = [null];
      lineup.nextCursor = null;
      lineup.error = "";
      lineup.conflictRetried = false;
      if (mutation && typeof mutation.mode === "string") {
        lineup.orderMode = mutation.mode;
      }
      lineup.pageIndex = keepPageIndex;
      var pageGeneration = lineupRequestGeneration + 1;
      await loadLineupPage("current", false);
      if (
        pageGeneration === lineupRequestGeneration &&
        lineup.playlistId === sentPlaylistId &&
        currentLineupSignature() === keepPageSignature &&
        lineupRequestSignature() === requestSignature &&
        contentViewActive()
      ) {
        return true;
      }
      return false;
    }
    if (options.keepReorder) {
      lineup.cursors = [null];
      lineup.nextCursor = null;
    } else {
      resetLineupPage();
    }
    var refreshGeneration = lineupRequestGeneration + 1;
    var refreshSignature = currentLineupSignature();
    await loadLineupPage("reset", false);
    if (
      refreshGeneration === lineupRequestGeneration &&
      lineup.playlistId === sentPlaylistId &&
      currentLineupSignature() === refreshSignature &&
      lineupRequestSignature() === requestSignature &&
      contentViewActive()
    ) {
      if (!activeLineupDialog()) {
        if (lineup.error) {
          var refreshRetry = root.querySelector("[data-lineup-retry]");
          if (refreshRetry && !refreshRetry.disabled) refreshRetry.focus();
        } else if (options.keepReorder) {
          var movedId = mutation && mutation.placement ? mutation.placement.itemId : "";
          focusMovedLineupRow(movedId);
        } else {
          restoreLineupFocus(returnFocus);
        }
      }
    }
    return true;
  }

  function channelNumberDraft(value) {
    var trimmed = (value || "").trim();
    if (!trimmed) return { number: null };
    if (!/^[0-9]+$/.test(trimmed)) return null;
    var parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
    return { number: parsed };
  }

  function lineupEditorRestoreTarget(editor) {
    if (editor.kind === "channel") {
      return {
        name: editor.providerName || "",
        number: editor.providerNumber == null ? "" : String(editor.providerNumber),
      };
    }
    if (editor.kind === "category") {
      return { value: editor.providerName || "" };
    }
    return null;
  }

  function applyLineupEditorRestore(editor) {
    var target = lineupEditorRestoreTarget(editor);
    if (!target) return;
    if (editor.kind === "channel") {
      editor.name = target.name;
      editor.number = target.number;
      editor.restore = { name: true, number: true };
    } else {
      editor.value = target.value;
      editor.restore = { name: true };
    }
    editor.error = "";
  }

  function lineupEditorSteps(editor) {
    var restore = editor.restore || {};
    if (editor.kind === "channel") {
      var parsed = channelNumberDraft(editor.number);
      if (!parsed) return null;
      var name = (editor.name || "").trim();
      var desiredName = name || editor.providerName || "";
      var desiredNumber =
        parsed.number === null ? editor.providerNumber ?? null : parsed.number;
      var steps = [];
      if (restore.name || desiredName !== editor.effectiveName) {
        steps.push({
          type: "channel.rename",
          channelId: editor.id,
          name: restore.name ? null : name || null,
        });
      }
      if (restore.number || desiredNumber !== editor.effectiveNumber) {
        steps.push({
          type: "channel.number",
          channelId: editor.id,
          number: restore.number ? null : parsed.number,
        });
      }
      return steps;
    }
    if (editor.kind === "category") {
      var value = (editor.value || "").trim();
      var desiredValue = value || editor.providerName || "";
      var categorySteps = [];
      if (restore.name || desiredValue !== editor.effectiveName) {
        categorySteps.push({
          type: "category.rename",
          categoryKey: editor.id,
          name: restore.name ? null : value || null,
        });
      }
      return categorySteps;
    }
    if (editor.kind === "personal-category") {
      var personalName = (editor.value || "").trim();
      if (!personalName) return null;
      return personalName !== editor.effectiveName
        ? [{ type: "personal-category.rename", categoryId: editor.id, name: personalName }]
        : [];
    }
    return null;
  }

  function applyEditorStepResult(editor, step) {
    var restore = editor.restore || (editor.restore = {});
    if (step.type === "channel.rename") {
      editor.effectiveName = step.name === null ? editor.providerName || "" : step.name;
      restore.name = false;
    } else if (step.type === "channel.number") {
      editor.effectiveNumber =
        step.number === null ? editor.providerNumber ?? null : step.number;
      restore.number = false;
    } else if (step.type === "category.rename") {
      editor.effectiveName = step.name === null ? editor.providerName || "" : step.name;
      restore.name = false;
    } else if (step.type === "personal-category.rename") {
      editor.effectiveName = step.name;
    }
  }

  async function saveLineupEditor(source) {
    var editor = lineup.editor;
    if (!editor || editor.saving || !contentViewActive()) return;
    if (editor.kind === "personal-category" && !customCategoriesEnabled()) return;
    var returnFocus = editor.returnFocus || focusDescriptor(source);
    var steps = lineupEditorSteps(editor);
    if (steps === null) {
      editor.error = labels().lineupInvalidValue;
      renderManage();
      var invalidField =
        root.querySelector('[data-lineup-editor] [name="editorNumber"]') ||
        root.querySelector("[data-lineup-editor] input");
      if (invalidField) invalidField.focus();
      return;
    }
    if (!steps.length) {
      lineup.editor = null;
      renderManage();
      restoreLineupFocus(returnFocus);
      return;
    }
    var editorOwner = {
      playlistId: lineup.playlistId,
      sourceVersion: lineup.sourceVersion,
      auth: auth,
    };
    var editorViewSignature = backgroundLineupViewSignature();
    await flushBackgroundLineupOwner(editorOwner);
    if (
      !contentViewActive() ||
      lineup.editor !== editor ||
      editor.saving ||
      auth !== editorOwner.auth ||
      lineup.playlistId !== editorOwner.playlistId ||
      lineup.sourceVersion !== editorOwner.sourceVersion ||
      backgroundLineupViewSignature() !== editorViewSignature
    ) {
      return;
    }
    clearLineupTimers();
    editor.saving = true;
    editor.error = "";
    var generation = ++lineupRequestGeneration;
    var requestSignature = lineupRequestSignature();
    var sentPlaylistId = lineup.playlistId;
    lineup.loading = false;
    lineup.mutating = true;
    renderManage();
    for (var index = 0; index < steps.length; index += 1) {
      var step = steps[index];
      var response = await postLineupMutation(step, editorOwner);
      if (
        generation !== lineupRequestGeneration ||
        lineupRequestSignature() !== requestSignature
      ) {
        if (lineup.editor === editor) {
          editor.saving = false;
          lineup.mutating = false;
        }
        return;
      }
      if (!response) {
        lineup.mutating = false;
        editor.saving = false;
        return;
      }
      if (!contentViewActive() || lineup.playlistId !== sentPlaylistId) {
        lineup.mutating = false;
        editor.saving = false;
        lineup.editor = null;
        renderManage();
        return;
      }
      if (response.status === 409) {
        var editorSourceChanged = false;
        if (response.body.snapshot) {
          adoptRemoteSnapshot(response.body.snapshot);
          editorSourceChanged = reconcileLineupSource();
        }
        if (editorSourceChanged) {
          lineup.mutating = false;
          editor.saving = false;
          renderManage();
          return;
        }
        acceptLineupRevision(response.body.revision);
        lineup.mutating = false;
        editor.saving = false;
        editor.error = lineupMutationReason(response);
        renderManage();
        return;
      }
      if (response.status !== 200 || !response.body.ok) {
        lineup.mutating = false;
        editor.saving = false;
        editor.error = lineupMutationReason(response);
        if (response.body && typeof response.body.revision === "number") {
          acceptLineupRevision(response.body.revision);
        }
        renderManage();
        return;
      }
      acceptLineupRevision(response.body.revision);
      applyEditorStepResult(editor, step);
    }
    var savedOrigin = editor.origin || null;
    lineup.mutating = false;
    lineup.editor = null;
    lineup.notice = "";
    lineup.createDraft = "";
    var expectedLoad = 0;
    var savedRequestSignature = lineupRequestSignature();
    var scopeIntact = function () {
      return (
        (!savedOrigin ||
          (savedOrigin.signature === lineupBrowseSignature() &&
            lineup.query === savedOrigin.query)) &&
        lineupRequestGeneration === expectedLoad &&
        lineupRequestSignature() === savedRequestSignature &&
        contentViewActive()
      );
    };
    if (
      savedOrigin &&
      savedOrigin.signature === lineupBrowseSignature() &&
      lineup.query === savedOrigin.query
    ) {
      lineup.pageIndex = savedOrigin.pageIndex;
      lineup.cursors = [null];
      expectedLoad = lineupRequestGeneration + 1;
      await loadLineupPage("current", false);
      var clamped = false;
      if (
        scopeIntact() &&
        lineup.loaded &&
        !lineup.items.length &&
        lineup.pageIndex > 0 &&
        lineup.total > 0
      ) {
        var lastPage = Math.max(0, Math.ceil(lineup.total / LINEUP_PAGE_SIZE) - 1);
        if (lastPage < lineup.pageIndex) {
          lineup.pageIndex = lastPage;
          lineup.cursors = [null];
          clamped = true;
          expectedLoad = lineupRequestGeneration + 1;
          await loadLineupPage("current", false);
        }
      }
      if (!scopeIntact()) return;
      if (
        !clamped &&
        typeof window !== "undefined" &&
        typeof window.scrollTo === "function"
      ) {
        window.scrollTo(0, savedOrigin.scrollY);
      }
      restoreLineupFocus(returnFocus);
      return;
    }
    resetLineupPage();
    expectedLoad = lineupRequestGeneration + 1;
    await loadLineupPage("reset");
    if (!scopeIntact()) return;
    if (!savedOrigin || savedOrigin.signature === lineupBrowseSignature()) {
      restoreLineupFocus(returnFocus);
    }
  }

  var LINEUP_PAGE_SIZE = 50;

  function lineupPageCount(total) {
    return Math.max(1, Math.ceil((total || 0) / LINEUP_PAGE_SIZE));
  }

  function lineupDrilled() {
    return lineup.scope === "channels" || lineup.scope === "items";
  }

  function lineupReorderable() {
    if (lineup.scope === "categories") return true;
    if (lineup.scope === "personal-categories") return false;
    return !!lineup.categoryKey;
  }

  function lineupMovableKind() {
    if (lineup.scope === "categories") return "category";
    if (lineup.scope === "channels") return "channel";
    if (lineup.scope === "items") return "item";
    return "";
  }

  function clearLineupContext() {
    lineup.categoryKey = "";
    lineup.categoryName = "";
    lineup.categoryKind = "live";
    lineup.categoryPersonal = false;
    lineup.membershipCategory = "";
    lineup.query = "";
    lineup.editor = null;
    lineup.orderDialog = null;
    lineupBrowseSnapshot = null;
    lineupParents = [];
    cancelLineupSortDrag();
    clearLineupSortClickSuppress();
    lineup.sort = null;
    lineup.reorder = false;
    lineup.notice = "";
    lineupRequestGeneration += 1;
    if (lineupSearchTimer !== null) {
      clearTimeout(lineupSearchTimer);
      lineupSearchTimer = null;
    }
    resetLineupPage();
  }

  function lineupPlacementMutation(placement) {
    if (lineup.scope === "categories") {
      return { type: "category.place", placement: placement };
    }
    if (lineup.scope === "channels") {
      return lineup.categoryPersonal
        ? {
            type: "personal-category.place-channel",
            categoryId: lineup.membershipCategory,
            placement: placement,
          }
        : { type: "channel.place", categoryKey: lineup.categoryKey, placement: placement };
    }
    if (lineup.scope === "items") {
      return { type: "item.place", categoryKey: lineup.categoryKey, placement: placement };
    }
    return null;
  }

  function lineupPageSortIds() {
    var wanted = lineupMovableKind();
    var ids = [];
    for (var index = 0; index < lineup.items.length; index += 1) {
      if (lineup.items[index].kind === wanted) ids.push(lineup.items[index].id);
    }
    return ids;
  }

  function lineupItemById(id) {
    for (var index = 0; index < lineup.items.length; index += 1) {
      if (lineup.items[index].id === id) return lineup.items[index];
    }
    var sort = lineup.sort;
    if (sort && sort.grabbed && sort.grabbed.id === id) return sort.grabbed;
    return null;
  }

  function lineupSortCleanIds() {
    var sort = lineup.sort;
    if (!sort) return [];
    var ids = sort.originIds.slice();
    if (sort.grabbed && sort.originIds.indexOf(sort.grabbed.id) < 0) {
      ids.unshift(sort.grabbed.id);
    }
    return ids;
  }

  function lineupSortHeldOffPage() {
    var sort = lineup.sort;
    return !!(sort && sort.grabbed && sort.originIds.indexOf(sort.grabbed.id) < 0);
  }

  function lineupSortSameIds(a, b) {
    if (a.length !== b.length) return false;
    for (var index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) return false;
    }
    return true;
  }

  function lineupSortDisplayIds() {
    var sort = lineup.sort;
    if (!sort) return [];
    var ids = sort.ids.slice();
    if (sort.grabbed && ids.indexOf(sort.grabbed.id) < 0) ids.unshift(sort.grabbed.id);
    return ids;
  }

  function lineupSortTranslateY(node) {
    var matrix = /^matrix\((.+)\)$/.exec(getComputedStyle(node).transform);
    return matrix ? Number(matrix[1].split(",")[5]) || 0 : 0;
  }

  function cancelLineupSortAnimations() {
    lineupSortAnimations.forEach(function (animation) {
      animation.onfinish = null;
      animation.oncancel = null;
      animation.cancel();
    });
    lineupSortAnimations.clear();
  }

  function rebuildLineupSort(keepHeld, pinHeld) {
    if (!lineup.reorder) {
      lineup.sort = null;
      return;
    }
    var previous = lineup.sort;
    var grabbed = keepHeld && previous ? previous.grabbed : null;
    var originIds = lineupPageSortIds();
    var heldOffPage = grabbed && originIds.indexOf(grabbed.id) < 0;
    var pin = !!(pinHeld && grabbed);
    lineup.sort = {
      grabbed: grabbed,
      originIds: originIds,
      ids: pin
        ? [grabbed.id].concat(
            originIds.filter(function (id) {
              return id !== grabbed.id;
            }),
          )
        : heldOffPage
          ? [grabbed.id].concat(originIds)
          : originIds.slice(),
      dirty: !!(pin && (heldOffPage || originIds[0] !== grabbed.id)),
    };
  }

  function syncLineupSortRows(pageTop) {
    var sort = lineup.sort;
    var list = root.querySelector(".lineup-sort-list");
    if (!sort || !list) return;
    var displayIds = lineupSortDisplayIds();
    var wanted = Object.create(null);
    displayIds.forEach(function (id) {
      wanted[id] = true;
    });
    var rows = list.querySelectorAll("[data-lineup-sort]");
    var nodes = Object.create(null);
    var beforeNodes = new Map();
    for (var index = 0; index < rows.length; index += 1) {
      var wrapper = rows[index].closest("li") || rows[index];
      nodes[rows[index].dataset.id] = wrapper;
      beforeNodes.set(wrapper, {
        top: wrapper.offsetTop,
        height: wrapper.offsetHeight,
        translateY: lineupSortTranslateY(wrapper),
      });
    }
    cancelLineupSortAnimations();
    var drag = lineupSortDrag;
    var protectedId = "";
    if (drag && drag.node && list.contains(drag.node)) {
      protectedId = drag.id;
    } else {
      var active = document.activeElement;
      if (
        active &&
        active.hasAttribute &&
        active.hasAttribute("data-lineup-sort") &&
        list.contains(active)
      ) {
        protectedId = active.dataset.id;
      }
    }
    if (!(protectedId && wanted[protectedId])) protectedId = "";
    var focusedInside = list.contains(document.activeElement);
    for (var staleId in nodes) {
      if (!wanted[staleId] && nodes[staleId].parentNode) {
        nodes[staleId].parentNode.removeChild(nodes[staleId]);
      }
    }
    var live = list.querySelectorAll("[data-lineup-sort]");
    var domIds = [];
    for (var liveIndex = 0; liveIndex < live.length; liveIndex += 1) {
      domIds.push(live[liveIndex].dataset.id);
    }
    if (!lineupSortSameIds(domIds, displayIds)) {
      if (!protectedId || !nodes[protectedId]) {
        displayIds.forEach(function (id) {
          var node = nodes[id];
          if (node && node.parentNode === list) list.appendChild(node);
        });
      } else {
        var anchor = nodes[protectedId];
        var anchorIndex = displayIds.indexOf(protectedId);
        for (var beforeIndex = 0; beforeIndex < anchorIndex; beforeIndex += 1) {
          list.insertBefore(nodes[displayIds[beforeIndex]], anchor);
        }
        for (var afterIndex = displayIds.length - 1; afterIndex > anchorIndex; afterIndex -= 1) {
          list.insertBefore(nodes[displayIds[afterIndex]], anchor.nextSibling);
        }
      }
    }
    var l = labels();
    var fresh = list.querySelectorAll("[data-lineup-sort]");
    for (var rowIndex = 0; rowIndex < fresh.length; rowIndex += 1) {
      var button = fresh[rowIndex];
      var held = !!(sort.grabbed && button.dataset.id === sort.grabbed.id);
      button.setAttribute("aria-pressed", String(held));
      var nameNode = button.querySelector(".lineup-sort-label");
      var name = nameNode ? nameNode.textContent : button.dataset.id;
      button.setAttribute(
        "aria-label",
        name + ", " + (held ? l.lineupRelease : l.lineupGrab),
      );
      var row = button.closest(".lineup-sort-row") || button;
      row.classList.toggle("grabbed", held);
      var wrapper = button.closest("li");
      if (wrapper) wrapper.classList.toggle("grabbed", held);
    }
    var duration = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--t-fast"),
    );
    beforeNodes.forEach(function (before, node) {
      if (
        !node.isConnected ||
        (sort.grabbed && nodes[sort.grabbed.id] === node) ||
        !before.height ||
        !(duration > 0)
      ) return;
      var delta = before.top - node.offsetTop + before.translateY;
      if (!delta) return;
      var animation = node.animate(
        [{ transform: "translateY(" + delta + "px)" }, { transform: "translateY(0px)" }],
        { duration: duration, easing: "cubic-bezier(0, 0, 0.2, 1)" },
      );
      lineupSortAnimations.set(node, animation);
      function release() {
        if (lineupSortAnimations.get(node) === animation) lineupSortAnimations.delete(node);
      }
      animation.onfinish = release;
      animation.oncancel = release;
    });
    if (focusedInside && !list.contains(document.activeElement)) {
      var firstRow = list.querySelector("[data-lineup-sort]");
      var fallback = firstRow || root.querySelector("[data-lineup-mode-back]");
      if (fallback) fallback.focus();
    }
    if (sort.grabbed && !lineupSortDrag) {
      for (var heldIndex = 0; heldIndex < fresh.length; heldIndex += 1) {
        if (fresh[heldIndex].dataset.id === sort.grabbed.id) {
          revealLineupSortRow(fresh[heldIndex], pageTop);
          break;
        }
      }
    }
  }

  function clearLineupSortHold(syncDom) {
    var sort = lineup.sort;
    if (!sort) return;
    sort.grabbed = null;
    sort.ids = sort.originIds.slice();
    sort.dirty = false;
    if (syncDom) syncLineupSortRows();
  }

  function cancelLineupSortDrag(restore) {
    document.documentElement.classList.remove("lineup-dragging");
    var drag = lineupSortDrag;
    lineupSortDrag = null;
    if (!drag) return;
    if (restore !== false && drag.moved && lineup.sort === drag.sort) {
      drag.sort.ids = drag.originIds;
      drag.sort.grabbed = drag.originGrabbed;
      drag.sort.dirty = drag.originDirty;
      syncLineupSortRows();
    }
    if (drag.raf && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(drag.raf);
    }
    if (drag.node && drag.node.releasePointerCapture) {
      try {
        drag.node.releasePointerCapture(drag.pointerId);
      } catch (_error) {}
    }
  }

  function lineupBrowseSignature() {
    return contentPlaylistId + "|" + currentLineupSignature();
  }

  function captureLineupBrowse() {
    lineupBrowseSnapshot = {
      signature: lineupBrowseSignature(),
      pageIndex: lineup.pageIndex,
      query: lineup.query,
      searchOpen: lineup.searchOpen,
      scrollY:
        typeof window !== "undefined"
          ? window.scrollY || window.pageYOffset || 0
          : 0,
    };
  }

  function restoreLineupBrowse(preferenceKey) {
    var snapshot = lineupBrowseSnapshot;
    lineupBrowseSnapshot = null;
    if (!snapshot || snapshot.signature !== lineupBrowseSignature()) return false;
    clearLineupTimers();
    var restorationGeneration = ++lineupRequestGeneration;
    var reuse =
      lineup.loaded &&
      !lineup.loading &&
      lineup.pageIndex === snapshot.pageIndex &&
      lineup.query === snapshot.query;
    lineup.query = snapshot.query;
    lineup.searchOpen = snapshot.searchOpen;
    lineup.pageIndex = snapshot.pageIndex;
    if (!reuse) {
      lineup.cursors = [null];
      lineup.nextCursor = null;
      lineup.items = [];
      lineup.loaded = false;
      lineup.loading = true;
      lineup.error = "";
    }
    var signature = snapshot.signature;
    var scrollY = snapshot.scrollY;
    var restoreAuth = auth;
    pendingLineupBrowseRestore = function () {
      void (async function () {
        if (
          auth !== restoreAuth ||
          signature !== lineupBrowseSignature() ||
          restorationGeneration !== lineupRequestGeneration ||
          !contentViewActive()
        ) {
          return;
        }
        if (!reuse) {
          var untouched = true;
          var onInteraction = function () { untouched = false; };
          window.addEventListener("keydown", onInteraction, true);
          window.addEventListener("pointerdown", onInteraction, true);
          try {
            await loadLineupPage("current", false);
          } finally {
            window.removeEventListener("keydown", onInteraction, true);
            window.removeEventListener("pointerdown", onInteraction, true);
          }
          if (
            !untouched ||
            auth !== restoreAuth ||
            lineupRequestGeneration !== restorationGeneration + 1 ||
            signature !== lineupBrowseSignature() ||
            !contentViewActive()
          ) {
            return;
          }
        }
        if (!activeLineupDialog() && !lineup.reorder) {
          if (lineup.error) {
            var retry = root.querySelector("[data-lineup-retry]");
            if (retry && !retry.disabled) retry.focus({ preventScroll: true });
          } else {
            var key = preferenceKey;
            if (
              key === "custom-order" &&
              !(lineup.orderMode === "custom" && lineupReorderable())
            ) {
              key = "order";
            }
            var keys = key && key !== "order" ? [key, "order"] : ["order"];
            var preference = null;
            for (var keyIndex = 0; keyIndex < keys.length && !preference; keyIndex += 1) {
              var candidates = root.querySelectorAll(
                '[data-lineup-preference="' + keys[keyIndex] + '"]',
              );
              for (
                var candidateIndex = 0;
                candidateIndex < candidates.length;
                candidateIndex += 1
              ) {
                var candidate = candidates[candidateIndex];
                if (
                  !candidate.disabled &&
                  candidate.getAttribute("aria-disabled") !== "true" &&
                  !candidate.closest("[hidden]")
                ) {
                  preference = candidate;
                  break;
                }
              }
            }
            if (preference) preference.focus({ preventScroll: true });
            else restoreLineupFocus(null);
          }
          if (
            typeof window !== "undefined" &&
            typeof window.scrollTo === "function"
          ) {
            window.scrollTo(0, scrollY);
          }
        }
      })();
    };
    return true;
  }

  function enterLineupSort() {
    if (
      !lineup.loaded ||
      !lineupReorderable() ||
      lineup.reorder ||
      lineup.loading ||
      lineup.mutating ||
      lineup.orderDialog
    ) {
      return;
    }
    captureLineupBrowse();
    var needsUnfilteredReload = !!lineup.query || lineup.pageIndex !== 0;
    clearLineupTimers();
    lineup.query = "";
    lineup.searchOpen = false;
    lineup.reorder = true;
    lineup.editor = null;
    if (needsUnfilteredReload) {
      resetLineupPage();
      void loadLineupPage("reset");
      return;
    }
    rebuildLineupSort(false);
    renderManage();
    var first = root.querySelector("[data-lineup-sort]");
    if (first) first.focus();
  }

  function exitLineupSort() {
    if (lineup.mutating) return;
    cancelLineupSortDrag();
    clearLineupSortClickSuppress();
    lineup.reorder = false;
    lineup.sort = null;
    restoreLineupBrowse("custom-order");
    renderManage();
  }

  function lineupModeBack() {
    if (
      managementWriteBlocked() ||
      commandInFlight ||
      lineup.editor ||
      lineup.orderDialog ||
      itemMenu
    ) return;
    if (lineup.reorder) {
      var sort = lineup.sort;
      cancelLineupSortDrag();
      if (sort && sort.grabbed) clearLineupSortHold(true);
      else exitLineupSort();
      return;
    }
    var parent = lineupParents.pop();
    var ancestors = lineupParents.slice();
    if (
      parent &&
      parent.auth === auth &&
      parent.playlistId === contentPlaylistId &&
      parent.sourceVersion === lineup.sourceVersion &&
      enterLineupView(parent.target, parent)
    ) {
      lineupParents = ancestors;
      saveManagementRoute(false);
      return;
    }
    lineupParents = [];
    var links = root.querySelectorAll(".manage-content > .crumbs a");
    if (links.length) links[links.length - 1].click();
  }

  function closeLineupSearch(restoreFocus) {
    if (!lineup.searchOpen) return;
    lineup.searchOpen = false;
    if (lineup.query) {
      lineupRequestGeneration += 1;
      if (lineupSearchTimer !== null) {
        clearTimeout(lineupSearchTimer);
        lineupSearchTimer = null;
      }
      lineup.query = "";
      resetLineupPage();
      void loadLineupPage("reset");
    }
    renderManage();
    if (restoreFocus !== false) {
      var toggle = root.querySelector("[data-lineup-search-toggle]");
      if (toggle) toggle.focus();
    }
  }

  function openLineupOrderDialog(source) {
    if (
      !lineupPreferenceScope() ||
      lineup.orderDialog ||
      lineup.loading ||
      lineup.mutating ||
      busy ||
      commandInFlight
    ) {
      return;
    }
    lineup.orderDialog = {
      signature: lineupOrderDialogSignature(),
      returnFocus: focusDescriptor(source),
    };
    renderManage();
    var selected =
      root.querySelector('[data-lineup-order-option][aria-selected="true"]') ||
      root.querySelector("[data-lineup-order-option]");
    if (selected) selected.focus();
  }

  function closeLineupOrderDialog(restore) {
    var dialog = lineup.orderDialog;
    if (!dialog) return;
    lineup.orderDialog = null;
    renderManage();
    if (restore !== false) restoreLineupFocus(dialog.returnFocus);
  }

  async function selectLineupOrderMode(mode, source) {
    var dialog = lineup.orderDialog;
    if (!dialog || dialog.signature !== lineupOrderDialogSignature()) {
      closeLineupOrderDialog();
      return;
    }
    if (lineup.mutating || lineup.loading || busy || commandInFlight) return;
    if (mode === lineup.orderMode) {
      closeLineupOrderDialog();
      return;
    }
    var mutation =
      lineup.scope === "categories"
        ? { type: "category-order.mode", section: lineup.contentKind, mode: mode }
        : { type: "item-order.mode", categoryKey: lineup.categoryKey, mode: mode };
    var saved = await sendLineupMutation(mutation, source, { keepPage: true });
    if (
      saved &&
      lineup.orderDialog === dialog &&
      dialog.signature === lineupOrderDialogSignature()
    ) {
      closeLineupOrderDialog();
    }
  }

  function lineupOrderResetMutation() {
    return lineup.scope === "categories"
      ? { type: "category-order.reset", section: lineup.contentKind }
      : { type: "item-order.reset", categoryKey: lineup.categoryKey };
  }

  function lineupBulkVisibilityMutation(hidden) {
    return lineup.scope === "channels" && lineup.categoryKey
      ? {
          type: "channels.visibility",
          categoryKey: lineup.categoryKey,
          hidden: hidden,
        }
      : {
          type: "categories.visibility",
          contentKind: lineup.contentKind,
          hidden: hidden,
        };
  }

  function lineupSortPlacement(ids) {
    var sort = lineup.sort;
    if (!sort || !sort.grabbed) return null;
    var at = ids.indexOf(sort.grabbed.id);
    if (at < 0) return null;
    if (at + 1 < ids.length) return { itemId: sort.grabbed.id, beforeId: ids[at + 1] };
    if (at > 0) return { itemId: sort.grabbed.id, afterId: ids[at - 1] };
    return null;
  }

  async function commitLineupSort(ids) {
    var sort = lineup.sort;
    if (!sort || !sort.grabbed || lineup.loading || lineup.mutating) return;
    if (lineup.orderMode !== "custom") {
      clearLineupSortHold(true);
      return;
    }
    var offPage = sort.originIds.indexOf(sort.grabbed.id) < 0;
    if (
      lineupSortSameIds(ids, lineupSortCleanIds()) &&
      (!sort.dirty || !offPage)
    ) {
      clearLineupSortHold(true);
      return;
    }
    var placement = lineupSortPlacement(ids);
    var mutation = placement && lineupPlacementMutation(placement);
    if (!mutation) {
      clearLineupSortHold(true);
      return;
    }
    sort.ids = ids.slice();
    if (!offPage) sort.grabbed = null;
    sort.dirty = false;
    syncLineupSortRows();
    await sendLineupMutation(mutation, null, { keepReorder: true });
  }

  function releaseLineupSort() {
    var sort = lineup.sort;
    if (!sort || !sort.grabbed) {
      clearLineupSortHold(true);
      return;
    }
    void commitLineupSort(lineupSortDisplayIds());
  }

  function armLineupSortClickSuppress(id) {
    if (lineupSortClickSuppress.timer !== null) {
      clearTimeout(lineupSortClickSuppress.timer);
    }
    lineupSortClickSuppress.id = id;
    lineupSortClickSuppress.timer = setTimeout(function () {
      lineupSortClickSuppress.id = "";
      lineupSortClickSuppress.timer = null;
    }, 0);
  }

  function consumeLineupSortClickSuppress(id) {
    if (lineupSortClickSuppress.id !== id) return false;
    if (lineupSortClickSuppress.timer !== null) {
      clearTimeout(lineupSortClickSuppress.timer);
      lineupSortClickSuppress.timer = null;
    }
    lineupSortClickSuppress.id = "";
    return true;
  }

  function clearLineupSortClickSuppress() {
    if (lineupSortClickSuppress.timer !== null) {
      clearTimeout(lineupSortClickSuppress.timer);
    }
    lineupSortClickSuppress.timer = null;
    lineupSortClickSuppress.id = "";
  }

  function lineupSortActivate(id, detail) {
    var sort = lineup.sort;
    if (!sort) return;
    if (detail !== 0 && consumeLineupSortClickSuppress(id)) return;
    if (lineup.loading || lineup.mutating) return;
    if (!sort.grabbed) {
      var item = lineupItemById(id);
      if (!item) return;
      sort.grabbed = item;
      if (sort.ids.indexOf(id) < 0) sort.ids.unshift(id);
      syncLineupSortRows();
      return;
    }
    if (sort.grabbed.id === id) {
      releaseLineupSort();
      return;
    }
    var ids = sort.ids.filter(function (entry) {
      return entry !== sort.grabbed.id;
    });
    var at = ids.indexOf(id);
    if (at < 0) return;
    ids.splice(at, 0, sort.grabbed.id);
    sort.ids = ids;
    sort.dirty = true;
    syncLineupSortRows();
    void commitLineupSort(ids);
  }

  function moveLineupSortGrabbed(delta) {
    var sort = lineup.sort;
    if (!sort || !sort.grabbed || lineup.loading || lineup.mutating) return;
    var ids = sort.ids.slice();
    var at = ids.indexOf(sort.grabbed.id);
    if (at < 0) return;
    var to = Math.max(0, Math.min(ids.length - 1, at + delta));
    if (at === to) return;
    ids.splice(at, 1);
    ids.splice(to, 0, sort.grabbed.id);
    sort.ids = ids;
    sort.dirty = lineupSortHeldOffPage()
      ? true
      : !lineupSortSameIds(ids, lineupSortCleanIds());
    syncLineupSortRows(to === 0 && lineup.pageIndex === 0);
  }

  function lineupSortDragHitTest(drag) {
    var sort = lineup.sort;
    if (!sort || sort !== drag.sort || !sort.grabbed || drag.auth !== auth) return;
    var rows = root.querySelectorAll("[data-lineup-sort]");
    var targetId = "";
    var after = false;
    for (var index = 0; index < rows.length; index += 1) {
      var wrapper = rows[index].closest("li") || rows[index];
      var box = wrapper.getBoundingClientRect();
      var translateY = lineupSortAnimations.has(wrapper) ? lineupSortTranslateY(wrapper) : 0;
      var top = box.top - translateY;
      var bottom = box.bottom - translateY;
      if (drag.clientY >= top && drag.clientY <= bottom) {
        targetId = rows[index].dataset.id;
        after = drag.clientY >= top + (bottom - top) / 2;
        break;
      }
    }
    if (!targetId || targetId === sort.grabbed.id) return;
    var ids = sort.ids.filter(function (entry) {
      return entry !== sort.grabbed.id;
    });
    var at = ids.indexOf(targetId);
    if (at < 0) return;
    ids.splice(after ? at + 1 : at, 0, sort.grabbed.id);
    sort.dirty = true;
    if (!lineupSortSameIds(ids, sort.ids)) {
      sort.ids = ids;
      syncLineupSortRows();
    }
  }

  function lineupSortDragStep(drag) {
    var step = 0;
    var viewportHeight = window.innerHeight || 0;
    var header = root.querySelector(".manage-top");
    var topEdge = (header ? header.getBoundingClientRect().bottom : 0) + 48;
    if (drag.clientY < topEdge) step = -16;
    else if (viewportHeight && drag.clientY > viewportHeight - 48) step = 16;
    if (step && typeof window.scrollBy === "function") {
      window.scrollBy({ top: step, behavior: "auto" });
    }
    lineupSortDragHitTest(drag);
  }

  function lineupSortDragFrame(drag) {
    drag.raf = 0;
    if (lineupSortDrag !== drag) return;
    var sort = lineup.sort;
    if (!sort || !sort.grabbed) return;
    lineupSortDragStep(drag);
    if (typeof requestAnimationFrame === "function") {
      drag.raf = requestAnimationFrame(function () {
        lineupSortDragFrame(drag);
      });
    }
  }

  function lineupSortListMarkup(l) {
    var sort = lineup.sort;
    if (!sort) return '<ul class="lineup-list lineup-sort-list"></ul>';
    var busy = lineup.loading || lineup.mutating;
    var rows = lineupSortDisplayIds()
      .map(function (id) {
        var item = lineupItemById(id);
        var name = item ? lineupAriaName(item) : id;
        var held = !!(sort.grabbed && sort.grabbed.id === id);
        return (
          '<li class="lineup-sort-item' +
          (held ? " grabbed" : "") +
          '"><button type="button" class="lineup-sort-row' +
          (held ? " grabbed" : "") +
          '"' +
          (busy ? " disabled" : "") +
          ' data-lineup-sort data-id="' +
          escape(id) +
          '" aria-pressed="' +
          String(held) +
          '" aria-label="' +
          escape(name + ", " + (held ? l.lineupRelease : l.lineupGrab)) +
          '"><span class="lineup-sort-label">' +
          (item ? lineupNameMarkup(item, l) : '<span dir="auto">' + escape(id) + "</span>") +
          '</span><span class="lineup-sort-handle" data-lineup-sort-handle aria-hidden="true">' +
          icon("sort", "lineup-sort-handle-icon") +
          "</span></button></li>"
        );
      })
      .join("");
    return '<ul class="lineup-list lineup-sort-list">' + rows + "</ul>";
  }

  function lineupNameMarkup(item, l) {
    var name = item.name || item.label || item.itemId || "";
    if (item.kind === "channel") {
      return (
        '<span class="lineup-channel-label"><span class="lineup-channel-number" dir="ltr" role="img" aria-label="' +
        escape((l ? l.lineupFieldNumber : "Channel number") + ", " + String(item.number)) +
        '">' +
        escape(String(item.number)) +
        '</span><strong class="lineup-channel-name" dir="auto">' +
        escape(name) +
        "</strong></span>"
      );
    }
    return '<span dir="auto">' + escape(name) + "</span>";
  }

  function lineupAriaName(item) {
    var name = item.name || item.label || item.itemId || "";
    return item.kind === "channel" ? String(item.number) + " " + name : name;
  }

  function lineupRowMenu(item, l, compact) {
    return (
      '<button type="button" class="lineup-row-menu management-row-actions' +
      (compact ? " lineup-compact-menu" : "") +
      '" data-item-menu="lineup" data-id="' +
      escape(item.id) +
      '" aria-label="' +
      escape(l.actions + ", " + lineupAriaName(item)) +
      '" aria-haspopup="menu" aria-expanded="' +
      String(!!(itemMenu && itemMenu.kind === "lineup" && itemMenu.id === item.id)) +
      '"><span class="lineup-row-more" aria-hidden="true">' +
      icon("more", "lineup-row-more-icon") +
      "</span></button>"
    );
  }

  function lineupRowMenuButton(id, name, l, inner, hidden) {
    return (
      '<button type="button" class="lineup-row-menu-button management-row-single' +
      (hidden ? " hidden" : "") +
      '" data-item-menu="lineup" data-id="' +
      escape(id) +
      '" aria-label="' +
      escape(l.actions + ", " + name) +
      '" aria-haspopup="menu" aria-expanded="' +
      String(!!(itemMenu && itemMenu.kind === "lineup" && itemMenu.id === id)) +
      '">' +
      inner +
      '<span class="lineup-row-more" aria-hidden="true">' +
      icon("more", "lineup-row-more-icon") +
      "</span></button>"
    );
  }

  function lineupRowOpen(item, l, inner) {
    var channel = item.kind === "channel";
    return (
      '<button type="button" class="lineup-row-open management-row-primary' +
      (channel ? " lineup-row-open-info" : "") +
      '" data-item-open="lineup" data-id="' + escape(item.id) + '"' +
      (channel ? ' data-lineup-provider-id="' + escape(item.id) + '" aria-haspopup="dialog"' : "") +
      ' aria-label="' + escape(l.open + ", " + lineupAriaName(item)) + '">' +
      inner + "</button>"
    );
  }

  function lineupRowOps(item, l) {
    var ops = "";
    if (item.kind === "category" || item.kind === "channel") {
      var editLabel =
        item.kind === "channel" ? l.lineupEditChannel : l.lineupEditCategory;
      ops +=
        '<button type="button" class="lineup-row-op lineup-edit" data-lineup-edit data-id="' +
        escape(item.id) +
        '" aria-label="' +
        escape(editLabel + ", " + lineupAriaName(item)) +
        '">' +
        icon("edit", "lineup-op-icon") +
        "</button>" +
        '<button type="button" class="lineup-row-op lineup-visibility" data-lineup-visibility data-id="' +
        escape(item.id) +
        '" role="switch" aria-checked="' +
        String(!item.hidden) +
        '" aria-label="' +
        escape(
          lineupAriaName(item) +
            ", " +
            (item.hidden ? l.lineupShow : l.lineupHide),
        ) +
        '">' +
        icon(item.hidden ? "hidden" : "visible", "lineup-op-icon") +
        "</button>" +
        lineupRowMenu(item, l, true);
    }
    return ops;
  }

  function lineupRow(item, l) {
    if (item.kind === "unavailable") {
      return (
        '<li class="lineup-row unavailable" data-lineup-id="' +
        escape(item.key) +
        '"><div class="lineup-row-open-info management-row-single" tabindex="0" data-settings-informational>' +
        '<span class="lineup-row-main"><strong dir="auto">' +
        escape(item.label) +
        '</strong><span class="management-row-meta">' +
        escape(l.lineupUnavailableItem) +
        "</span></span></div>" +
        '<button type="button" class="lineup-row-op lineup-remove" data-lineup-remove data-id="' +
        escape(item.key) +
        '" aria-label="' +
        escape(
          l.lineupRemoveUnavailable +
            ", " +
            (item.label || item.itemId || ""),
        ) +
        '">' +
        icon("remove", "lineup-op-icon") +
        "</button></li>"
      );
    }
    var hiddenTag = item.hidden
      ? '<span class="lineup-hidden-tag">' + escape(l.lineupHidden) + "</span>"
      : "";
    if (item.kind === "category" || item.kind === "personal-category") {
      var count = typeof item.count === "number"
        ? '<span class="lineup-category-count">' + escape(String(item.count)) + "</span>"
        : "";
      var provider =
        item.providerName && item.providerName !== item.name
          ? '<span class="management-row-meta" dir="auto">' + escape(item.providerName) + "</span>"
          : "";
      var inner =
        '<span class="lineup-row-main"><span class="lineup-category-label"><strong dir="auto">' +
        escape(item.name) + "</strong>" + count + "</span>" +
        provider + "</span>" + hiddenTag;
      var categoryOps =
        item.kind === "category" ? lineupRowOps(item, l) : lineupRowMenu(item, l);
      return (
        '<li class="lineup-row lineup-row-category' +
        (item.hidden ? " hidden" : "") +
        '" data-lineup-id="' +
        escape(item.id) +
        '">' +
        lineupRowOpen(item, l, inner) +
        categoryOps +
        "</li>"
      );
    }
    if (item.kind === "channel") {
      var channelProvider =
        item.providerName && item.providerName !== item.name ? item.providerName : "";
      var channelInner =
        '<span class="lineup-row-main">' +
        lineupNameMarkup(item, l) +
        (channelProvider
          ? '<span class="management-row-meta" dir="auto">' + escape(channelProvider) + "</span>"
          : "") +
        "</span>" +
        hiddenTag;
      if (lineup.membershipCategory) {
        return (
          '<li class="lineup-row lineup-row-channel' +
          (item.hidden ? " hidden" : "") +
          '" data-lineup-id="' +
          escape(item.id) +
          '">' +
          lineupRowMenuButton(
            item.id,
            lineupAriaName(item),
            l,
            channelInner,
            item.hidden,
          ) +
          lineupRowOps(item, l) +
          "</li>"
        );
      }
      return (
        '<li class="lineup-row lineup-row-channel' +
        (item.hidden ? " hidden" : "") +
        '" data-lineup-id="' + escape(item.id) + '">' +
        lineupRowOpen(item, l, channelInner) +
        lineupRowOps(item, l) +
        "</li>"
      );
    }
    var itemInner =
      '<span class="lineup-row-main"><strong dir="auto">' +
      escape(item.name) +
      "</strong></span>";
    return (
      '<li class="lineup-row lineup-row-item" data-lineup-id="' + escape(item.id) + '">' +
      lineupRowOpen(item, l, itemInner) +
      "</li>"
    );
  }

  function lineupEditorMarkup(l) {
    var editor = lineup.editor;
    if (!editor) return "";
    var saving = !!editor.saving;
    var disabled = saving ? " disabled" : "";
    var title = editor.kind === "channel" ? l.lineupEditChannel : l.lineupEditCategory;
    var fields;
    if (editor.kind === "channel") {
      fields =
        '<div class="lineup-editor-fields lineup-editor-split">' +
        '<label>' + escape(l.lineupFieldNumber) +
        '<input name="editorNumber" type="text" inputmode="numeric" dir="ltr" value="' + escape(editor.number) +
        '"' + disabled +
        (editor.providerNumber != null
          ? ' placeholder="#' + escape(String(editor.providerNumber)) + '"'
          : "") +
        "></label>" +
        '<label class="lineup-editor-name">' + escape(l.lineupFieldName) +
        '<input name="editorName" dir="auto" value="' + escape(editor.name) + '"' +
        (editor.providerName ? ' placeholder="' + escape(editor.providerName) + '"' : "") +
        disabled + "></label>" +
        "</div>";
    } else {
      fields =
        '<div class="lineup-editor-fields">' +
        '<label class="lineup-editor-wide">' + escape(l.lineupRename) +
        '<input name="editorValue" dir="auto" value="' + escape(editor.value) + '"' +
        (editor.providerName ? ' placeholder="' + escape(editor.providerName) + '"' : "") +
        disabled + "></label>" +
        "</div>";
    }
    var providerRef = "";
    var restoreButton = "";
    if (editor.kind === "channel" || editor.kind === "category") {
      var hasProviderName = !!editor.providerName;
      var hasProviderNumber =
        editor.kind === "channel" && editor.providerNumber != null;
      if (hasProviderName || hasProviderNumber) {
        providerRef =
          '<div class="lineup-provider-ref" data-lineup-provider-ref role="note">' +
          '<span class="lineup-provider-values" id="lineup-provider-values" data-lineup-provider-values>' +
          (hasProviderNumber
            ? '<em class="lineup-provider-number" dir="ltr">' +
              escape(String(editor.providerNumber)) +
              "</em>"
            : "") +
          (hasProviderName
            ? '<strong dir="auto">' + escape(editor.providerName) + "</strong>"
            : "") +
          "</span></div>";
        restoreButton =
          '<button type="button" class="lineup-restore" data-lineup-action="restore-draft" aria-label="' +
          escape(l.resetToDefault) +
          '" title="' +
          escape(l.resetToDefault) +
          '" aria-describedby="lineup-provider-values"' +
          disabled +
          ">" +
          icon("refresh", "lineup-op-icon") +
          '<span class="lineup-restore-label">' +
          escape(l.resetToDefault) +
          "</span>" +
          "</button>";
      }
    }
    var body =
      providerRef +
      fields +
      (editor.error
        ? '<p class="lineup-state notice" role="alert">' + escape(editor.error) + "</p>"
        : "") +
      (editor.kind === "personal-category"
        ? '<button type="button" class="quiet danger" data-lineup-action="delete-category" data-id="' +
          escape(editor.id) +
          '">' +
          escape(l.lineupDeleteCategory) +
          "</button>"
        : "");
    return (
      '<div class="lineup-editor-overlay"><button type="button" class="lineup-editor-backdrop" data-lineup-action="cancel-editor" tabindex="-1" aria-label="' +
      escape(l.close) +
      '"' +
      (saving ? " disabled" : "") +
      "></button><section class=\"lineup-editor-dialog\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"lineup-editor-title\" tabindex=\"-1\">" +
      '<div class="modal-head"><h3 id="lineup-editor-title" dir="auto">' + escape(title) + "</h3></div>" +
      '<form class="lineup-editor lineup-editor-' +
      (editor.kind === "channel" ? "channel" : "text") +
      '" data-lineup-editor data-editor="' +
      (editor.kind === "channel" ? "channel" : "text") +
      '"><div class="lineup-editor-body">' +
      body +
      '</div><div class="form-actions lineup-editor-footer' +
      (restoreButton ? " has-restore" : "") +
      '">' +
      restoreButton +
      '<div class="lineup-editor-actions">' +
      '<button type="button" class="quiet" data-lineup-action="cancel-editor"' +
      disabled +
      ">" +
      icon("close") +
      escape(l.cancel) +
      '</button><button type="submit"' +
      disabled +
      (saving ? ' aria-busy="true" aria-label="' + escape(l.saving) + '"' : "") +
      ">" +
      (saving ? '<span class="form-spinner" aria-hidden="true"></span>' : icon("check")) +
      escape(l.save) +
      "</button></div></div></form></section></div>"
    );
  }

  function listHeadMarkup(title, count, actions, headingLevel) {
    var headingTag = headingLevel === 3 ? "h3" : "h2";
    var countMarkup =
      count === undefined || count === null
        ? ""
        : '<span class="list-count">' + escape(String(count)) + "</span>";
    return (
      '<div class="list-head"><div class="list-title"><' +
      headingTag +
      ">" +
      escape(title) +
      "</" +
      headingTag +
      ">" +
      countMarkup +
      "</div>" +
      (actions ? '<div class="list-actions">' + actions + "</div>" : "") +
      "</div>"
    );
  }

  function lineupActivityHeadMarkup(actions) {
    if (!actions) return "";
    return (
      '<div class="list-head lineup-activity-head"><div class="list-actions">' +
      actions +
      "</div></div>"
    );
  }

  function lineupPreferenceScope() {
    if (lineup.scope === "categories") {
      return {
        orderLabel: "lineupCategoryOrder",
        orderTitle: "lineupCategoryOrder",
        orderOptions: [
          ["provider", "orderProvider"],
          ["alphabetical", "orderAlphabetical"],
          ["custom", "orderCustom"],
        ],
        settingsTitle: "lineupPlaylistSettings",
      };
    }
    if (lineup.scope === "channels" && lineup.categoryKey) {
      return {
        orderLabel: "lineupChannelOrder",
        orderTitle: "lineupChannelOrder",
        orderOptions: [
          ["provider", "orderProvider"],
          ["alphabetical", "orderAlphabetical"],
          ["number", "orderNumber"],
          ["custom", "orderCustom"],
        ],
        settingsTitle: "lineupCategorySettings",
      };
    }
    if (lineup.scope === "items" && lineup.categoryKey) {
      var orderLabel =
        lineup.categoryKind === "movie"
          ? "lineupMovieOrder"
          : lineup.categoryKind === "series"
            ? "lineupSeriesOrder"
            : "lineupChannelOrder";
      return {
        orderLabel: orderLabel,
        orderTitle: orderLabel,
        orderOptions: [
          ["provider", "orderProvider"],
          ["alphabetical", "orderAlphabetical"],
          ["custom", "orderCustom"],
        ],
        settingsTitle: "lineupCategorySettings",
      };
    }
    return null;
  }


  function lineupPreferenceButton(kind, iconName, label, value, disabled, l) {
    return (
      '<button type="button" class="lineup-preference" data-lineup-preference="' +
      kind +
      '"' +
      (disabled ? " disabled" : "") +
      '><span class="lineup-preference-leading" aria-hidden="true">' +
      icon(iconName, "lineup-preference-leading-icon") +
      '</span><span class="lineup-preference-main"><span class="lineup-preference-label">' +
      escape(label) +
      "</span>" +
      (value
        ? '<span class="lineup-preference-value">' + escape(value) + "</span>"
        : "") +
      '</span><span class="lineup-preference-icon" aria-hidden="true">' +
      icon("right", "lineup-preference-icon-svg") +
      "</span></button>"
    );
  }

  function lineupPreferencesMarkup(l) {
    var scope = lineupPreferenceScope();
    if (!scope) return "";
    var busy = lineupPageBusy();
    var orderValue = "";
    for (var optionIndex = 0; optionIndex < scope.orderOptions.length; optionIndex += 1) {
      if (scope.orderOptions[optionIndex][0] === lineup.orderMode) {
        orderValue = l[scope.orderOptions[optionIndex][1]];
      }
    }
    var orderRows =
      '<div class="lineup-order-attach">' +
      lineupPreferenceButton(
        "order",
        "sort",
        l[scope.orderLabel],
        orderValue,
        busy,
        l,
      );
    if (lineup.orderMode === "custom" && lineupReorderable()) {
      orderRows +=
        '<span class="lineup-order-divider" aria-hidden="true"></span>' +
        '<button type="button" class="lineup-custom-order" data-lineup-preference="custom-order"' +
        (busy ? " disabled" : "") +
        '><span class="lineup-preference-leading" aria-hidden="true">' +
        icon("edit", "lineup-preference-leading-icon") +
        "</span><span>" +
        escape(l.lineupEditCustomOrder) +
        "</span></button>";
    }
    orderRows += "</div>";
    return (
      '<div class="lineup-order-settings" data-lineup-preferences role="group" aria-label="' +
      escape(l[scope.settingsTitle]) +
      '">' +
      orderRows +
      "</div>"
    );
  }

  function lineupOrderDialogSignature() {
    return contentPlaylistId + "|" + currentLineupSignature();
  }

  function lineupOrderDialogMarkup(l) {
    var dialog = lineup.orderDialog;
    if (!dialog) return "";
    var scope = lineupPreferenceScope();
    if (!scope) return "";
    var orderBusy = lineup.mutating || lineup.loading || busy || commandInFlight;
    var context =
      lineup.scope === "categories"
        ? contentKindLabel(lineup.contentKind, l)
        : lineup.categoryName || contentKindLabel(lineup.categoryKind, l);
    var playlist = playlistById(contentPlaylistId);
    var options = scope.orderOptions
      .map(function (option) {
        var selected = lineup.orderMode === option[0];
        return (
          '<button type="button" role="option" aria-selected="' +
          String(selected) +
          '" class="lineup-order-option lineup-preference" data-lineup-order-option="' +
          option[0] +
          '"' +
          (orderBusy ? " disabled" : "") +
          ">" +
          '<span class="lineup-preference-main"><span class="lineup-preference-label">' +
          escape(l[option[1]]) +
          "</span></span>" +
          (selected
            ? '<span class="lineup-order-check" aria-hidden="true">' +
              icon("check", "lineup-order-check-icon") +
              "</span>"
            : "") +
          "</button>"
        );
      })
      .join("");
    return (
      '<div class="lineup-editor-overlay"><button type="button" class="lineup-editor-backdrop" data-lineup-order-dismiss tabindex="-1" aria-label="' +
      escape(l.close) +
      '"' +
      (orderBusy ? " disabled" : "") +
      '></button><section class="lineup-editor-dialog lineup-order-dialog" role="dialog" aria-modal="true" aria-labelledby="lineup-order-title" tabindex="-1" data-lineup-order-dialog>' +
      '<div class="modal-head"><h3 id="lineup-order-title" dir="auto">' +
      escape(l[scope.orderTitle]) +
      "</h3></div>" +
      '<p class="muted lineup-order-context" dir="auto">' +
      escape((playlist ? playlist.name + " · " : "") + context) +
      "</p>" +
      '<div class="lineup-order-options" role="listbox" aria-label="' +
      escape(l[scope.orderTitle]) +
      '">' +
      options +
      "</div>" +
      '<div class="form-actions lineup-editor-footer lineup-order-foot">' +
      '<button type="button" class="lineup-reset-action tonal" data-lineup-order-reset' +
      (orderBusy ? " disabled" : "") +
      ">" +
      icon("refresh", "lineup-op-icon") +
      escape(l.resetToDefault) +
      '</button><button type="button" class="quiet" data-lineup-order-dismiss' +
      (orderBusy ? " disabled" : "") +
      ">" +
      icon("close") +
      escape(l.close) +
      "</button></div></section></div>"
    );
  }

  function lineupKinds() {
    var playlist =
      contentPlaylistId && current && current.playlists
        ? current.playlists.find(function (entry) {
            return entry.id === contentPlaylistId;
          })
        : null;
    if (!playlist) return [];
    if (playlist.source.kind === "m3u") return ["live"];
    var counts = lineup.sectionCounts;
    if (!counts) return [];
    var kinds = [];
    ["live", "movie", "series"].forEach(function (kind) {
      if (counts[kind] > 0) kinds.push(kind);
    });
    return kinds;
  }

  function lineupVisibilitySupported() {
    return lineup.scope === "categories" || lineup.scope === "channels";
  }

  function lineupPageBusy() {
    return (
      lineup.loading ||
      lineup.mutating ||
      busy ||
      commandInFlight ||
      !lineup.loaded
    );
  }

  function lineupRowMenuActions(item, l) {
    if (item.kind === "personal-category") {
      return [
        { id: "edit", label: l.lineupEditCategory },
        { id: "add-members", label: l.lineupAddChannels },
      ];
    }
    if (item.kind === "channel") {
      var membershipId = lineup.membershipCategory || "";
      if (lineup.scope === "channels" && membershipId) {
        var member = (item.personalCategoryIds || []).indexOf(membershipId) >= 0;
        return [
          {
            id: "membership",
            label: member ? l.lineupRemoveMembership : l.lineupAddMembership,
          },
        ];
      }
    }
    if (item.kind === "category" || item.kind === "channel") {
      return [
        {
          id: "edit",
          label: item.kind === "channel" ? l.lineupEditChannel : l.lineupEditCategory,
        },
        {
          id: "visibility",
          label: item.hidden ? l.lineupShow : l.lineupHide,
          icon: item.hidden ? "visible" : "hidden",
        },
      ];
    }
    return [];
  }

  function buildItemMenu(kind, id, l) {
    if (kind === "playlist") {
      var playlist = playlistById(id);
      if (!playlist) return null;
      var menuBlocked = busy || commandInFlight;
      return {
        kind: kind,
        id: id,
        page: manageView.page,
        title: playlist.name,
        actions: [
          {
            id: "activate",
            label: l.activate,
            disabled:
              menuBlocked ||
              playlistRowProgress(playlist) ||
              !!(current && current.activePlaylistId === playlist.id),
          },
          {
            id: "refresh",
            label: l.refresh,
            disabled: menuBlocked || playlistRowProgress(playlist),
          },
          {
            id: "edit",
            label:
              playlist.source.kind === "xtream" ? l.editCredentials : l.editAddress,
            disabled: menuBlocked,
          },
          { id: "reset", label: l.resetToDefault, danger: true, disabled: menuBlocked },
          { id: "remove", label: l.remove, danger: true, disabled: menuBlocked },
        ],
      };
    }
    if (kind === "lineup") {
      if (!contentViewActive()) return null;
      var item = lineupRowItem(id);
      if (!item) return null;
      var rowActions = lineupRowMenuActions(item, l);
      if (!rowActions.length) return null;
      return {
        kind: kind,
        id: id,
        page: manageView.page,
        title: item.name || item.label || "",
        actions: rowActions,
      };
    }
    return null;
  }

  var itemMenuActionIcons = {
    activate: "check",
    refresh: "refresh",
    edit: "edit",
    reset: "clear",
    remove: "remove",
    "add-members": "plus",
    membership: "check",
  };

  function itemMenuMarkup(l) {
    if (!itemMenu) return "";
    var actions = itemMenu.actions
      .map(function (action) {
        var actionIcon = action.icon || itemMenuActionIcons[action.id];
        return (
          '<button type="button" role="menuitem" class="item-menu-action' +
          (action.danger ? " danger" : "") +
          '"' +
          (action.disabled ? ' aria-disabled="true" disabled' : "") +
          ' data-item-action="' +
          escape(action.id) +
          '">' +
          (actionIcon ? icon(actionIcon, "item-menu-action-icon") : "") +
          "<span>" +
          escape(action.label) +
          "</span></button>"
        );
      })
      .join("");
    return (
      '<div class="item-menu-overlay"><div class="item-menu-backdrop" data-item-menu-close></div>' +
      '<div class="item-menu-dialog" data-item-action-dialog role="dialog" aria-modal="true" aria-label="' +
      escape(itemMenu.title) +
      '"><div class="modal-head item-menu-head"><h2 class="item-menu-title">' +
      '<span dir="auto">' +
      escape(itemMenu.title) +
      "</span></h2></div>" +
      '<div class="item-menu-list" role="menu">' +
      actions +
      "</div>" +
      '<div class="form-actions item-menu-foot"><button type="button" class="quiet" data-item-menu-close>' +
      icon("close") +
      escape(l.close) +
      "</button></div></div></div>"
    );
  }

  function itemMenuContext(kind) {
    var context =
      manageView.page + "|" + manageView.sub + "|" + manageView.subId;
    if (kind === "lineup") {
      context +=
        "|" +
        contentPlaylistId +
        "|" +
        lineup.playlistId +
        "|" +
        lineup.scope +
        "|" +
        (lineup.categoryKey || "") +
        "|" +
        (lineup.membershipCategory || "") +
        "|" +
        (lineup.contentKind || "");
    }
    return context;
  }

  function sanitizeItemMenu() {
    if (!itemMenu) return;
    var context = itemMenuContext(itemMenu.kind);
    var fresh = itemMenu.context === context ? buildItemMenu(itemMenu.kind, itemMenu.id, labels()) : null;
    if (!fresh) {
      itemMenu = null;
      itemMenuReturn = null;
      itemMenuSource = null;
      return;
    }
    fresh.context = context;
    itemMenu = fresh;
  }

  function focusItemMenu() {
    var dialog = root.querySelector("[data-item-action-dialog]");
    if (!dialog) return;
    var actions = dialog.querySelectorAll("[role=menuitem]:not(:disabled)");
    for (var index = 0; index < actions.length; index += 1) {
      actions[index].focus();
      return;
    }
    var close = dialog.querySelector("[data-item-menu-close]");
    if (close) close.focus();
  }

  function openItemMenu(kind, id, source) {
    var menu = buildItemMenu(kind, id, labels());
    if (!menu) return;
    menu.context = itemMenuContext(kind);
    itemMenu = menu;
    itemMenuReturn = focusDescriptor(source);
    itemMenuSource = source;
    renderManage();
    focusItemMenu();
  }

  function closeItemMenu(restore) {
    if (!itemMenu) return;
    var ret = itemMenuReturn;
    itemMenu = null;
    itemMenuReturn = null;
    itemMenuSource = null;
    renderManage();
    if (restore !== false) restoreLineupFocus(ret);
  }

  function dispatchItemMenuAction(kind, id, actionId, source, returnFocus) {
    var l = labels();
    if (kind === "playlist") {
      var playlist = playlistById(id);
      if (!playlist) return;
      var trigger = findFocusControl(returnFocus) || source;
      if (actionId === "activate") {
        if (playlist.id !== current.activePlaylistId) {
          void sendPlaylistRowCommand(
            { type: "playlist.activate", id: playlist.id },
            trigger,
          );
        }
      } else if (actionId === "refresh") {
        void sendPlaylistRowCommand(
          { type: "playlist.refresh", id: playlist.id },
          trigger,
        );
      } else if (actionId === "edit") {
        openEditPlaylist(id, source);
      } else if (actionId === "reset") {
        var capturedSourceVersion = playlistRowSourceVersion(playlist);
        openManagementConfirmation({
          title: playlist.name,
          body:
            l.resetQuestion.replace("{name}", playlist.name) +
            "\n\n" +
            l.resetBody,
          confirmLabel: l.resetToDefault,
          danger: true,
          returnFocus: returnFocus,
          isCurrent: function () {
            var currentPlaylist = playlistById(id);
            return !!(
              currentPlaylist &&
              playlistRowSourceVersion(currentPlaylist) === capturedSourceVersion
            );
          },
          run: function () {
            return resetPlaylistConfirmed({
              playlistId: id,
              sourceVersion: capturedSourceVersion,
              auth: auth,
            });
          },
        });
      } else if (actionId === "remove") {
        var capturedRemoveSourceVersion = playlistRowSourceVersion(playlist);
        openManagementConfirmation({
          title: playlist.name,
          body:
            l.playlistRemoveQuestion.replace("{name}", playlist.name) +
            "\n\n" +
            l.removeConfirm,
          confirmLabel: l.remove,
          danger: true,
          returnFocus: returnFocus,
          isCurrent: function () {
            var currentPlaylist = playlistById(id);
            return !!(
              currentPlaylist &&
              playlistRowSourceVersion(currentPlaylist) ===
                capturedRemoveSourceVersion
            );
          },
          run: function () {
            return sendConfirmedCommand({ type: "playlist.remove", id: id });
          },
        });
      }
      return;
    }
    if (kind === "lineup") {
      runLineupRowAction(actionId, id, source);
      return;
    }
  }

  function runItemMenuAction(actionId) {
    var menu = itemMenu;
    if (!menu) return;
    var action = null;
    for (var index = 0; index < menu.actions.length; index += 1) {
      if (menu.actions[index].id === actionId) {
        action = menu.actions[index];
        break;
      }
    }
    if (!action || action.disabled) return;
    var source = itemMenuSource;
    var ret = itemMenuReturn;
    itemMenu = null;
    itemMenuReturn = null;
    itemMenuSource = null;
    renderManage();
    restoreLineupFocus(ret);
    dispatchItemMenuAction(menu.kind, menu.id, actionId, source, ret);
  }

  function bindItemMenu() {
    root.querySelectorAll("button[data-item-menu]").forEach(function (trigger) {
      trigger.addEventListener("click", function () {
        openItemMenu(trigger.dataset.itemMenu, trigger.dataset.id || "", trigger);
      });
    });
    root.querySelectorAll("button[data-item-open]").forEach(function (trigger) {
      trigger.addEventListener("click", function () {
        if (managementWriteBlocked()) return;
        var kind = trigger.dataset.itemOpen;
        var id = trigger.dataset.id || "";
        if (kind === "playlist") {
          var target = playlistById(id);
          if (target && playlistCardState(target).disabled) return;
          openPlaylistContent(id, trigger);
          saveManagementRoute(false);
        } else if (kind === "lineup") {
          runLineupRowAction("open", id, trigger);
        }
      });
    });
    var dialog = root.querySelector("[data-item-action-dialog]");
    if (!dialog) return;
    var overlay = dialog.closest(".item-menu-overlay") || dialog;
    overlay.querySelectorAll("[data-item-menu-close]").forEach(function (control) {
      control.addEventListener("click", function () {
        closeItemMenu();
      });
    });
    dialog.querySelectorAll("[data-item-action]").forEach(function (button) {
      button.addEventListener("click", function () {
        runItemMenuAction(button.dataset.itemAction);
      });
    });
    dialog.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeItemMenu();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      var items = Array.from(
        dialog.querySelectorAll("[role=menuitem]:not(:disabled)"),
      );
      if (!items.length) return;
      var at = items.indexOf(document.activeElement);
      var next =
        event.key === "ArrowDown"
          ? items[(at + 1 + items.length) % items.length]
          : items[(at - 1 + items.length) % items.length];
      next.focus();
    });
  }

  function renderLineup() {
    var l = labels();
    var drilled = lineupDrilled();
    var personalScope = lineup.scope === "personal-categories";
    if (lineup.reorder && !lineup.sort) rebuildLineupSort(false);
    var sorting = !!(lineup.reorder && lineup.sort);
    var kinds = lineupKinds();
    var showContentTabs = !drilled && !personalScope && !sorting && kinds.length > 1;
    var customTab =
      !drilled && !personalScope && !sorting && customCategoriesEnabled()
        ? '<button type="button" class="lineup-tab-custom" data-lineup-scope="personal-categories" aria-pressed="' +
          String(personalScope) +
          '">' +
          escape(l.lineupPersonalCategories) +
          "</button>"
        : "";
    var tabStopKind =
      lineup.scope === "categories" && kinds.indexOf(lineup.contentKind) >= 0
        ? lineup.contentKind
        : kinds[0];
    var kindButtons = showContentTabs
      ? kinds
          .map(function (kind) {
            var selected =
              lineup.scope === "categories" && lineup.contentKind === kind;
            return (
              '<button type="button" role="tab" id="lineup-tab-' +
              kind +
              '" data-lineup-kind="' +
              kind +
              '" aria-controls="lineup-tab-panel" aria-selected="' +
              String(selected) +
              '" tabindex="' +
              (kind === tabStopKind ? "0" : "-1") +
              '"><span class="lineup-tab-text">' +
              icon(
                kind === "movie" ? "movie" : kind === "series" ? "series" : "live",
                "lineup-tab-icon",
              ) +
              '<span class="lineup-tab-label">' +
              escape(
                kind === "movie"
                  ? l.lineupMovies
                  : kind === "series"
                    ? l.lineupSeries
                    : l.lineupLive,
              ) +
              "</span></span></button>"
            );
          })
          .join("")
      : "";
    var header =
      (kindButtons
        ? '<div class="lineup-tabs" role="tablist" aria-orientation="vertical" aria-label="' +
          escape(l.lineup) +
          '">' +
          kindButtons +
          '<span class="lineup-tab-ink" data-lineup-tab-ink="' +
          escape(contentPlaylistId) +
          '" aria-hidden="true"></span>' +
          "</div>"
        : "") +
      (customTab ? '<div class="lineup-tabs-custom">' + customTab + "</div>" : "");
    var resultsNoun =
      lineup.scope === "items"
        ? contentKindLabel(lineup.categoryKind, l)
        : lineup.scope === "channels"
          ? l.lineupChannels
          : l.lineupCategories;
    var loadingPlaylist = playlistById(contentPlaylistId);
    var pagingBlocked = lineup.loading || lineup.mutating || busy || commandInFlight;
    var pagination =
      lineup.pageIndex > 0 || lineup.nextCursor
        ? '<div class="lineup-pagination"><button type="button" data-lineup-page="prev"' +
          (lineup.pageIndex <= 0 || pagingBlocked ? " disabled" : "") +
          ">" +
          escape(l.lineupPrevious) +
          '</button><span class="lineup-page-label">' +
          escape(
            l.lineupPage
              .replace("{current}", String(lineup.pageIndex + 1))
              .replace("{total}", String(lineupPageCount(lineup.total))),
          ) +
          "</span>" +
          '<button type="button" data-lineup-page="next"' +
          (lineup.nextCursor && !pagingBlocked ? "" : " disabled") +
          ">" +
          escape(l.lineupNext) +
          "</button></div>"
        : "";
    var listHead;
    var listBody;
    var searchLabel =
      lineup.scope === "categories" || personalScope
        ? l.lineupSearchCategories
        : lineup.scope === "channels"
          ? l.lineupSearchChannels
          : l.lineupSearchTitles;
    var searchToggle =
      '<button type="button" class="lineup-icon-action' +
      (lineup.query ? " active" : "") +
      '" data-lineup-search-toggle aria-expanded="' +
      String(lineup.searchOpen) +
      '" aria-label="' +
      escape(searchLabel) +
      '">' +
      icon("search", "lineup-icon") +
      '<span class="lineup-toolbar-label">' +
      escape(l.lineupSearchToggle) +
      "</span></button>";
    var searchField = lineup.searchOpen
      ? '<label class="lineup-search"><span class="visually-hidden">' +
        escape(searchLabel) +
        "</span>" +
        icon("search", "lineup-search-icon") +
        '<input data-lineup-search type="search" dir="auto" placeholder="' +
        escape(searchLabel) +
        '" aria-label="' +
        escape(searchLabel) +
        '" value="' +
        escape(lineup.query) +
        '"></label>'
      : "";
    var bulkBusy = lineupPageBusy();
    var bulkActions =
      lineup.loaded &&
      lineupVisibilitySupported() &&
      !personalScope &&
      (lineup.scope !== "channels" || !!lineup.categoryKey)
        ? '<button type="button" class="lineup-icon-action lineup-bulk-action" data-lineup-bulk="show"' +
          ' aria-label="' +
          escape(l.lineupShowAll) +
          '" title="' +
          escape(l.lineupShowAll) +
          '"' +
          (bulkBusy ? " disabled" : "") +
          ">" +
          icon("visible", "lineup-icon lineup-bulk-icon") +
          '<span class="lineup-toolbar-label">' +
          escape(l.lineupShowAll) +
          '</span></button><button type="button" class="lineup-icon-action lineup-bulk-action" data-lineup-bulk="hide" aria-label="' +
          escape(l.lineupHideAll) +
          '" title="' +
          escape(l.lineupHideAll) +
          '"' +
          (bulkBusy ? " disabled" : "") +
          ">" +
          icon("hidden", "lineup-icon lineup-bulk-icon") +
          '<span class="lineup-toolbar-label">' +
          escape(l.lineupHideAll) +
          "</span></button>"
        : "";
    if (sorting) {
      var sortBusy = lineup.loading || lineup.mutating;
      listHead = lineupActivityHeadMarkup("");
      listBody =
        '<p class="lineup-reorder-help">' +
        escape(l.lineupReorderHelp) +
        "</p>" +
        lineupSortListMarkup(l) +
        '<div class="form-actions lineup-editor-footer lineup-order-foot lineup-sort-foot">' +
        '<button type="button" class="lineup-reset-action tonal" data-lineup-sort-reset' +
        (sortBusy ? " disabled" : "") +
        ">" +
        icon("refresh", "lineup-op-icon") +
        escape(l.resetToDefault) +
        '</button><button type="button" class="quiet" data-lineup-sort-done>' +
        icon("close") +
        escape(l.close) +
        "</button></div>";
    } else {
      listHead = listHeadMarkup(resultsNoun, lineup.loaded ? lineup.total : undefined, searchToggle + bulkActions, 3);
      var create =
        lineup.loaded && personalScope && customCategoriesEnabled()
          ? '<form class="lineup-editor lineup-create" data-create-category><label>' +
            escape(l.lineupCreateCategory) +
            '<input name="personalCategoryName" dir="auto" required value="' +
            escape(lineup.createDraft || "") +
            '"></label><button type="submit">' +
            escape(l.lineupCreateCategory) +
            "</button></form>"
          : "";
      var rows = lineup.items
        .map(function (item) { return lineupRow(item, l); })
        .join("");
      listBody =
        create +
        '<ul class="lineup-list lineup-list-rows">' +
        rows +
        "</ul>";
    }
    if (lineup.loading) {
      var loadingName = loadingPlaylist && loadingPlaylist.name
        ? loadingPlaylist.name + " · " + l.lineupLoading
        : l.lineupLoading;
      listBody =
        '<span class="form-spinner lineup-loading-mark" aria-hidden="true"></span>' +
        '<span class="lineup-loading-name">' +
        escape(loadingName) +
        "</span>";
    } else if (lineup.error && !lineup.loaded) {
      listBody = '<div class="lineup-state-error" role="alert"><p>' +
        escape(lineup.error) + '</p><button type="button" class="quiet lineup-retry" data-lineup-retry>' +
        escape(l.retry) + '</button></div>';
    } else if (!lineup.loaded) {
      listBody = "";
    } else if (!lineup.items.length) {
      listBody =
        (!sorting ? create : "") +
        '<p class="lineup-state">' +
        escape(lineup.query ? l.lineupNoMatches : l.lineupEmpty) +
        '</p>';
    }
    var preferences = sorting || !lineup.loaded ? "" : lineupPreferencesMarkup(l);
    var controlsInner = preferences;
    var controls = controlsInner
      ? '<div class="lineup-controls">' + controlsInner + "</div>"
      : "";
    var numberWidth = 2;
    for (var itemIndex = 0; itemIndex < lineup.items.length; itemIndex += 1) {
      var numbered = lineup.items[itemIndex];
      if (numbered && numbered.kind === "channel") {
        var digits = String(numbered.number).length;
        if (digits > numberWidth) numberWidth = digits;
      }
    }
    return (
      '<div id="lineup" class="lineup-layout' +
      (showContentTabs ? " lineup-layout-tabbed" : "") +
      '" data-lineup-mode="' +
      (sorting ? "reorder" : "browse") +
      '" aria-busy="' + String(lineup.loading || lineup.mutating) + '"' +
      ' style="--lineup-number-width: ' + numberWidth + 'ch">' +
      header +
      '<div class="lineup-content' +
      (showContentTabs ? " lineup-tab-content" : "") +
      '"' +
      (showContentTabs
        ? ' id="lineup-tab-panel" role="tabpanel" aria-labelledby="lineup-tab-' +
          escape(lineup.contentKind) +
          '"'
        : "") +
      ">" +
      controls +
      '<div class="lineup-results">' +
      listHead +
      searchField +
      '<div class="lineup-results-body' +
      (lineup.loading ? " is-loading" : "") +
      (lineup.reorder && lineup.sort ? " is-reordering" : "") +
      '"' +
      (lineup.loading ? ' role="status" aria-live="polite" aria-label="' + escape(loadingName) + '"' : "") +
      (lineup.loading && lineupResultsHeight ? ' style="min-height:' + lineupResultsHeight + 'px"' : "") +
      '>' +
      listBody +
      "</div>" +
      pagination +
      "</div>" +
      "</div>" +
      lineupEditorMarkup(l) +
      lineupOrderDialogMarkup(l) +
      "</div>"
    );
  }

  function lineupEditorOrigin(item) {
    var rowId = item.id || item.key || "";
    var rowIndex = -1;
    for (var index = 0; index < lineup.items.length; index += 1) {
      var entry = lineup.items[index];
      if ((entry.id || entry.key || "") === rowId) {
        rowIndex = index;
        break;
      }
    }
    return {
      signature: lineupBrowseSignature(),
      pageIndex: lineup.pageIndex,
      rowIndex: rowIndex,
      query: lineup.query,
      searchOpen: lineup.searchOpen,
      scrollY:
        typeof window !== "undefined"
          ? window.scrollY || window.pageYOffset || 0
          : 0,
      rowId: rowId,
    };
  }

  function openLineupEditor(item, source) {
    if (lineupPageBusy()) return;
    var origin = lineupEditorOrigin(item);
    var pendingSearch = lineupSearchTimer !== null;
    clearLineupTimers();
    if (pendingSearch) {
      resetLineupPage();
      void loadLineupPage("reset");
    }
    if (item.kind === "channel") {
      lineup.editor = {
        kind: "channel",
        id: item.id,
        name: item.name,
        number: String(item.number),
        providerName: item.providerName || "",
        providerNumber: item.providerNumber ?? null,
        effectiveName: item.name,
        effectiveNumber: item.number,
        restore: { name: false, number: false },
        saving: false,
        error: "",
        returnFocus: focusDescriptor(source),
        origin: origin,
      };
    } else if (item.kind === "category" || item.kind === "personal-category") {
      lineup.editor = {
        kind: item.kind,
        id: item.id,
        value: item.name,
        providerName: item.providerName || "",
        effectiveName: item.name,
        restore: item.kind === "category" ? { name: false } : null,
        saving: false,
        error: "",
        returnFocus: focusDescriptor(source),
        origin: origin,
      };
    } else {
      return;
    }
    renderManage();
    root.querySelector("[data-lineup-editor] input")?.focus();
  }

  function lineupRowItem(id) {
    for (var index = 0; index < lineup.items.length; index += 1) {
      var entry = lineup.items[index];
      if (entry.id === id || entry.key === id) return entry;
    }
    return null;
  }

  function runLineupRowAction(action, id, source) {
    var item = lineupRowItem(id);
    if (action === "open" && item) {
      if (item.kind === "channel") {
        openLineupEditor(item, source);
        return;
      }
      if (item.kind === "item") {
        showNotification(labels().noAction, "neutral");
        return;
      }
      var openTarget = null;
      if (item.kind === "category") {
        openTarget = {
          playlistId: contentPlaylistId,
          scope: item.contentKind === "live" ? "channels" : "items",
          contentKind: item.contentKind || "live",
          categoryKey: item.id,
          categoryName: item.name,
          categoryKind: item.contentKind || "live",
          categoryPersonal: false,
          membershipCategory: "",
        };
      } else if (item.kind === "personal-category") {
        openTarget = {
          playlistId: contentPlaylistId,
          scope: "channels",
          contentKind: "live",
          categoryKey: item.id,
          categoryName: item.name,
          categoryKind: "live",
          categoryPersonal: true,
          membershipCategory: item.id,
        };
      }
      if (openTarget && openLineupChild(openTarget, source)) saveManagementRoute(false);
    } else if (action === "add-members" && item) {
      var memberTarget = {
        playlistId: contentPlaylistId,
        scope: "channels",
        contentKind: "live",
        categoryKey: "",
        categoryName: item.name,
        categoryKind: "live",
        categoryPersonal: false,
        membershipCategory: item.id,
      };
      if (openLineupChild(memberTarget, source)) saveManagementRoute(false);
    } else if (action === "edit" && item) {
      openLineupEditor(item, source);
    } else if (action === "visibility" && item) {
      if (lineup.loading || lineup.mutating || busy || commandInFlight) return;
      var mutation = null;
      if (item.kind === "channel") {
        mutation = { type: "channel.visibility", channelId: item.id, hidden: !item.hidden };
      } else if (item.kind === "category") {
        mutation = { type: "category.visibility", categoryKey: item.id, hidden: !item.hidden };
      }
      if (mutation) void sendLineupMutation(mutation, source);
    } else if (action === "membership" && item) {
      var membershipId = lineup.membershipCategory;
      if (!membershipId) return;
      var ids = (item.personalCategoryIds || []).slice();
      var at = ids.indexOf(membershipId);
      if (at >= 0) ids.splice(at, 1);
      else ids.push(membershipId);
      void sendLineupMutation(
        { type: "personal-category.memberships", channelId: item.id, categoryIds: ids },
        source,
      );
    } else if (action === "remove" && item && item.kind === "unavailable") {
      var l = labels();
      openManagementConfirmation({
        title: l.lineupRemoveUnavailable,
        body:
          l.lineupRemoveUnavailableQuestion + "\n\n" + l.lineupRemoveUnavailableBody,
        confirmLabel: l.lineupRemoveUnavailable,
        danger: true,
        returnFocus: focusDescriptor(source),
        isCurrent: function () {
          var currentItem = lineupRowItem(id);
          return !!(currentItem && currentItem.kind === "unavailable");
        },
        run: function () {
          return sendConfirmedLineupMutation({ type: "unavailable.remove", key: id });
        },
      });
    }
  }

  function bindLineup() {
    if (!contentViewActive()) return;
    bindLineupOverlayKeys();
    var summary = current.lineup;
    var browsing =
      !lineup.editor &&
      !lineup.orderDialog &&
      !lineup.reorder &&
      !lineup.loading &&
      !lineup.mutating;
    var summaryQueue =
      summary &&
      summary.playlistId === lineup.playlistId &&
      typeof lineup.sourceVersion === "number"
        ? lineupWriteQueueFor(lineup.playlistId, lineup.sourceVersion)
        : null;
    var summaryQueueBusy = !!(
      summaryQueue &&
      (summaryQueue.pending.length || summaryQueue.running)
    );
    if (
      browsing &&
      !summaryQueueBusy &&
      summary &&
      summary.ready &&
      summary.playlistId === lineup.playlistId &&
      summary.revision > lineup.revision
    ) {
      lineup.revision = summary.revision;
      resetLineupPage();
    }
    var lineupKindsNow = lineupKinds();
    if (
      lineup.scope === "categories" &&
      lineupKindsNow.length > 0 &&
      lineupKindsNow.indexOf(lineup.contentKind) < 0
    ) {
      lineup.contentKind = lineupKindsNow[0];
      clearLineupContext();
      saveManagementRoute(true);
      void loadLineupPage("reset");
      return;
    }
    if (lineup.mutating) {
      root.querySelectorAll("#lineup button, #lineup input, #lineup select, .crumbs a").forEach(function (control) {
        if (control.tagName === "A") {
          control.removeAttribute("href");
          control.setAttribute("aria-disabled", "true");
        } else {
          control.disabled = true;
        }
      });
    }
    root.querySelectorAll("[data-lineup-kind]").forEach(function (button) {
      button.addEventListener("click", function () {
        var kind = button.dataset.lineupKind;
        if (lineup.scope === "categories" && lineup.contentKind === kind) return;
        var moved = enterLineupView({
          playlistId: contentPlaylistId,
          scope: "categories",
          contentKind: kind,
          categoryKey: "",
          categoryName: "",
          categoryKind: "live",
          categoryPersonal: false,
          membershipCategory: "",
        });
        if (moved) saveManagementRoute(false);
      });
    });
    var tabStrip = root.querySelector(".lineup-tabs[role='tablist']");
    if (tabStrip) {
      tabStrip.addEventListener("keydown", function (event) {
        var key = event.key;
        var horizontal = tabStrip.getAttribute("aria-orientation") === "horizontal";
        var rtl = getComputedStyle(tabStrip).direction === "rtl";
        var previousKey = horizontal ? (rtl ? "ArrowRight" : "ArrowLeft") : "ArrowUp";
        var nextKey = horizontal ? (rtl ? "ArrowLeft" : "ArrowRight") : "ArrowDown";
        if (key !== previousKey && key !== nextKey && key !== "Home" && key !== "End") return;
        var tabs = Array.from(tabStrip.querySelectorAll('[role="tab"]')).filter(
          function (tab) {
            return !tab.disabled;
          },
        );
        if (!tabs.length) return;
        var at = tabs.indexOf(document.activeElement);
        var next = at;
        if (key === "Home") next = 0;
        else if (key === "End") next = tabs.length - 1;
        else if (key === nextKey) next = (at < 0 ? 0 : at + 1) % tabs.length;
        else next = (at < 0 ? tabs.length - 1 : at - 1 + tabs.length) % tabs.length;
        event.preventDefault();
        tabs.forEach(function (tab) {
          tab.setAttribute("tabindex", tab === tabs[next] ? "0" : "-1");
        });
        tabs[next].focus();
      });
    }
    root.querySelectorAll("[data-lineup-scope]").forEach(function (button) {
      button.addEventListener("click", function () {
        if (button.dataset.lineupScope !== "personal-categories") return;
        if (lineup.scope === "personal-categories") return;
        var moved = openLineupChild({
          playlistId: contentPlaylistId,
          scope: "personal-categories",
          contentKind: "live",
          categoryKey: "",
          categoryName: "",
          categoryKind: "live",
          categoryPersonal: false,
          membershipCategory: "",
        }, button);
        if (moved) saveManagementRoute(false);
      });
    });
    root.querySelector("[data-lineup-search-toggle]")?.addEventListener("click", function () {
      if (lineup.searchOpen) {
        closeLineupSearch();
        return;
      }
      lineup.searchOpen = true;
      renderManage();
      var field = root.querySelector("[data-lineup-search]");
      if (field) field.focus();
    });
    var searchField = root.querySelector("[data-lineup-search]");
    if (searchField) {
      searchField.addEventListener("input", function (event) {
        var input = event.currentTarget;
        lineup.query = input.value;
        lineup.editor = null;
        lineup.notice = "";
        lineupRequestGeneration += 1;
        if (lineupSearchTimer !== null) clearTimeout(lineupSearchTimer);
        lineupSearchTimer = setTimeout(function () {
          lineupSearchTimer = null;
          resetLineupPage();
          void loadLineupPage("reset");
        }, 150);
      });
      searchField.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          event.preventDefault();
          searchField.blur();
          var toggle = root.querySelector("[data-lineup-search-toggle]");
          if (toggle) toggle.focus();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          return;
        }
        if (event.key === "ArrowDown") {
          var first =
            root.querySelector("#lineup .lineup-list .lineup-row-open") ||
            root.querySelector("#lineup .lineup-list [data-lineup-edit]") ||
            root.querySelector("#lineup .lineup-list .lineup-row-menu-button") ||
            root.querySelector("#lineup .lineup-list [tabindex='0']");
          if (first) {
            event.preventDefault();
            first.focus();
          } else {
            var toggle = root.querySelector("[data-lineup-search-toggle]");
            if (toggle) {
              event.preventDefault();
              toggle.focus();
            }
          }
        }
      });
    }
    var searchToggleControl = root.querySelector("[data-lineup-search-toggle]");
    if (searchToggleControl) {
      searchToggleControl.addEventListener("keydown", function (event) {
        if (event.key !== "Escape" || !lineup.searchOpen) return;
        var field = root.querySelector("[data-lineup-search]");
        if (field && document.activeElement === field) return;
        event.preventDefault();
        closeLineupSearch();
      });
    }
    root.querySelectorAll("[data-lineup-preference]").forEach(function (button) {
      button.addEventListener("click", function () {
        var kind = button.dataset.lineupPreference;
        if (kind === "order") openLineupOrderDialog(button);
        else if (kind === "custom-order") enterLineupSort();
      });
    });
    root.querySelectorAll("[data-lineup-order-option]").forEach(function (option) {
      option.addEventListener("click", function () {
        void selectLineupOrderMode(option.dataset.lineupOrderOption, option);
      });
    });
    root.querySelectorAll("[data-lineup-order-dismiss]").forEach(function (button) {
      button.addEventListener("click", function () {
        closeLineupOrderDialog();
      });
    });
    root.querySelectorAll("[data-lineup-order-reset]").forEach(function (button) {
      button.addEventListener("click", function () {
        if (
          !lineup.orderDialog ||
          lineup.mutating ||
          lineup.loading ||
          busy ||
          commandInFlight
        ) {
          return;
        }
        void sendLineupMutation(lineupOrderResetMutation(), button);
      });
    });
    root.querySelectorAll("[data-lineup-sort-reset]").forEach(function (button) {
      button.addEventListener("click", function () {
        if (lineup.loading || lineup.mutating) return;
        void sendLineupMutation(lineupOrderResetMutation(), button).then(
          function (sent) {
            if (sent) exitLineupSort();
          },
        );
      });
    });
    root.querySelectorAll("[data-lineup-sort-done]").forEach(function (button) {
      button.addEventListener("click", function () {
        exitLineupSort();
      });
    });
    root.querySelectorAll("[data-lineup-bulk]").forEach(function (button) {
      button.addEventListener("click", function () {
        var action = button.dataset.lineupBulk;
        if (action === "show" || action === "hide") {
          void sendLineupMutation(
            lineupBulkVisibilityMutation(action === "hide"),
            button,
          );
        }
      });
    });
    root.querySelectorAll("[data-lineup-edit]").forEach(function (button) {
      button.addEventListener("click", function () {
        var item = lineupRowItem(button.dataset.id);
        if (item) openLineupEditor(item, button);
      });
    });
    root.querySelectorAll("[data-lineup-visibility]").forEach(function (button) {
      button.addEventListener("click", function () {
        runLineupRowAction("visibility", button.dataset.id, button);
      });
    });
    root.querySelectorAll("[data-lineup-remove]").forEach(function (button) {
      button.addEventListener("click", function () {
        runLineupRowAction("remove", button.dataset.id, button);
      });
    });
    root.querySelectorAll("[data-lineup-mode-back]").forEach(function (button) {
      button.addEventListener("click", function () {
        lineupModeBack();
      });
    });
    root.querySelectorAll("[data-lineup-page]").forEach(function (button) {
      button.addEventListener("click", function () {
        if (lineup.loading || lineup.mutating || busy || commandInFlight) return;
        if (lineup.sort) {
          lineup.sort.ids = lineupSortCleanIds();
          lineup.sort.dirty = false;
        }
        void loadLineupPage(
          button.dataset.lineupPage === "next" ? "next" : "prev",
          true,
          false,
          undefined,
          true,
        );
      });
    });
    root.querySelector("[data-lineup-retry]")?.addEventListener("click", function () {
      lineup.conflictRetried = false;
      resetLineupPage();
      void loadLineupPage("reset");
    });
    var createForm = root.querySelector("[data-create-category]");
    if (createForm) {
      createForm.addEventListener("input", function () {
        lineup.createDraft = createForm.elements.personalCategoryName.value;
      });
      createForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var value = createForm.elements.personalCategoryName.value;
        lineup.createDraft = value;
        void sendLineupMutation(
          { type: "personal-category.create", name: value.trim() },
          createForm.querySelector("button"),
        );
      });
    }
    root.querySelectorAll("[data-lineup-action]").forEach(function (button) {
      button.addEventListener("click", function () {
        var action = button.dataset.lineupAction;
        var item = lineupRowItem(button.dataset.id);
        if (action === "delete-category" && item && item.kind === "personal-category") {
          var l = labels();
          var editorReturn = lineup.editor ? lineup.editor.returnFocus : null;
          lineup.editor = null;
          renderManage();
          openManagementConfirmation({
            title: item.name,
            body:
              l.categoryRemoveQuestion + "\n\n" + l.categoryRemoveBody,
            confirmLabel: l.lineupDeleteCategory,
            danger: true,
            returnFocus: editorReturn || focusDescriptor(button),
            isCurrent: function () {
              var currentItem = lineupRowItem(item.id);
              return !!(
                currentItem && currentItem.kind === "personal-category"
              );
            },
            run: function () {
              return sendConfirmedLineupMutation({
                type: "personal-category.delete",
                categoryId: item.id,
              });
            },
          });
        } else if (action === "cancel-editor") {
          var editorFocus = lineup.editor && lineup.editor.returnFocus;
          lineup.editor = null;
          renderManage();
          restoreLineupFocus(editorFocus);
        } else if (action === "restore-draft" && lineup.editor) {
          applyLineupEditorRestore(lineup.editor);
          renderManage();
          var restoreField = root.querySelector("[data-lineup-editor] input");
          if (restoreField) restoreField.focus();
        }
      });
    });
    var editorForm = root.querySelector("[data-lineup-editor]");
    if (editorForm) {
      editorForm.addEventListener("input", function (event) {
        var editor = lineup.editor;
        if (!editor || editor.saving) return;
        var field = event.target;
        if (editor.kind === "channel") {
          if (field.name === "editorName") {
            editor.name = field.value;
            editor.restore.name = false;
          } else if (field.name === "editorNumber") {
            editor.number = field.value;
            editor.restore.number = false;
          }
        } else if (field.name === "editorValue") {
          editor.value = field.value;
          if (editor.restore) editor.restore.name = false;
        }
      });
      editorForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var editor = lineup.editor;
        if (!editor || editor.saving) return;
        var elements = event.currentTarget.elements;
        if (editor.kind === "channel") {
          editor.name = elements.editorName.value;
          editor.number = elements.editorNumber.value;
        } else {
          editor.value = elements.editorValue.value;
        }
        void saveLineupEditor(event.currentTarget.querySelector('button[type="submit"]'));
      });
    }
    cancelLineupSortDrag();
    var sortList = root.querySelector(".lineup-sort-list");
    if (sortList) {
      sortList.addEventListener("pointerdown", function (event) {
        var button = event.target.closest("[data-lineup-sort]");
        if (!button || lineup.loading || lineup.mutating || lineupSortDrag) return;
        if (event.button != null && event.button !== 0) return;
        if (event.isPrimary === false) return;
        var onHandle = event.target.closest("[data-lineup-sort-handle]");
        var sort = lineup.sort;
        if (!sort) return;
        if (event.pointerType === "touch" && !onHandle &&
          (!sort.grabbed || sort.grabbed.id !== button.dataset.id)) return;
        if (event.cancelable) event.preventDefault();
        document.documentElement.classList.add("lineup-dragging");
        lineupSortDrag = {
          pointerId: event.pointerId,
          id: button.dataset.id,
          node: button,
          clientX: event.clientX,
          clientY: event.clientY,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
          raf: 0,
          auth: auth,
          sort: sort,
          originIds: sort.ids.slice(),
          originGrabbed: sort.grabbed,
          originDirty: sort.dirty,
        };
        if (button.setPointerCapture) {
          try {
            button.setPointerCapture(event.pointerId);
          } catch (_error) {}
        }
      });
      sortList.addEventListener("pointermove", function (event) {
        var drag = lineupSortDrag;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (drag.sort !== lineup.sort || drag.auth !== auth) {
          cancelLineupSortDrag();
          return;
        }
        if (event.cancelable) event.preventDefault();
        drag.clientX = event.clientX;
        drag.clientY = event.clientY;
        if (!drag.moved) {
          if (
            Math.abs(event.clientX - drag.startX) < 8 &&
            Math.abs(event.clientY - drag.startY) < 8
          ) {
            return;
          }
          drag.moved = true;
          var sort = lineup.sort;
          if (sort) {
            if (sort.grabbed && sort.grabbed.id !== drag.id) {
              clearLineupSortHold(true);
            }
            if (!sort.grabbed || sort.grabbed.id !== drag.id) {
              var item = lineupItemById(drag.id);
              if (item) {
                sort.grabbed = item;
                if (sort.ids.indexOf(drag.id) < 0) sort.ids.unshift(drag.id);
                syncLineupSortRows();
              }
            }
          }
        }
        if (!drag.raf && typeof requestAnimationFrame === "function") {
          drag.raf = requestAnimationFrame(function () {
            lineupSortDragFrame(drag);
          });
        }
      }, { passive: false });
      function finishSortPointer(event, cancel) {
        var drag = lineupSortDrag;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (!cancel && drag.moved) {
          drag.clientX = event.clientX;
          drag.clientY = event.clientY;
          lineupSortDragHitTest(drag);
        }
        var currentDrag = drag.sort === lineup.sort && drag.auth === auth;
        cancel = cancel || !currentDrag;
        cancelLineupSortDrag(cancel);
        if (!drag.moved) return;
        if (cancel) {
          return;
        }
        armLineupSortClickSuppress(drag.id);
        if (lineup.sort) void commitLineupSort(lineupSortDisplayIds());
      }
      sortList.addEventListener("pointerup", function (event) {
        finishSortPointer(event, false);
      });
      sortList.addEventListener("pointercancel", function (event) {
        finishSortPointer(event, true);
      });
      sortList.addEventListener("lostpointercapture", function (event) {
        finishSortPointer(event, true);
      });
      sortList.addEventListener("click", function (event) {
        var button = event.target.closest("[data-lineup-sort]");
        if (!button) return;
        lineupSortActivate(button.dataset.id, event.detail);
      });
      sortList.addEventListener("keydown", function (event) {
        var sort = lineup.sort;
        if (!sort || event.defaultPrevented || activeLineupDialog()) return;
        if (event.key === "Escape") {
          event.preventDefault();
          lineupModeBack();
          return;
        }
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        var rows = Array.from(
          sortList.querySelectorAll("[data-lineup-sort]:not(:disabled)"),
        );
        var active = document.activeElement;
        var at = rows.indexOf(active);
        if (at < 0) return;
        event.preventDefault();
        event.stopPropagation();
        var delta = event.key === "ArrowUp" ? -1 : 1;
        if (sort.grabbed && active.dataset.id === sort.grabbed.id) {
          moveLineupSortGrabbed(delta);
          return;
        }
        var next = rows[Math.max(0, Math.min(rows.length - 1, at + delta))];
        if (next === active) return;
        next.focus({ preventScroll: true });
        next.scrollIntoView({ block: "nearest", behavior: "instant" });
      });
    }
    var sortPanel = root.querySelector(".lineup-layout");
    if (sortPanel) {
      sortPanel.addEventListener("keydown", function (event) {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        if (activeLineupDialog()) return;
        if (lineup.searchOpen) {
          event.preventDefault();
          closeLineupSearch();
          return;
        }
        event.preventDefault();
        lineupModeBack();
      });
    }
    if (!lineup.loaded && !lineup.loading && !lineup.mutating && !lineup.error) {
      void loadLineupPage("reset");
    }
  }

  var lineupOverlayBound = false;
  function activeLineupDialog() {
    if (managementConfirmation) {
      return root.querySelector("[data-management-confirmation]");
    }
    if (lineup.editor) return root.querySelector(".lineup-editor-dialog");
    var formOverlay = root.querySelector("[data-form-overlay]");
    if (formOverlay) return formOverlay;
    if (lineup.orderDialog) return root.querySelector("[data-lineup-order-dialog]");
    if (itemMenu) return root.querySelector("[data-item-action-dialog]");
    return null;
  }

  function lineupWriteInFlight() {
    return !!(lineup.mutating || (lineup.editor && lineup.editor.saving));
  }

  function overlayWriteInFlight() {
    if (managementConfirmation && managementConfirmation.busy) return true;
    if (lineupWriteInFlight()) return true;
    return !!(
      lineup.orderDialog &&
      (lineup.loading || busy || commandInFlight)
    );
  }

  function closeActiveLineupDialog() {
    if (managementConfirmation) {
      closeManagementConfirmation();
      return;
    }
    if (lineup.editor) {
      var editorFocus = lineup.editor.returnFocus;
      lineup.editor = null;
      renderManage();
      restoreLineupFocus(editorFocus);
      return;
    }
    var formOverlay = root.querySelector("[data-form-overlay]");
    if (formOverlay) {
      if (formOverlay.dataset.formOverlay === "playlist-edit") closePlaylistEdit();
      else if (formOverlay.dataset.formOverlay === "playlist-add") {
        endAddPlaylistDraft();
        showPlaylistsIndex();
      } else closeDeviceEdit();
      return;
    }
    if (lineup.orderDialog) {
      closeLineupOrderDialog();
      return;
    }
    if (itemMenu) {
      closeItemMenu();
    }
  }

  function openManagementConfirmation(prompt) {
    if (!prompt || managementConfirmation) return false;
    if (
      activeLineupDialog() ||
      busy ||
      commandInFlight ||
      lineupWriteInFlight()
    ) {
      return false;
    }
    prompt.auth = auth;
    prompt.busy = false;
    prompt.error = "";
    if (typeof prompt.isCurrent !== "function") {
      prompt.isCurrent = function () {
        return true;
      };
    }
    managementConfirmation = prompt;
    renderManage();
    ensureLineupOverlayFocus();
    return true;
  }

  function restoreConfirmationFocus(target) {
    if (!target) return;
    var control = findFocusControl(target);
    if (!control || control.disabled) {
      control =
        root.querySelector("[data-playlist-search]") ||
        root.querySelector(".page-head-actions button") ||
        root.querySelector("#manage-main [data-item-open]") ||
        root.querySelector("[data-item-menu]") ||
        root.querySelector("[data-lineup-heading]") ||
        root.querySelector(".page-head [tabindex]");
    }
    if (control && !control.disabled) control.focus();
  }

  function closeManagementConfirmation(restore) {
    if (!managementConfirmation || managementConfirmation.busy) return;
    var ret = managementConfirmation.returnFocus;
    managementConfirmation = null;
    renderManage();
    if (restore !== false) restoreConfirmationFocus(ret);
  }

  async function confirmManagementAction() {
    var prompt = managementConfirmation;
    if (!prompt || prompt.busy) return;
    if (auth !== prompt.auth || !prompt.isCurrent()) {
      closeManagementConfirmation();
      return;
    }
    prompt.busy = true;
    prompt.error = "";
    renderManage();
    ensureLineupOverlayFocus();
    var outcome = await prompt.run();
    if (managementConfirmation !== prompt) return;
    if (auth !== prompt.auth) {
      managementConfirmation = null;
      return;
    }
    if (outcome && outcome.ok) {
      managementConfirmation = null;
      renderManage(outcome.message || "", !!outcome.failed);
      restoreConfirmationFocus(prompt.returnFocus);
    } else {
      prompt.busy = false;
      prompt.error = (outcome && outcome.error) || labels().changeFailed;
      renderManage();
      ensureLineupOverlayFocus();
    }
  }

  function managementConfirmationMarkup(l) {
    var prompt = managementConfirmation;
    if (!prompt) return "";
    var busy = !!prompt.busy;
    return (
      '<div class="confirm-overlay"><button type="button" class="confirm-backdrop" data-confirm-dismiss tabindex="-1" aria-label="' +
      escape(l.close) +
      '"' +
      (busy ? " disabled" : "") +
      '></button><section class="confirm-dialog lineup-editor-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" tabindex="-1" data-management-confirmation>' +
      '<div class="modal-head"><h3 id="confirm-title" dir="auto">' +
      escape(prompt.title) +
      "</h3></div>" +
      '<div class="lineup-editor-body confirm-body"><p class="confirm-text" dir="auto">' +
      escape(prompt.body) +
      "</p>" +
      (prompt.error
        ? '<p class="lineup-state notice" role="alert">' + escape(prompt.error) + "</p>"
        : "") +
      '</div><div class="form-actions lineup-editor-footer confirm-foot">' +
      '<button type="button" class="quiet" data-confirm-cancel' +
      (busy ? " disabled" : "") +
      ">" +
      icon("close") +
      escape(l.cancel) +
      '</button><button type="button" class="confirm-accept' +
      (prompt.danger ? " danger" : "") +
      '" data-confirm-accept' +
      (busy ? ' aria-busy="true"' : "") +
      (busy ? " disabled" : "") +
      ">" +
      (busy ? '<span class="form-spinner" aria-hidden="true"></span>' : "") +
      escape(busy ? prompt.busyLabel || prompt.confirmLabel : prompt.confirmLabel) +
      "</button></div></section></div>"
    );
  }

  function trapLineupDialogFocus(event, dialog) {
    var focusable = Array.from(
      dialog.querySelectorAll("button, input, select, textarea, [href], [tabindex]"),
    ).filter(function (element) {
      return !element.disabled && element.tabIndex >= 0 && !element.closest("[hidden]");
    });
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    var active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !dialog.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !dialog.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }

  function moveLineupModalFocus(dialog, delta) {
    var controls = Array.from(
      dialog.querySelectorAll("button, input, select, textarea, [href], [tabindex]"),
    ).filter(function (element) {
      return (
        !element.disabled && element.tabIndex >= 0 && !element.closest("[hidden]")
      );
    });
    if (!controls.length) {
      dialog.focus();
      return;
    }
    var at = controls.indexOf(document.activeElement);
    var next =
      at < 0
        ? delta > 0
          ? controls[0]
          : controls[controls.length - 1]
        : controls[(at + delta + controls.length) % controls.length];
    next.focus();
  }

  function bindLineupOverlayKeys() {
    if (lineupOverlayBound) return;
    lineupOverlayBound = true;
    root.addEventListener("keydown", function (event) {
      var dialog = activeLineupDialog();
      if (!dialog) {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          lineup.searchOpen &&
          contentViewActive()
        ) {
          var field = root.querySelector("[data-lineup-search]");
          if (field && document.activeElement === field) return;
          event.preventDefault();
          closeLineupSearch();
        }
        return;
      }
      if (event.key === "Escape") {
        if (overlayWriteInFlight()) return;
        event.preventDefault();
        closeActiveLineupDialog();
        return;
      }
      if (event.key === "Tab") {
        trapLineupDialogFocus(event, dialog);
        return;
      }
      var modal = dialog.hasAttribute("data-lineup-order-dialog");
      if (!modal) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        moveLineupModalFocus(dialog, event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (lineup.mutating || lineup.loading || busy || commandInFlight) return;
        var active = document.activeElement;
        if (
          active &&
          active instanceof HTMLElement &&
          dialog.contains(active) &&
          !active.disabled
        ) {
          active.click();
        }
      }
    });
  }

  function ensureLineupOverlayFocus() {
    var dialog = activeLineupDialog();
    if (!dialog) return;
    var active = document.activeElement;
    if (active && active !== document.body && dialog.contains(active)) return;
    var preferred = dialog.querySelector(
      '[data-lineup-order-option][aria-selected="true"]',
    );
    if (preferred && !preferred.disabled && !preferred.closest("[hidden]")) {
      preferred.focus();
      return;
    }
    var candidates = dialog.querySelectorAll(
      "input:enabled, select:enabled, textarea:enabled, button:enabled",
    );
    for (var index = 0; index < candidates.length; index += 1) {
      if (!candidates[index].closest("[hidden]")) {
        candidates[index].focus();
        return;
      }
    }
    dialog.focus();
  }

  function syncLineupOverlayScroll() {
    document.body.style.overflow =
      managementConfirmation ||
      lineup.editor ||
      lineup.orderDialog ||
      itemMenu ||
      root.querySelector("[data-form-overlay]")
        ? "hidden"
        : "";
  }

  function lineupFocusMode() {
    if (lineup.reorder && lineup.sort) return "reorder";
    return "browse";
  }

  function captureLineupFocus() {
    var active = document.activeElement;
    var retained = preRenderLineupFocus;
    preRenderLineupFocus = null;
    if (!active || active === document.body || !active.hasAttribute) {
      if (
        retained &&
        retained.kind === "overlayField" &&
        retained.overlay &&
        root.querySelector('[data-form-overlay="' + retained.overlay + '"]')
      ) {
        preRenderLineupFocus = retained;
      }
      return;
    }
    if (active.hasAttribute("data-lineup-search")) {
      preRenderLineupFocus = {
        kind: "search",
        start: active.selectionStart,
        end: active.selectionEnd,
      };
    } else if (active.hasAttribute && active.hasAttribute("data-lineup-sort")) {
      preRenderLineupFocus = { kind: "sort", id: active.dataset.id };
    } else if (active.hasAttribute && active.hasAttribute("data-lineup-edit")) {
      preRenderLineupFocus = { kind: "lineupOp", op: "edit", id: active.dataset.id };
    } else if (active.hasAttribute && active.hasAttribute("data-lineup-visibility")) {
      preRenderLineupFocus = { kind: "lineupOp", op: "visibility", id: active.dataset.id };
    } else if (active.hasAttribute && active.hasAttribute("data-lineup-remove")) {
      preRenderLineupFocus = { kind: "lineupOp", op: "remove", id: active.dataset.id };
    } else if (
      active.hasAttribute &&
      active.hasAttribute("data-lineup-provider-id") &&
      active.dataset.lineupProviderId
    ) {
      preRenderLineupFocus = {
        kind: "infoRow",
        id: active.dataset.lineupProviderId,
        scope: lineupOrderDialogSignature(),
        mode: lineupFocusMode(),
      };
    } else if (active.hasAttribute && active.hasAttribute("data-lineup-mode-back")) {
      preRenderLineupFocus = {
        kind: "modeBack",
        scope: lineupOrderDialogSignature(),
        mode: lineupFocusMode(),
      };
    } else if (active.hasAttribute && active.hasAttribute("data-lineup-preference")) {
      preRenderLineupFocus = {
        kind: "preference",
        pref: active.dataset.lineupPreference,
        scope: lineupOrderDialogSignature(),
      };
    } else if (active.hasAttribute && active.hasAttribute("data-lineup-order-option")) {
      preRenderLineupFocus = {
        kind: "orderOption",
        option: active.dataset.lineupOrderOption,
        scope: lineupOrderDialogSignature(),
      };
    } else if (active.hasAttribute && active.hasAttribute("data-lineup-bulk")) {
      preRenderLineupFocus = {
        kind: "bulk",
        action: active.dataset.lineupBulk,
        scope: lineupOrderDialogSignature(),
      };
    } else if (active.hasAttribute && active.hasAttribute("data-item-menu")) {
      preRenderLineupFocus = {
        kind: "itemMenu",
        menu: active.dataset.itemMenu,
        id: active.dataset.id || "",
      };
    } else if (active.hasAttribute && active.hasAttribute("data-item-open")) {
      preRenderLineupFocus = {
        kind: "itemOpen",
        open: active.dataset.itemOpen,
        id: active.dataset.id || "",
      };
    } else if (active.hasAttribute && active.hasAttribute("data-item-action")) {
      preRenderLineupFocus = {
        kind: "itemAction",
        action: active.dataset.itemAction,
        menuKind: itemMenu ? itemMenu.kind : "",
        menuId: itemMenu ? itemMenu.id : "",
      };
    } else if (active.hasAttribute && active.hasAttribute("data-lineup-heading")) {
      preRenderLineupFocus = { kind: "heading" };
    } else if (
      active.name &&
      ["editorName", "editorNumber", "editorValue"].indexOf(active.name) >= 0 &&
      active.closest &&
      active.closest("[data-lineup-editor]")
    ) {
      preRenderLineupFocus = {
        kind: "editor",
        name: active.name,
        start: active.selectionStart,
        end: active.selectionEnd,
      };
    } else if (
      active.name &&
      active.closest &&
      active.closest("[data-form-overlay]")
    ) {
      var overlay = active.closest("[data-form-overlay]");
      preRenderLineupFocus = {
        kind: "overlayField",
        overlay: overlay.dataset.formOverlay,
        name: active.name,
        start: typeof active.selectionStart === "number" ? active.selectionStart : null,
        end: typeof active.selectionEnd === "number" ? active.selectionEnd : null,
      };
    }
  }

  function restoreCapturedLineupFocus() {
    var wanted = preRenderLineupFocus;
    preRenderLineupFocus = null;
    if (!wanted) return;
    var field =
      wanted.kind === "search"
        ? root.querySelector("[data-lineup-search]")
        : wanted.kind === "sort"
          ? null
          : wanted.kind === "heading"
            ? root.querySelector("[data-lineup-heading]")
            : wanted.kind === "editor" && wanted.name
              ? root.querySelector('[data-lineup-editor] [name="' + wanted.name + '"]')
              : null;
    if (wanted.kind === "sort") {
      var sortButtons = root.querySelectorAll("[data-lineup-sort]");
      for (var index = 0; index < sortButtons.length; index += 1) {
        if (sortButtons[index].dataset.id === wanted.id) {
          field = sortButtons[index];
          break;
        }
      }
    } else if (wanted.kind === "lineupOp") {
      var opButtons = root.querySelectorAll("[data-lineup-" + wanted.op + "]");
      for (var opIndex = 0; opIndex < opButtons.length; opIndex += 1) {
        if (opButtons[opIndex].dataset.id === wanted.id) {
          field = opButtons[opIndex];
          break;
        }
      }
    } else if (wanted.kind === "itemMenu") {
      var menuTriggers = root.querySelectorAll("button[data-item-menu]");
      for (var menuIndex = 0; menuIndex < menuTriggers.length; menuIndex += 1) {
        var trigger = menuTriggers[menuIndex];
        if (
          trigger.dataset.itemMenu === wanted.menu &&
          (!wanted.id || trigger.dataset.id === wanted.id)
        ) {
          field = trigger;
          break;
        }
      }
    } else if (wanted.kind === "itemOpen") {
      var openButtons = root.querySelectorAll("button[data-item-open]");
      for (var openIndex = 0; openIndex < openButtons.length; openIndex += 1) {
        var openButton = openButtons[openIndex];
        if (
          openButton.dataset.itemOpen === wanted.open &&
          (!wanted.id || openButton.dataset.id === wanted.id)
        ) {
          field = openButton;
          break;
        }
      }
    } else if (wanted.kind === "itemAction") {
      if (itemMenu && itemMenu.kind === wanted.menuKind && itemMenu.id === wanted.menuId) {
        var actionButtons = root.querySelectorAll("[data-item-action]");
        for (var actionIndex = 0; actionIndex < actionButtons.length; actionIndex += 1) {
          if (actionButtons[actionIndex].dataset.itemAction === wanted.action) {
            field = actionButtons[actionIndex];
            break;
          }
        }
      }
    } else if (wanted.kind === "preference") {
      if (wanted.scope === lineupOrderDialogSignature()) {
        var preferenceButtons = root.querySelectorAll("[data-lineup-preference]");
        for (var preferenceIndex = 0; preferenceIndex < preferenceButtons.length; preferenceIndex += 1) {
          if (preferenceButtons[preferenceIndex].dataset.lineupPreference === wanted.pref) {
            field = preferenceButtons[preferenceIndex];
            break;
          }
        }
      }
    } else if (wanted.kind === "orderOption") {
      if (wanted.scope === lineupOrderDialogSignature() && lineup.orderDialog) {
        field = root.querySelector('[data-lineup-order-option="' + wanted.option + '"]');
      }
    } else if (wanted.kind === "bulk") {
      if (wanted.scope === lineupOrderDialogSignature()) {
        field = root.querySelector('[data-lineup-bulk="' + wanted.action + '"]');
      }
    } else if (wanted.kind === "overlayField" && wanted.overlay) {
      var overlay = root.querySelector('[data-form-overlay="' + wanted.overlay + '"]');
      if (overlay && wanted.name) {
        field = overlay.querySelector('[name="' + wanted.name + '"]');
      }
    } else if (
      (wanted.kind === "infoRow" || wanted.kind === "modeBack") &&
      wanted.scope === lineupOrderDialogSignature() &&
      wanted.mode === lineupFocusMode() &&
      !lineup.editor &&
      !lineup.orderDialog &&
      !itemMenu
    ) {
      if (wanted.kind === "infoRow") {
        var infoRows = root.querySelectorAll(
          "button[data-lineup-provider-id]",
        );
        for (var infoIndex = 0; infoIndex < infoRows.length; infoIndex += 1) {
          if (infoRows[infoIndex].dataset.lineupProviderId === wanted.id) {
            field = infoRows[infoIndex];
            break;
          }
        }
        if (!field) {
          field =
            root.querySelector("#lineup .lineup-list [data-lineup-provider-id]") ||
            root.querySelector("#lineup .lineup-list [tabindex='0']") ||
            root.querySelector("[data-lineup-search-toggle]") ||
            root.querySelector("[data-lineup-heading]");
        }
      } else {
        field = root.querySelector("[data-lineup-mode-back]");
      }
    }
    if (!field) return;
    if (
      wanted.kind === "heading" ||
      wanted.kind === "infoRow" ||
      wanted.kind === "modeBack"
    ) {
      field.focus({ preventScroll: true });
    } else {
      field.focus();
    }
    try {
      if (wanted.start != null) field.setSelectionRange(wanted.start, wanted.end);
    } catch (_error) {}
  }

  function capturePlaylistFormDrafts() {
    // Source changes capture the outgoing fields before advancing the form epoch.
    var currentFields = renderedPlaylistFormEpoch === playlistFormEpoch;
    if (
      currentFields &&
      addPlaylistDraftActive &&
      root.querySelector("[data-add-playlist-form]")
    ) {
      addPlaylistDraft = readAddPlaylistDraft();
    }
    var editForm = root.querySelector("[data-edit-playlist]");
    if (currentFields && editForm && editForm.dataset.id === editingPlaylist) {
      editingPlaylistDraft = readEditPlaylistDraft();
    }
    var deviceForm = root.querySelector("[data-edit-device]");
    if (deviceForm && deviceForm.dataset.id === editingDevice) {
      editingDeviceDraft = deviceForm.elements.editDeviceName.value;
    }
  }

  function sanitizeManageView() {
    reconcileLineupSource();
    sanitizeItemMenu();
    if (
      managementConfirmation &&
      (auth !== managementConfirmation.auth ||
        (!managementConfirmation.busy &&
          !managementConfirmation.isCurrent()))
    ) {
      managementConfirmation = null;
    }
    if (
      lineup.orderDialog &&
      (!contentViewActive() ||
        lineup.orderDialog.signature !== lineupOrderDialogSignature())
    ) {
      lineup.orderDialog = null;
    }
    if (lineup.reorder && lineup.sort && lineup.orderMode !== "custom") {
      cancelLineupSortDrag();
      clearLineupSortClickSuppress();
      lineup.reorder = false;
      lineup.sort = null;
      restoreLineupBrowse("order");
    }
    if (
      manageView.page !== "devices" ||
      !editingDevice ||
      !deviceById(editingDevice)
    ) {
      editingDevice = "";
      editingDeviceDraft = "";
      editingDeviceReturn = null;
    }
    if (manageView.sub !== "edit" || !playlistById(manageView.subId)) {
      if (manageView.sub === "edit") {
        manageView.sub = "";
        manageView.subId = "";
      }
      if (!playlistById(editingPlaylist)) editingPlaylist = "";
      editingPlaylistReturn = null;
    }
    if (manageView.page !== "playlists") {
      manageView.sub = "";
      manageView.subId = "";
      clearPlaylistSubViews();
      return;
    }
    if (manageView.sub === "content") {
      if (!playlistById(contentPlaylistId)) {
        manageView.sub = "";
        manageView.subId = "";
        clearPlaylistSubViews();
      } else {
        manageView.subId = contentPlaylistId;
      }
    }
  }

  var PLAYLIST_PAGE_SIZE = 6;

  function filteredPlaylists() {
    var query = playlistQuery.trim().toLocaleLowerCase(current.locale);
    if (!query) return current.playlists;
    return current.playlists.filter(function (playlist) {
      return String(playlist.name || "")
        .toLocaleLowerCase(current.locale)
        .indexOf(query) !== -1;
    });
  }

  function playlistCatalogueReady(playlist) {
    return !!(
      playlist.id === current.activePlaylistId &&
      !(current.operation && current.operation.loading) &&
      current.lineup &&
      current.lineup.ready &&
      current.lineup.playlistId === playlist.id
    );
  }

  function playlistRowError(playlist) {
    if (playlist.id === current.activePlaylistId) {
      return (current.operation && current.operation.error) || "";
    }
    return playlistErrors[playlist.id] || "";
  }

  function playlistRowProgress(playlist) {
    var operation = playlistRowOperations.get(playlist.id);
    return (
      !!(
        operation &&
        operation.auth === auth &&
        playlistRowSourceVersion(playlist) === operation.sourceVersion
      ) ||
      (playlist.id === current.activePlaylistId &&
        !!(current.operation && current.operation.loading))
    );
  }

  function playlistCardState(playlist) {
    var error = playlistRowError(playlist) !== "";
    var ready = playlistCatalogueReady(playlist);
    return {
      progress: playlistRowProgress(playlist),
      unavailable: error && !ready,
      saved: error && ready,
      disabled: playlistRowProgress(playlist) || (error && !ready),
    };
  }

  function recordPlaylistError(id, message) {
    if (!id) return;
    delete playlistErrors[id];
    playlistErrors[id] = message;
    var keys = Object.keys(playlistErrors);
    for (var index = 0; index < keys.length - 8; index += 1) {
      delete playlistErrors[keys[index]];
    }
  }

  function clearPlaylistError(id) {
    if (id) delete playlistErrors[id];
  }

  function playlistPageCount() {
    return Math.max(1, Math.ceil(filteredPlaylists().length / PLAYLIST_PAGE_SIZE));
  }

  function playlistCardMarkup(playlist, l) {
    var counts = [];
    if (typeof playlist.categoryCount === "number") {
      counts.push(String(playlist.categoryCount) + " " + l.lineupCategories);
    }
    if (typeof playlist.channelCount === "number") {
      counts.push(String(playlist.channelCount) + " " + l.lineupChannels);
    }
    var active = playlist.id === current.activePlaylistId;
    var cardState = playlistCardState(playlist);
    var position = current.playlists.findIndex(function (entry) {
      return entry.id === playlist.id;
    }) + 1;
    var info =
      '<span class="playlist-card-info"><span class="playlist-card-heading">' +
      '<span class="playlist-position" data-playlist-number="' +
      escape(playlist.id) +
      '" aria-hidden="true">' +
      escape(String(position)) +
      '</span><strong dir="auto">' +
      escape(playlist.name) +
      "</strong>" +
      (active ? '<em class="active-badge">' + escape(l.active) + "</em>" : "") +
      (cardState.unavailable
        ? '<em class="playlist-state-tag playlist-state-unavailable">' +
          escape(l.playlistUnavailable) +
          "</em>"
        : "") +
      (cardState.saved
        ? '<em class="playlist-state-tag playlist-state-saved">' +
          escape(l.playlistSavedContent) +
          "</em>"
        : "") +
      '</span><span class="playlist-card-meta management-row-meta">' +
      (counts.length ? "<span>" + escape(counts.join(" · ")) + "</span>" : "") +
      accountStatus(playlist.account, l) +
      "</span></span>";
    var rowBusy = cardState.progress;
    return (
      '<article class="playlist-card"><div class="playlist-card-line management-row">' +
      '<button type="button" class="playlist-card-open management-row-primary" data-item-open="playlist" data-id="' +
      escape(playlist.id) +
      '" aria-label="' +
      escape(l.open + ", " + playlist.name) +
      '"' +
      (cardState.disabled ? " disabled" : "") +
      ">" +
      info +
      "</button>" +
      '<button type="button" class="playlist-row-op playlist-activate' +
      (active ? " is-active" : "") +
      '" data-action="playlist-activate" data-id="' +
      escape(playlist.id) +
      '" aria-pressed="' +
      String(active) +
      '" aria-label="' +
      escape(l.activate + ", " + playlist.name) +
      '"' +
      (rowBusy ? ' aria-disabled="true"' : "") +
      ">" +
      icon("check", "playlist-op-icon") +
      "</button>" +
      '<button type="button" class="playlist-card-menu management-row-actions" data-item-menu="playlist" data-id="' +
      escape(playlist.id) +
      '" aria-label="' +
      escape(l.actions + ", " + playlist.name) +
      '" aria-haspopup="menu" aria-expanded="' +
      String(!!(itemMenu && itemMenu.kind === "playlist" && itemMenu.id === playlist.id)) +
      '"><span class="playlist-card-more" aria-hidden="true">' +
      icon("more", "playlist-more-icon") +
      "</span></button></div></article>"
    );
  }

  function managementBackMarkup(l, href, disabled) {
    var name = ' aria-label="' + escape(l.lineupBack) + '" title="' + escape(l.lineupBack) + '"';
    if (href) {
      return '<a class="page-back" href="' + escape(href) + '" data-focus-key="playlists-back"' + name + '>' + icon("left", "page-back-icon") + '</a>';
    }
    return '<button type="button" class="page-back" data-lineup-mode-back' + name + (disabled ? ' disabled' : '') + '>' + icon("left", "page-back-icon") + '</button>';
  }

  function managementPageHead(title, context, headClass, count, backMarkup, actionsMarkup) {
    var heading =
      '<h1 dir="auto" data-lineup-heading tabindex="-1" title="' +
      escape(title) +
      '">' +
      escape(title) +
      "</h1>";
    if (count !== undefined && count !== null) {
      heading =
        '<div class="page-head-line">' +
        heading +
        '<span class="page-head-count">' +
        escape(String(count)) +
        "</span></div>";
    }
    return (
      '<header class="page-head' +
      (headClass ? " " + headClass : "") +
      '">' +
      (backMarkup || "") +
      '<div class="page-head-text">' +
      heading +
      (context ? '<span class="content-kind">' + escape(context) + "</span>" : "") +
      "</div>" +
      (actionsMarkup ? '<div class="page-head-actions">' + actionsMarkup + "</div>" : "") +
      "</header>"
    );
  }

  function closePlaylistSearch() {
    playlistSearchOpen = false;
    playlistQuery = "";
    playlistPage = 0;
    renderManage();
    var toggle = root.querySelector("[data-playlist-search-toggle]");
    if (toggle) toggle.focus();
  }

  function playlistsIndexMarkup(l) {
    var filtered = filteredPlaylists();
    var pageTotal = playlistPageCount();
    playlistPage = Math.max(0, Math.min(playlistPage, pageTotal - 1));
    var pageItems = filtered.slice(
      playlistPage * PLAYLIST_PAGE_SIZE,
      (playlistPage + 1) * PLAYLIST_PAGE_SIZE,
    );
    var cards = pageItems
      .map(function (playlist) { return playlistCardMarkup(playlist, l); })
      .join("");
    var listBody = cards;
    if (!filtered.length) {
      listBody =
        '<p class="muted playlist-empty">' +
        escape(playlistQuery.trim() ? l.lineupNoMatches : l.setupTitle) +
        "</p>";
    }
    var searchToggle =
      '<button type="button" class="lineup-icon-action' +
      (playlistQuery ? " active" : "") +
      '" data-playlist-search-toggle data-focus-key="playlist-search-toggle" aria-expanded="' +
      String(playlistSearchOpen) +
      '" aria-label="' +
      escape(l.searchPlaylists) +
      '" title="' +
      escape(l.searchPlaylists) +
      '">' +
      icon("search", "lineup-icon") +
      '<span class="lineup-toolbar-label">' +
      escape(l.lineupSearchToggle) +
      "</span></button>";
    var searchField = playlistSearchOpen
      ? '<label class="lineup-search"><span class="visually-hidden">' +
        escape(l.searchPlaylists) +
        "</span>" +
        icon("search", "lineup-search-icon") +
        '<input data-playlist-search type="search" name="playlistSearch" autocomplete="off" dir="auto" placeholder="' +
        escape(l.searchPlaylists) +
        '" aria-label="' +
        escape(l.searchPlaylists) +
        '" title="' +
        escape(l.searchPlaylists) +
        '" value="' +
        escape(playlistQuery) +
        '"></label>'
      : "";
    var pager =
      pageTotal > 1
        ? '<div class="playlist-pagination"><button type="button" class="quiet" data-playlist-page="prev" data-action="playlist-page" data-id="prev"' +
          (playlistPage <= 0 ? " disabled" : "") +
          ">" +
          escape(l.lineupPrevious) +
          '</button><span class="playlist-page-label">' +
          escape(
            l.lineupPage
              .replace("{current}", String(playlistPage + 1))
              .replace("{total}", String(pageTotal)),
          ) +
          "</span>" +
          '<button type="button" class="quiet" data-playlist-page="next" data-action="playlist-page" data-id="next"' +
          (playlistPage >= pageTotal - 1 ? " disabled" : "") +
          ">" +
          escape(l.lineupNext) +
          "</button></div>"
        : "";
    var addButton =
      '<button type="button" class="page-action secondary" data-action="open-add-playlist" aria-label="' +
      escape(l.addPlaylist) +
      '" title="' +
      escape(l.addPlaylist) +
      '">' +
      icon("plus") +
      '<span class="lineup-toolbar-label">' +
      escape(l.addPlaylist) +
      "</span></button>";
    return (
      '<section class="manage-page" data-page="playlists">' +
      managementPageHead(
        l.savedPlaylists,
        "",
        "",
        filtered.length,
        managementBackMarkup(l, "#playlists"),
        searchToggle + addButton,
      ) +
      searchField +
      '<div class="playlist-list">' +
      listBody +
      "</div>" +
      pager +
      "</section>"
    );
  }

  function playlistsLandingMarkup(l) {
    var active = playlistById(current.activePlaylistId);
    var sourceKind =
      active && active.source && active.source.kind === "xtream" ? "xtream" : "m3u";
    var modes = [];
    if (current.settings.showLive) modes.push("live");
    if (sourceKind === "xtream") {
      if (current.settings.showMovies) modes.push("movie");
      if (current.settings.showSeries) modes.push("series");
    }
    var sections = [
      ["showLive", "live", l.showLive, l.lineupLive],
      ["showMovies", "movie", l.showMovies, l.lineupMovies],
      ["showSeries", "series", l.showSeries, l.lineupSeries],
    ];
    var toggles = sections
      .map(function (section) {
        var key = section[0];
        var mode = section[1];
        var only = modes.length === 1 && modes[0] === mode;
        var hint = only
          ? l.keepSectionHint
          : mode !== "live" && sourceKind !== "xtream"
            ? l.sectionUnsupportedHint
            : l.sectionVisibilityHint.replace("{section}", section[3]);
        return (
          '<label class="setting content-setting"><span class="setting-text">' +
          escape(section[2]) +
          '<span class="setting-hint">' +
          escape(hint) +
          "</span></span>" +
          '<input type="checkbox" data-setting="' +
          key +
          '"' +
          (current.settings[key] ? " checked" : "") +
          (only ? " disabled" : "") +
          "></label>"
        );
      })
      .join("");
    var activeName = active ? " · " + active.name : "";
    return (
      '<section class="manage-page" data-page="content-settings">' +
      managementPageHead(l.content) +
      '<div class="settings-list">' +
      '<a class="content-manage management-row" href="#playlists/list" data-focus-key="manage-playlists">' +
      '<span class="content-manage-main"><span class="content-manage-title">' +
      escape(l.managePlaylists) +
      '</span><span class="content-manage-meta">' +
      escape(l.savedPlaylists) +
      " · " +
      escape(String(current.playlists.length)) +
      escape(activeName) +
      "</span></span>" +
      icon("right", "content-manage-chevron") +
      "</a>" +
      '<label class="setting content-setting"><span class="setting-text">' +
      escape(l.playlistShortcut) +
      '<span class="setting-hint">' +
      escape(l.playlistShortcutHint) +
      "</span></span>" +
      '<input type="checkbox" data-setting="playlistShortcut"' +
      (current.settings.playlistShortcut !== false ? " checked" : "") +
      "></label>" +
      '<label class="setting content-setting"><span class="setting-text">' +
      escape(l.hideEmptyCategories) +
      '<span class="setting-hint">' +
      escape(l.hideEmptyCategoriesHint) +
      "</span></span>" +
      '<input type="checkbox" data-setting="hideEmptyCategories"' +
      (current.settings.hideEmptyCategories ? " checked" : "") +
      "></label>" +
      toggles +
      "</div></section>"
    );
  }

  function playlistAddOverlayMarkup(l) {
    var ownBusy = entryOverlayBusy("playlist-add");
    var fieldOff = ownBusy ? ' disabled data-operation-disabled="true"' : "";
    var laneOff = busy || commandInFlight ? " disabled" : "";
    var sourceFields =
      addPlaylistSource === "m3u"
        ? '<label>' +
          escape(l.playlistAddress) +
          '<input name="newUrl" type="url" inputmode="url" dir="ltr" aria-label="' +
          escape(l.playlistAddress) +
          '" value="' +
          escape(addPlaylistDraft.url) +
          '"' +
          fieldOff +
          "></label>" +
          xtreamSuggestionMarkup(l, "new", addPlaylistDraft, addPlaylistDismissedXtream, fieldOff)
        : xtreamFields("new", addPlaylistDraft, l, fieldOff, true, true);
    return (
      '<div class="lineup-editor-overlay"><button type="button" class="lineup-editor-backdrop" data-playlist-add-dismiss tabindex="-1" aria-label="' +
      escape(l.close) +
      '"' +
      '></button><section class="lineup-editor-dialog playlist-add-dialog" role="dialog" aria-modal="true" aria-labelledby="playlist-add-title" tabindex="-1" data-form-overlay="playlist-add">' +
      '<div class="modal-head"><h3 id="playlist-add-title" dir="auto">' +
      escape(l.addPlaylist) +
      "</h3></div>" +
      '<form class="playlist-form credential-card lineup-editor" data-add-playlist-form data-return-action="add-playlist"><div class="lineup-editor-body">' +
      sourceOptions(addPlaylistSource, l, fieldOff) +
      '<div class="add-source-fields">' +
      sourceFields +
      "</div>" +
      '<label>' +
      escape(l.playlistName) +
      '<input name="newName" aria-label="' +
      escape(l.playlistName) +
      '" value="' +
      escape(addPlaylistDraft.name) +
      '"' +
      fieldOff +
      "></label>" +
      "</div>" +
      (playlistFormError
        ? '<p class="playlist-form-error" role="alert">' + escape(playlistFormError) + "</p>"
        : "") +
      '<div class="form-actions lineup-editor-footer"><button class="quiet" type="button" data-action="cancel-add-playlist">' +
      icon("close") +
      escape(l.cancel) +
      '</button><button type="submit" data-action="add-playlist"' +
      laneOff +
      (ownBusy ? ' aria-busy="true" aria-label="' + escape(l.saving) + '"' : "") +
      ">" +
      (ownBusy ? '<span class="form-spinner" aria-hidden="true"></span>' : icon("check")) +
      escape(l.save) +
      "</button></div></form></section></div>"
    );
  }

  function playlistEditOverlayMarkup(l, playlist) {
    var ownBusy = entryOverlayBusy("playlist-edit");
    var fieldOff = ownBusy ? ' disabled data-operation-disabled="true"' : "";
    var laneOff = busy || commandInFlight ? " disabled" : "";
    var editSourceFields =
      editingPlaylistSource === "m3u"
        ? '<label>' +
          escape(l.playlistAddress) +
          '<input name="editUrl" type="url" inputmode="url" dir="ltr" value="' +
          escape(editingPlaylistDraft.url) +
          '" required' +
          fieldOff +
          "></label>" +
          xtreamSuggestionMarkup(l, "edit", editingPlaylistDraft, editPlaylistDismissedXtream, fieldOff)
        : xtreamFields("edit", editingPlaylistDraft, l, fieldOff, true, true);
    return (
      '<div class="lineup-editor-overlay"><button type="button" class="lineup-editor-backdrop" data-playlist-edit-dismiss tabindex="-1" aria-label="' +
      escape(l.close) +
      '"></button><section class="lineup-editor-dialog playlist-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="playlist-edit-title" tabindex="-1" data-form-overlay="playlist-edit">' +
      '<div class="modal-head"><h3 id="playlist-edit-title" dir="auto">' +
      escape(editingPlaylistSource === "m3u" ? l.editAddress : l.editCredentials) +
      "</h3></div>" +
      '<p class="muted playlist-edit-name" dir="auto">' +
      escape(playlist.name) +
      "</p>" +
      '<form class="playlist-form credential-card lineup-editor" data-edit-playlist data-id="' +
      escape(playlist.id) +
      '"><div class="lineup-editor-body">' +
      sourceOptions(editingPlaylistSource, l, fieldOff) +
      '<div class="add-source-fields">' +
      editSourceFields +
      "</div>" +
      '<label>' +
      escape(l.playlistName) +
      '<input name="editName" value="' +
      escape(editingPlaylistDraft.name) +
      '"' +
      fieldOff +
      "></label>" +
      "</div>" +
      (playlistFormError
        ? '<p class="playlist-form-error" role="alert">' + escape(playlistFormError) + "</p>"
        : "") +
      '<div class="form-actions lineup-editor-footer"><button class="quiet" type="button" data-action="cancel-edit-playlist">' +
      icon("close") +
      escape(l.cancel) +
      '</button><button type="submit" data-action="save-playlist"' +
      laneOff +
      (ownBusy ? ' aria-busy="true" aria-label="' + escape(l.saving) + '"' : "") +
      ">" +
      (ownBusy ? '<span class="form-spinner" aria-hidden="true"></span>' : icon("check")) +
      escape(l.save) +
      "</button></div></form></section></div>"
    );
  }

  function contentKindLabel(kind, l) {
    return kind === "movie" ? l.lineupMovies : kind === "series" ? l.lineupSeries : l.lineupLive;
  }

  function contentHeadInfo(l, playlist) {
    var sorting = !!(lineup.reorder && lineup.sort);
    if (sorting) return l.lineupReorder;
    var contentActive = contentViewActive();
    var drilled = contentActive && lineupDrilled();
    var personal = contentActive && lineup.scope === "personal-categories";
    var customChild = drilled && !!(lineup.categoryPersonal || lineup.membershipCategory);
    if (personal) return l.lineupPersonalCategories;
    if (!drilled) return playlist ? playlist.name : l.manageContent;
    var addChannels = customChild && lineup.membershipCategory && !lineup.categoryKey;
    var leafFallback =
      lineup.scope === "items"
        ? contentKindLabel(lineup.categoryKind, l)
        : lineup.categoryKey && customChild
          ? l.lineupPersonalCategories
          : l.lineupChannels;
    return addChannels
      ? l.lineupAddMembership
      : lineup.categoryName || leafFallback;
  }

  function contentScopeLabel(l) {
    if (lineup.scope === "categories") return contentKindLabel(lineup.contentKind, l);
    if (lineup.scope === "channels") return lineup.categoryName || l.lineupChannels;
    if (lineup.scope === "items") return contentKindLabel(lineup.categoryKind, l);
    if (lineup.scope === "personal-categories") return l.lineupPersonalCategories;
    return "";
  }

  function contentCrumbSectionLabel(l) {
    var kind = "";
    if (lineup.scope === "categories") kind = lineup.contentKind;
    else if (lineup.scope === "channels" || lineup.scope === "items") {
      kind = lineup.categoryKind;
    } else if (lineup.scope === "personal-categories") {
      return l.lineupPersonalCategories;
    }
    if (!kind) return "";
    return l.lineupContentManagement.replace("{kind}", contentKindLabel(kind, l));
  }

  function contentCrumbsMarkup(l, playlist) {
    var atRoot = lineup.scope === "categories";
    var customChild =
      lineupDrilled() && !!(lineup.categoryPersonal || lineup.membershipCategory);
    var sectionLabel = contentCrumbSectionLabel(l);
    var crumbs = ['<a class="crumb" href="#playlists/list">' + escape(l.playlists) + "</a>"];
    if (atRoot) {
      crumbs.push(
        '<span class="crumb-scope" dir="auto">' + escape(playlist.name) + "</span>",
      );
    } else {
      var rootKind =
        lineup.scope !== "categories" && lineup.categoryKind
          ? lineup.categoryKind
          : lineup.contentKind;
      crumbs.push(
        '<a class="crumb" href="' +
          contentRouteHash(playlist.id, { scope: "categories", contentKind: rootKind }) +
          '">' +
          escape(playlist.name) +
          "</a>",
      );
    }
    if (sectionLabel) {
      crumbs.push(
        '<span class="crumb-scope" dir="auto">' + escape(sectionLabel) + "</span>",
      );
    }
    if (!atRoot && customChild) {
      crumbs.push(
        '<a class="crumb" href="' +
          contentRouteHash(playlist.id, {
            scope: "personal-categories",
            contentKind: "live",
          }) +
          '">' +
          escape(l.lineupPersonalCategories) +
          "</a>",
      );
    }
    if (lineupDrilled()) {
      var categoryLabel = lineup.categoryName || contentScopeLabel(l);
      if (categoryLabel) {
        crumbs.push(
          '<span class="crumb-scope" dir="auto">' + escape(categoryLabel) + "</span>",
        );
      }
    }
    return (
      '<nav class="crumbs" aria-label="' +
      escape(l.breadcrumbs) +
      '">' +
      crumbs.join('<span class="crumb-sep" aria-hidden="true">/</span>') +
      "</nav>"
    );
  }

  function playlistContentMarkup(l, playlist) {
    var contentActive = contentViewActive();
    var contentState = renderLineup();
    var info = contentHeadInfo(l, playlist);
    var sorting =
      contentActive && !!(lineup.reorder && lineup.sort);
    var contentRoot =
      contentActive && !lineupDrilled() && lineup.scope !== "personal-categories" && !sorting;
    return (
      '<section class="manage-page manage-content" data-page="content">' +
      contentCrumbsMarkup(l, playlist) +
      managementPageHead(
        info,
        contentRoot
          ? l.lineupManageContentHint
          : lineup.scope === "personal-categories"
            ? l.lineupManageContentHint
            : contentCrumbSectionLabel(l),
        "content-head",
        sorting && lineup.loaded ? lineup.total : undefined,
        managementBackMarkup(
          l,
          "",
          managementWriteBlocked() ||
            commandInFlight ||
            !!(lineup.editor || lineup.orderDialog || itemMenu),
        ),
      ) +
      contentState +
      "</section>"
    );
  }

  function settingsPageMarkup(l, page) {
    var title = page === "appearance" ? l.appearance : l.playback;
    var body =
      page === "appearance"
        ? settingSelect("locale", l.language, (current.localeOptions || []).map(function (option) { return [option.id, option.label, option.secondary]; })) +
          settingSelect("fontSizeId", l.textSize, [["s", l.small], ["m", l.medium], ["l", l.large], ["xl", l.extraLarge]]) +
          settingToggle("showNumbers", l.showNumbers) + settingToggle("showLogos", l.showLogos) +
          settingToggle("showClock", l.showClock)
        : settingSelect("aspectId", l.screenFit, [["fill", l.fill], ["fit", l.fit], ["stretch", l.stretch]]) +
          settingToggle("resumeLast", l.resumeLast) + settingToggle("compatibility", l.compatibility) +
          settingToggle("showPlaybackStats", l.playbackInfo) +
          settingToggle("continuousReconnect", l.continuousReconnect);
    return (
      '<section class="manage-page" data-page="' +
      page +
      '">' +
      managementPageHead(title) +
      '<div class="settings-list">' +
      body +
      "</div></section>"
    );
  }

  function deviceEditOverlayMarkup(l, device) {
    var editBusy = entryOverlayBusy("device-edit");
    var fieldOff = editBusy ? ' disabled data-operation-disabled="true"' : "";
    var laneOff = busy || commandInFlight ? " disabled" : "";
    return (
      '<div class="lineup-editor-overlay"><button type="button" class="lineup-editor-backdrop" data-device-edit-dismiss tabindex="-1" aria-label="' +
      escape(l.close) +
      '"></button><section class="lineup-editor-dialog device-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="device-edit-title" tabindex="-1" data-form-overlay="device-edit">' +
      '<div class="modal-head"><h3 id="device-edit-title" dir="auto">' +
      escape(l.rename) +
      "</h3></div>" +
      '<form class="lineup-editor" data-edit-device data-id="' +
      escape(device.id) +
      '"><div class="lineup-editor-body"><label>' +
      escape(l.deviceName) +
      '<input name="editDeviceName" value="' +
      escape(editingDeviceDraft) +
      '" required' +
      fieldOff +
      '></label></div><div class="form-actions lineup-editor-footer"><button class="quiet" type="button" data-action="cancel-edit-device"' +
      ">" +
      icon("close") +
      escape(l.cancel) +
      '</button><button type="submit"' +
      laneOff +
      (editBusy ? ' aria-busy="true" aria-label="' + escape(l.saving) + '"' : "") +
      ">" +
      (editBusy ? '<span class="form-spinner" aria-hidden="true"></span>' : icon("check")) +
      escape(l.save) +
      "</button></div></form></section></div>"
    );
  }

  function devicesMarkup(l) {
    var rows = current.devices.length
      ? current.devices
          .map(function (device) {
            var lastUsed = device.lastUsedAt
              ? l.lastUsed.replace(
                  "{when}",
                  new Date(device.lastUsedAt).toLocaleDateString(current.locale),
                )
              : "";
            return (
              '<article class="device-card"><div class="device-card-line management-row">' +
              '<button type="button" class="device-card-main management-row-primary" data-action="device-rename" data-id="' +
              escape(device.id) +
              '" aria-label="' +
              escape(l.rename + ", " + device.name) +
              '"><span class="device-card-info"><span class="device-card-heading"><strong dir="auto">' +
              escape(device.name) +
              "</strong>" +
              (auth && device.id === auth.deviceId
                ? '<em class="self-badge">' + escape(l.thisDevice) + "</em>"
                : "") +
              "</span>" +
              (lastUsed
                ? '<span class="device-last-used management-row-meta">' +
                  escape(lastUsed) +
                  "</span>"
                : "") +
              "</span></button>" +
              '<button type="button" class="device-row-op device-remove management-row-actions danger" data-action="device-remove" data-id="' +
              escape(device.id) +
              '" aria-label="' +
              escape(l.revoke + ", " + device.name) +
              '">' +
              icon("remove", "device-op-icon") +
              "</button></div></article>"
            );
          })
          .join("")
      : '<p class="muted">' + escape(l.noDevices) + "</p>";
    var editingDeviceEntry = deviceById(editingDevice);
    return (
      '<section class="manage-page" data-page="devices">' +
      managementPageHead(l.devices) +
      listHeadMarkup(l.pairedDevices, current.devices.length) +
      '<div class="device-list">' +
      rows +
      "</div></section>" +
      (editingDeviceEntry ? deviceEditOverlayMarkup(l, editingDeviceEntry) : "")
    );
  }

  function aboutMarkup(l) {
    return (
      '<section class="manage-page" data-page="about">' +
      managementPageHead(l.about) +
      '<div class="about-card"><div class="about-brand"><img src="/icon.svg" alt=""><div><strong>OpenIPTV</strong><span>' +
      escape(l.aboutVersion) +
      '</span></div></div><a class="repository-link" dir="ltr" href="' +
      escape(current.about.repository) +
      '" target="_blank" rel="noopener noreferrer" data-focus-key="repository">GitHub</a><p>' +
      escape(l.aboutDescription) +
      '</p><p class="muted">' +
      escape(l.aboutDisclaimer) +
      '</p></div><div class="about-data"><h2>' +
      escape(l.applicationData) +
      '</h2><div class="setting about-data-row"><span>' +
      escape(l.cache) +
      '</span><button class="secondary about-action" type="button" data-action="clear-cache" data-focus-key="about-clear-cache">' +
      icon("refresh", "about-action-icon") +
      escape(l.clear) +
      '</button></div><div class="setting about-data-row"><span>' +
      escape(l.resetData) +
      '</span><button class="secondary about-action about-action-danger" type="button" data-action="reset-app-data" data-focus-key="about-reset-data">' +
      icon("remove", "about-action-icon") +
      escape(l.resetData) +
      "</button></div></div></section>"
    );
  }

  function playlistsMarkup(l) {
    if (manageView.sub === "add") {
      return playlistsIndexMarkup(l) + playlistAddOverlayMarkup(l);
    }
    if (manageView.sub === "edit") {
      var editPlaylist = playlistById(manageView.subId);
      if (editPlaylist) {
        return playlistsIndexMarkup(l) + playlistEditOverlayMarkup(l, editPlaylist);
      }
    }
    if (manageView.sub === "content") {
      var contentPlaylist = playlistById(contentPlaylistId);
      if (contentPlaylist) return playlistContentMarkup(l, contentPlaylist);
    }
    if (manageView.sub === "list") return playlistsIndexMarkup(l);
    if (manageView.sub === "") return playlistsLandingMarkup(l);
    return playlistsIndexMarkup(l);
  }

  function managePageMarkup(l) {
    if (manageView.page === "appearance") return settingsPageMarkup(l, "appearance");
    if (manageView.page === "playback") return settingsPageMarkup(l, "playback");
    if (manageView.page === "devices") return devicesMarkup(l);
    if (manageView.page === "about") return aboutMarkup(l);
    return playlistsMarkup(l);
  }

  function managementShellMarkup(l) {
    return (
      '<div class="manage"><header class="manage-top"><button type="button" class="manage-menu" data-action="open-nav" aria-label="' +
      escape(l.menu) +
      '">' +
      icon("menu") +
      '</button><div class="manage-brand">' +
      '<img class="brand-mark" src="/icon.svg" alt=""><strong>' +
      escape(l.title) +
      '</strong></div><div class="manage-top-actions">' +
      remoteLauncherMarkup(l) +
      "</div></header>" +
      '<div class="manage-body">' +
      '<nav class="manage-rail" aria-label="' +
      escape(l.manageNav) +
      '">' +
      managementNavMarkup(l) +
      "</nav>" +
      '<main class="manage-main" id="manage-main">' +
      managePageMarkup(l) +
      itemMenuMarkup(l) +
      managementConfirmationMarkup(l) +
      "</main></div>" +
      '<dialog class="manage-drawer" data-nav-drawer aria-label="' +
      escape(l.menu) +
      '"><div class="manage-drawer-head"><strong>' +
      escape(l.title) +
      '</strong><button type="button" class="manage-drawer-close" data-action="close-nav" aria-label="' +
      escape(l.close) +
      '">' +
      icon("close") +
      "</button></div>" +
      managementNavMarkup(l) +
      "</dialog>" +
      remoteOverlayMarkup(l) +
      "</div>"
    );
  }

  function restoreBrowseLineupFocus() {
    if (activeLineupDialog() || lineup.reorder || lineup.sort || lineup.mutating) return;
    var active = document.activeElement;
    if (active && active !== document.body && root.contains(active)) return;
    var first = !lineup.loading && root.querySelector("[data-item-menu]");
    if (first && !first.disabled && first.getAttribute("aria-disabled") !== "true") {
      first.focus();
      return;
    }
    var heading = root.querySelector("[data-lineup-heading]");
    if (heading && !heading.disabled && heading.getAttribute("aria-disabled") !== "true") {
      heading.focus({ preventScroll: true });
    }
  }

  var lineupTabInkObserver = null;
  var lineupTabInkTargets = null;
  var lineupTabInkFrame = null;

  function measureLineupTabInk() {
    var targets = lineupTabInkTargets;
    if (!targets) return;
    var stripRect = targets.strip.getBoundingClientRect();
    var labelRect = targets.label.getBoundingClientRect();
    var horizontal = getComputedStyle(targets.strip).flexDirection === "row";
    targets.strip.setAttribute("aria-orientation", horizontal ? "horizontal" : "vertical");
    if (horizontal) {
      targets.ink.style.transform = "translateX(" + (labelRect.left - stripRect.left - 2) + "px)";
      targets.ink.style.width = labelRect.width + 4 + "px";
      targets.ink.style.height = "3px";
    } else {
      targets.ink.style.transform =
        "translateY(" +
        (labelRect.top - stripRect.top + targets.strip.scrollTop - 2) +
        "px)";
      targets.ink.style.height = labelRect.height + 4 + "px";
      targets.ink.style.width = "3px";
    }
  }

  function syncLineupTabInk(retained) {
    lineupTabInkTargets = null;
    var strip = root.querySelector(".lineup-tabs");
    var placeholder = root.querySelector("[data-lineup-tab-ink]");
    if (!strip || !placeholder) return;
    var ink = placeholder;
    var reused = false;
    if (
      retained &&
      retained.getAttribute("data-lineup-tab-ink") ===
        placeholder.getAttribute("data-lineup-tab-ink")
    ) {
      placeholder.replaceWith(retained);
      ink = retained;
      reused = true;
      ink.getBoundingClientRect();
    }
    var label =
      strip.querySelector('[role="tab"][aria-selected="true"] .lineup-tab-text') ||
      strip.querySelector('[role="tab"][aria-selected="true"]');
    if (!label) return;
    var targets = { strip: strip, label: label, ink: ink };
    lineupTabInkTargets = targets;
    function commit() {
      if (lineupTabInkTargets !== targets || !targets.ink.isConnected) return;
      measureLineupTabInk();
      if (!lineupTabInkObserver) {
        lineupTabInkObserver = new ResizeObserver(measureLineupTabInk);
      }
      lineupTabInkObserver.observe(targets.strip);
      lineupTabInkObserver.observe(targets.label);
    }
    if (!reused) {
      commit();
      return;
    }
    lineupTabInkFrame = requestAnimationFrame(function () {
      lineupTabInkFrame = null;
      commit();
    });
  }

  function renderManage(message, failed, keepBusy) {
    if (!managementActive) return;
    var l = labels();
    applyLocale();
    captureLineupFocus();
    capturePlaylistFormDrafts();
    sanitizeManageView();
    var restoreBrowse = pendingLineupBrowseRestore;
    pendingLineupBrowseRestore = null;
    var retainBusy = !!(keepBusy && busy);
    var optionPickerSnapshot = captureOptionPicker();
    var keepToast = !!(
      toastOwner &&
      toastOwner.auth === auth &&
      toastOwner.view === managementToastView()
    );
    resetRender(retainBusy, keepToast);
    var tabInk = root.querySelector("[data-lineup-tab-ink]");
    root.innerHTML = managementShellMarkup(l);
    renderedPlaylistFormEpoch = playlistFormEpoch;
    document.documentElement.classList.toggle("lineup-reordering", !!lineup.reorder);
    bindManagement();
    bindOptionPickers();
    syncLineupTabInk(tabInk);
    restoreBrowseLineupFocus();
    applyManagementViewAnimation();
    if (retainBusy) {
      disableOperationScope();
      if (foregroundOperationMessage) {
        operationStatus(foregroundOperationMessage, false, true);
      }
    } else if (message) {
      operationStatus(message, failed, false);
    }
    restoreOptionPicker(optionPickerSnapshot, retainBusy);
    if (restoreBrowse) restoreBrowse();
  }

  function commandId() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  function focusDescriptor(source) {
    if (!source) return null;
    return {
      action: source.dataset && (source.dataset.returnAction || source.dataset.action),
      lineupAction: source.dataset && source.dataset.lineupAction,
      lineupScope: source.dataset && source.dataset.lineupScope,
      lineupSort: source.hasAttribute && source.hasAttribute("data-lineup-sort"),
      lineupPreference:
        source.hasAttribute && source.hasAttribute("data-lineup-preference")
          ? source.dataset.lineupPreference
          : "",
      lineupOrderOption:
        source.hasAttribute && source.hasAttribute("data-lineup-order-option")
          ? source.dataset.lineupOrderOption
          : "",
      lineupBulk:
        source.hasAttribute && source.hasAttribute("data-lineup-bulk")
          ? source.dataset.lineupBulk
          : "",
      itemMenu: source.hasAttribute && source.hasAttribute("data-item-menu")
        ? source.dataset.itemMenu
        : "",
      itemOpen: source.hasAttribute && source.hasAttribute("data-item-open")
        ? source.dataset.itemOpen
        : "",
      lineupEdit:
        source.hasAttribute && source.hasAttribute("data-lineup-edit"),
      lineupVisibility:
        source.hasAttribute && source.hasAttribute("data-lineup-visibility"),
      lineupRemove:
        source.hasAttribute && source.hasAttribute("data-lineup-remove"),
      lineupModeBack:
        source.hasAttribute && source.hasAttribute("data-lineup-mode-back"),
      id: source.dataset && source.dataset.id,
      setting: source.dataset && source.dataset.setting,
      focusKey: source.dataset && source.dataset.focusKey,
      name: source.name,
    };
  }

  function findFocusControl(target) {
    if (!target) return null;
    var controls = Array.from(
      root.querySelectorAll("button, input, select:not([data-picker-native]), a[href]"),
    );
    return (
      controls.find(function (item) {
        if (target.focusKey) {
          return (
            item.hasAttribute("data-focus-key") &&
            item.dataset.focusKey === target.focusKey
          );
        }
        if (target.setting) {
          return (
            item.dataset.setting === target.setting ||
            item.dataset.pickerSetting === target.setting
          );
        }
        if (target.lineupAction) {
          return item.dataset.lineupAction === target.lineupAction && (!target.id || item.dataset.id === target.id);
        }
        if (target.lineupScope) return item.dataset.lineupScope === target.lineupScope;
        if (target.lineupSort) {
          return item.hasAttribute("data-lineup-sort") && (!target.id || item.dataset.id === target.id);
        }
        if (target.lineupPreference) {
          return (
            item.hasAttribute("data-lineup-preference") &&
            item.dataset.lineupPreference === target.lineupPreference
          );
        }
        if (target.lineupOrderOption) {
          return (
            item.hasAttribute("data-lineup-order-option") &&
            item.dataset.lineupOrderOption === target.lineupOrderOption
          );
        }
        if (target.lineupBulk) {
          return (
            item.hasAttribute("data-lineup-bulk") &&
            item.dataset.lineupBulk === target.lineupBulk
          );
        }
        if (target.lineupEdit) {
          return (
            item.hasAttribute("data-lineup-edit") &&
            (!target.id || item.dataset.id === target.id)
          );
        }
        if (target.lineupVisibility) {
          return (
            item.hasAttribute("data-lineup-visibility") &&
            (!target.id || item.dataset.id === target.id)
          );
        }
        if (target.lineupRemove) {
          return (
            item.hasAttribute("data-lineup-remove") &&
            (!target.id || item.dataset.id === target.id)
          );
        }
        if (target.lineupModeBack) {
          return item.hasAttribute("data-lineup-mode-back");
        }
        if (target.itemMenu) {
          return (
            item.hasAttribute("data-item-menu") &&
            item.dataset.itemMenu === target.itemMenu &&
            (!target.id || item.dataset.id === target.id)
          );
        }
        if (target.itemOpen) {
          return (
            item.hasAttribute("data-item-open") &&
            item.dataset.itemOpen === target.itemOpen &&
            (!target.id || item.dataset.id === target.id)
          );
        }
        if (target.action) return item.dataset.action === target.action && (!target.id || item.dataset.id === target.id);
        return (
          (target.name && item.name === target.name) ||
          (target.name && item.dataset.pickerName === target.name)
        );
      }) || null
    );
  }

  function restoreFocus(target) {
    if (!target) return;
    var control = findFocusControl(target);
    if (
      control &&
      control.matches(".lineup-compact-menu") &&
      getComputedStyle(control).display === "none"
    ) {
      var row = control.closest(".lineup-row");
      var primary = row && row.querySelector('[data-item-open="lineup"]');
      if (primary) control = primary;
    }
    if (!control) {
      if (target.lineupEdit || target.lineupVisibility || target.lineupRemove) {
        control =
          root.querySelector("#lineup .lineup-list .lineup-row-op") ||
          root.querySelector("#lineup .lineup-list .lineup-row-open") ||
          root.querySelector("#lineup .lineup-list [tabindex='0']") ||
          root.querySelector("[data-lineup-search-toggle]") ||
          root.querySelector("[data-lineup-heading]");
      }
      if (!control) return;
    }
    var dialog = activeLineupDialog();
    if (
      control.disabled ||
      control.getAttribute("aria-disabled") === "true" ||
      (dialog && !dialog.contains(control))
    ) return;
    var closed = control.closest("details:not([open])");
    while (closed) {
      closed.open = true;
      closed = closed.parentElement ? closed.parentElement.closest("details:not([open])") : null;
    }
    control.focus();
  }

  function captureCurrentFocus() {
    var active = document.activeElement;
    if (!active || active === document.body || !root.contains(active)) return null;
    var selection = null;
    if (
      (active.tagName === "INPUT" || active.tagName === "TEXTAREA") &&
      active.selectionStart !== null &&
      active.selectionEnd !== null
    ) {
      selection = {
        start: active.selectionStart,
        end: active.selectionEnd,
        direction: active.selectionDirection,
      };
    }
    return {
      route: routeHashFor(currentRoute()),
      target: focusDescriptor(active),
      selection: selection,
    };
  }

  function restoreCapturedFocus(captured) {
    if (!captured || !captured.target) return;
    if (routeHashFor(currentRoute()) !== captured.route) return;
    var control = findFocusControl(captured.target);
    if (!control || control.disabled) return;
    control.focus();
    if (
      captured.selection &&
      (control.tagName === "INPUT" || control.tagName === "TEXTAREA") &&
      control.selectionStart !== null &&
      control.selectionEnd !== null
    ) {
      control.setSelectionRange(
        captured.selection.start,
        captured.selection.end,
        captured.selection.direction,
      );
    }
  }

  function enqueueRemoteCommand(action) {
    var result = remoteCommandLane.then(action, action);
    remoteCommandLane = result.then(function () {}, function () {});
    return result;
  }

  function adoptRemoteSnapshot(snapshot) {
    if (!snapshot) return;
    if (
      current &&
      typeof current.revision === "number" &&
      typeof snapshot.revision === "number" &&
      snapshot.revision < current.revision
    ) {
      return;
    }
    current = snapshot;
    playlistRowOperations.forEach(function (token, id) {
      var playlist = playlistById(id);
      if (!playlist || playlistRowSourceVersion(playlist) !== token.sourceVersion) {
        if (token.noticeId != null) clearNotification(token.noticeId);
        playlistRowOperations.delete(id);
      }
    });
  }

  function commandFailure(reason, setup) {
    var l = labels();
    if (reason === "invalid") return l.invalidUrl;
    if (setup && reason === "failed") return l.setupLoadFailed;
    return l.changeFailed;
  }

  function commandFeedback(response) {
    var body = response && response.body ? response.body : {};
    if (
      typeof body.message === "string" &&
      body.message.trim() &&
      body.message.length <= 512
    ) {
      return body.message;
    }
    return "";
  }

  function commandMessage(response, setup) {
    return commandFeedback(response) ||
      commandFailure(response && response.body && response.body.reason, setup);
  }

  function captureCommandOwner() {
    return {
      auth: auth,
      view: managementToastView(),
      setup: !managementActive,
      epoch: playlistFormEpoch,
    };
  }

  function commandOwnerCurrent(owner) {
    return (
      auth === owner.auth &&
      owner.epoch === playlistFormEpoch &&
      owner.setup === !managementActive &&
      owner.view === managementToastView()
    );
  }

  async function sendCommand(command, setup, source, started, onComplete) {
    if (
      !setup &&
      command &&
      (command.type === "playlist.activate" || command.type === "playlist.refresh")
    ) {
      return sendPlaylistRowCommand(command, source);
    }
    var returnFocus = focusDescriptor(source);
    if (commandInFlight) return false;
    if (!started && busy) return false;
    var acceptedAuth = auth;
    var owner = started && operationOwner ? operationOwner : captureCommandOwner();
    if (
      !started &&
      !beginOperation(
        setup ? labels().checkingPlaylist : labels().saving,
        source,
        false,
        owner,
      )
    ) {
      return false;
    }
    commandInFlight = true;
    try {
      return await enqueueRemoteCommand(function () {
        if (auth !== acceptedAuth || !current || !commandOwnerCurrent(owner)) {
          return false;
        }
        return performRemoteCommand(command, setup, returnFocus, owner, onComplete);
      });
    } finally {
      commandInFlight = false;
      if (operationOwner === owner) releaseOperation(owner);
      syncEntrySaveAvailability();
    }
  }

  async function requestRemoteCommand(command, failureScope) {
    var response = await request(
      "/api/v1/command",
      {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({
          id: commandId(),
          revision: current.revision,
          command: command,
        }),
      },
      failureScope,
    );
    if (response && response.body && response.body.snapshot) {
      adoptRemoteSnapshot(response.body.snapshot);
    }
    return response;
  }

  function enterEmptyPlaylistsSetup(message) {
    var enteringSource = current.setup && current.setup.source;
    setupDraft = Object.assign({}, setupDraft, {
      locale: current.settings.locale,
      name: current.setup?.name ?? "",
      url: enteringSource && enteringSource.kind === "m3u" ? enteringSource.url : "",
      server: enteringSource && enteringSource.kind === "xtream" ? enteringSource.server : "",
      username:
        enteringSource && enteringSource.kind === "xtream" ? enteringSource.username : "",
      password: "",
      output:
        enteringSource && enteringSource.kind === "xtream"
          ? enteringSource.output
          : "m3u8",
    });
    renderSetup(message || "", true);
  }

  async function performRemoteCommand(command, setup, returnFocus, owner, onComplete) {
    var previousPlaylist = current && current.playlists
      ? current.playlists.find(function (playlist) {
          return playlist.id === command.id;
        })
      : null;
    var loadsPlaylist =
      command.type === "playlist.activate" ||
      command.type === "playlist.refresh" ||
      (command.type === "playlist.remove" && current && command.id === current.activePlaylistId) ||
      (command.type === "playlist.update" &&
        current &&
        command.id === current.activePlaylistId &&
        previousPlaylist &&
        JSON.stringify(previousPlaylist.source) !== JSON.stringify(command.source));
    var response = await requestRemoteCommand(command, "operation");
    if (!response) return false;
    if (!commandOwnerCurrent(owner)) return false;
    if (response.status === 409) {
      if (setup) renderSetup(labels().conflict, false);
      else renderManage(labels().conflict, true);
      restoreFocus(returnFocus);
      return false;
    }
    if (response.status !== 200) {
      var failed = commandMessage(response, setup);
      if (
        command.id &&
        (command.type === "playlist.refresh" ||
          command.type === "playlist.activate")
      ) {
        recordPlaylistError(command.id, failed);
      }
      if (setup) renderSetup(failed, false);
      else renderManage(failed, true);
      restoreFocus(returnFocus);
      return false;
    }
    if (response.body && response.body.cancelled === true) {
      releaseOperation(owner);
      return false;
    }
    var feedback = {
      message: commandFeedback(response) || (command.type === "setting" ? labels().saved : ""),
      failed: false,
    };
    if (command.type === "setting" && command.key !== "locale") {
      if (managementActive) {
        renderManage(feedback.message, false);
        if (onComplete) onComplete(feedback);
        restoreFocus(returnFocus);
        return true;
      }
      finishOperation(feedback.message, false);
      if (onComplete) onComplete(feedback);
      restoreFocus(returnFocus);
      return true;
    }
    if (command.type === "device.revoke" && auth && command.id === auth.deviceId) {
      saveAuth(null);
      renderPair(labels().revoked);
      return true;
    }
    if (!current.playlists.length) {
      if (setup) {
        renderSetup(current.operation.error || labels().setupLoadFailed, false);
      } else {
        enterEmptyPlaylistsSetup(feedback.message);
      }
    } else if (setup && current.operation && current.operation.error) {
      managementActive = true;
      var savedHash = window.location.hash || "#playlists";
      lastRouteHash = savedHash;
      applyParsedRoute(parseManagementHash(savedHash), savedHash);
      canonicalizeManagementRoute(savedHash);
      feedback = { message: current.operation.error, failed: true };
      renderManage(feedback.message, true);
    } else if (
      loadsPlaylist &&
      current.operation &&
      current.operation.error &&
      (command.type === "playlist.remove" ||
        command.id === current.activePlaylistId)
    ) {
      if (command.id && command.type !== "playlist.remove") {
        recordPlaylistError(command.id, current.operation.error);
      }
      feedback = { message: current.operation.error, failed: true };
      renderManage(feedback.message, true);
    } else if (setup) {
      var donePlaylist = current.playlists.find(function (playlist) {
        return playlist.id === current.activePlaylistId;
      });
      var emptyDone = !!(donePlaylist && donePlaylist.channelCount === 0);
      renderSetupResult(
        true,
        labels().setupCompleteTitle,
        emptyDone
          ? labels().setupSavedEmpty.replace("{name}", donePlaylist.name)
          : labels().setupCompleteBody,
      );
    } else {
      if (command.id) clearPlaylistError(command.id);
      renderManage(feedback.message, false);
    }
    if (onComplete) onComplete(feedback);
    restoreFocus(returnFocus);
    return true;
  }

  function playlistRowSourceVersion(playlist) {
    return playlist && typeof playlist.sourceVersion === "number"
      ? playlist.sourceVersion
      : null;
  }

  function sendPlaylistRowCommand(command, source) {
    if (!current || busy || commandInFlight) return Promise.resolve(false);
    var playlist = playlistById(command.id);
    if (!playlist) return Promise.resolve(false);
    if (playlistRowProgress(playlist)) return Promise.resolve(false);
    if (
      command.type === "playlist.activate" &&
      playlist.id === current.activePlaylistId
    ) {
      return Promise.resolve(false);
    }
    var token = {
      auth: auth,
      playlistId: command.id,
      sourceVersion: playlistRowSourceVersion(playlist),
      command: command.type,
      route: routeHashFor(currentRoute()),
    };
    if (command.type === "playlist.refresh") {
      token.noticeId = showNotification(labels().refreshing + " " + playlist.name, "loading", token);
    }
    playlistRowOperations.set(command.id, token);
    var rowFocus = captureCurrentFocus();
    renderManage();
    restoreCapturedFocus(rowFocus);
    return enqueueRemoteCommand(function () {
      var done = function (outcome) {
        if (playlistRowOperations.get(token.playlistId) === token) {
          playlistRowOperations.delete(token.playlistId);
        }
        renderPlaylistRowCompletion(token, outcome);
        return outcome.ok;
      };
      return performPlaylistRowCommand(token, command).then(done, function () {
        return done({ ok: false, suppressed: true });
      });
    });
  }

  async function performPlaylistRowCommand(token, command) {
    if (auth !== token.auth || !current) {
      return { ok: false, suppressed: true };
    }
    var playlist = playlistById(token.playlistId);
    if (
      !playlist ||
      playlistRowSourceVersion(playlist) !== token.sourceVersion
    ) {
      return { ok: false, suppressed: true };
    }
    var response = await requestRemoteCommand(command, "operation");
    if (!response) return { ok: false, message: labels().changeFailed, failed: true };
    reconcileLineupSource();
    var currentPlaylist = playlistById(token.playlistId);
    var sourceIntact = !!(
      currentPlaylist &&
      playlistRowSourceVersion(currentPlaylist) === token.sourceVersion
    );
    if (!sourceIntact) {
      return { ok: false, suppressed: true };
    }
    if (response.status === 409) {
      recordPlaylistError(token.playlistId, labels().conflict);
      return { ok: false, message: labels().conflict, failed: true };
    }
    if (response.status !== 200) {
      var failed = commandMessage(response, false);
      recordPlaylistError(token.playlistId, failed);
      return { ok: false, message: failed, failed: true };
    }
    if (response.body && response.body.cancelled === true) {
      return { ok: false };
    }
    if (
      command.id === current.activePlaylistId &&
      current.operation &&
      current.operation.error
    ) {
      var activeError = current.operation.error;
      recordPlaylistError(token.playlistId, activeError);
      return { ok: false, message: activeError, failed: true };
    }
    clearPlaylistError(token.playlistId);
    return { ok: true, message: commandFeedback(response) };
  }

  function renderPlaylistRowCompletion(token, outcome) {
    if (token.auth !== auth) {
      if (token.noticeId != null) clearNotification(token.noticeId);
      return;
    }
    var captured = captureCurrentFocus();
    var route = routeHashFor(currentRoute());
    var obsolete = !outcome || outcome.suppressed || route !== token.route;
    if (token.noticeId != null) {
      resolveNotification(token.noticeId, obsolete ? "" : outcome.message, outcome && outcome.failed ? "error" : "success");
    }
    renderManage(
      token.noticeId != null || obsolete || !outcome.message ? "" : outcome.message,
      outcome ? outcome.failed : false,
      true,
    );
    restoreCapturedFocus(captured);
  }

  function sendConfirmedCommand(command) {
    var prompt = managementConfirmation;
    return enqueueRemoteCommand(function () {
      if (
        !prompt ||
        managementConfirmation !== prompt ||
        auth !== prompt.auth ||
        !prompt.isCurrent()
      ) {
        return { ok: false, error: labels().changeFailed };
      }
      return performConfirmedCommand(command, prompt.auth);
    });
  }

  async function performConfirmedCommand(command, acceptedAuth) {
    var l = labels();
    var removingActive =
      command.type === "playlist.remove" &&
      !!(current && command.id === current.activePlaylistId);
    var response = await requestRemoteCommand(command, "confirmation");
    if (auth !== acceptedAuth) {
      return { ok: false, error: l.changeFailed };
    }
    if (command.type === "app.reset") {
      if (response && response.status === 200) {
        managementConfirmation = null;
        saveAuth(null);
        invalidateLineupWriteQueues();
        playlistRowOperations.clear();
        itemMenu = null;
        itemMenuReturn = null;
        itemMenuSource = null;
        resetPlaylistContent();
        renderPair(commandFeedback(response) || l.resetDone);
        return { ok: true };
      }
      return {
        ok: false,
        error: response ? commandMessage(response, false) : l.changeFailed,
      };
    }
    if (!response) return { ok: false, error: l.changeFailed };
    if (response.status === 409) return { ok: false, error: l.conflict };
    if (response.status !== 200) {
      return {
        ok: false,
        error: commandMessage(response, false),
      };
    }
    if (command.type === "device.revoke" && auth && command.id === auth.deviceId) {
      managementConfirmation = null;
      saveAuth(null);
      invalidateLineupWriteQueues();
      playlistRowOperations.clear();
      resetPlaylistContent();
      renderPair(l.revoked);
      return { ok: true };
    }
    if (command.type === "playlist.remove") {
      if (editingPlaylist === command.id) editingPlaylist = "";
      if (contentPlaylistId === command.id) clearPlaylistSubViews();
      if (!current.playlists.length) {
        managementConfirmation = null;
        enterEmptyPlaylistsSetup(commandFeedback(response));
        return { ok: true };
      }
      if (removingActive && current.operation && current.operation.error) {
        return {
          ok: true,
          message: current.operation.error,
          failed: true,
        };
      }
    }
    return {
      ok: true,
      message: commandFeedback(response),
    };
  }

  async function sendConfirmedLineupMutation(mutation) {
    var l = labels();
    var sentOwner = {
      playlistId: lineup.playlistId,
      sourceVersion: lineup.sourceVersion,
      auth: auth,
    };
    var sentViewSignature = backgroundLineupViewSignature();
    await flushBackgroundLineupOwner(sentOwner);
    if (
      !contentViewActive() ||
      lineup.mutating ||
      auth !== sentOwner.auth ||
      lineup.playlistId !== sentOwner.playlistId ||
      lineup.sourceVersion !== sentOwner.sourceVersion ||
      backgroundLineupViewSignature() !== sentViewSignature
    ) {
      return { ok: false, error: l.changeFailed };
    }
    var sentPlaylistId = sentOwner.playlistId;
    var generation = ++lineupRequestGeneration;
    var requestSignature = lineupRequestSignature();
    lineup.loading = false;
    lineup.mutating = true;
    lineup.error = "";
    renderManage();
    var response = await postLineupMutation(mutation, sentOwner);
    if (
      generation !== lineupRequestGeneration ||
      lineupRequestSignature() !== requestSignature ||
      auth !== sentOwner.auth ||
      lineup.sourceVersion !== sentOwner.sourceVersion
    ) {
      return { ok: false, error: l.changeFailed };
    }
    lineup.mutating = false;
    if (
      !response ||
      lineup.playlistId !== sentPlaylistId ||
      !contentViewActive()
    ) {
      return { ok: false, error: l.changeFailed };
    }
    if (response.status === 409) {
      if (response.body && response.body.snapshot) {
        adoptRemoteSnapshot(response.body.snapshot);
        if (reconcileLineupSource()) {
          return { ok: false, error: l.changeFailed };
        }
      }
      return { ok: false, error: l.conflict };
    }
    if (response.status !== 200 || !response.body || !response.body.ok) {
      return { ok: false, error: lineupMutationReason(response) };
    }
    acceptLineupRevision(response.body.revision);
    resetLineupPage();
    await loadLineupPage("reset", false);
    if (
      auth !== sentOwner.auth ||
      !contentViewActive() ||
      lineup.playlistId !== sentPlaylistId ||
      lineup.sourceVersion !== sentOwner.sourceVersion
    ) {
      return { ok: false, error: l.changeFailed };
    }
    return { ok: true };
  }

  async function resetPlaylistConfirmed(owner) {
    var l = labels();
    await flushBackgroundLineupOwner(owner);
    var stillThere = playlistById(owner.playlistId);
    if (
      auth !== owner.auth ||
      !stillThere ||
      playlistRowSourceVersion(stillThere) !== owner.sourceVersion
    ) {
      return { ok: false, error: l.changeFailed };
    }
    var startRevision = 0;
    if (
      current &&
      current.lineup &&
      current.lineup.playlistId === owner.playlistId &&
      typeof current.lineup.revision === "number"
    ) {
      startRevision = current.lineup.revision;
    }
    var queryBody = {
      playlistId: owner.playlistId,
      revision: startRevision,
      scope: "categories",
      contentKind: "live",
      includeHidden: true,
      limit: 1,
    };
    if (typeof owner.sourceVersion === "number") {
      queryBody.sourceVersion = owner.sourceVersion;
    }
    var response = await request(
      "/api/v1/lineup/query",
      {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify(queryBody),
      },
      "lineup",
    );
    if (response && response.status === 409) {
      if (response.body && response.body.snapshot) {
        adoptRemoteSnapshot(response.body.snapshot);
      }
      var retryRevision =
        response.body && typeof response.body.revision === "number"
          ? response.body.revision
          : null;
      var retryOwner = playlistById(owner.playlistId);
      if (
        auth !== owner.auth ||
        !retryOwner ||
        playlistRowSourceVersion(retryOwner) !== owner.sourceVersion ||
        retryRevision === null
      ) {
        return { ok: false, error: l.conflict };
      }
      queryBody.revision = retryRevision;
      response = await request(
        "/api/v1/lineup/query",
        {
          method: "POST",
          headers: headers(true),
          body: JSON.stringify(queryBody),
        },
        "lineup",
      );
    }
    if (
      !response ||
      response.status !== 200 ||
      !response.body ||
      !response.body.page ||
      typeof response.body.page.revision !== "number"
    ) {
      return {
        ok: false,
        error:
          response && response.status === 409 ? l.conflict : l.changeFailed,
      };
    }
    if (!queueOwnerCurrent(owner)) {
      return { ok: false, error: l.changeFailed };
    }
    var mutationResponse = await postLineupMutation(
      { type: "playlist.reset" },
      {
        playlistId: owner.playlistId,
        sourceVersion: owner.sourceVersion,
        revision: response.body.page.revision,
      },
    );
    if (!queueOwnerCurrent(owner)) {
      return { ok: false, error: l.changeFailed };
    }
    if (
      !mutationResponse ||
      mutationResponse.status !== 200 ||
      !mutationResponse.body ||
      !mutationResponse.body.ok
    ) {
      return {
        ok: false,
        error:
          mutationResponse && mutationResponse.status === 409
            ? l.conflict
            : l.changeFailed,
      };
    }
    invalidateLineupWriteQueues(owner.playlistId);
    acceptBackgroundLineupRevision(owner, mutationResponse.body.revision);
    if (lineup.playlistId === owner.playlistId) {
      resetLineupPage();
      if (contentViewActive()) void loadLineupPage("reset");
    }
    return { ok: true };
  }

  async function sendRemoteKey(code) {
    var response = await requestRemoteCommand({ type: "remote.key", code: code });
    if (!response) return;
    if (response.status !== 200) operationStatus(labels().changeFailed, true, false);
  }

  function bindManagement() {
    var remoteButton = root.querySelector("[data-action=open-remote]");
    var remoteOverlay = root.querySelector("[data-remote-overlay]");
    var remoteSheet = remoteOverlay.querySelector(".remote-sheet");
    var remoteBackdrop = remoteOverlay.querySelector(".remote-backdrop");
    var remoteCarousel = root.querySelector("[data-remote-carousel]");
    var remoteTrack = root.querySelector("[data-remote-track]");
    var remotePages = root.querySelectorAll("[data-remote-page]");
    var remotePage = 0;
    var swipeStart = null;
    var swipeDistance = 0;
    var dragStart = null;
    var dragLastY = null;
    var dragDistance = 0;
    var dragReversed = false;
    var closeTimer = null;
    var showRemotePage = function (page) {
      remotePage = Math.max(0, Math.min(1, page));
      remoteTrack.style.transform =
        "translateX(" + -remotePage * (remoteCarousel.clientWidth + 14) + "px)";
      remotePages.forEach(function (button, index) {
        button.setAttribute("aria-selected", String(index === remotePage));
      });
    };
    var openRemote = function () {
      if (closeTimer !== null) clearTimeout(closeTimer);
      closeTimer = null;
      remoteOverlay.hidden = false;
      remoteSheet.style.transition = "";
      remoteSheet.style.transform = "";
      remoteBackdrop.style.transition = "";
      remoteBackdrop.style.opacity = "";
      dragStart = null;
      dragLastY = null;
      dragDistance = 0;
      dragReversed = false;
      showRemotePage(0);
      requestAnimationFrame(function () { remoteOverlay.classList.add("open"); });
      remoteButton.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
      remoteOverlay.querySelector(".touch-key.ok").focus();
    };
    var closeRemote = function () {
      remoteSheet.style.transition = "";
      remoteBackdrop.style.transition = "";
      remoteSheet.style.transform = "";
      remoteBackdrop.style.opacity = "";
      remoteOverlay.classList.remove("open");
      remoteButton.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
      remoteButton.focus();
      closeTimer = setTimeout(function () {
        remoteOverlay.hidden = true;
        remoteSheet.style.transform = "";
        remoteBackdrop.style.opacity = "";
        closeTimer = null;
      }, 220);
    };
    remoteButton.addEventListener("click", openRemote);
    root.querySelectorAll("[data-action=close-remote]").forEach(function (button) {
      button.addEventListener("click", closeRemote);
    });
    remotePages.forEach(function (button) {
      button.addEventListener("click", function () { showRemotePage(Number(button.dataset.remotePage)); });
    });
    var finishRemoteSwipe = function () {
      if (swipeStart === null) return;
      var target = Math.abs(swipeDistance) > 48
        ? remotePage + (swipeDistance < 0 ? 1 : -1)
        : remotePage;
      swipeStart = null;
      swipeDistance = 0;
      remoteTrack.style.transition = "";
      requestAnimationFrame(function () { showRemotePage(target); });
    };
    remoteCarousel.addEventListener("pointerdown", function (event) {
      swipeStart = event.clientX;
      swipeDistance = 0;
      remoteTrack.style.transition = "none";
      remoteCarousel.setPointerCapture?.(event.pointerId);
    });
    remoteCarousel.addEventListener("pointermove", function (event) {
      if (swipeStart === null) return;
      swipeDistance = event.clientX - swipeStart;
      if ((remotePage === 0 && swipeDistance > 0) || (remotePage === 1 && swipeDistance < 0)) {
        swipeDistance *= 0.28;
      }
      remoteTrack.style.transform =
        "translateX(" + (-remotePage * (remoteCarousel.clientWidth + 14) + swipeDistance) + "px)";
    });
    remoteCarousel.addEventListener("pointerup", finishRemoteSwipe);
    remoteCarousel.addEventListener("pointercancel", finishRemoteSwipe);
    var finishRemoteDrag = function () {
      if (dragStart === null) return;
      dragStart = null;
      dragLastY = null;
      if (dragDistance > 96 && !dragReversed) {
        closeRemote();
      } else {
        remoteSheet.style.transition = "";
        remoteBackdrop.style.transition = "";
        requestAnimationFrame(function () {
          remoteSheet.style.transform = "";
          remoteBackdrop.style.opacity = "";
        });
      }
      dragDistance = 0;
      dragReversed = false;
    };
    remoteSheet.addEventListener("pointerdown", function (event) {
      if (event.target.closest("button, .remote-carousel, .remote-pages")) return;
      dragStart = event.clientY;
      dragLastY = event.clientY;
      dragDistance = 0;
      dragReversed = false;
      remoteSheet.setPointerCapture?.(event.pointerId);
    });
    remoteSheet.addEventListener("pointermove", function (event) {
      if (dragStart === null) return;
      if (dragLastY !== null && dragLastY - event.clientY > 6 && dragDistance > 12) {
        dragReversed = true;
      }
      dragLastY = event.clientY;
      dragDistance = Math.max(0, event.clientY - dragStart);
      remoteSheet.style.transition = "none";
      remoteBackdrop.style.transition = "none";
      remoteSheet.style.transform = "translateY(" + dragDistance + "px)";
      remoteBackdrop.style.opacity = String(Math.max(0.2, 1 - dragDistance / 320));
    });
    remoteSheet.addEventListener("pointerup", finishRemoteDrag);
    remoteSheet.addEventListener("pointercancel", finishRemoteDrag);
    root.querySelectorAll("[data-remote-key]").forEach(function (button) {
      button.addEventListener("click", function () {
        void sendRemoteKey(Number(button.dataset.remoteKey));
      });
    });
    bindNavDrawer();
    bindItemMenu();
    bindLineupOverlayKeys();
    var confirmDialog = root.querySelector("[data-management-confirmation]");
    if (confirmDialog) {
      var confirmOverlay =
        confirmDialog.closest(".confirm-overlay") || confirmDialog;
      confirmOverlay
        .querySelectorAll("[data-confirm-dismiss]")
        .forEach(function (control) {
          control.addEventListener("click", function () {
            closeManagementConfirmation();
          });
        });
      var confirmCancel = confirmDialog.querySelector("[data-confirm-cancel]");
      if (confirmCancel) {
        confirmCancel.addEventListener("click", function () {
          closeManagementConfirmation();
        });
      }
      var confirmAccept = confirmDialog.querySelector("[data-confirm-accept]");
      if (confirmAccept) {
        confirmAccept.addEventListener("click", function () {
          void confirmManagementAction();
        });
      }
    }
    if (manageView.page === "playlists") bindPlaylistsPage();
    else if (manageView.page === "appearance" || manageView.page === "playback") bindSettingsPage();
    else if (manageView.page === "devices") bindDevicesPage();
    else if (manageView.page === "about") bindAboutPage();
    restoreCapturedLineupFocus();
    ensureLineupOverlayFocus();
    syncLineupOverlayScroll();
  }

  function bindNavDrawer() {
    var drawer = root.querySelector("[data-nav-drawer]");
    var opener = root.querySelector("[data-action=open-nav]");
    if (!drawer || !opener) return;
    var closeDrawer = function () {
      if (typeof drawer.close === "function") drawer.close();
      else drawer.removeAttribute("open");
    };
    opener.addEventListener("click", function () {
      if (typeof drawer.showModal === "function") drawer.showModal();
      else drawer.setAttribute("open", "");
      var first = drawer.querySelector("a, button");
      if (first) first.focus();
    });
    drawer.querySelectorAll("[data-action=close-nav]").forEach(function (button) {
      button.addEventListener("click", closeDrawer);
    });
    drawer.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", closeDrawer);
    });
    drawer.addEventListener("click", function (event) {
      if (event.target === drawer) closeDrawer();
    });
    drawer.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
      }
    });
  }

  function openAddPlaylist(opener) {
    playlistFormEpoch += 1;
    manageView = { page: "playlists", sub: "add", subId: "" };
    clearPlaylistSubViews();
    addPlaylistDraftActive = true;
    playlistFormError = "";
    saveManagementRoute(false);
    renderManage();
    root.querySelector(addPlaylistSource === "m3u" ? '[name="newUrl"]' : '[name="newServer"]')?.focus();
  }

  function openEditPlaylist(id, opener) {
    var playlist = playlistById(id);
    if (!playlist) return;
    playlistFormEpoch += 1;
    manageView = { page: "playlists", sub: "edit", subId: id };
    clearPlaylistSubViews();
    editingPlaylistReturn = opener ? focusDescriptor(opener) : null;
    playlistFormError = "";
    if (editingPlaylist !== id) beginPlaylistEdit(playlist);
    saveManagementRoute(false);
    renderManage();
    root.querySelector(editingPlaylistSource === "m3u" ? '[name="editUrl"]' : '[name="editServer"]')?.focus();
  }

  function closePlaylistEdit(message, failed) {
    playlistFormEpoch += 1;
    var ret = editingPlaylistReturn;
    editingPlaylist = "";
    editingPlaylistReturn = null;
    playlistFormError = "";
    manageView = { page: "playlists", sub: "list", subId: "" };
    saveManagementRoute(true);
    renderManage(message, failed);
    restoreLineupFocus(ret);
  }

  function closeDeviceEdit() {
    var ret = editingDeviceReturn;
    editingDevice = "";
    editingDeviceDraft = "";
    editingDeviceReturn = null;
    renderManage();
    restoreLineupFocus(ret);
  }

  function showPlaylistsIndex(message, failed) {
    playlistFormEpoch += 1;
    var endingSub = manageView.sub;
    manageView = { page: "playlists", sub: "list", subId: "" };
    clearPlaylistSubViews();
    saveManagementRoute(false);
    renderManage(message, failed);
    if (endingSub === "add") restoreFocus({ action: "open-add-playlist" });
    else focusViewHeading();
  }

  function endAddPlaylistDraft() {
    playlistFormEpoch += 1;
    addPlaylistDraftActive = false;
    playlistFormError = "";
    addPlaylistSource = "m3u";
    addPlaylistDismissedXtream = "";
    addPlaylistDraft = {
      name: "",
      url: "",
      server: "",
      username: "",
      password: "",
      output: "m3u8",
    };
  }

  function bindPlaylistForm() {
    var isAdd = manageView.sub === "add";
    var container = isAdd ? "[data-add-playlist-form]" : "[data-edit-playlist]";
    root.querySelectorAll(container + " [data-source]").forEach(function (button) {
      button.addEventListener("click", function () {
        playlistFormError = "";
        playlistFormEpoch += 1;
        if (isAdd) {
          addPlaylistDraft = readAddPlaylistDraft();
          addPlaylistSource = button.dataset.source;
        } else {
          editingPlaylistDraft = readEditPlaylistDraft();
          editingPlaylistSource = button.dataset.source;
        }
        renderManage();
        var source = isAdd ? addPlaylistSource : editingPlaylistSource;
        root.querySelector(source === "m3u" ? '[name="' + (isAdd ? "new" : "edit") + 'Url"]' : '[name="' + (isAdd ? "new" : "edit") + 'Server"]')?.focus();
      });
    });
    root.querySelectorAll(container + " .add-source-fields").forEach(function (fields) {
      var clearFormError = function () {
        if (toastOwner && toastOwner.kind !== "loading") clearNotification();
        if (!playlistFormError) return;
        playlistFormError = "";
        var error = root.querySelector(".playlist-form-error");
        if (error) error.remove();
      };
      fields.addEventListener("input", clearFormError);
      fields.addEventListener("change", clearFormError);
    });
    root.querySelectorAll('[name="newUrl"], [name="editUrl"]').forEach(function (input) {
      input.addEventListener("input", function () {
        syncXtreamSuggestion(input);
      });
    });
    root.querySelectorAll('[name="newServer"], [name="editServer"]').forEach(function (server) {
      server.addEventListener("input", function () {
        var prefix = server.name === "newServer" ? "new" : "edit";
        var output = root.querySelector('[name="' + prefix + 'Output"]');
        var parsed = parseXtreamTemplateUrl(server.value, output ? output.value : "m3u8");
        if (!parsed) return;
        server.value = parsed.server;
        if (output) {
          output.value = parsed.output;
          syncOptionPickerValue(output);
        }
        if (parsed.username) {
          var username = root.querySelector('[name="' + prefix + 'Username"]');
          if (username) username.value = parsed.username;
        }
        if (parsed.password) {
          var password = root.querySelector('[name="' + prefix + 'Password"]');
          if (password) password.value = parsed.password;
        }
      });
    });
    root.querySelectorAll("[data-xtream-choice]").forEach(function (button) {
      button.addEventListener("click", function () {
        var choiceIsAdd = button.dataset.form === "new";
        var draft = choiceIsAdd ? addPlaylistDraft : editingPlaylistDraft;
        var banner = button.closest("[data-xtream-suggestion]");
        if (button.dataset.xtreamChoice === "keep") {
          if (choiceIsAdd) addPlaylistDismissedXtream = draft.url;
          else editPlaylistDismissedXtream = draft.url;
          if (banner) banner.hidden = true;
          root.querySelector(choiceIsAdd ? '[name="newUrl"]' : '[name="editUrl"]')?.focus();
          return;
        }
        var parsed = parseXtreamTemplateUrl(draft.url, "m3u8");
        if (!parsed) return;
        if (choiceIsAdd) addPlaylistDraft = readAddPlaylistDraft();
        else editingPlaylistDraft = readEditPlaylistDraft();
        draft = choiceIsAdd ? addPlaylistDraft : editingPlaylistDraft;
        draft.server = parsed.server;
        draft.output = parsed.output;
        if (parsed.username) draft.username = parsed.username;
        if (parsed.password) draft.password = parsed.password;
        if (choiceIsAdd) {
          addPlaylistSource = "xtream";
          addPlaylistDismissedXtream = draft.url;
        } else {
          editingPlaylistSource = "xtream";
          editPlaylistDismissedXtream = draft.url;
        }
        playlistFormError = "";
        playlistFormEpoch += 1;
        renderManage();
        root.querySelector(choiceIsAdd ? '[name="newServer"]' : '[name="editServer"]')?.focus();
      });
    });
    var addForm = root.querySelector("[data-add-playlist-form]");
    if (addForm) {
      addForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        if (busy || commandInFlight) return;
        addPlaylistDraft = readAddPlaylistDraft();
        var name = addPlaylistDraft.name.trim();
        var source = sourceFromDraft(addPlaylistSource, addPlaylistDraft);
        if (!validEntrySource(source)) {
          playlistFormError = labels().invalidUrl;
          renderManage();
          root.querySelector(
            addPlaylistSource === "m3u" ? '[name="newUrl"]' : '[name="newServer"]',
          )?.focus();
          return;
        }
        playlistFormError = "";
        var submitEpoch = playlistFormEpoch;
        var addFeedback = { message: "", failed: false };
        var added = await sendCommand(
          { type: "playlist.add", name: name, source: source },
          false,
          addForm,
          false,
          function (feedback) { addFeedback = feedback; },
        );
        if (added && playlistFormEpoch === submitEpoch) {
          endAddPlaylistDraft();
          showPlaylistsIndex(addFeedback.message, addFeedback.failed);
        }
      });
    }
    var editPlaylist = root.querySelector("[data-edit-playlist]");
    if (editPlaylist) {
      editPlaylist.addEventListener("submit", async function (event) {
        event.preventDefault();
        if (busy || commandInFlight) return;
        var id = editPlaylist.dataset.id;
        editingPlaylistDraft = readEditPlaylistDraft();
        var name = editingPlaylistDraft.name.trim();
        var source = sourceFromDraft(editingPlaylistSource, editingPlaylistDraft);
        if (!validEntrySource(source, true)) {
          playlistFormError = labels().invalidUrl;
          renderManage();
          root.querySelector(
            editingPlaylistSource === "m3u" ? '[name="editUrl"]' : '[name="editServer"]',
          )?.focus();
          return;
        }
        playlistFormError = "";
        var editEpoch = playlistFormEpoch;
        var editFeedback = { message: "", failed: false };
        var updated = await sendCommand(
          { type: "playlist.update", id: id, name: name, source: source },
          false,
          editPlaylist,
          false,
          function (feedback) { editFeedback = feedback; },
        );
        if (updated && playlistFormEpoch === editEpoch) {
          closePlaylistEdit(editFeedback.message, editFeedback.failed);
        }
      });
      editPlaylist.querySelector("[data-action=cancel-edit-playlist]").addEventListener("click", function () {
        closePlaylistEdit();
      });
      var playlistEditDismiss = root.querySelector("[data-playlist-edit-dismiss]");
      if (playlistEditDismiss) {
        playlistEditDismiss.addEventListener("click", function () {
          closePlaylistEdit();
        });
      }
    }
    root.querySelectorAll("[data-action=cancel-add-playlist]").forEach(function (button) {
      button.addEventListener("click", function () {
        endAddPlaylistDraft();
        showPlaylistsIndex();
      });
    });
    var addDismiss = root.querySelector("[data-playlist-add-dismiss]");
    if (addDismiss) {
      addDismiss.addEventListener("click", function () {
        endAddPlaylistDraft();
        showPlaylistsIndex();
      });
    }
  }

  function bindPlaylistsPage() {
    if (manageView.sub === "content") {
      bindLineup();
      return;
    }
    if (manageView.sub === "add" || manageView.sub === "edit") {
      bindPlaylistForm();
      return;
    }
    if (manageView.sub === "") {
      bindSettingsPage();
      return;
    }
    root.querySelectorAll("[data-playlist-page]").forEach(function (button) {
      button.addEventListener("click", function () {
        var direction = button.dataset.playlistPage;
        var total = playlistPageCount();
        playlistPage =
          direction === "next"
            ? Math.min(playlistPage + 1, total - 1)
            : Math.max(0, playlistPage - 1);
        renderManage();
        var pageOpen = root.querySelector(".playlist-card-open:not(:disabled)");
        var pageTarget =
          pageOpen ||
          root.querySelector("[data-action='open-add-playlist']") ||
          root.querySelector("[data-lineup-heading]");
        if (pageTarget) {
          pageTarget.focus({ preventScroll: true });
          pageTarget.scrollIntoView({ block: "nearest" });
        }
      });
    });
    var addButton = root.querySelector("[data-action=open-add-playlist]");
    if (addButton) {
      addButton.addEventListener("click", function () {
        openAddPlaylist(addButton);
      });
    }
    root.querySelectorAll("[data-action=playlist-activate]").forEach(function (button) {
      button.addEventListener("click", function () {
        var target = playlistById(button.dataset.id || "");
        if (target && target.id !== current.activePlaylistId) {
          void sendPlaylistRowCommand({ type: "playlist.activate", id: target.id }, button);
        }
      });
    });
    var playlistSearchToggleControl = root.querySelector("[data-playlist-search-toggle]");
    if (playlistSearchToggleControl) {
      playlistSearchToggleControl.addEventListener("click", function () {
        if (playlistSearchOpen) {
          closePlaylistSearch();
          return;
        }
        playlistSearchOpen = true;
        renderManage();
        var field = root.querySelector("[data-playlist-search]");
        if (field) field.focus();
      });
      playlistSearchToggleControl.addEventListener("keydown", function (event) {
        if (event.key !== "Escape" || !playlistSearchOpen) return;
        var field = root.querySelector("[data-playlist-search]");
        if (field && document.activeElement === field) return;
        event.preventDefault();
        closePlaylistSearch();
      });
    }
    var search = root.querySelector("[data-playlist-search]");
    if (search) {
      search.addEventListener("input", function () {
        playlistQuery = search.value;
        playlistPage = 0;
        var start = search.selectionStart;
        var end = search.selectionEnd;
        var direction = search.selectionDirection;
        renderManage();
        var next = root.querySelector("[data-playlist-search]");
        if (next) {
          next.focus();
          next.setSelectionRange(start, end, direction);
        }
      });
      search.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          event.preventDefault();
          search.blur();
          var toggle = root.querySelector("[data-playlist-search-toggle]");
          if (toggle) toggle.focus();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          return;
        }
        if (event.key === "ArrowDown") {
          var firstLine = root.querySelector(".playlist-card-line");
          var first =
            firstLine &&
            (firstLine.querySelector(".playlist-card-open:not(:disabled)") ||
              firstLine.querySelector(
                "button:not(:disabled):not([aria-disabled='true'])",
              ));
          if (first) {
            event.preventDefault();
            first.focus();
          } else {
            var toggle = root.querySelector("[data-playlist-search-toggle]");
            if (toggle) {
              event.preventDefault();
              toggle.focus();
            }
          }
        }
      });
    }
  }

  function bindSettingsPage() {
    root.querySelectorAll("[data-setting]").forEach(function (control) {
      control.addEventListener("change", function () {
        var value = control.type === "checkbox" ? control.checked : control.value;
        var source = control;
        if (control.hasAttribute("data-picker-native")) {
          var wrapper = control.closest(".option-picker");
          source =
            (wrapper && wrapper.querySelector("[data-picker-trigger]")) || control;
        }
        void sendCommand(
          { type: "setting", key: control.dataset.setting, value: value },
          false,
          source,
        );
      });
    });
  }

  function bindOptionPickers() {
    root.querySelectorAll("[data-picker-trigger]").forEach(function (trigger) {
      trigger.addEventListener("click", function (event) {
        if (
          activeOptionPicker &&
          activeOptionPicker.trigger === trigger
        ) {
          closeOptionPicker(true);
        } else {
          openOptionPicker(trigger, event.detail === 0);
        }
      });
      trigger.addEventListener("keydown", function (event) {
        if (
          event.key !== "ArrowDown" &&
          event.key !== "ArrowUp" &&
          event.keyCode !== 40 &&
          event.keyCode !== 38
        ) {
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        openOptionPicker(trigger, true);
      });
    });
  }

  function bindDevicesPage() {
    var deviceLabels = labels();
    root.querySelectorAll("[data-action=device-rename]").forEach(function (button) {
      button.addEventListener("click", function () {
        var entry = deviceById(button.dataset.id || "");
        if (!entry) return;
        editingDevice = entry.id;
        editingDeviceDraft = entry.name;
        editingDeviceReturn = focusDescriptor(button);
        renderManage();
        var field = root.querySelector('[name="editDeviceName"]');
        if (field) field.focus();
      });
    });
    root.querySelectorAll("[data-action=device-remove]").forEach(function (button) {
      button.addEventListener("click", function () {
        var id = button.dataset.id || "";
        var device = deviceById(id);
        var warning =
          auth && id === auth.deviceId
            ? deviceLabels.revokeSelfConfirm
            : deviceLabels.revokeConfirm;
        openManagementConfirmation({
          title: device ? device.name : deviceLabels.revoke,
          body: (device ? device.name + "\n\n" : "") + warning,
          confirmLabel: deviceLabels.revoke,
          danger: true,
          returnFocus: focusDescriptor(button),
          isCurrent: function () {
            return !!deviceById(id);
          },
          run: function () {
            return sendConfirmedCommand({ type: "device.revoke", id: id });
          },
        });
      });
    });
    var editDevice = root.querySelector("[data-edit-device]");
    if (editDevice) {
      var nameInput = editDevice.elements.editDeviceName;
      nameInput.addEventListener("input", function () {
        editingDeviceDraft = nameInput.value;
      });
      editDevice.addEventListener("submit", function (event) {
        event.preventDefault();
        var id = editDevice.dataset.id;
        var name = nameInput.value.trim();
        if (!name || busy || commandInFlight) return;
        void sendCommand({ type: "device.rename", id: id, name: name }, false, editDevice).then(
          function (renamed) {
            if (renamed) closeDeviceEdit();
          },
        );
      });
      editDevice.querySelector("[data-action=cancel-edit-device]").addEventListener("click", function () {
        closeDeviceEdit();
      });
      var deviceEditDismiss = root.querySelector("[data-device-edit-dismiss]");
      if (deviceEditDismiss) {
        deviceEditDismiss.addEventListener("click", function () {
          closeDeviceEdit();
        });
      }
    }
  }

  function bindAboutPage() {
    var l = labels();
    var clearCache = root.querySelector("[data-action=clear-cache]");
    if (clearCache) {
      clearCache.addEventListener("click", function () {
        openManagementConfirmation({
          title: l.cache,
          body: l.cacheConfirm,
          confirmLabel: l.clear,
          returnFocus: focusDescriptor(clearCache),
          isCurrent: function () {
            return managementActive;
          },
          run: function () {
            return sendConfirmedCommand({ type: "cache.clear" });
          },
        });
      });
    }
    var resetData = root.querySelector("[data-action=reset-app-data]");
    if (resetData) {
      resetData.addEventListener("click", function () {
        openManagementConfirmation({
          title: l.resetData,
          body:
            l.resetDataQuestion +
            "\n\n" +
            l.resetDataBody +
            "\n\n" +
            l.resetRemoteHint,
          confirmLabel: l.resetData,
          danger: true,
          busyLabel: l.resetData,
          returnFocus: focusDescriptor(resetData),
          isCurrent: function () {
            return managementActive;
          },
          run: function () {
            return sendConfirmedCommand({ type: "app.reset" });
          },
        });
      });
    }
  }

  async function loadState() {
    if (toastOwner && toastOwner.auth !== auth) clearNotification();
    var loaded = await request("/api/v1/state", { headers: headers(false) });
    if (!loaded) return;
    if (loaded.status !== 200) {
      renderUnavailable();
      return;
    }
    current = loaded.body;
    applyLocale();
    lineup.loading = false;
    lineup.mutating = false;
    cancelLineupSortDrag();
    clearLineupSortClickSuppress();
    lineup.sort = null;
    if (contentPlaylistId) {
      if (current.playlists.some(function (playlist) { return playlist.id === contentPlaylistId; })) {
        resetPlaylistContent();
      } else {
        contentPlaylistId = "";
        contentReturnFocus = null;
      }
    }
    var source = current.setup && current.setup.source;
    setupSource = source ? source.kind : "m3u";
    setupDraft = Object.assign({}, setupDraft, {
      locale: current.settings.locale,
      name: current.setup?.name ?? "",
      url: source && source.kind === "m3u" ? source.url : "",
      server: source && source.kind === "xtream" ? source.server : "",
      username: source && source.kind === "xtream" ? source.username : "",
      password: "",
      output: source && source.kind === "xtream" ? source.output : "m3u8",
    });
    if (current.playlists.length) {
      managementActive = true;
      var routeHash = window.location.hash || "#playlists";
      lastRouteHash = routeHash;
      applyParsedRoute(parseManagementHash(routeHash), routeHash);
      canonicalizeManagementRoute(routeHash);
    } else renderSetup();
  }

  async function start() {
    auth = readAuth();
    if (auth) {
      await loadState();
      return;
    }
    var publicState = await request("/api/v1/status", { headers: headers(false) });
    if (!publicState) return;
    if (publicState.status === 200) {
      current = publicState.body;
      applyLocale();
    }
    renderPair();
  }

  window.onpopstate = onManagementRouteChange;
  window.onhashchange = onManagementRouteChange;

  window.OpenIPTVRemote = {
    start: start,
    parsePairSecret: parsePairSecret,
    renderLineup: renderLineup,
    bindLineup: bindLineup,
    loadLineupPage: loadLineupPage,
    sendLineupMutation: sendLineupMutation,
  };
  if (!window.__OPENIPTV_TEST__) void start();
})();
