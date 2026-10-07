(function () {
  var root = document.getElementById("app");
  var auth = readAuth();
  var current = null;
  var busy = false;
  var previewTimer = null;
  var toastTimer = null;
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
  var editingPlaylistDraft = {
    name: "",
    url: "",
    server: "",
    username: "",
    password: "",
    output: "m3u8",
  };
  var editingDevice = "";
  var expandedPlaylists = false;
  var expandedDevices = false;
  var addPlaylistOpen = false;
  var lineupSearchTimer = null;
  var anchorSearchTimer = null;
  var lineupRequestGeneration = 0;
  var anchorRequestGeneration = 0;
  var lineup = {
    playlistId: "",
    revision: 0,
    scope: "categories",
    categoryKey: "",
    categoryName: "",
    categoryPersonal: false,
    membershipCategory: "",
    query: "",
    includeHidden: false,
    items: [],
    nextCursor: null,
    total: 0,
    loading: false,
    error: "",
    notice: "",
    loaded: false,
    editor: null,
    anchorPicker: null,
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
    hls: "HLS, recommended",
    mpegTs: "MPEG TS",
    language: "Language",
    finish: "Finish setup",
    setupCompleteTitle: "Your playlist is ready",
    setupCompleteBody:
      "Channels were added to OpenIPTV. Continue on your TV, or open Settings here to manage your playlists and preferences.",
    setupFailedTitle: "Couldn’t add this playlist",
    setupLoadFailed: "No channels were found at this address. Check the address and try again.",
    manage: "Settings",
    connecting: "Connecting",
    checkingPlaylist: "Loading the playlist…",
    saving: "Save…",
    saved: "Settings saved.",
    playlists: "Playlists",
    lineup: "Channels & categories",
    lineupChannels: "Channels",
    lineupMovies: "Movies",
    lineupSeries: "Series",
    lineupCategories: "Categories",
    lineupPersonalCategories: "Personal categories",
    lineupSearch: "Search lineup",
    lineupRevealHidden: "Reveal hidden",
    lineupResults: "{shown} of {total} items",
    lineupLoadMore: "Load more",
    lineupLoading: "Loading lineup…",
    lineupEmpty: "No matching lineup items.",
    lineupUnavailable: "Lineup management is unavailable until the active playlist is ready.",
    lineupConflict: "The lineup changed on the TV. The latest page has been loaded.",
    lineupHidden: "Hidden",
    lineupUnavailableItem: "Unavailable",
    lineupRestore: "Restore provider value",
    lineupRename: "Rename",
    lineupNumber: "Change number",
    lineupHide: "Hide",
    lineupShow: "Show",
    lineupMoveBefore: "Move before",
    lineupMoveAfter: "Move after",
    lineupCreateCategory: "Create personal category",
    lineupDeleteCategory: "Delete personal category",
    lineupAddMembership: "Add to category",
    lineupRemoveMembership: "Remove from category",
    lineupRemoveUnavailable: "Remove unavailable record",
    lineupMembers: "members",
    lineupCount: "channels",
    lineupBulkHide: "Hide all",
    lineupBulkShow: "Show all",
    appearance: "Appearance",
    playback: "Playback",
    devices: "Devices",
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
    edit: "Edit",
    refresh: "Refresh",
    active: "Active",
    activate: "Make active",
    invalidUrl: "That is not a complete web address.",
    changeFailed: "The change could not be saved.",
    pairingFailed: "The pairing code is invalid or has expired.",
    retry: "Try again",
    cache: "Clear downloaded cache",
    cacheConfirm: "Clear downloaded cache?",
    removeConfirm: "Remove this playlist?",
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
    orderCustom: "Custom order",
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
    rename: "Rename",
    revoke: "Remove access",
    revokeConfirm: "This device will need to scan a new QR code before it can connect again.",
    revokeSelfConfirm:
      "This is the device you are using. Removing access will disconnect it, and you will need to add it again.",
    trustedNetwork:
      "This local HTTP connection is intended only for a trusted private network. Account credentials and stream addresses are never shown.",
    accountActive: "Active",
    accountInactive: "Inactive",
    accountExpired: "Expired",
    accountTrial: "trial",
    accountExpiryUnknown: "Expiry unknown",
    accountExpires: "Expires {date}",
    accountConnections: "{active} of {maximum} connections active",
    save: "Save",
    open: "Open",
    close: "Close",
    cancel: "Cancel",
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
  };

  function icon(name, className) {
    return '<svg class="' + (className || "remote-icon") + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + icons[name] + "</svg>";
  }

  function navIcon(name) {
    return icon(name, "tab-icon");
  }

  function remoteMarkup(l) {
    var digits = "";
    for (var digit = 1; digit <= 9; digit += 1) {
      digits += '<button type="button" data-remote-key="' + (48 + digit) + '">' + digit + "</button>";
    }
    digits += '<span></span><button type="button" data-remote-key="48">0</button><span></span>';
    return (
      '<button type="button" class="remote-fab" data-action="open-remote" aria-label="Smart Remote" aria-expanded="false">' + icon("remote") + '</button>' +
      '<div class="remote-overlay" data-remote-overlay hidden><button type="button" class="remote-backdrop" data-action="close-remote" aria-label="' + escape(l.remoteClose) + '"></button><section class="remote-sheet" role="dialog" aria-modal="true" aria-labelledby="remote-title"><header><h2 id="remote-title">Smart Remote</h2><button type="button" class="remote-close" data-action="close-remote" aria-label="' + escape(l.remoteClose) + '">' + icon("close") + '</button></header><div class="remote-carousel" data-remote-carousel><div class="remote-track" data-remote-track>' +
      '<div class="remote-page"><div class="mobile-remote"><div class="touch-dpad"><button type="button" class="touch-key up" data-remote-key="38" aria-label="' + escape(l.remoteUp) + '">' + icon("up") + '</button><button type="button" class="touch-key right" data-remote-key="39" aria-label="' + escape(l.remoteRight) + '">' + icon("right") + '</button><button type="button" class="touch-key down" data-remote-key="40" aria-label="' + escape(l.remoteDown) + '">' + icon("down") + '</button><button type="button" class="touch-key left" data-remote-key="37" aria-label="' + escape(l.remoteLeft) + '">' + icon("left") + '</button><button type="button" class="touch-key ok" data-remote-key="13" aria-label="' + escape(l.remoteSelect) + '">OK</button></div><div class="touch-primary"><button type="button" data-remote-key="10009" aria-label="' + escape(l.remoteReturn) + '">' + icon("return") + '<span>' + escape(l.remoteReturn) + '</span></button><button type="button" data-remote-key="10252" aria-label="' + escape(l.remotePlayPause) + '">' + icon("play") + '<span>Play/Pause</span></button></div><div class="touch-rockers"><div class="touch-rocker"><span>VOL</span><div><button type="button" data-remote-key="448" aria-label="' + escape(l.remoteVolumeUp) + '">' + icon("plus") + '</button><button type="button" data-remote-key="449" aria-label="' + escape(l.remoteVolumeDown) + '">' + icon("minus") + '</button></div></div><div class="touch-rocker"><span>CH</span><div><button type="button" data-remote-key="427" aria-label="' + escape(l.remoteChannelUp) + '">' + icon("plus") + '</button><button type="button" data-remote-key="428" aria-label="' + escape(l.remoteChannelDown) + '">' + icon("minus") + '</button></div></div></div></div></div>' +
      '<div class="remote-page"><div class="remote-keypad"><div class="keypad-digits">' + digits + '</div><div class="keypad-transport"><button type="button" data-remote-key="10232" aria-label="' + escape(l.remotePrevious) + '">' + icon("previous", "transport-icon") + '</button><button type="button" data-remote-key="412" aria-label="' + escape(l.remoteRewind) + '">' + icon("rewind", "transport-icon") + '</button><button type="button" data-remote-key="413" aria-label="' + escape(l.remoteStop) + '">' + icon("stop", "transport-icon") + '</button><button type="button" data-remote-key="417" aria-label="' + escape(l.remoteFastForward) + '">' + icon("forward", "transport-icon") + '</button><button type="button" data-remote-key="10233" aria-label="' + escape(l.remoteNext) + '">' + icon("next", "transport-icon") + '</button></div><div class="keypad-colours"><button type="button" class="red" data-remote-key="403" aria-label="' + escape(l.remoteRed) + '"></button><button type="button" class="green" data-remote-key="404" aria-label="' + escape(l.remoteGreen) + '"></button><button type="button" class="yellow" data-remote-key="405" aria-label="' + escape(l.remoteYellow) + '"></button><button type="button" class="blue" data-remote-key="406" aria-label="' + escape(l.remoteBlue) + '"></button></div></div></div></div></div><div class="remote-pages" role="tablist" aria-label="Remote pages"><button type="button" data-remote-page="0" aria-label="Main controls" aria-selected="true"></button><button type="button" data-remote-page="1" aria-label="Keypad controls" aria-selected="false"></button></div></section></div>'
    );
  }

  function itemMenuMarkup(l) {
    return (
      '<div class="item-menu-overlay" data-item-menu hidden><button type="button" class="item-menu-backdrop" data-action="close-item-menu" aria-label="' +
      escape(l.close) + '"></button><section class="item-menu-sheet" role="dialog" aria-modal="true" aria-labelledby="item-menu-title"><header><strong id="item-menu-title" data-item-menu-title></strong><button type="button" class="item-menu-close" data-action="close-item-menu" aria-label="' +
      escape(l.close) + '">' + icon("close") + '</button></header><div class="item-menu-actions" data-item-menu-actions></div></section></div>'
    );
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

  function accountStatus(account, l) {
    if (!account) return "";
    var status = String(account.status || "").toLowerCase();
    var expired = account.expiresAt && account.expiresAt <= Math.floor(Date.now() / 1000);
    var state = status === "expired" || expired
      ? l.accountExpired
      : status === "active"
        ? l.accountActive
        : l.accountInactive;
    var expiry = account.expiresAt
      ? l.accountExpires.replace(
          "{date}",
          new Date(account.expiresAt * 1000).toLocaleDateString(current.locale),
        )
      : l.accountExpiryUnknown;
    var connections = account.activeConnections == null
      ? ""
      : l.accountConnections
          .replace("{active}", account.activeConnections)
          .replace("{maximum}", account.maxConnections == null ? "?" : account.maxConnections);
    return (
      '<span class="account-status"><span>' + escape(state) +
      (account.isTrial ? " " + escape(l.accountTrial) : "") +
      "</span><span>" + escape(expiry) + "</span>" +
      (connections ? "<span>" + escape(connections) + "</span>" : "") +
      "</span>"
    );
  }

  function sourceOptions(source, l) {
    return (
      '<div class="source-options"><button type="button" data-source="m3u" aria-pressed="' +
      (source === "m3u") + '">' + escape(l.m3uPlaylist) +
      '</button><button type="button" data-source="xtream" aria-pressed="' +
      (source === "xtream") + '">' + escape(l.xtreamLogin) + "</button></div>"
    );
  }

  function xtreamFields(prefix, draft, l) {
    return (
      '<label>' + escape(l.serverAddress) + '<input name="' + prefix + 'Server" type="url" inputmode="url" dir="ltr" value="' + escape(draft.server) + '" required></label>' +
      '<label>' + escape(l.username) + '<input name="' + prefix + 'Username" dir="ltr" value="' + escape(draft.username) + '" required></label>' +
      '<label>' + escape(l.password) + '<input name="' + prefix + 'Password" type="password" dir="ltr" value="' + escape(draft.password) + '"' + (prefix === "edit" ? "" : " required") + "></label>" +
      '<label>' + escape(l.streamFormat) + '<select name="' + prefix + 'Output"><option value="m3u8"' +
      (draft.output === "m3u8" ? " selected" : "") + '>' + escape(l.hls) + '</option><option value="ts"' +
      (draft.output === "ts" ? " selected" : "") + '>' + escape(l.mpegTs) + "</option></select></label>"
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

  function headers(json) {
    var result = {};
    if (json) result["Content-Type"] = "application/json";
    if (auth) result.Authorization = "Bearer " + auth.deviceId + ":" + auth.credential;
    return result;
  }

  async function request(path, options) {
    try {
      var response = await fetch(path, options || { headers: headers(false) });
      var body = await response.json();
      if (response.status === 401 && auth) {
        saveAuth(null);
        renderPair(labels().revoked);
        return null;
      }
      return { status: response.status, body: body };
    } catch (_error) {
      renderUnavailable();
      return null;
    }
  }

  function operationStatus(message, failed, persistent) {
    var notice = root.querySelector("[data-operation-status]");
    if (!notice) {
      notice = document.createElement("p");
      notice.dataset.operationStatus = "true";
      root.appendChild(notice);
    }
    if (toastTimer !== null) clearTimeout(toastTimer);
    notice.className = "toast " + (failed ? "error" : "success");
    notice.setAttribute("role", failed ? "alert" : "status");
    notice.textContent = message;
    if (!persistent) {
      toastTimer = setTimeout(function () {
        notice.remove();
        toastTimer = null;
      }, failed ? 5200 : 3200);
    }
  }

  function beginOperation(message, source) {
    if (busy) return false;
    busy = true;
    root.setAttribute("aria-busy", "true");
    root.querySelectorAll("button, input, select").forEach(function (control) {
      control.disabled = true;
    });
    if (source && source.tagName === "BUTTON") source.textContent = message;
    operationStatus(message, false, true);
    return true;
  }

  function finishOperation(message, failed) {
    busy = false;
    root.removeAttribute("aria-busy");
    root.querySelectorAll("button, input, select").forEach(function (control) {
      control.disabled = false;
    });
    operationStatus(message, failed);
  }

  function shell(content, message, failed) {
    busy = false;
    document.body.querySelectorAll("[data-item-menu-root]").forEach(function (menu) {
      menu.remove();
    });
    document.body.style.overflow = "";
    root.removeAttribute("aria-busy");
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = null;
    var l = labels();
    root.innerHTML =
      '<header class="top"><img class="brand-mark" src="/icon.svg" alt=""><strong>' +
      escape(l.title) +
      '</strong></header><div class="content">' + content + "</div>";
    if (message) operationStatus(message, failed, false);
  }

  function renderUnavailable() {
    shell(
      '<section class="hero"><h1>' +
        escape(labels().unavailable) +
        '</h1><button type="button" data-action="retry">' +
        escape(labels().retry) +
        "</button></section>",
    );
    root.querySelector("[data-action=retry]").addEventListener("click", start);
  }

  function renderPair(message) {
    var l = labels();
    var secret = parsePairSecret();
    shell(
      '<section class="hero pair"><h1>' +
        escape(l.pairTitle) +
        "</h1><p>" +
        escape(l.pairBody) +
        "</p>" +
        '<form><label>' +
        escape(l.deviceName) +
        '<input name="deviceName" autocomplete="off" required></label>' +
        (secret
          ? ""
          : '<label>' +
            escape(l.code) +
            '<input name="code" dir="ltr" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required></label>') +
        '<button type="submit">' +
        escape(l.pair) +
        "</button></form></section>",
      message,
      true,
    );
    root.querySelector("form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      var name = form.elements.deviceName.value.trim();
      var payload = { name: name };
      if (secret) payload.secret = secret;
      else payload.code = form.elements.code.value.trim();
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
    });
    if (!response) return;
    if (response.body && response.body.snapshot) current = response.body.snapshot;
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
        renderSetup();
        root.querySelector(setupSource === "m3u" ? '[name="playlistUrl"]' : '[name="xtreamServer"]')?.focus();
      });
    });
    form.querySelectorAll('[name="playlistName"], [name="playlistUrl"], [name^="xtream"]').forEach(function (control) {
      control.addEventListener("input", function () { queueSetupPreview(form, false); });
      if (control.tagName === "SELECT") {
        control.addEventListener("change", function () { queueSetupPreview(form, false); });
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
      if (success) renderManage();
      else {
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

  function settingSelect(key, label, options) {
    return (
      '<label class="select-setting"><span>' +
      escape(label) +
      '</span><select data-setting="' +
      key +
      '">' +
      options
        .map(function (option) {
          return (
            '<option value="' +
            option[0] +
            '"' +
            (current.settings[key] === option[0] ? " selected" : "") +
            ">" +
            escape(option[1]) +
            "</option>"
          );
        })
        .join("") +
      "</select></label>"
    );
  }

  function lineupQueryBody(cursor) {
    var body = {
      playlistId: lineup.playlistId,
      revision: lineup.revision,
      scope: lineup.scope,
    };
    if (lineup.categoryKey) body.categoryKey = lineup.categoryKey;
    if (lineup.query) body.query = lineup.query;
    if (lineup.includeHidden) body.includeHidden = true;
    if (cursor) body.cursor = cursor;
    return body;
  }

  function resetLineupPage() {
    lineup.items = [];
    lineup.nextCursor = null;
    lineup.total = 0;
    lineup.loaded = false;
    lineup.error = "";
  }

  async function loadLineupPage(append) {
    var generation = ++lineupRequestGeneration;
    if (!current || !current.lineup || !current.lineup.ready) {
      lineup.error = labels().lineupUnavailable;
      lineup.loading = false;
      lineup.loaded = true;
      renderManage();
      return;
    }
    if (append && !lineup.nextCursor) return;
    lineup.loading = true;
    lineup.error = "";
    renderManage();
    var heldRevision = lineup.revision;
    var response = await request("/api/v1/lineup/query", {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(lineupQueryBody(append ? lineup.nextCursor : null)),
    });
    if (generation !== lineupRequestGeneration) return;
    if (!response) return;
    if (response.status === 409) {
      if (response.body.snapshot) current = response.body.snapshot;
      lineup.revision = response.body.revision;
      lineup.notice = labels().lineupConflict;
      lineup.editor = null;
      lineup.anchorPicker = null;
      lineup.items = [];
      lineup.nextCursor = null;
      lineup.loaded = false;
      await loadLineupPage(false);
      return;
    }
    if (response.status !== 200 || !response.body.page) {
      lineup.loading = false;
      lineup.loaded = true;
      lineup.error = labels().changeFailed;
      renderManage();
      return;
    }
    var page = response.body.page;
    if (append && page.revision !== heldRevision) {
      lineup.revision = page.revision;
      resetLineupPage();
      await loadLineupPage(false);
      return;
    }
    var items = append ? lineup.items.concat(page.items || []) : page.items || [];
    lineup.items = items.length > 100 ? items.slice(items.length - 100) : items;
    lineup.revision = page.revision;
    lineup.nextCursor = page.nextCursor || null;
    lineup.total = page.total;
    lineup.loading = false;
    lineup.loaded = true;
    renderManage();
  }

  async function sendLineupMutation(mutation, source) {
    if (!lineup.playlistId) return;
    var returnFocus = lineup.editor?.returnFocus || lineup.anchorPicker?.returnFocus || focusDescriptor(source);
    var id = commandId();
    lineupRequestGeneration += 1;
    lineup.loading = true;
    lineup.error = "";
    renderManage();
    var response = await request("/api/v1/lineup/mutation", {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify({
        id: id,
        playlistId: lineup.playlistId,
        revision: lineup.revision,
        mutation: mutation,
      }),
    });
    if (!response) return;
    if (response.status === 409) {
      if (response.body.snapshot) current = response.body.snapshot;
      lineup.revision = response.body.revision;
      lineup.loading = false;
      lineup.notice = labels().lineupConflict;
      lineup.editor = null;
      lineup.anchorPicker = null;
      resetLineupPage();
      await loadLineupPage(false);
      restoreFocus(returnFocus);
      return;
    }
    if (response.status !== 200 || !response.body.ok) {
      lineup.loading = false;
      lineup.error = labels().changeFailed;
      renderManage(lineup.error, true);
      restoreFocus(returnFocus);
      return;
    }
    lineup.revision = response.body.revision;
    if (current.lineup) current.lineup.revision = response.body.revision;
    lineup.editor = null;
    lineup.anchorPicker = null;
    lineup.notice = "";
    resetLineupPage();
    await loadLineupPage(false);
    operationStatus(labels().saved, false, false);
    restoreFocus(returnFocus);
  }

  async function loadLineupAnchors(append) {
    var generation = ++anchorRequestGeneration;
    var picker = lineup.anchorPicker;
    if (!picker || (append && !picker.nextCursor)) return;
    picker.loading = true;
    renderManage();
    var body = {
      playlistId: lineup.playlistId,
      revision: lineup.revision,
      scope: lineup.scope,
      includeHidden: true,
    };
    if (lineup.categoryKey) body.categoryKey = lineup.categoryKey;
    if (picker.query) body.query = picker.query;
    if (append) body.cursor = picker.nextCursor;
    var response = await request("/api/v1/lineup/query", {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(body),
    });
    if (generation !== anchorRequestGeneration || !response || !lineup.anchorPicker) return;
    if (response.status === 409) {
      if (response.body.snapshot) current = response.body.snapshot;
      lineup.revision = response.body.revision;
      lineup.notice = labels().lineupConflict;
      picker.items = [];
      picker.nextCursor = null;
      picker.loading = false;
      await loadLineupAnchors(false);
      return;
    }
    if (response.status !== 200 || !response.body.page) {
      picker.loading = false;
      lineup.error = labels().changeFailed;
      renderManage();
      return;
    }
    var page = response.body.page;
    var next = (page.items || []).filter(function (item) {
      return item.kind !== "unavailable" && item.id !== picker.itemId;
    });
    var items = append ? picker.items.concat(next) : next;
    picker.items = items.length > 100 ? items.slice(items.length - 100) : items;
    picker.nextCursor = page.nextCursor || null;
    picker.loading = false;
    renderManage();
    root.querySelector("[data-anchor-search]")?.focus();
  }

  function openLineupAnchorPicker(itemId, placement, source) {
    lineup.anchorPicker = {
      itemId: itemId,
      placement: placement,
      returnFocus: focusDescriptor(source),
      query: "",
      items: [],
      nextCursor: null,
      loading: false,
    };
    renderManage();
    void loadLineupAnchors(false);
  }

  function lineupRow(item, l) {
    if (item.kind === "unavailable") {
      return '<li class="lineup-row unavailable"><div><strong dir="auto">' + escape(item.label) +
        '</strong><span>' + escape(l.lineupUnavailableItem) + '</span></div><button type="button" data-lineup-action="remove-unavailable" data-key="' +
        escape(item.key) + '" aria-label="' + escape(l.lineupRemoveUnavailable + " " + item.label) + '">' + escape(l.remove) + "</button></li>";
    }
    var hidden = item.hidden ? '<span class="lineup-state">' + escape(l.lineupHidden) + "</span>" : "";
    var count = item.kind === "channel"
      ? String(item.number)
      : String(item.count) + " " + (item.kind === "personal-category" ? l.lineupMembers : l.lineupCount);
    var membershipId = lineup.membershipCategory || (lineup.categoryPersonal ? lineup.categoryKey : "");
    var membership = lineup.scope === "channels" && membershipId && item.kind === "channel"
      ? '<button type="button" data-lineup-action="membership" data-id="' + escape(item.id) + '">' +
        escape((item.personalCategoryIds || []).indexOf(membershipId) >= 0 ? l.lineupRemoveMembership : l.lineupAddMembership) + "</button>"
      : "";
    var categoryActions = item.kind === "personal-category"
      ? '<button type="button" data-lineup-action="open-members" data-id="' + escape(item.id) + '">' + escape(l.open) + '</button><button type="button" data-lineup-action="add-members" data-id="' + escape(item.id) + '">' + escape(l.lineupAddMembership) + '</button><button type="button" data-lineup-action="rename" data-id="' + escape(item.id) + '">' + escape(l.lineupRename) + '</button><button type="button" class="danger" data-lineup-action="delete-category" data-id="' + escape(item.id) + '">' + escape(l.lineupDeleteCategory) + "</button>"
      : '<button type="button" data-lineup-action="open-members" data-id="' + escape(item.id) + '">' + escape(l.open) + '</button><button type="button" data-lineup-action="rename" data-id="' + escape(item.id) + '">' + escape(l.lineupRename) + '</button><button type="button" data-lineup-action="visibility" data-id="' + escape(item.id) + '" data-hidden="' + String(item.hidden) + '">' + escape(item.hidden ? l.lineupShow : l.lineupHide) + "</button>";
    var channelActions = item.kind === "channel"
      ? '<button type="button" data-lineup-action="rename" data-id="' + escape(item.id) + '">' + escape(l.lineupRename) + '</button><button type="button" data-lineup-action="number" data-id="' + escape(item.id) + '">' + escape(l.lineupNumber) + '</button><button type="button" data-lineup-action="visibility" data-id="' + escape(item.id) + '" data-hidden="' + String(item.hidden) + '">' + escape(item.hidden ? l.lineupShow : l.lineupHide) + "</button>"
      : categoryActions;
    var placement = item.kind !== "channel" || lineup.categoryKey
      ? '<button type="button" data-lineup-action="move-before" data-id="' + escape(item.id) + '" aria-label="' + escape(l.lineupMoveBefore + " " + item.name) + '">' + escape(l.lineupMoveBefore) + '</button><button type="button" data-lineup-action="move-after" data-id="' + escape(item.id) + '" aria-label="' + escape(l.lineupMoveAfter + " " + item.name) + '">' + escape(l.lineupMoveAfter) + "</button>"
      : "";
    return '<li class="lineup-row' + (item.hidden ? " hidden" : "") + '" data-lineup-id="' + escape(item.id) + '"><div><strong dir="auto">' +
      escape(item.name) + '</strong><span dir="auto">' + escape(item.providerName) + '</span><span>' + escape(count) + "</span>" + hidden +
      '</div><div class="lineup-row-actions">' + membership + channelActions + placement + "</div></li>";
  }

  function lineupEditorMarkup(l) {
    if (!lineup.editor) return "";
    var editor = lineup.editor;
    var provider = editor.kind === "personal-category"
      ? ""
      : '<p class="lineup-provider-value"><span>' + escape(l.lineupRestore) + '</span><strong dir="auto">' + escape(editor.providerValue) + "</strong></p>";
    var restore = editor.kind === "personal-category"
      ? ""
      : '<button type="button" class="quiet" data-lineup-action="restore">' + escape(l.lineupRestore) + "</button>";
    return '<form class="lineup-editor" data-lineup-editor><label>' + escape(editor.type === "number" ? l.lineupNumber : l.lineupRename) +
      '<input name="lineupValue" ' + (editor.type === "number" ? 'type="number" min="1" step="1" inputmode="numeric"' : 'dir="auto"') +
      ' value="' + escape(editor.value) + '"></label>' + provider + '<div><button type="submit">' + escape(l.save) +
      "</button>" + restore + '<button type="button" class="quiet" data-lineup-action="cancel-editor">' + escape(l.cancel) + "</button></div></form>";
  }

  function anchorPickerMarkup(l) {
    if (!lineup.anchorPicker) return "";
    var anchors = lineup.anchorPicker.items.map(function (item) {
      return '<button type="button" data-lineup-anchor="' + escape(item.id) + '"><span dir="auto">' + escape(item.name) + "</span></button>";
    }).join("");
    return '<div class="lineup-anchor-picker" role="dialog" aria-modal="true" aria-labelledby="lineup-anchor-title"><h3 id="lineup-anchor-title">' + escape(lineup.anchorPicker.placement === "before" ? l.lineupMoveBefore : l.lineupMoveAfter) + '</h3><label>' + escape(l.lineupSearch) +
      '<input data-anchor-search dir="auto" value="' + escape(lineup.anchorPicker.query) + '"></label><div>' + anchors +
      '</div>' + (lineup.anchorPicker.loading ? '<p class="lineup-state">' + escape(l.lineupLoading) + "</p>" : "") +
      (lineup.anchorPicker.nextCursor ? '<button type="button" data-anchor-more>' + escape(l.lineupLoadMore) + "</button>" : "") +
      '<button type="button" class="quiet" data-lineup-action="cancel-anchor">' + escape(l.cancel) + "</button></div>";
  }

  function renderLineup() {
    var l = labels();
    var summary = current.lineup;
    var playlists = current.playlists.map(function (playlist) {
      return '<option dir="auto" value="' + escape(playlist.id) + '"' + (playlist.id === current.activePlaylistId ? " selected" : "") + '>' + escape(playlist.name) + "</option>";
    }).join("");
    var scopes = lineup.scope === "channels" && lineup.categoryKey
      ? '<button type="button" data-lineup-scope="categories">' + escape(l.lineupCategories) + '</button><span class="lineup-category-name" dir="auto">' + escape(lineup.categoryName) + "</span>"
      : [["categories", l.lineupCategories], ["personal-categories", l.lineupPersonalCategories]].map(function (entry) {
          return '<button type="button" data-lineup-scope="' + entry[0] + '" aria-pressed="' + String(lineup.scope === entry[0]) + '">' + escape(entry[1]) + "</button>";
        }).join("");
    var rows = lineup.items.map(function (item) { return lineupRow(item, l); }).join("");
    var status = !summary || !summary.ready
      ? l.lineupUnavailable
      : lineup.loading
        ? l.lineupLoading
        : lineup.error
          ? lineup.error
          : !lineup.items.length && lineup.loaded
            ? l.lineupEmpty
            : l.lineupResults.replace("{shown}", lineup.items.length).replace("{total}", lineup.total);
    var notice = lineup.notice
      ? '<p class="lineup-state notice" aria-live="polite">' + escape(lineup.notice) + "</p>"
      : "";
    var create = lineup.scope === "personal-categories"
      ? '<form class="lineup-editor" data-create-category><label>' + escape(l.lineupCreateCategory) + '<input name="personalCategoryName" dir="auto" required></label><button type="submit">' + escape(l.lineupCreateCategory) + "</button></form>"
      : "";
    var bulk = lineup.scope === "categories"
      ? '<div class="lineup-bulk">' + ["live", "movie", "series"].map(function (kind) {
          var label = kind === "live" ? l.lineupChannels : kind === "movie" ? l.lineupMovies : l.lineupSeries;
          return '<button type="button" data-lineup-bulk="' + kind + '" data-hidden="true">' + escape(l.lineupBulkHide + " " + label) + '</button><button type="button" data-lineup-bulk="' + kind + '" data-hidden="false">' + escape(l.lineupBulkShow + " " + label) + "</button>";
        }).join("") + "</div>"
      : "";
    return '<section id="lineup" data-section="lineup" aria-busy="' + String(lineup.loading) + '"><h2>' + escape(l.lineup) + '</h2><div class="lineup-toolbar"><label>' +
      escape(l.playlists) + '<select data-lineup-playlist>' + playlists + '</select></label><label>' + escape(l.lineupOrder) +
      '<select data-lineup-order><option value="provider"' + (current.settings.lineupOrderMode === "provider" ? " selected" : "") + '>' + escape(l.orderProvider) + '</option><option value="alphabetical"' + (current.settings.lineupOrderMode === "alphabetical" ? " selected" : "") + '>' + escape(l.orderAlphabetical) +
      '</option><option value="number"' + (current.settings.lineupOrderMode === "number" ? " selected" : "") + '>' + escape(l.orderNumber) + '</option><option value="custom"' + (current.settings.lineupOrderMode === "custom" ? " selected" : "") + '>' + escape(l.orderCustom) +
      '</option></select></label><label>' + escape(l.lineupSearch) + '<input data-lineup-search type="search" dir="auto" value="' + escape(lineup.query) +
      '"></label><label class="setting"><span>' + escape(l.lineupRevealHidden) + '</span><input data-lineup-hidden type="checkbox"' +
      (lineup.includeHidden ? " checked" : "") + '></label></div><div class="lineup-scopes">' + scopes + "</div>" + bulk + create + lineupEditorMarkup(l) + notice +
      '<p class="lineup-state" aria-live="polite">' + escape(status) + '</p><ul class="lineup-list">' + rows + '</ul><div class="lineup-pagination">' +
      (lineup.nextCursor ? '<button type="button" data-lineup-more>' + escape(l.lineupLoadMore) + "</button>" : "") + "</div>" + anchorPickerMarkup(l) + "</section>";
  }

  function bindLineup() {
    var summary = current.lineup;
    if (summary && (lineup.playlistId !== summary.playlistId || lineup.revision !== summary.revision) && !lineup.loading) {
      var changedPlaylist = lineup.playlistId !== summary.playlistId;
      lineup.playlistId = summary.playlistId;
      lineup.revision = summary.revision;
      lineup.editor = null;
      lineup.anchorPicker = null;
      if (changedPlaylist) {
        lineup.notice = "";
        lineup.scope = "categories";
        lineup.categoryKey = "";
        lineup.categoryName = "";
        lineup.categoryPersonal = false;
      }
      resetLineupPage();
    }
    if (lineup.loading) {
      root.querySelectorAll("#lineup button, #lineup input, #lineup select").forEach(function (control) {
        control.disabled = true;
      });
    }
    root.querySelector("[data-lineup-playlist]")?.addEventListener("change", function (event) {
      lineup.editor = null;
      lineup.anchorPicker = null;
      lineup.notice = "";
      lineupRequestGeneration += 1;
      anchorRequestGeneration += 1;
      resetLineupPage();
      void sendCommand({ type: "playlist.activate", id: event.currentTarget.value }, false, event.currentTarget);
    });
    root.querySelector("[data-lineup-order]")?.addEventListener("change", function (event) {
      void sendLineupMutation({ type: "order.mode", mode: event.currentTarget.value }, event.currentTarget);
    });
    root.querySelectorAll("[data-lineup-scope]").forEach(function (button) {
      button.addEventListener("click", function () {
        lineup.scope = button.dataset.lineupScope;
        lineup.categoryKey = "";
        lineup.categoryName = "";
        lineup.categoryPersonal = false;
        lineup.membershipCategory = "";
        lineup.query = "";
        lineup.editor = null;
        lineup.anchorPicker = null;
        lineup.notice = "";
        lineupRequestGeneration += 1;
        resetLineupPage();
        void loadLineupPage(false);
      });
    });
    root.querySelector("[data-lineup-search]")?.addEventListener("input", function (event) {
      lineup.query = event.currentTarget.value;
      lineup.editor = null;
      lineup.anchorPicker = null;
      lineup.notice = "";
      lineupRequestGeneration += 1;
      if (lineupSearchTimer !== null) clearTimeout(lineupSearchTimer);
      lineupSearchTimer = setTimeout(function () {
        lineupSearchTimer = null;
        resetLineupPage();
        void loadLineupPage(false);
      }, 250);
    });
    root.querySelector("[data-lineup-hidden]")?.addEventListener("change", function (event) {
      lineup.includeHidden = event.currentTarget.checked;
      lineup.editor = null;
      lineup.anchorPicker = null;
      lineup.notice = "";
      lineupRequestGeneration += 1;
      resetLineupPage();
      void loadLineupPage(false);
    });
    root.querySelector("[data-lineup-more]")?.addEventListener("click", function () { void loadLineupPage(true); });
    root.querySelectorAll("[data-lineup-bulk]").forEach(function (button) {
      button.addEventListener("click", function () {
        void sendLineupMutation({ type: "categories.visibility", contentKind: button.dataset.lineupBulk, hidden: button.dataset.hidden === "true" }, button);
      });
    });
    root.querySelector("[data-create-category]")?.addEventListener("submit", function (event) {
      event.preventDefault();
      var value = event.currentTarget.elements.personalCategoryName.value;
      void sendLineupMutation({ type: "personal-category.create", name: value }, event.currentTarget.querySelector("button"));
    });
    root.querySelectorAll("[data-lineup-action]").forEach(function (button) {
      button.addEventListener("click", function () {
        var action = button.dataset.lineupAction;
        var item = lineup.items.find(function (entry) { return entry.id === button.dataset.id; });
        if (action === "rename" && item) {
          lineup.editor = { type: "rename", id: item.id, value: item.name, providerValue: item.providerName, kind: item.kind, returnFocus: focusDescriptor(button) };
          renderManage();
          root.querySelector('[name="lineupValue"]')?.focus();
        } else if (action === "number" && item) {
          lineup.editor = { type: "number", id: item.id, value: item.number, providerValue: item.providerNumber, kind: item.kind, returnFocus: focusDescriptor(button) };
          renderManage();
          root.querySelector('[name="lineupValue"]')?.focus();
        } else if (action === "visibility" && item) {
          var type = item.kind === "channel" ? "channel.visibility" : "category.visibility";
          var visibility = { type: type, hidden: button.dataset.hidden !== "true" };
          if (item.kind === "channel") visibility.channelId = item.id;
          else visibility.categoryKey = item.id;
          void sendLineupMutation(visibility, button);
        } else if ((action === "move-before" || action === "move-after") && item) {
          openLineupAnchorPicker(item.id, action === "move-before" ? "before" : "after", button);
        } else if (action === "delete-category" && item) {
          void sendLineupMutation({ type: "personal-category.delete", categoryId: item.id }, button);
        } else if (action === "open-members" && item) {
          lineup.scope = "channels";
          lineup.categoryKey = item.id;
          lineup.categoryName = item.name;
          lineup.categoryPersonal = item.kind === "personal-category";
          lineup.membershipCategory = item.kind === "personal-category" ? item.id : "";
          resetLineupPage();
          void loadLineupPage(false);
        } else if (action === "add-members" && item) {
          lineup.scope = "channels";
          lineup.categoryKey = "";
          lineup.categoryPersonal = false;
          lineup.membershipCategory = item.id;
          lineup.query = "";
          resetLineupPage();
          void loadLineupPage(false);
        } else if (action === "membership" && item) {
          var categoryId = lineup.membershipCategory || lineup.categoryKey;
          var ids = (item.personalCategoryIds || []).slice();
          var at = ids.indexOf(categoryId);
          if (at >= 0) ids.splice(at, 1);
          else ids.push(categoryId);
          void sendLineupMutation({ type: "personal-category.memberships", channelId: item.id, categoryIds: ids }, button);
        } else if (action === "remove-unavailable") {
          void sendLineupMutation({ type: "unavailable.remove", key: button.dataset.key }, button);
        } else if (action === "cancel-editor") {
          var editorFocus = lineup.editor?.returnFocus;
          lineup.editor = null;
          renderManage();
          restoreFocus(editorFocus);
        } else if (action === "restore" && lineup.editor) {
          var restore = lineup.editor.kind === "channel"
            ? { type: lineup.editor.type === "number" ? "channel.number" : "channel.rename", channelId: lineup.editor.id }
            : lineup.editor.kind === "personal-category"
              ? null
              : { type: "category.rename", categoryKey: lineup.editor.id };
          if (restore) {
            if (lineup.editor.type === "number") restore.number = null;
            else restore.name = null;
            void sendLineupMutation(restore, button);
          }
        } else if (action === "cancel-anchor") {
          var anchorFocus = lineup.anchorPicker?.returnFocus;
          lineup.anchorPicker = null;
          anchorRequestGeneration += 1;
          renderManage();
          restoreFocus(anchorFocus);
        }
      });
    });
    root.querySelector("[data-lineup-editor]")?.addEventListener("submit", function (event) {
      event.preventDefault();
      var editor = lineup.editor;
      var value = event.currentTarget.elements.lineupValue.value;
      if (!editor) return;
      editor.value = value;
      var mutation;
      if (editor.kind === "channel") {
        mutation = editor.type === "number"
          ? { type: "channel.number", channelId: editor.id, number: value ? Number(value) : null }
          : { type: "channel.rename", channelId: editor.id, name: value || null };
      } else if (editor.kind === "personal-category") {
        mutation = { type: "personal-category.rename", categoryId: editor.id, name: value };
      } else mutation = { type: "category.rename", categoryKey: editor.id, name: value || null };
      void sendLineupMutation(mutation, event.currentTarget.querySelector('button[type="submit"]'));
    });
    root.querySelector("[data-anchor-search]")?.addEventListener("input", function (event) {
      lineup.anchorPicker.query = event.currentTarget.value;
      anchorRequestGeneration += 1;
      if (anchorSearchTimer !== null) clearTimeout(anchorSearchTimer);
      anchorSearchTimer = setTimeout(function () {
        anchorSearchTimer = null;
        lineup.anchorPicker.items = [];
        lineup.anchorPicker.nextCursor = null;
        void loadLineupAnchors(false);
      }, 250);
    });
    root.querySelector("[data-anchor-more]")?.addEventListener("click", function () {
      void loadLineupAnchors(true);
    });
    root.querySelectorAll("[data-lineup-anchor]").forEach(function (button) {
      button.addEventListener("click", function () {
        var picker = lineup.anchorPicker;
        if (!picker) return;
        var placement = { itemId: picker.itemId };
        placement[picker.placement === "before" ? "beforeId" : "afterId"] = button.dataset.lineupAnchor;
        var mutation = lineup.scope === "channels"
          ? lineup.categoryPersonal
            ? { type: "personal-category.place-channel", categoryId: lineup.categoryKey, placement: placement }
            : { type: "channel.place", categoryKey: lineup.categoryKey, placement: placement }
          : { type: "category.place", placement: placement };
        void sendLineupMutation(mutation, button);
      });
    });
    if (summary && summary.ready && !lineup.loaded && !lineup.loading) void loadLineupPage(false);
  }

  function renderManage(message, failed) {
    var l = labels();
    applyLocale();
    var visiblePlaylists = expandedPlaylists ? current.playlists : current.playlists.slice(0, 5);
    var playlists = visiblePlaylists
      .map(function (playlist) {
        if (editingPlaylist === playlist.id) {
          var editSourceFields = editingPlaylistSource === "m3u"
            ? '<label>' + escape(l.playlistAddress) + '<input name="editUrl" type="url" inputmode="url" dir="ltr" value="' + escape(editingPlaylistDraft.url) + '" required></label>'
            : xtreamFields("edit", editingPlaylistDraft, l);
          return (
            '<form class="playlist edit-card credential-card" data-edit-playlist data-return-action="edit-playlist" data-id="' +
            escape(playlist.id) + '">' + sourceOptions(editingPlaylistSource, l) +
            '<div class="add-source-fields">' + editSourceFields + '<label>' + escape(l.playlistName) +
            '<input name="editName" value="' + escape(editingPlaylistDraft.name) + '"></label></div>' +
            '<div class="add-actions"><button type="submit">' + escape(l.save) +
            '</button><button class="quiet" type="button" data-action="cancel-edit-playlist">' +
            escape(l.cancel) + "</button></div></form>"
          );
        }
        return (
          '<article class="playlist compact-row"><div><strong>' +
          escape(playlist.name) +
          '</strong><span dir="ltr">' +
          escape(sourceAddress(playlist.source)) +
          "</span>" + accountStatus(playlist.account, l) + "</div>" +
          (playlist.id === current.activePlaylistId
            ? '<em>' + escape(l.active) + "</em>"
            : "") +
          '<button class="row-menu" type="button" data-action="open-item-menu" data-kind="playlist" data-id="' +
          escape(playlist.id) +
          '" aria-label="' + escape(l.edit + " " + playlist.name) + '">' + icon("more") + '</button></article>'
        );
      })
      .join("");
    var visibleDevices = expandedDevices ? current.devices : current.devices.slice(0, 5);
    var devices = current.devices.length
      ? visibleDevices
          .map(function (device) {
            if (editingDevice === device.id) {
              return (
                '<form class="device edit-card" data-edit-device data-return-action="rename-device" data-id="' +
                escape(device.id) +
                '"><label>' + escape(l.deviceName) + '<input name="editDeviceName" value="' +
                escape(device.name) +
                '" required></label><button type="submit">' + escape(l.save) +
                '</button><button class="quiet" type="button" data-action="cancel-edit-device">' +
                escape(l.cancel) + "</button></form>"
              );
            }
            return (
              '<article class="device compact-row"><div><strong>' +
              escape(device.name) +
              "</strong></div>" +
              (auth && device.id === auth.deviceId ? '<em class="self-badge">' + escape(l.thisDevice) + "</em>" : "") +
              '<button class="row-menu" type="button" data-action="open-item-menu" data-kind="device" data-id="' +
              escape(device.id) +
              '" aria-label="' + escape(l.rename + " " + device.name) + '">' + icon("more") + '</button></article>'
            );
          })
          .join("")
      : '<p class="muted">' + escape(l.noDevices) + "</p>";
    var appearance = '<section id="appearance" data-section="appearance"><h2>' +
      escape(l.appearance) + "</h2>" +
      settingSelect("locale", l.language, (current.localeOptions || []).map(function (option) { return [option.id, option.label]; })) +
      settingSelect("fontSizeId", l.textSize, [["s", l.small], ["m", l.medium], ["l", l.large], ["xl", l.extraLarge]]) +
      settingToggle("showNumbers", l.showNumbers) + settingToggle("showLogos", l.showLogos) +
      settingToggle("showClock", l.showClock) +
      settingSelect("lineupOrderMode", l.lineupOrder, [["provider", l.orderProvider], ["alphabetical", l.orderAlphabetical], ["number", l.orderNumber], ["custom", l.orderCustom]]) + "</section>";
    var playback = '<section id="playback" data-section="playback"><h2>' + escape(l.playback) + "</h2>" +
      settingSelect("aspectId", l.screenFit, [["fill", l.fill], ["fit", l.fit], ["stretch", l.stretch]]) +
      settingToggle("resumeLast", l.resumeLast) + settingToggle("showPlaybackStats", l.playbackInfo) +
      settingToggle("compatibility", l.compatibility) +
      settingToggle("continuousReconnect", l.continuousReconnect) + "</section>";
    var playlistToggle = current.playlists.length > 5
      ? '<button type="button" class="list-toggle" data-action="toggle-playlists">' +
        escape(expandedPlaylists ? l.close : l.open + " " + l.playlists + " (" + current.playlists.length + ")") +
        icon(expandedPlaylists ? "up" : "down") + '</button>'
      : "";
    var deviceToggle = current.devices.length > 5
      ? '<button type="button" class="list-toggle" data-action="toggle-devices">' +
        escape(expandedDevices ? l.close : l.open + " " + l.devices + " (" + current.devices.length + ")") +
        icon(expandedDevices ? "up" : "down") + '</button>'
      : "";
    var addSourceFields = addPlaylistSource === "m3u"
      ? '<label>' + escape(l.playlistAddress) + '<input name="newUrl" type="url" inputmode="url" dir="ltr" aria-label="' + escape(l.playlistAddress) + '" value="' + escape(addPlaylistDraft.url) + '"></label>'
      : xtreamFields("new", addPlaylistDraft, l);
    var addPlaylist = addPlaylistOpen
      ? '<div class="add-card">' + sourceOptions(addPlaylistSource, l) + '<div class="add-source-fields">' +
        addSourceFields + '<label>' + escape(l.playlistName) + '<input name="newName" aria-label="' + escape(l.playlistName) + '" value="' +
        escape(addPlaylistDraft.name) + '"></label></div><div class="add-actions"><button type="button" data-action="add-playlist">' + escape(l.addPlaylist) +
        '</button><button class="quiet" type="button" data-action="close-add-playlist">' + escape(l.cancel) + "</button></div></div>"
      : "";
    var playlistSection = '<section id="playlists" data-section="playlists"><div class="section-title-row"><h2>' +
      escape(l.playlists) + '</h2><button class="section-add' + (addPlaylistOpen ? " open" : "") +
      '" type="button" data-action="' + (addPlaylistOpen ? "close-add-playlist" : "open-add-playlist") +
      '" aria-label="' + escape(addPlaylistOpen ? l.cancel : l.addPlaylist) +
      '">' + icon("plus") + '</button></div>' +
      addPlaylist + '<div class="stack">' + playlists + "</div>" + playlistToggle + "</section>";
    var lineupSection = renderLineup();
    var deviceSection = '<section id="devices" data-section="devices"><h2>' + escape(l.devices) +
      '</h2><p class="trusted-network">' + escape(l.trustedNetwork) + '</p><div class="stack">' +
      devices + "</div>" + deviceToggle + "</section>";
    var aboutSection = '<section id="about" data-section="about"><h2>' + escape(l.about) +
      '</h2><div class="about-card"><div class="about-brand"><img src="/icon.svg" alt=""><div><strong>OpenIPTV</strong><span>' +
      escape(l.aboutVersion) + '</span></div></div><p>' + escape(l.aboutDescription) +
      '</p><p class="muted">' + escape(l.aboutDisclaimer) + '</p><a class="repository-link" dir="ltr" href="' +
      escape(current.about.repository) + '" target="_blank" rel="noopener noreferrer">' +
      escape(current.about.repository) + '</a></div><div class="about-data"><h3>' + escape(l.applicationData) +
      '</h3><button class="secondary danger" type="button" data-action="clear-cache">' + escape(l.cache) +
      "</button></div></section>";

    shell(
      '<nav class="tabs" aria-label="' + escape(l.title) + '"><span class="tab-selection" aria-hidden="true"></span><a href="#appearance" aria-current="page">' + navIcon("appearance") + escape(l.appearance) +
        '</a><a href="#playback">' + navIcon("playback") + escape(l.playback) +
        '</a><a href="#playlists">' + navIcon("playlists") + escape(l.playlists) + '</a><a href="#lineup">' + navIcon("playlists") + escape(l.lineup) + '</a><a href="#devices">' + navIcon("devices") + escape(l.devices) +
        '</a><a href="#about">' + navIcon("about") + escape(l.about) +
        "</a></nav>" + appearance + playback + playlistSection + lineupSection + deviceSection + aboutSection + itemMenuMarkup(l) + remoteMarkup(l),
      message,
      !!failed,
    );
    bindManagement();
    bindLineup();
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
      lineupAnchor: source.dataset && source.dataset.lineupAnchor,
      anchorMore: source.hasAttribute && source.hasAttribute("data-anchor-more"),
      id: source.dataset && source.dataset.id,
      setting: source.dataset && source.dataset.setting,
      name: source.name,
    };
  }

  function restoreFocus(target) {
    if (!target) return;
    setTimeout(function () {
      var controls = Array.from(root.querySelectorAll("button, input, select"));
      var control = controls.find(function (item) {
        if (target.setting) return item.dataset.setting === target.setting;
        if (target.lineupAction) {
          return item.dataset.lineupAction === target.lineupAction && (!target.id || item.dataset.id === target.id);
        }
        if (target.lineupScope) return item.dataset.lineupScope === target.lineupScope;
        if (target.lineupAnchor) return item.dataset.lineupAnchor === target.lineupAnchor;
        if (target.anchorMore) return item.hasAttribute("data-anchor-more");
        if (target.action) return item.dataset.action === target.action && (!target.id || item.dataset.id === target.id);
        return target.name && item.name === target.name;
      });
      control?.focus();
    }, 0);
  }

  function commandFailure(reason, setup) {
    var l = labels();
    if (reason === "invalid") return l.invalidUrl;
    if (setup && reason === "failed") return l.setupLoadFailed;
    return l.changeFailed;
  }

  async function sendCommand(command, setup, source, started) {
    var returnFocus = focusDescriptor(source);
    var previousPlaylist = current.playlists.find(function (playlist) {
      return playlist.id === command.id;
    });
    var loadsPlaylist =
      command.type === "playlist.activate" ||
      command.type === "playlist.refresh" ||
      (command.type === "playlist.remove" && command.id === current.activePlaylistId) ||
      (command.type === "playlist.update" &&
        command.id === current.activePlaylistId &&
        previousPlaylist &&
        JSON.stringify(previousPlaylist.source) !== JSON.stringify(command.source));
    if (!started && (busy || !beginOperation(setup ? labels().checkingPlaylist : labels().saving, source))) {
      return;
    }
    var response = await request("/api/v1/command", {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify({ id: commandId(), revision: current.revision, command: command }),
    });
    if (!response) return;
    if (response.body && response.body.snapshot) current = response.body.snapshot;
    if (response.status === 409) {
      if (setup) renderSetupResult(false, labels().setupFailedTitle, labels().conflict);
      else renderManage(labels().conflict, true);
      restoreFocus(returnFocus);
      return;
    }
    if (response.status !== 200) {
      var failed = commandFailure(response.body && response.body.reason, setup);
      if (setup) renderSetupResult(false, labels().setupFailedTitle, failed);
      else renderManage(failed, true);
      restoreFocus(returnFocus);
      return;
    }
    if (command.type === "setting" && command.key !== "locale") {
      finishOperation(labels().saved, false);
      restoreFocus(returnFocus);
      return;
    }
    if (command.type === "device.revoke" && auth && command.id === auth.deviceId) {
      saveAuth(null);
      renderPair(labels().revoked);
      return;
    }
    if (!current.playlists.length) {
      var setupSource = current.setup && current.setup.source;
      setupDraft = Object.assign({}, setupDraft, {
        locale: current.settings.locale,
        name: current.setup?.name ?? "",
        url: setupSource && setupSource.kind === "m3u" ? setupSource.url : "",
        server: setupSource && setupSource.kind === "xtream" ? setupSource.server : "",
        username: setupSource && setupSource.kind === "xtream" ? setupSource.username : "",
        password: "",
        output: setupSource && setupSource.kind === "xtream" ? setupSource.output : "m3u8",
      });
      if (setup) {
        renderSetupResult(
          false,
          labels().setupFailedTitle,
          current.operation.error || labels().setupLoadFailed,
        );
      } else renderSetup(labels().saved, true);
    } else if (setup && current.operation && current.operation.error) {
      renderSetupResult(false, labels().setupFailedTitle, current.operation.error);
    } else if (loadsPlaylist && current.operation && current.operation.error) {
      renderManage(current.operation.error, true);
    } else if (setup) {
      renderSetupResult(true, labels().setupCompleteTitle, labels().setupCompleteBody);
    }
    else renderManage(labels().saved, false);
    restoreFocus(returnFocus);
  }

  async function sendRemoteKey(code) {
    var response = await request("/api/v1/command", {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify({
        id: commandId(),
        revision: current.revision,
        command: { type: "remote.key", code: code },
      }),
    });
    if (!response) return;
    if (response.body && response.body.snapshot) current = response.body.snapshot;
    if (response.status !== 200) operationStatus(labels().changeFailed, true, false);
  }

  function bindManagement() {
    var tabSelection = root.querySelector(".tab-selection");
    var tabLinks = root.querySelectorAll(".tabs a");
    var selectTab = function (link) {
      tabLinks.forEach(function (item) { item.removeAttribute("aria-current"); });
      link.setAttribute("aria-current", "page");
      tabSelection.style.width = link.offsetWidth + "px";
      tabSelection.style.transform = "translateX(" + link.offsetLeft + "px)";
    };
    tabLinks.forEach(function (link) {
      link.addEventListener("click", function () {
        selectTab(link);
        link.scrollIntoView?.({
          behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth",
          block: "nearest",
          inline: "center",
        });
      });
    });
    requestAnimationFrame(function () {
      var initialTab = window.location.hash
        ? root.querySelector('.tabs a[href="' + window.location.hash + '"]')
        : null;
      selectTab(initialTab || tabLinks[0]);
    });
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
    var itemMenu = root.querySelector("[data-item-menu]");
    var itemMenuTitle = root.querySelector("[data-item-menu-title]");
    var itemMenuActions = root.querySelector("[data-item-menu-actions]");
    document.body.querySelectorAll("[data-item-menu-root]").forEach(function (menu) {
      menu.remove();
    });
    itemMenu.dataset.itemMenuRoot = "true";
    document.body.appendChild(itemMenu);
    var itemMenuSource = null;
    var itemMenuTimer = null;
    var closeItemMenu = function (restoreFocus) {
      itemMenu.classList.remove("open");
      itemMenuTimer = setTimeout(function () {
        itemMenu.hidden = true;
        itemMenuTimer = null;
      }, 240);
      if (restoreFocus !== false) itemMenuSource?.focus({ preventScroll: true });
    };
    root.querySelectorAll("[data-action=open-item-menu]").forEach(function (button) {
      button.addEventListener("click", function () {
        var kind = button.dataset.kind;
        var id = button.dataset.id;
        var item = kind === "playlist"
          ? current.playlists.find(function (entry) { return entry.id === id; })
          : current.devices.find(function (entry) { return entry.id === id; });
        if (!item) return;
        if (itemMenuTimer !== null) clearTimeout(itemMenuTimer);
        itemMenuTimer = null;
        itemMenuSource = button;
        itemMenu.dataset.kind = kind;
        itemMenu.dataset.id = id;
        itemMenuTitle.textContent = item.name;
        itemMenuActions.innerHTML = kind === "playlist"
          ? (id === current.activePlaylistId
              ? ""
              : '<button type="button" data-menu-action="activate">' + escape(labels().activate) + "</button>") +
            '<button type="button" data-menu-action="edit">' + escape(labels().edit) + "</button>" +
            (id === current.activePlaylistId
              ? '<button type="button" data-menu-action="refresh">' + escape(labels().refresh) + "</button>"
              : "") +
            '<button type="button" class="danger" data-menu-action="remove">' + escape(labels().remove) + "</button>"
          : '<button type="button" data-menu-action="rename">' + escape(labels().rename) +
            '</button><button type="button" class="danger" data-menu-action="revoke">' + escape(labels().revoke) + "</button>";
        itemMenu.classList.remove("open");
        itemMenu.hidden = false;
        void itemMenu.offsetHeight;
        requestAnimationFrame(function () {
          itemMenu.classList.add("open");
          itemMenuActions.querySelector("button")?.focus({ preventScroll: true });
        });
      });
    });
    itemMenu.querySelectorAll("[data-action=close-item-menu]").forEach(function (button) {
      button.addEventListener("click", function () { closeItemMenu(true); });
    });
    itemMenuActions.addEventListener("click", function (event) {
      var button = event.target.closest("[data-menu-action]");
      if (!button) return;
      var kind = itemMenu.dataset.kind;
      var id = itemMenu.dataset.id;
      var action = button.dataset.menuAction;
      var playlist = current.playlists.find(function (entry) { return entry.id === id; });
      var device = current.devices.find(function (entry) { return entry.id === id; });
      if (action === "edit" && playlist) {
        beginPlaylistEdit(playlist);
        closeItemMenu(false);
        renderManage();
        root.querySelector(editingPlaylistSource === "m3u" ? '[name="editUrl"]' : '[name="editServer"]')?.focus();
      } else if (action === "rename" && device) {
        editingDevice = id;
        closeItemMenu(false);
        renderManage();
        root.querySelector('[name="editDeviceName"]')?.focus();
      } else if (action === "activate") {
        closeItemMenu(false);
        void sendCommand({ type: "playlist.activate", id: id }, false, button);
      } else if (action === "refresh") {
        closeItemMenu(false);
        void sendCommand({ type: "playlist.refresh" }, false, button);
      } else if (action === "remove" && playlist && confirm(playlist.name + "\n\n" + labels().removeConfirm)) {
        closeItemMenu(false);
        void sendCommand({ type: "playlist.remove", id: id }, false, button);
      } else if (action === "revoke" && device) {
        var warning = auth && id === auth.deviceId ? labels().revokeSelfConfirm : labels().revokeConfirm;
        if (confirm(device.name + "\n\n" + warning)) {
          closeItemMenu(false);
          void sendCommand({ type: "device.revoke", id: id }, false, button);
        }
      }
    });
    root.querySelector("[data-action=toggle-playlists]")?.addEventListener("click", function () {
      expandedPlaylists = !expandedPlaylists;
      renderManage();
      root.querySelector("#playlists")?.scrollIntoView({ block: "start" });
    });
    root.querySelector("[data-action=toggle-devices]")?.addEventListener("click", function () {
      expandedDevices = !expandedDevices;
      renderManage();
      root.querySelector("#devices")?.scrollIntoView({ block: "start" });
    });
    root.querySelector("[data-action=open-add-playlist]")?.addEventListener("click", function () {
      addPlaylistOpen = true;
      addPlaylistSource = "m3u";
      addPlaylistDraft = {
        name: "",
        url: "",
        server: "",
        username: "",
        password: "",
        output: "m3u8",
      };
      renderManage();
      root.querySelector('[name="newUrl"]')?.focus();
    });
    root.querySelectorAll(".add-card [data-source]").forEach(function (button) {
      button.addEventListener("click", function () {
        addPlaylistDraft = readAddPlaylistDraft();
        addPlaylistSource = button.dataset.source;
        renderManage();
        root.querySelector(addPlaylistSource === "m3u" ? '[name="newUrl"]' : '[name="newServer"]')?.focus();
      });
    });
    root.querySelectorAll("[data-action=close-add-playlist]").forEach(function (button) {
      button.addEventListener("click", function () {
        addPlaylistOpen = false;
        renderManage();
        root.querySelector("[data-action=open-add-playlist]")?.focus();
      });
    });
    var add = root.querySelector("[data-action=add-playlist]");
    if (add) add.addEventListener("click", function () {
      addPlaylistDraft = readAddPlaylistDraft();
      var name = addPlaylistDraft.name.trim();
      var source = sourceFromDraft(addPlaylistSource, addPlaylistDraft);
      if (!sourceAddress(source)) {
        operationStatus(labels().invalidUrl, true);
        return;
      }
      addPlaylistOpen = false;
      void sendCommand({ type: "playlist.add", name: name, source: source }, false, add);
    });
    root.querySelectorAll("[data-action=edit-playlist]").forEach(function (button) {
      button.addEventListener("click", function () {
        var playlist = current.playlists.find(function (entry) { return entry.id === button.dataset.id; });
        if (!playlist) return;
        beginPlaylistEdit(playlist);
        renderManage();
        root.querySelector(editingPlaylistSource === "m3u" ? '[name="editUrl"]' : '[name="editServer"]')?.focus();
      });
    });
    root.querySelectorAll(".credential-card [data-source]").forEach(function (button) {
      button.addEventListener("click", function () {
        editingPlaylistDraft = readEditPlaylistDraft();
        editingPlaylistSource = button.dataset.source;
        renderManage();
        root.querySelector(editingPlaylistSource === "m3u" ? '[name="editUrl"]' : '[name="editServer"]')?.focus();
      });
    });
    var editPlaylist = root.querySelector("[data-edit-playlist]");
    if (editPlaylist) {
      editPlaylist.addEventListener("submit", function (event) {
        event.preventDefault();
        var id = editPlaylist.dataset.id;
        editingPlaylistDraft = readEditPlaylistDraft();
        var name = editingPlaylistDraft.name.trim();
        var source = sourceFromDraft(editingPlaylistSource, editingPlaylistDraft);
        if (!sourceAddress(source)) {
          operationStatus(labels().invalidUrl, true);
          return;
        }
        editingPlaylist = "";
        void sendCommand(
          { type: "playlist.update", id: id, name: name, source: source },
          false,
          editPlaylist,
        );
      });
      editPlaylist.querySelector("[data-action=cancel-edit-playlist]").addEventListener("click", function () {
        var id = editingPlaylist;
        editingPlaylist = "";
        renderManage();
        root.querySelector('[data-action="edit-playlist"][data-id="' + id + '"]')?.focus();
      });
    }
    var refresh = root.querySelector("[data-action=refresh-playlist]");
    if (refresh) {
      refresh.addEventListener("click", function () {
        void sendCommand({ type: "playlist.refresh" }, false, refresh);
      });
    }
    root.querySelectorAll("[data-action=remove-playlist]").forEach(function (button) {
      button.addEventListener("click", function () {
        var playlist = current.playlists.find(function (item) { return item.id === button.dataset.id; });
        if (confirm((playlist ? playlist.name + "\n\n" : "") + labels().removeConfirm)) {
          void sendCommand(
            { type: "playlist.remove", id: button.dataset.id },
            false,
            button,
          );
        }
      });
    });
    root.querySelectorAll("[data-action=activate-playlist]").forEach(function (button) {
      button.addEventListener("click", function () {
        void sendCommand(
          { type: "playlist.activate", id: button.dataset.id },
          false,
          button,
        );
      });
    });
    root.querySelectorAll("[data-setting]").forEach(function (control) {
      control.addEventListener("change", function () {
        var value = control.type === "checkbox" ? control.checked : control.value;
        void sendCommand(
          { type: "setting", key: control.dataset.setting, value: value },
          false,
          control,
        );
      });
    });
    root.querySelector("[data-action=clear-cache]").addEventListener("click", function () {
      if (confirm(labels().cacheConfirm)) {
        void sendCommand({ type: "cache.clear" }, false, root.querySelector("[data-action=clear-cache]"));
      }
    });
    root.querySelectorAll("[data-action=rename-device]").forEach(function (button) {
      button.addEventListener("click", function () {
        editingDevice = button.dataset.id;
        renderManage();
        root.querySelector('[name="editDeviceName"]')?.focus();
      });
    });
    var editDevice = root.querySelector("[data-edit-device]");
    if (editDevice) {
      editDevice.addEventListener("submit", function (event) {
        event.preventDefault();
        var id = editDevice.dataset.id;
        var name = editDevice.elements.editDeviceName.value.trim();
        if (!name) return;
        editingDevice = "";
        void sendCommand({ type: "device.rename", id: id, name: name }, false, editDevice);
      });
      editDevice.querySelector("[data-action=cancel-edit-device]").addEventListener("click", function () {
        var id = editingDevice;
        editingDevice = "";
        renderManage();
        root.querySelector('[data-action="rename-device"][data-id="' + id + '"]')?.focus();
      });
    }
    root.querySelectorAll("[data-action=revoke-device]").forEach(function (button) {
      button.addEventListener("click", function () {
        var device = current.devices.find(function (item) { return item.id === button.dataset.id; });
        var warning = auth && button.dataset.id === auth.deviceId
          ? labels().revokeSelfConfirm
          : labels().revokeConfirm;
        if (confirm((device ? device.name + "\n\n" : "") + warning)) {
          void sendCommand(
            { type: "device.revoke", id: button.dataset.id },
            false,
            button,
          );
        }
      });
    });
  }

  async function loadState() {
    var loaded = await request("/api/v1/state", { headers: headers(false) });
    if (!loaded) return;
    if (loaded.status !== 200) {
      renderUnavailable();
      return;
    }
    current = loaded.body;
    applyLocale();
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
    if (current.playlists.length) renderManage();
    else renderSetup();
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

  window.OpenIPTVRemote = {
    start: start,
    parsePairSecret: parsePairSecret,
    renderLineup: renderLineup,
    bindLineup: bindLineup,
    loadLineupPage: loadLineupPage,
    sendLineupMutation: sendLineupMutation,
    openLineupAnchorPicker: openLineupAnchorPicker,
  };
  if (!window.__OPENIPTV_TEST__) void start();
})();
