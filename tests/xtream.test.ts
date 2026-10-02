import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, test } from "vitest";
import { xtreamPlaylistUrl } from "../src/services/playlistUrl";
import { useChannels } from "../src/stores/channels";

let server: Server | undefined;

const startProvider = () =>
  new Promise<string>((resolve) => {
    const provider = createServer((request, response) => {
      const url = new URL(request.url ?? "", "http://localhost");
      response.setHeader("Access-Control-Allow-Origin", "*");
      if (url.pathname !== "/portal/get.php") {
        response.writeHead(404).end();
        return;
      }
      if (url.searchParams.get("username") === "denied") {
        response.writeHead(403).end("Forbidden");
        return;
      }
      if (url.searchParams.get("username") === "error-page") {
        response.writeHead(200, { "Content-Type": "text/html" }).end("<h1>Invalid login</h1>");
        return;
      }
      if (
        url.searchParams.get("username") !== "viewer name" ||
        url.searchParams.get("password") !== "p&ss+word" ||
        url.searchParams.get("type") !== "m3u_plus" ||
        url.searchParams.get("output") !== "m3u8"
      ) {
        response.writeHead(400).end("Bad request");
        return;
      }
      response
        .writeHead(200, { "Content-Type": "application/x-mpegURL" })
        .end(
          '#EXTM3U\n#EXTINF:-1 group-title="News",Fixture News\nhttp://stream.example/news.m3u8\n',
        );
    });
    server = provider;
    provider.listen(0, "127.0.0.1", () => {
      const { port } = provider.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}/portal`);
    });
  });

afterEach(
  () =>
    new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
      server = undefined;
    }),
);

test("Xtream credentials fetch and parse a real M3U Plus response", async () => {
  const provider = await startProvider();
  const url = xtreamPlaylistUrl(provider, "viewer name", "p&ss+word", "m3u8");

  const result = await useChannels.getState().validatePlaylist("Fixture", url);

  expect(result).toEqual({ count: 1, error: "" });
});

test("rejected Xtream credentials report the provider status", async () => {
  const provider = await startProvider();
  const url = xtreamPlaylistUrl(provider, "denied", "wrong", "m3u8");

  const result = await useChannels.getState().validatePlaylist("Fixture", url);

  expect(result).toMatchObject({
    count: 0,
    errorKey: "playlist.loadFailed",
    errorDetail: "HTTP 403",
  });
});

test("an Xtream error page returned as HTTP 200 is not accepted as a playlist", async () => {
  const provider = await startProvider();
  const url = xtreamPlaylistUrl(provider, "error-page", "wrong", "m3u8");

  const result = await useChannels.getState().validatePlaylist("Fixture", url);

  expect(result).toMatchObject({
    count: 0,
    errorKey: "playlist.loadFailed",
    errorDetail: "no channels in that playlist",
  });
});
