#include <emscripten.h>
#include <errno.h>
#include <netinet/in.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/types.h>

#define IMPORT(name) __attribute__((import_module("env"), import_name(name)))
extern int host_socket(int, int, int) IMPORT("__wasm_socket");
extern int host_bind(int, const struct sockaddr *, socklen_t) IMPORT("__wasm_bind");
extern int host_listen(int, int) IMPORT("__wasm_listen");
extern int host_accept(int, struct sockaddr *, socklen_t *) IMPORT("__wasm_accept");
extern int host_close(int) IMPORT("__wasm_close");
extern ssize_t host_recv(int, void *, size_t, int) IMPORT("__wasm_recv");
extern ssize_t host_send(int, const void *, size_t, int) IMPORT("__wasm_send");
extern int host_poll(struct pollfd *, nfds_t, int) IMPORT("__wasm_poll");
extern int host_setsockopt(int, int, int, const void *, socklen_t) IMPORT("__wasm_setsockopt");

#define HEADER_MAX 8192
#define BODY_MAX 65536
#define REQUEST_MAX (HEADER_MAX + BODY_MAX)

static int listening = -1;
static int client = -1;
static char request[REQUEST_MAX + 1];
static size_t request_length = 0;
static size_t expected_length = 0;

static int send_all(int socket, const char *buffer, size_t length) {
  size_t sent = 0;
  while (sent < length) {
    ssize_t written = host_send(socket, buffer + sent, length - sent, 0);
    if (written > 0) {
      sent += (size_t)written;
      continue;
    }
    if (written < 0 && errno == EINTR) continue;
    return -1;
  }
  return 0;
}

static void close_client(void) {
  if (client >= 0) host_close(client);
  client = -1;
  request_length = 0;
  expected_length = 0;
  request[0] = '\0';
}

static void reject_request(int status, const char *reason) {
  char response[512];
  int length = snprintf(response, sizeof(response),
    "HTTP/1.1 %d %s\r\n"
    "Content-Type: text/plain; charset=utf-8\r\n"
    "Content-Length: %zu\r\n"
    "Cache-Control: no-store\r\n"
    "Connection: close\r\n\r\n%s",
    status, reason, strlen(reason), reason);
  if (length > 0) send_all(client, response, (size_t)length);
  close_client();
}

static char *header_end(void) {
  if (request_length < 4) return NULL;
  return strstr(request, "\r\n\r\n");
}

static long content_length(char *end) {
  char *line = strstr(request, "\r\n");
  if (!line || line >= end) return 0;
  line += 2;
  while (line < end) {
    char *next = strstr(line, "\r\n");
    if (!next || next > end) next = end;
    if ((size_t)(next - line) > 15 && strncasecmp(line, "Content-Length:", 15) == 0) {
      char *value = line + 15;
      while (value < next && (*value == ' ' || *value == '\t')) value += 1;
      char *after = NULL;
      long length = strtol(value, &after, 10);
      if (after == value || length < 0) return -1;
      return length;
    }
    line = next + 2;
  }
  return 0;
}

static int parse_ipv4(const char *text, uint32_t *address) {
  uint32_t octets[4] = { 0, 0, 0, 0 };
  const char *at = text;
  for (int part = 0; part < 4; part += 1) {
    if (*at < '0' || *at > '9') return 0;
    while (*at >= '0' && *at <= '9') {
      octets[part] = octets[part] * 10 + (uint32_t)(*at - '0');
      if (octets[part] > 255) return 0;
      at += 1;
    }
    if (part < 3 && *at++ != '.') return 0;
  }
  if (*at != '\0') return 0;
  *address = octets[0] | (octets[1] << 8) | (octets[2] << 16) | (octets[3] << 24);
  return 1;
}

EMSCRIPTEN_KEEPALIVE void stop_server(void);

EMSCRIPTEN_KEEPALIVE
int start_server(const char *ip, int port) {
  if (listening >= 0 || !ip || port <= 0 || port > 65535) return -1;

  listening = host_socket(AF_INET, SOCK_STREAM, 0);
  if (listening < 0) return -2;

  int on = 1;
  host_setsockopt(listening, SOL_SOCKET, SO_REUSEADDR, &on, sizeof(on));

  struct sockaddr_in address;
  memset(&address, 0, sizeof(address));
  address.sin_family = AF_INET;
  address.sin_port = (unsigned short)(((unsigned short)port >> 8) | ((unsigned short)port << 8));
  if (!parse_ipv4(ip, &address.sin_addr.s_addr)) {
    stop_server();
    return -3;
  }
  if (host_bind(listening, (struct sockaddr *)&address, sizeof(address)) < 0) {
    stop_server();
    return -4;
  }
  if (host_listen(listening, 4) < 0) {
    stop_server();
    return -5;
  }
  return port;
}

EMSCRIPTEN_KEEPALIVE
int receive_request(void) {
  if (listening < 0) return -1;
  if (client < 0) {
    struct pollfd waiting = { listening, POLLIN, 0 };
    if (host_poll(&waiting, 1, 0) <= 0) return 0;
    client = host_accept(listening, NULL, NULL);
    if (client < 0) return 0;
  }

  struct pollfd reading = { client, POLLIN, 0 };
  if (host_poll(&reading, 1, 0) <= 0) return 0;
  if (request_length >= REQUEST_MAX) {
    reject_request(413, "Payload Too Large");
    return 0;
  }

  ssize_t received = host_recv(client, request + request_length, REQUEST_MAX - request_length, 0);
  if (received <= 0) {
    close_client();
    return 0;
  }
  request_length += (size_t)received;
  request[request_length] = '\0';

  char *end = header_end();
  if (!end) {
    if (request_length >= HEADER_MAX) reject_request(431, "Request Header Fields Too Large");
    return 0;
  }

  size_t header_length = (size_t)(end - request) + 4;
  if (header_length > HEADER_MAX) {
    reject_request(431, "Request Header Fields Too Large");
    return 0;
  }
  if (!expected_length) {
    long body_length = content_length(end);
    if (body_length < 0) {
      reject_request(400, "Bad Request");
      return 0;
    }
    if (body_length > BODY_MAX) {
      reject_request(413, "Payload Too Large");
      return 0;
    }
    expected_length = header_length + (size_t)body_length;
  }
  return request_length >= expected_length ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
const char *request_text(void) {
  return request;
}

EMSCRIPTEN_KEEPALIVE
int send_response(const char *response) {
  if (client < 0 || !response) return -1;
  int outcome = send_all(client, response, strlen(response));
  close_client();
  return outcome;
}

EMSCRIPTEN_KEEPALIVE
void stop_server(void) {
  close_client();
  if (listening >= 0) host_close(listening);
  listening = -1;
}
