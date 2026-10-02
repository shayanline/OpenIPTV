(function () {
  var root = document.getElementById("app");
  var auth = readAuth();
  var current = null;
  var busy = false;
  var previewTimer = null;
  var toastTimer = null;
  var previewQueue = Promise.resolve();
  var setupDraft = { locale: "system", name: "", url: "" };
  var editingPlaylist = "";
  var editingDevice = "";
  var expandedPlaylists = false;
  var expandedDevices = false;
  var addPlaylistOpen = false;
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
    sortAlphabetically: "Sort channels alphabetically",
    screenFit: "Screen fit",
    fill: "Fill",
    fit: "Fit",
    stretch: "Stretch",
    compatibility: "Compatibility mode",
    playbackInfo: "Playback information",
    resumeLast: "Resume last channel",
    applicationData: "Application data",
    noDevices: "No devices are authorised.",
    thisDevice: "This device",
    rename: "Rename",
    revoke: "Remove access",
    revokeConfirm: "This device will need to scan a new QR code before it can connect again.",
    revokeSelfConfirm:
      "This is the device you are using. Removing access will disconnect it, and you will need to add it again.",
    save: "Save",
    open: "Open",
    close: "Close",
    cancel: "Cancel",
  };

  var navIcons = {
    appearance: '<path d="M5.6 19.4L11.4 4.8h1.2l5.8 14.6"/><path d="M8.1 14.6h7.8"/>',
    playback: '<rect x="2.6" y="5" width="18.8" height="13" rx="2.2"/><path d="M8.6 21h6.8"/>',
    playlists: '<circle cx="4.9" cy="7" r="1.1"/><circle cx="4.9" cy="12" r="1.1"/><circle cx="4.9" cy="17" r="1.1"/><path d="M9.4 7h10.2M9.4 12h10.2M9.4 17h10.2"/>',
    devices: '<rect x="2.7" y="4.4" width="12.8" height="11.2" rx="2"/><path d="M6.7 19.6h4.8M9.1 15.6v4M19.1 8.1c1.2.9 1.9 2.3 1.9 3.9s-.7 3-1.9 3.9M20.5 5.7c1.6 1.5 2.5 3.8 2.5 6.3s-.9 4.8-2.5 6.3"/>',
    about: '<circle cx="12" cy="12" r="9"/><path d="M12 11.2v5.4M12 7.6v.1"/>',
  };

  function navIcon(name) {
    var solid = name === "general";
    return '<svg class="tab-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="' +
      (solid ? "currentColor" : "none") + '" stroke="' + (solid ? "none" : "currentColor") +
      '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + navIcons[name] + "</svg>";
  }

  function remoteMarkup(l) {
    var digits = "";
    for (var digit = 1; digit <= 9; digit += 1) {
      digits += '<button type="button" data-remote-key="' + (48 + digit) + '">' + digit + "</button>";
    }
    digits += '<span></span><button type="button" data-remote-key="48">0</button><span></span>';
    return (
      '<button type="button" class="remote-fab" data-action="open-remote" aria-label="Smart Remote" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="4"/><circle cx="12" cy="9" r="2.5"/><path d="M9.5 15h5M10.5 18h3"/></svg></button>' +
      '<div class="remote-overlay" data-remote-overlay hidden><button type="button" class="remote-backdrop" data-action="close-remote" aria-label="' + escape(l.remoteClose) + '"></button><section class="remote-sheet" role="dialog" aria-modal="true" aria-labelledby="remote-title"><header><h2 id="remote-title">Smart Remote</h2><button type="button" class="remote-close" data-action="close-remote" aria-label="' + escape(l.remoteClose) + '">×</button></header><div class="remote-carousel" data-remote-carousel><div class="remote-track" data-remote-track>' +
      '<div class="remote-page"><div class="mobile-remote"><div class="touch-dpad"><button type="button" class="touch-key up" data-remote-key="38" aria-label="' + escape(l.remoteUp) + '"><i></i></button><button type="button" class="touch-key right" data-remote-key="39" aria-label="' + escape(l.remoteRight) + '"><i></i></button><button type="button" class="touch-key down" data-remote-key="40" aria-label="' + escape(l.remoteDown) + '"><i></i></button><button type="button" class="touch-key left" data-remote-key="37" aria-label="' + escape(l.remoteLeft) + '"><i></i></button><button type="button" class="touch-key ok" data-remote-key="13" aria-label="' + escape(l.remoteSelect) + '">OK</button></div><div class="touch-primary"><button type="button" data-remote-key="10009" aria-label="' + escape(l.remoteReturn) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6.5L4.5 11 9 15.5"/><path d="M4.5 11h9a6 6 0 0 1 0 12h-2"/></svg><span>' + escape(l.remoteReturn) + '</span></button><button type="button" data-remote-key="10252" aria-label="' + escape(l.remotePlayPause) + '"><svg viewBox="0 0 24 24" aria-hidden="true" class="filled"><path d="M4 4.5l9 7.5-9 7.5z"/><rect x="15" y="4.5" width="2.4" height="15" rx="1"/><rect x="19.2" y="4.5" width="2.4" height="15" rx="1"/></svg><span>Play/Pause</span></button></div><div class="touch-rockers"><div class="touch-rocker"><span>VOL</span><div><button type="button" data-remote-key="448" aria-label="' + escape(l.remoteVolumeUp) + '">+</button><button type="button" data-remote-key="449" aria-label="' + escape(l.remoteVolumeDown) + '">−</button></div></div><div class="touch-rocker"><span>CH</span><div><button type="button" data-remote-key="427" aria-label="' + escape(l.remoteChannelUp) + '">+</button><button type="button" data-remote-key="428" aria-label="' + escape(l.remoteChannelDown) + '">−</button></div></div></div></div></div>' +
      '<div class="remote-page"><div class="remote-keypad"><div class="keypad-digits">' + digits + '</div><div class="keypad-transport"><button type="button" data-remote-key="10232" aria-label="' + escape(l.remotePrevious) + '">|◀</button><button type="button" data-remote-key="412" aria-label="' + escape(l.remoteRewind) + '"><svg class="transport-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5.5v13L3 12z"/><path d="M21 5.5v13l-8-6.5z"/></svg></button><button type="button" data-remote-key="413" aria-label="' + escape(l.remoteStop) + '">■</button><button type="button" data-remote-key="417" aria-label="' + escape(l.remoteFastForward) + '"><svg class="transport-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 5.5v13l8-6.5z"/><path d="M3 5.5v13l8-6.5z"/></svg></button><button type="button" data-remote-key="10233" aria-label="' + escape(l.remoteNext) + '">▶|</button></div><div class="keypad-colours"><button type="button" class="red" data-remote-key="403" aria-label="' + escape(l.remoteRed) + '"></button><button type="button" class="green" data-remote-key="404" aria-label="' + escape(l.remoteGreen) + '"></button><button type="button" class="yellow" data-remote-key="405" aria-label="' + escape(l.remoteYellow) + '"></button><button type="button" class="blue" data-remote-key="406" aria-label="' + escape(l.remoteBlue) + '"></button></div></div></div></div></div><div class="remote-pages" role="tablist" aria-label="Remote pages"><button type="button" data-remote-page="0" aria-label="Main controls" aria-selected="true"></button><button type="button" data-remote-page="1" aria-label="Keypad controls" aria-selected="false"></button></div></section></div>'
    );
  }

  function itemMenuMarkup(l) {
    return (
      '<div class="item-menu-overlay" data-item-menu hidden><button type="button" class="item-menu-backdrop" data-action="close-item-menu" aria-label="' +
      escape(l.close) + '"></button><section class="item-menu-sheet" role="dialog" aria-modal="true" aria-labelledby="item-menu-title"><header><strong id="item-menu-title" data-item-menu-title></strong><button type="button" class="item-menu-close" data-action="close-item-menu" aria-label="' +
      escape(l.close) + '">×</button></header><div class="item-menu-actions" data-item-menu-actions></div></section></div>'
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
    return {
      locale: form.elements.locale.value,
      name: form.elements.playlistName.value,
      url: form.elements.playlistUrl.value,
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
          url: draft.url,
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
    shell(
      '<section class="setup"><h1>' +
        escape(l.setupTitle) +
        '</h1><form><label>' +
        escape(l.playlistAddress) +
        '<input name="playlistUrl" type="url" inputmode="url" dir="ltr" value="' +
        escape(setupDraft.url) +
        '" required></label><label>' +
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
    form.elements.playlistName.addEventListener("input", function () {
      queueSetupPreview(form, false);
    });
    form.elements.playlistUrl.addEventListener("input", function () {
      queueSetupPreview(form, false);
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
          url: setupDraft.url,
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

  function renderManage(message, failed) {
    var l = labels();
    applyLocale();
    var visiblePlaylists = expandedPlaylists ? current.playlists : current.playlists.slice(0, 5);
    var playlists = visiblePlaylists
      .map(function (playlist) {
        if (editingPlaylist === playlist.id) {
          return (
            '<form class="playlist edit-card" data-edit-playlist data-return-action="edit-playlist" data-id="' +
            escape(playlist.id) +
            '"><label>' +
            escape(l.playlistAddress) +
            '<input name="editUrl" type="url" inputmode="url" dir="ltr" value="' +
            escape(playlist.url) +
            '" required></label><label>' +
            escape(l.playlistName) +
            '<input name="editName" value="' +
            escape(playlist.name) +
            '"></label><button type="submit">' +
            escape(l.save) +
            '</button><button class="quiet" type="button" data-action="cancel-edit-playlist">' +
            escape(l.cancel) +
            "</button></form>"
          );
        }
        return (
          '<article class="playlist compact-row"><div><strong>' +
          escape(playlist.name) +
          '</strong><span dir="ltr">' +
          escape(playlist.url) +
          "</span></div>" +
          (playlist.id === current.activePlaylistId
            ? '<em>' + escape(l.active) + "</em>"
            : "") +
          '<button class="row-menu" type="button" data-action="open-item-menu" data-kind="playlist" data-id="' +
          escape(playlist.id) +
          '" aria-label="' + escape(l.edit + " " + playlist.name) + '"><i></i><i></i><i></i></button></article>'
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
              '" aria-label="' + escape(l.rename + " " + device.name) + '"><i></i><i></i><i></i></button></article>'
            );
          })
          .join("")
      : '<p class="muted">' + escape(l.noDevices) + "</p>";
    var appearance = '<section id="appearance" data-section="appearance"><h2>' +
      escape(l.appearance) + "</h2>" +
      settingSelect("locale", l.language, (current.localeOptions || []).map(function (option) { return [option.id, option.label]; })) +
      settingSelect("fontSizeId", l.textSize, [["s", l.small], ["m", l.medium], ["l", l.large], ["xl", l.extraLarge]]) +
      settingToggle("showNumbers", l.showNumbers) + settingToggle("showLogos", l.showLogos) +
      settingToggle("showClock", l.showClock) + settingToggle("sortAlphabetically", l.sortAlphabetically) + "</section>";
    var playback = '<section id="playback" data-section="playback"><h2>' + escape(l.playback) + "</h2>" +
      settingSelect("aspectId", l.screenFit, [["fill", l.fill], ["fit", l.fit], ["stretch", l.stretch]]) +
      settingToggle("resumeLast", l.resumeLast) + settingToggle("compatibility", l.compatibility) +
      settingToggle("showPlaybackStats", l.playbackInfo) + "</section>";
    var playlistToggle = current.playlists.length > 5
      ? '<button type="button" class="list-toggle" data-action="toggle-playlists">' +
        escape(expandedPlaylists ? l.close : l.open + " " + l.playlists + " (" + current.playlists.length + ")") +
        '<i class="' + (expandedPlaylists ? "up" : "") + '"></i></button>'
      : "";
    var deviceToggle = current.devices.length > 5
      ? '<button type="button" class="list-toggle" data-action="toggle-devices">' +
        escape(expandedDevices ? l.close : l.open + " " + l.devices + " (" + current.devices.length + ")") +
        '<i class="' + (expandedDevices ? "up" : "") + '"></i></button>'
      : "";
    var addPlaylist = addPlaylistOpen
      ? '<div class="add-card"><input name="newUrl" type="url" inputmode="url" dir="ltr" aria-label="' +
        escape(l.playlistAddress) + '" placeholder="' + escape(l.playlistAddress) +
        '"><input name="newName" aria-label="' + escape(l.playlistName) + '" placeholder="' + escape(l.playlistName) +
        '"><div class="add-actions"><button type="button" data-action="add-playlist">' + escape(l.addPlaylist) +
        '</button><button class="quiet" type="button" data-action="close-add-playlist">' + escape(l.cancel) + "</button></div></div>"
      : "";
    var playlistSection = '<section id="playlists" data-section="playlists"><div class="section-title-row"><h2>' +
      escape(l.playlists) + '</h2><button class="section-add' + (addPlaylistOpen ? " open" : "") +
      '" type="button" data-action="' + (addPlaylistOpen ? "close-add-playlist" : "open-add-playlist") +
      '" aria-label="' + escape(addPlaylistOpen ? l.cancel : l.addPlaylist) +
      '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div>' +
      addPlaylist + '<div class="stack">' + playlists + "</div>" + playlistToggle + "</section>";
    var deviceSection = '<section id="devices" data-section="devices"><h2>' + escape(l.devices) +
      '</h2><div class="stack">' + devices + "</div>" + deviceToggle + "</section>";
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
        '</a><a href="#playlists">' + navIcon("playlists") + escape(l.playlists) + '</a><a href="#devices">' + navIcon("devices") + escape(l.devices) +
        '</a><a href="#about">' + navIcon("about") + escape(l.about) +
        "</a></nav>" + appearance + playback + playlistSection + deviceSection + aboutSection + itemMenuMarkup(l) + remoteMarkup(l),
      message,
      !!failed,
    );
    bindManagement();
  }

  function commandId() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  function focusDescriptor(source) {
    if (!source) return null;
    return {
      action: source.dataset && (source.dataset.returnAction || source.dataset.action),
      id: source.dataset && source.dataset.id,
      setting: source.dataset && source.dataset.setting,
      name: source.name,
    };
  }

  function restoreFocus(target) {
    if (!target) return;
    var selector = target.setting
      ? '[data-setting="' + target.setting + '"]'
      : target.action
        ? '[data-action="' + target.action + '"]' + (target.id ? '[data-id="' + target.id + '"]' : "")
        : target.name
          ? '[name="' + target.name + '"]'
          : "";
    if (selector) setTimeout(function () { root.querySelector(selector)?.focus(); }, 0);
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
        previousPlaylist.url !== command.url.trim());
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
      setupDraft = {
        locale: current.settings.locale,
        name: current.setup?.name ?? "",
        url: current.setup?.url ?? "",
      };
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
        editingPlaylist = id;
        closeItemMenu(false);
        renderManage();
        root.querySelector('[name="editUrl"]')?.focus();
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
      renderManage();
      root.querySelector('[name="newUrl"]')?.focus();
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
      var name = root.querySelector('[name="newName"]').value.trim();
      var url = root.querySelector('[name="newUrl"]').value.trim();
      if (!url) {
        operationStatus(labels().invalidUrl, true);
        return;
      }
      addPlaylistOpen = false;
      void sendCommand({ type: "playlist.add", name: name, url: url }, false, add);
    });
    root.querySelectorAll("[data-action=edit-playlist]").forEach(function (button) {
      button.addEventListener("click", function () {
        editingPlaylist = button.dataset.id;
        renderManage();
        root.querySelector('[name="editUrl"]')?.focus();
      });
    });
    var editPlaylist = root.querySelector("[data-edit-playlist]");
    if (editPlaylist) {
      editPlaylist.addEventListener("submit", function (event) {
        event.preventDefault();
        var id = editPlaylist.dataset.id;
        var name = editPlaylist.elements.editName.value.trim();
        var url = editPlaylist.elements.editUrl.value.trim();
        if (!url) {
          operationStatus(labels().invalidUrl, true);
          return;
        }
        editingPlaylist = "";
        void sendCommand({ type: "playlist.update", id: id, name: name, url: url }, false, editPlaylist);
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
    setupDraft = {
      locale: current.settings.locale,
      name: current.setup?.name ?? "",
      url: current.setup?.url ?? "",
    };
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

  window.OpenIPTVRemote = { start: start, parsePairSecret: parsePairSecret };
  if (!window.__OPENIPTV_TEST__) void start();
})();
