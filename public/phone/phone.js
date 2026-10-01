(function () {
  var root = document.getElementById("app");
  var auth = readAuth();
  var current = null;
  var setupDraft = { locale: "system", name: "", url: "" };
  var fallback = {
    title: "OpenIPTV",
    pairTitle: "Connect to your TV",
    pairBody: "Keep OpenIPTV open on your television.",
    phoneName: "Phone name",
    code: "Pairing code",
    pair: "Connect",
    setupTitle: "Add your first playlist",
    playlistName: "Playlist name",
    playlistAddress: "Playlist address",
    language: "Language",
    finish: "Finish setup",
    playlists: "Playlists",
    appearance: "Appearance",
    playback: "Playback",
    general: "General",
    phones: "Paired phones",
    addPlaylist: "Add playlist",
    remove: "Remove",
    active: "Active",
    cache: "Clear downloaded cache",
    cacheConfirm: "Clear downloaded cache?",
    removeConfirm: "Remove this playlist?",
    conflict: "Settings changed on another phone. Review and try again.",
    unavailable: "The TV is unavailable. Keep OpenIPTV open and try again.",
    revoked: "This phone no longer has access.",
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
    resumeLast: "Resume last channel",
    noPhones: "No phones are paired.",
    rename: "Rename",
    revoke: "Revoke",
    save: "Save",
    cancel: "Cancel",
  };

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
      var value = JSON.parse(localStorage.getItem("openiptv.phone") || "null");
      return value && typeof value.phoneId === "string" && typeof value.credential === "string"
        ? value
        : null;
    } catch (_error) {
      return null;
    }
  }

  function saveAuth(value) {
    auth = value;
    if (value) localStorage.setItem("openiptv.phone", JSON.stringify(value));
    else localStorage.removeItem("openiptv.phone");
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
    if (auth) result.Authorization = "Bearer " + auth.phoneId + ":" + auth.credential;
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

  function shell(content, alert) {
    var l = labels();
    root.innerHTML =
      '<header class="top"><span class="brand-mark">O</span><div><strong>' +
      escape(l.title) +
      '</strong><span>Local TV management</span></div></header>' +
      (alert ? '<p class="notice" role="alert">' + escape(alert) + "</p>" : "") +
      '<div class="content">' + content + "</div>";
  }

  function renderUnavailable() {
    shell(
      '<section class="hero"><span class="eyebrow">Connection</span><h1>' +
        escape(labels().unavailable) +
        '</h1><button type="button" data-action="retry">Try again</button></section>',
    );
    root.querySelector("[data-action=retry]").addEventListener("click", start);
  }

  function renderPair(message) {
    var l = labels();
    var secret = parsePairSecret();
    shell(
      '<section class="hero pair"><span class="eyebrow">OpenIPTV</span><h1>' +
        escape(l.pairTitle) +
        "</h1><p>" +
        escape(l.pairBody) +
        "</p>" +
        (message ? '<p class="notice" role="alert">' + escape(message) + "</p>" : "") +
        '<form><label>' +
        escape(l.phoneName) +
        '<input name="phoneName" autocomplete="name" required></label>' +
        (secret
          ? ""
          : '<label>' +
            escape(l.code) +
            '<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required></label>') +
        '<button type="submit">' +
        escape(l.pair) +
        "</button></form></section>",
    );
    root.querySelector("form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      var name = form.elements.phoneName.value.trim();
      var payload = { name: name };
      if (secret) payload.secret = secret;
      else payload.code = form.elements.code.value.trim();
      var paired = await request("/api/v1/pair", {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify(payload),
      });
      if (!paired) return;
      if (paired.status !== 200) {
        renderPair("The pairing code is invalid or has expired.");
        return;
      }
      saveAuth({ phoneId: paired.body.phoneId, credential: paired.body.credential });
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

  function renderSetup(error) {
    var l = labels();
    shell(
      '<section class="setup"><span class="eyebrow">First setup</span><h1>' +
        escape(l.setupTitle) +
        "</h1>" +
        (error ? '<p class="notice" role="alert">' + escape(error) + "</p>" : "") +
        '<form><label>' +
        escape(l.language) +
        '<select name="locale">' +
        localeOptions(setupDraft.locale) +
        "</select></label><label>" +
        escape(l.playlistName) +
        '<input name="playlistName" value="' +
        escape(setupDraft.name) +
        '"></label><label>' +
        escape(l.playlistAddress) +
        '<input name="playlistUrl" type="url" inputmode="url" value="' +
        escape(setupDraft.url) +
        '" required></label><button type="submit">' +
        escape(l.finish) +
        "</button></form></section>",
    );
    root.querySelector("form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      setupDraft = {
        locale: form.elements.locale.value,
        name: form.elements.playlistName.value,
        url: form.elements.playlistUrl.value,
      };
      await sendCommand(
        {
          type: "setup",
          locale: setupDraft.locale,
          name: setupDraft.name,
          url: setupDraft.url,
        },
        true,
      );
    });
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

  function renderManage(alert) {
    var l = labels();
    applyLocale();
    var playlists = current.playlists
      .map(function (playlist) {
        return (
          '<article class="playlist"><div><strong>' +
          escape(playlist.name) +
          "</strong><span>" +
          escape(playlist.url) +
          "</span></div>" +
          (playlist.id === current.activePlaylistId
            ? '<em>' + escape(l.active) + "</em>"
            : '<button type="button" data-action="activate-playlist" data-id="' +
              escape(playlist.id) +
              '">' +
              escape(l.active) +
              "</button>") +
          '<button class="quiet danger" type="button" data-action="remove-playlist" data-id="' +
          escape(playlist.id) +
          '">' +
          escape(l.remove) +
          "</button></article>"
        );
      })
      .join("");
    var phones = current.phones.length
      ? current.phones
          .map(function (phone) {
            return (
              '<article class="phone"><strong>' +
              escape(phone.name) +
              '</strong><button class="quiet" type="button" data-action="rename-phone" data-id="' +
              escape(phone.id) +
              '">' +
              escape(l.rename) +
              '</button><button class="quiet danger" type="button" data-action="revoke-phone" data-id="' +
              escape(phone.id) +
              '">' +
              escape(l.revoke) +
              "</button></article>"
            );
          })
          .join("")
      : '<p class="muted">' + escape(l.noPhones) + "</p>";

    shell(
      '<nav class="tabs" aria-label="Settings"><a href="#playlists">' +
        escape(l.playlists) +
        '</a><a href="#appearance">' +
        escape(l.appearance) +
        '</a><a href="#playback">' +
        escape(l.playback) +
        '</a><a href="#general">' +
        escape(l.general) +
        '</a><a href="#phones">' +
        escape(l.phones) +
        '</a></nav><section id="playlists" data-section="playlists"><span class="eyebrow">Library</span><h1>' +
        escape(l.playlists) +
        '</h1><div class="stack">' +
        playlists +
        '</div><div class="add-card"><input name="newName" placeholder="' +
        escape(l.playlistName) +
        '"><input name="newUrl" type="url" inputmode="url" placeholder="' +
        escape(l.playlistAddress) +
        '"><button type="button" data-action="add-playlist">' +
        escape(l.addPlaylist) +
        '</button></div></section><section id="appearance" data-section="appearance"><span class="eyebrow">Display</span><h2>' +
        escape(l.appearance) +
        "</h2>" +
        settingSelect("locale", l.language, (current.localeOptions || []).map(function (option) { return [option.id, option.label]; })) +
        settingSelect("fontSizeId", l.textSize, [["s", l.small], ["m", l.medium], ["l", l.large], ["xl", l.extraLarge]]) +
        settingToggle("showNumbers", l.showNumbers) +
        settingToggle("showLogos", l.showLogos) +
        settingToggle("showClock", l.showClock) +
        settingToggle("sortAlphabetically", l.sortAlphabetically) +
        '</section><section id="playback" data-section="playback"><span class="eyebrow">Picture</span><h2>' +
        escape(l.playback) +
        "</h2>" +
        settingSelect("aspectId", l.screenFit, [["fill", l.fill], ["fit", l.fit], ["stretch", l.stretch]]) +
        settingToggle("compatibility", l.compatibility) +
        '</section><section id="general" data-section="general"><span class="eyebrow">Device</span><h2>' +
        escape(l.general) +
        "</h2>" +
        settingToggle("resumeLast", l.resumeLast) +
        '<button class="secondary danger" type="button" data-action="clear-cache">' +
        escape(l.cache) +
        '</button></section><section id="phones" data-section="phones"><span class="eyebrow">Access</span><h2>' +
        escape(l.phones) +
        '</h2><div class="stack">' +
        phones +
        "</div></section>",
      alert,
    );
    bindManagement();
  }

  function commandId() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  async function sendCommand(command, setup) {
    var response = await request("/api/v1/command", {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify({ id: commandId(), revision: current.revision, command: command }),
    });
    if (!response) return;
    if (response.body && response.body.snapshot) current = response.body.snapshot;
    if (response.status === 409) {
      renderManage(labels().conflict);
      return;
    }
    if (response.status !== 200) {
      if (setup) renderSetup(response.body.reason || "The playlist could not be loaded.");
      else renderManage(response.body.reason || "The change could not be saved.");
      return;
    }
    if (setup && !current.playlists.length) renderSetup("The playlist could not be loaded.");
    else renderManage();
  }

  function bindManagement() {
    var add = root.querySelector("[data-action=add-playlist]");
    add.addEventListener("click", function () {
      var name = root.querySelector('[name="newName"]').value;
      var url = root.querySelector('[name="newUrl"]').value;
      void sendCommand({ type: "playlist.add", name: name, url: url });
    });
    root.querySelectorAll("[data-action=remove-playlist]").forEach(function (button) {
      button.addEventListener("click", function () {
        if (confirm(labels().removeConfirm)) {
          void sendCommand({ type: "playlist.remove", id: button.dataset.id });
        }
      });
    });
    root.querySelectorAll("[data-action=activate-playlist]").forEach(function (button) {
      button.addEventListener("click", function () {
        void sendCommand({ type: "playlist.activate", id: button.dataset.id });
      });
    });
    root.querySelectorAll("[data-setting]").forEach(function (control) {
      control.addEventListener("change", function () {
        var value = control.type === "checkbox" ? control.checked : control.value;
        void sendCommand({ type: "setting", key: control.dataset.setting, value: value });
      });
    });
    root.querySelector("[data-action=clear-cache]").addEventListener("click", function () {
      if (confirm(labels().cacheConfirm)) void sendCommand({ type: "cache.clear" });
    });
    root.querySelectorAll("[data-action=rename-phone]").forEach(function (button) {
      button.addEventListener("click", function () {
        var phone = current.phones.find(function (candidate) { return candidate.id === button.dataset.id; });
        var name = window.prompt(labels().phoneName, phone ? phone.name : "");
        if (name) void sendCommand({ type: "phone.rename", id: button.dataset.id, name: name });
      });
    });
    root.querySelectorAll("[data-action=revoke-phone]").forEach(function (button) {
      button.addEventListener("click", function () {
        if (confirm(labels().revoke + "?")) {
          void sendCommand({ type: "phone.revoke", id: button.dataset.id });
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
    setupDraft.locale = current.settings.locale;
    if (current.playlists.length) renderManage();
    else renderSetup();
  }

  async function start() {
    auth = readAuth();
    if (auth) await loadState();
    else renderPair();
  }

  window.OpenIPTVPhone = { start: start, parsePairSecret: parsePairSecret };
  if (!window.__OPENIPTV_TEST__) void start();
})();
