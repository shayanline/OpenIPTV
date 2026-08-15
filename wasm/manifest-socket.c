/*
 * A loopback HTTP server, so the application can hand AVPlay a playlist it has repaired.
 *
 * WHY THIS EXISTS
 * Some packagers number their segments from a microsecond clock, so EXT-X-MEDIA-SEQUENCE is
 * sixteen digits. AVPlay keeps that field in a signed 32 bit integer, so anything above
 * 2,147,483,647 overflows: it plays one segment, reports the whole live stream as 2000ms, and
 * stops. Measured on a 2025 set, 2,147,483,000 plays and 2,147,484,000 does not.
 *
 * Repairing it means changing one number in a text file, and there is nowhere to put the
 * result. AVPlay refuses blob: and data: URLs, refuses a file:// playlist, and fetches over its
 * own native HTTP client that nothing in the page can intercept. What it does accept is
 * http://127.0.0.1, which is what this serves. Tizen provides real sockets to WebAssembly, and
 * only the internet privilege is needed, which the widget already declares.
 *
 * The whole module is this file. It holds one string and hands it to whoever connects. The
 * fetching, the parsing and the renumbering all happen in TypeScript where they can be tested;
 * nothing here knows what HLS is.
 *
 * Rebuilding it needs Samsung's Emscripten fork and two patches to their own SDK. The recipe is
 * in docs/testing.md, and the built artefacts are committed so that `npm ci && npm run build`
 * needs none of it.
 */
#include <emscripten.h>
#include <netinet/in.h>
#include <poll.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>

/**
 * Room for a manifest, and a deliberate ceiling on one.
 *
 * A repaired playlist is a short window of a few dozen segments with long names, which measures
 * around 18KB. 64KB is generous for that and small enough that the module's memory is never
 * interesting. Anything larger is refused rather than truncated: half a playlist is a playlist
 * that plays for a while and then fails somewhere the viewer cannot be told about.
 */
#define MANIFEST_MAX 65536

static char manifest[MANIFEST_MAX];
static size_t manifest_length = 0;
static int listening = -1;

/* Declared here because the failure paths in start_server() below tidy up through it. */
EMSCRIPTEN_KEEPALIVE void stop_server(void);

/**
 * Replace what is served. Returns 0, or -1 if it would not fit.
 *
 * Copied rather than referenced, because the JavaScript string belongs to the runtime and this
 * has to outlive the call. There is no locking: this module runs on one thread, and the calls
 * from JavaScript are serialised by that thread's event loop.
 */
EMSCRIPTEN_KEEPALIVE
int set_manifest(const char *text) {
  size_t length = strlen(text);
  if (length >= MANIFEST_MAX) return -1;
  memcpy(manifest, text, length);
  manifest_length = length;
  return 0;
}

/**
 * Bind to a port the platform chooses, and answer with which one.
 *
 * Port 0 rather than a number of our own, and the reason is a bug this had in its first
 * version: a fixed port plus a worker that was terminated without closing left the socket held,
 * and the next attempt could not bind. The symptom was AVPlay reporting CONNECTION_FAILED
 * against a server that looked perfectly healthy, which is an hour nobody should spend twice.
 *
 * Loopback only. This must never be reachable from the network: it is a private arrangement
 * between this application and the set's own player.
 */
EMSCRIPTEN_KEEPALIVE
int start_server(void) {
  if (listening >= 0) return -1;                 /* already running, and not by accident */

  listening = socket(AF_INET, SOCK_STREAM, 0);
  if (listening < 0) return -2;

  int on = 1;
  setsockopt(listening, SOL_SOCKET, SO_REUSEADDR, &on, sizeof(on));

  struct sockaddr_in address;
  memset(&address, 0, sizeof(address));
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  address.sin_port = 0;

  if (bind(listening, (struct sockaddr *)&address, sizeof(address)) < 0) {
    stop_server();
    return -3;
  }
  if (listen(listening, 4) < 0) {
    stop_server();
    return -4;
  }

  struct sockaddr_in bound;
  socklen_t bound_length = sizeof(bound);
  if (getsockname(listening, (struct sockaddr *)&bound, &bound_length) < 0) {
    stop_server();
    return -5;
  }
  return ntohs(bound.sin_port);
}

/**
 * Serve at most one connection and return at once.
 *
 * Polled with no timeout rather than blocking in accept(), which matters more than it looks:
 * this thread also has to receive the refreshed manifest, and a blocking accept() would hold
 * the worker's event loop closed for as long as nobody was watching. Returns 1 for a connection
 * served, 0 for nothing waiting, negative for a socket that has gone.
 */
EMSCRIPTEN_KEEPALIVE
int serve_once(void) {
  if (listening < 0) return -1;

  struct pollfd waiting;
  waiting.fd = listening;
  waiting.events = POLLIN;
  waiting.revents = 0;
  if (poll(&waiting, 1, 0) <= 0) return 0;

  int client = accept(listening, NULL, NULL);
  if (client < 0) return 0;

  /*
   * The request is read and thrown away.
   *
   * Every path serves the same thing, so there is nothing to route on, and a player that gets
   * its response without its request having been read can see a reset instead. Polled first so
   * a client that connects and says nothing cannot hold this thread.
   */
  struct pollfd asking;
  asking.fd = client;
  asking.events = POLLIN;
  asking.revents = 0;
  char request[1024];
  if (poll(&asking, 1, 50) > 0) recv(client, request, sizeof(request), 0);

  char head[256];
  int head_length = snprintf(head, sizeof(head),
    "HTTP/1.0 200 OK\r\n"
    "Content-Type: application/vnd.apple.mpegurl\r\n"
    "Content-Length: %zu\r\n"
    "Cache-Control: no-cache\r\n"
    "Connection: close\r\n\r\n",
    manifest_length);

  /*
   * Nothing is retried and nothing is reported if a write fails. A player that hangs up
   * mid-response asks again a second later, and the only thing an error path could do here is
   * describe a connection that has already gone.
   */
  send(client, head, head_length, 0);
  if (manifest_length) send(client, manifest, manifest_length, 0);
  close(client);
  return 1;
}

/**
 * Give the port back.
 *
 * Called on the way out of everything, including the failure paths above, because a listening
 * socket that outlives its owner is the one failure mode of this design that looks like a
 * network fault.
 */
EMSCRIPTEN_KEEPALIVE
void stop_server(void) {
  if (listening < 0) return;
  close(listening);
  listening = -1;
  manifest_length = 0;
}
