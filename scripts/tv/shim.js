/**
 * A Tizen TV, as far as the app can tell, injected before any of it runs.
 *
 * Without this the app takes its desktop branch on a laptop: it renders a <video>, keeps
 * an opaque background, registers no remote keys and never touches AVPlay. So the code
 * that actually ships to the set is the code least exercised during development, which is
 * how the TV ended up playing sound into a hole nobody could see through.
 *
 * Every Tizen path runs, and the parts that are easy to get wrong are enforced rather than
 * imitated: AVPlay's state machine rejects calls made in the wrong state exactly as the
 * real one does, so an ordering mistake fails here instead of silently on the TV.
 *
 * Playback is real. AVPlay itself is Samsung firmware and cannot exist here, but nothing
 * says the imitation has to be hollow, so each call is carried out by hls.js against a
 * video element hidden behind the page, in the place the hardware plane would occupy. The
 * app cannot tell the difference: it calls open, prepareAsync and play, and a picture
 * appears where setDisplayRect said it should.
 *
 * What that does not reproduce is the hardware: a TV decodes in silicon on a plane below
 * the browser, and here a software decoder paints into the page. Timing and cost differ,
 * and the real AVPlay error names cannot be produced at all.
 */
(() => {
  const log = (...a) => console.log("[tv]", ...a);

  /**
   * Hide the hole punch surface.
   *
   * The app creates an <object type="application/avplayer"> because the set binds its video
   * plane to one. A desktop browser has no such plugin, so it draws the grey "this plug-in
   * is not supported" placeholder instead, full screen, and the transparent page the TV
   * requires means it shows through the whole interface.
   *
   * Standing in for the platform is this file's job, so the placeholder goes and the plane
   * below takes its place. Injected as a style rule rather than set on the element, because
   * the surface is created lazily on the first channel and may not exist yet.
   */
  const hidePlugin = () => {
    if (document.getElementById("tv-hide-avplayer") || !document.head) return;
    const style = document.createElement("style");
    style.id = "tv-hide-avplayer";
    style.textContent = 'object[type="application/avplayer"]{display:none!important}';
    document.head.appendChild(style);
  };

  /**
   * The video plane: a dim backing with a real video element on it.
   *
   * Sits behind the page, which is the arrangement the set uses and the reason the app has
   * to keep its background transparent. If the page ever stops being transparent this goes
   * dark, which is exactly the failure it is here to catch.
   */
  const video = () => {
    const host = plane();
    if (!host) return null;
    let v = document.getElementById("tv-video-el");
    if (v) return v;
    v = document.createElement("video");
    v.id = "tv-video-el";
    v.muted = false;
    v.playsInline = true;
    v.setAttribute("style", "position:absolute;width:100%;height:100%;object-fit:contain;background:#000;");
    host.appendChild(v);
    return v;
  };

  const plane = () => {
    let el = document.getElementById("tv-video-plane");
    if (el || !document.body) return el;
    el = document.createElement("div");
    el.id = "tv-video-plane";
    // Nearly black, because that is what most of an evening's television looks like and a
    // test pattern competes with the interface being judged. Faintly labelled so an empty
    // plane can still be told apart from a plane that is simply dark.
    //
    // Note it flatters overlay contrast. The readability checks were done against worst
    // case white content, which is the harder direction and not what this is for.
    //
    // Shown from the moment it exists, not from the first channel. A set's video plane is
    // under the browser from boot and is dark until something plays, while this waited for
    // prepareAsync, so the simulator opened onto the browser's own white paper through the
    // transparent page: a screen the television cannot produce, and the wrong thing to have
    // been judging the interface against.
    el.setAttribute(
      "style",
      "position:fixed;top:0;right:0;bottom:0;left:0;z-index:-1;pointer-events:none;" +
        "display:flex;background:#08080a;" +
        "font:500 18px system-ui;color:rgba(255,255,255,.09);letter-spacing:.24em;" +
        "text-transform:uppercase;align-items:flex-end;justify-content:center;" +
        "padding-bottom:24px;box-sizing:border-box;",
    );
    el.textContent = "video plane";
    document.body.insertBefore(el, document.body.firstChild);
    return el;
  };

  // The real states, and which calls each one accepts. Kept here rather than in the app so
  // the app cannot quietly disagree with the platform about what is legal.
  const ALLOWED = {
    open: ["NONE", "IDLE"],
    prepareAsync: ["IDLE", "READY"],
    play: ["READY", "PLAYING", "PAUSED"],
    pause: ["PLAYING", "PAUSED"],
    stop: ["NONE", "IDLE", "READY", "PLAYING", "PAUSED"],
    close: ["NONE", "IDLE", "READY", "PLAYING", "PAUSED"],
    setDisplayRect: ["IDLE", "READY", "PLAYING", "PAUSED"],
    setDisplayMethod: ["IDLE", "READY", "PLAYING", "PAUSED"],
    setStreamingProperty: ["IDLE"],
    suspend: ["READY", "PLAYING", "PAUSED"],
    restore: ["PLAYING", "PAUSED"],
  };

  let state = "NONE";
  let listener = {};
  let source = "";
  let hls = null;

  /** Give back the decoder, whichever engine happens to be driving it. */
  const release = () => {
    if (hls) { try { hls.destroy(); } catch { /* already gone */ } hls = null; }
    const v = document.getElementById("tv-video-el");
    if (v) { v.pause(); v.removeAttribute("src"); v.load(); }
  };

  const guard = (name) => {
    if (ALLOWED[name] && !ALLOWED[name].includes(state)) {
      const e = new Error(`${name}() is not allowed in ${state}`);
      e.name = "InvalidStateError";
      console.error("[tv] InvalidStateError:", e.message);
      throw e;
    }
  };

  window.webapis = {
    avplay: {
      getState: () => state,
      open(url) {
        guard("open");
        release();
        source = url;
        state = "IDLE";
        hidePlugin();   // the surface is created just before this, on the first channel
        log("open", url);
      },
      close() { guard("close"); release(); state = "NONE"; log("close"); },
      stop() { guard("stop"); release(); state = "IDLE"; log("stop"); },
      setDisplayRect(x, y, w, h) {
        guard("setDisplayRect");
        // The rect is always in a 1920x1080 space on a real set whatever the panel is, and
        // the simulator's viewport is that space, so the numbers go straight through.
        const el = plane();
        if (el) Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
        log("setDisplayRect", x, y, w, h);
      },
      setDisplayMethod(m) { guard("setDisplayMethod"); log("setDisplayMethod", m); },
      setStreamingProperty(k, v) { guard("setStreamingProperty"); log("setStreamingProperty", k, v); },
      setListener(l) { listener = l || {}; log("setListener"); },
      suspend() { guard("suspend"); log("suspend"); },
      restore() { guard("restore"); log("restore"); },
      /**
       * Join the stream for real, and report it the way the set would.
       *
       * READY is reached when there is actually something to show rather than after a
       * made up delay, so the app's loading states last as long as loading does.
       */
      prepareAsync(ok, fail) {
        guard("prepareAsync");
        const v = video();
        if (!v) { fail?.("PLAYER_ERROR_INVALID_STATE"); return; }

        listener.onbufferingstart?.();
        let settled = false;
        const ready = () => {
          if (settled) return;
          settled = true;
          state = "READY";
          listener.onbufferingcomplete?.();
          try { ok?.(); } catch (e) { console.error(e); }
        };
        const failed = (why) => {
          if (settled) return;
          settled = true;
          log("prepare failed", why);
          listener.onerror?.(why);
          try { fail?.(why); } catch { /* the app reports it */ }
        };

        if (window.Hls && window.Hls.isSupported()) {
          hls = new window.Hls({ backBufferLength: 0, maxMaxBufferLength: 30 });
          hls.on(window.Hls.Events.MANIFEST_PARSED, ready);
          hls.on(window.Hls.Events.ERROR, (_e, d) => {
            // Only a fatal error is a failure. Live playlists produce plenty that are not.
            if (d.fatal) failed(String(d.details));
          });
          hls.loadSource(source);
          hls.attachMedia(v);
        } else {
          v.src = source;
          v.addEventListener("loadedmetadata", ready, { once: true });
          v.addEventListener("error", () => failed("PLAYER_ERROR_NOT_SUPPORTED_FILE"), { once: true });
        }
        v.addEventListener("waiting", () => listener.onbufferingstart?.());
        v.addEventListener("playing", () => listener.onbufferingcomplete?.());
        v.addEventListener("ended", () => listener.onstreamcompleted?.());
      },
      play() {
        guard("play");
        state = "PLAYING";
        void video()?.play().catch((e) => log("play refused", e && e.name));
        log("play");
      },
      pause() { guard("pause"); video()?.pause(); state = "PAUSED"; log("pause"); },
      getCurrentTime() { return Math.round((video()?.currentTime ?? 0) * 1000); },
      getDuration() { return Math.round((video()?.duration ?? 0) * 1000); },
      seekTo(ms) { const v = video(); if (v) v.currentTime = ms / 1000; },
      jumpForward(ms) { const v = video(); if (v) v.currentTime += ms / 1000; },
      jumpBackward(ms) { const v = video(); if (v) v.currentTime -= ms / 1000; },
      setTimeoutForBuffering(s) { log("setTimeoutForBuffering", s); },
      /** Enough of the read only properties for the app's live timeline to work. */
      getStreamingProperty(key) {
        const v = video();
        const seekable = v && v.seekable.length ? v.seekable : null;
        if (key === "IS_LIVE") return seekable && !Number.isFinite(v.duration) ? "1" : "0";
        if (key === "GET_LIVE_DURATION") {
          if (!seekable) return "";
          return `${Math.round(seekable.start(0) * 1000)}|${Math.round(seekable.end(seekable.length - 1) * 1000)}`;
        }
        if (key === "CURRENT_BANDWIDTH") return String(hls?.bandwidthEstimate ?? 0);
        return "";
      },
    },
  };

  const registered = new Set();
  window.tizen = {
    tvinputdevice: {
      registerKey: (name) => { registered.add(name); },
      getKey: (name) => ({ name }),
    },
    application: {
      getCurrentApplication: () => ({ exit: () => log("exit()") }),
    },
  };

  window.addEventListener("load", () => {
    hidePlugin();
    plane();
    // After the app has mounted and asked for its keys, not before.
    setTimeout(() => log(`ready. ${registered.size} remote keys:`, [...registered].join(", ")), 1500);
  });
})();
