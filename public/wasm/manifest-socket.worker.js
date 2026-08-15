/*
 * The worker that owns the loopback socket.
 *
 * Two reasons it is here rather than on the main thread. The platform requires it: Tizen's socket
 * bindings refuse to run on the browser's main thread, because a blocking socket call there would
 * stop rendering. And it is the right place anyway, since nothing about serving a few kilobytes
 * every couple of seconds should ever be able to delay a key press.
 *
 * A plain classic script rather than a bundled module, because it has to importScripts the
 * Emscripten glue, which is a classic script. It therefore gets no TypeScript and no build step:
 * everything with logic in it lives in src/services/manifest.ts, and this file only carries the
 * socket and the platform's own awkwardness.
 *
 * Messages in
 *   { type: "start" }              bind and begin serving
 *   { type: "manifest", text }     replace what is served
 *   { type: "stop" }               close the socket and go quiet
 * Messages out
 *   { type: "listening", port }    the port the platform gave us
 *   { type: "served" }             one request answered
 *   { type: "error", reason }      anything that went wrong, once
 */

/**
 * How often to look for a connection.
 *
 * The module polls rather than blocking in accept(), so this is the cost of waiting: one
 * cheap call every 100ms on a thread with nothing else to do, which measured at about one
 * point of a core on a 2025 set. Faster buys nothing, since a player asks every few seconds.
 */
var POLL_MS = 100;

/**
 * The platform's socket implementations, handed to the module as imports.
 *
 * Tizen exposes these on `tizentvwasm.SocketsHostBindings`, and Samsung's own SDK maps each POSIX
 * call onto them in library_tizen_socket_host.js. It does not link that mapping unless the
 * filesystem is linked, and even forced on it emitted bare `__wasm_*` globals that nothing
 * defined, so the mapping is done here instead.
 *
 * These are references, never calls. Calling a host binding from JavaScript is refused outright
 * with "Cannot call host binding function from JS", but handing the function object to the module
 * is not, because the caller is then the WebAssembly runtime. That is exactly what Samsung's own
 * resolver does when it replaces those strings with real functions.
 */
var SOCKET_CALLS = {
  __wasm_socket: "create",
  __wasm_bind: "bind",
  __wasm_listen: "listen",
  __wasm_accept: "accept",
  __wasm_connect: "connect",
  __wasm_close: "close",
  __wasm_recv: "recv",
  __wasm_recvfrom: "recvFrom",
  __wasm_recvmsg: "recvMsg",
  __wasm_send: "send",
  __wasm_sendto: "sendTo",
  __wasm_sendmsg: "sendMsg",
  __wasm_poll: "poll",
  __wasm_select: "select",
  __wasm_shutdown: "shutdown",
  __wasm_getsockname: "getSockName",
  __wasm_getpeername: "getPeerName",
  __wasm_getsockopt: "getSockOpt",
  __wasm_setsockopt: "setSockOpt",
};

var failed = false;
function fail(reason) {
  if (failed) return;                       // one explanation, like the player's
  failed = true;
  self.postMessage({ type: "error", reason: String(reason) });
}

function bindHostSockets() {
  if (typeof tizentvwasm === "undefined" || !tizentvwasm.SocketsHostBindings) {
    fail("no socket bindings on this television");
    return false;
  }
  var missing = [];
  for (var name in SOCKET_CALLS) {
    var host = tizentvwasm.SocketsHostBindings[SOCKET_CALLS[name]];
    if (typeof host !== "function") missing.push(SOCKET_CALLS[name]);
    else self[name] = host;
  }
  if (missing.length) {
    fail("socket bindings incomplete: " + missing.join(", "));
    return false;
  }
  return true;
}

var pending = null;                          // a manifest that arrived before the module was up
var timer = null;
var api = null;

function pump() {
  timer = null;
  if (!api) return;
  var outcome;
  try {
    outcome = api.serveOnce();
  } catch (e) {
    fail("serving threw: " + (e && e.message ? e.message : e));
    return;
  }
  if (outcome === 1) self.postMessage({ type: "served" });
  else if (outcome < 0) {
    fail("the socket went away");
    return;
  }
  /* Straight back round when a request was just answered, since players often ask twice. */
  timer = setTimeout(pump, outcome === 1 ? 0 : POLL_MS);
}

function start() {
  if (!api) {
    fail("the module is not ready");
    return;
  }
  var port = api.startServer();
  if (port <= 0) {
    fail("could not listen, code " + port);
    return;
  }
  if (pending !== null) {
    api.setManifest(pending);
    pending = null;
  }
  self.postMessage({ type: "listening", port: port });
  pump();
}

function stop() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (api) {
    try {
      api.stopServer();
    } catch (e) { /* going away regardless */ }
  }
}

/*
 * Queued rather than answered, until the module is ready.
 *
 * The main thread has no way of knowing when a wasm module has finished instantiating, so it is
 * allowed to send "start" and a manifest immediately. Anything that arrives early is held and
 * applied in order once the runtime is up.
 */
var queue = [];
self.onmessage = function (event) {
  var message = event.data || {};
  if (!api) {
    queue.push(message);
    return;
  }
  handle(message);
};

function handle(message) {
  if (message.type === "manifest") {
    if (!api) {
      pending = message.text;
      return;
    }
    if (api.setManifest(message.text) !== 0) fail("the manifest is too large to serve");
    return;
  }
  if (message.type === "start") start();
  if (message.type === "stop") stop();
}

var Module = {
  onRuntimeInitialized: function () {
    api = {
      setManifest: Module.cwrap("set_manifest", "number", ["string"]),
      startServer: Module.cwrap("start_server", "number", []),
      serveOnce: Module.cwrap("serve_once", "number", []),
      stopServer: Module.cwrap("stop_server", null, []),
    };
    var held = queue;
    queue = [];
    for (var i = 0; i < held.length; i += 1) handle(held[i]);
  },
  onAbort: function (what) { fail("the module aborted: " + what); },
  print: function () { /* nothing in the module prints in anger */ },
  printErr: function (text) { fail(text); },
};

if (bindHostSockets()) self.importScripts("./manifest-socket.js");
