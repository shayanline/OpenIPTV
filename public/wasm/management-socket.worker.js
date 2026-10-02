var POLL_MS = 100;
var HEADER_MAX = 8 * 1024;
var BODY_MAX = 64 * 1024;
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
var STATUS = {
  200: "OK",
  400: "Bad Request",
  404: "Not Found",
  405: "Method Not Allowed",
  413: "Payload Too Large",
  431: "Request Header Fields Too Large",
  500: "Internal Server Error",
};
var ASSETS = {
  "/": { path: "../remote/index.html", type: "text/html; charset=utf-8" },
  "/remote.css": { path: "../remote/remote.css", type: "text/css; charset=utf-8" },
  "/remote.js": { path: "../remote/remote.js", type: "text/javascript; charset=utf-8" },
  "/icon.svg": { path: "../icon.svg", type: "image/svg+xml; charset=utf-8" },
};
var api = null;
var queue = [];
var timer = null;
var waiting = 0;
var nextId = 1;
var failed = false;

function fail(reason) {
  if (failed) return;
  failed = true;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (api) {
    try { api.stopServer(); } catch (_error) {}
  }
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

function response(status, contentType, body) {
  var text = String(body || "");
  var length = new TextEncoder().encode(text).length;
  return (
    "HTTP/1.1 " + status + " " + STATUS[status] + "\r\n" +
    "Content-Type: " + contentType + "\r\n" +
    "Content-Length: " + length + "\r\n" +
    "Cache-Control: no-store\r\n" +
    "X-Content-Type-Options: nosniff\r\n" +
    "Connection: close\r\n\r\n" + text
  );
}

function send(status, contentType, body) {
  if (api.sendResponse(response(status, contentType, body)) !== 0) {
    fail("could not send a management response");
  }
  waiting = 0;
  pump();
}

function parse(raw) {
  var split = raw.indexOf("\r\n\r\n");
  if (split < 0) return { error: 400 };
  if (split + 4 > HEADER_MAX) return { error: 431 };
  var lines = raw.slice(0, split).split("\r\n");
  var first = lines.shift().split(" ");
  if (first.length !== 3) return { error: 400 };
  var method = first[0];
  var path = first[1];
  if (method !== "GET" && method !== "POST") return { error: 405 };
  try {
    if (decodeURIComponent(path).indexOf("..") !== -1) return { error: 400 };
  } catch (_error) {
    return { error: 400 };
  }
  var headers = {};
  for (var i = 0; i < lines.length; i += 1) {
    var colon = lines[i].indexOf(":");
    if (colon <= 0) return { error: 400 };
    headers[lines[i].slice(0, colon).trim().toLowerCase()] = lines[i].slice(colon + 1).trim();
  }
  var claimed = Number(headers["content-length"] || 0);
  if (!Number.isInteger(claimed) || claimed < 0) return { error: 400 };
  if (claimed > BODY_MAX) return { error: 413 };
  var body = raw.slice(split + 4);
  if (new TextEncoder().encode(body).length > BODY_MAX) return { error: 413 };
  return { method: method, path: path, headers: headers, body: body };
}

async function handleRequest(raw) {
  var request = parse(raw);
  if (request.error) {
    send(request.error, "text/plain; charset=utf-8", STATUS[request.error]);
    return;
  }
  var asset = ASSETS[request.path];
  if (asset) {
    if (request.method !== "GET") {
      send(405, "text/plain; charset=utf-8", STATUS[405]);
      return;
    }
    try {
      var result = await fetch(asset.path);
      if (!result.ok) throw new Error("asset unavailable");
      send(200, asset.type, await result.text());
    } catch (error) {
      send(500, "text/plain; charset=utf-8", error && error.message ? error.message : error);
    }
    return;
  }
  if (request.path.indexOf("/api/v1/") !== 0) {
    send(404, "text/plain; charset=utf-8", STATUS[404]);
    return;
  }
  var id = nextId;
  nextId += 1;
  waiting = id;
  self.postMessage({
    type: "request",
    id: id,
    method: request.method,
    path: request.path,
    headers: request.headers,
    body: request.body,
  });
}

function pump() {
  if (!api || timer !== null || waiting) return;
  var outcome;
  try {
    outcome = api.receiveRequest();
  } catch (error) {
    fail(error && error.message ? error.message : error);
    return;
  }
  if (outcome === 1) {
    waiting = -1;
    void handleRequest(api.requestText());
    return;
  }
  if (outcome < 0) {
    fail("the management socket went away, code " + outcome);
    return;
  }
  timer = setTimeout(function () {
    timer = null;
    pump();
  }, POLL_MS);
}

function start(message) {
  var port = api.startServer(message.address, message.port);
  if (port <= 0) {
    fail("could not listen, code " + port);
    return;
  }
  self.postMessage({ type: "listening", address: message.address, port: port });
  pump();
}

function stop() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  waiting = 0;
  if (api) api.stopServer();
  self.postMessage({ type: "stopped" });
}

function handle(message) {
  if (message.type === "start") start(message);
  if (message.type === "stop") stop();
  if (message.type === "response" && message.id === waiting) {
    send(message.status, message.contentType, message.body);
  }
}

self.onmessage = function (event) {
  var message = event.data || {};
  if (!api) queue.push(message);
  else handle(message);
};

var Module = {
  onRuntimeInitialized: function () {
    api = {
      startServer: Module.cwrap("start_server", "number", ["string", "number"]),
      receiveRequest: Module.cwrap("receive_request", "number", []),
      requestText: Module.cwrap("request_text", "string", []),
      sendResponse: Module.cwrap("send_response", "number", ["string"]),
      stopServer: Module.cwrap("stop_server", null, []),
    };
    var held = queue;
    queue = [];
    for (var i = 0; i < held.length; i += 1) handle(held[i]);
  },
  onAbort: function (reason) { fail("the module aborted: " + reason); },
  print: function () {},
  printErr: function (text) { fail(text); },
};

if (bindHostSockets()) importScripts("./management-socket.js");
