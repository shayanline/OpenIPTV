import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { stageTVApp } from "../scripts/tv-ports.mjs";

let directory: string;
let source: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "openiptv-port-test-"));
  source = join(directory, "dist");
  mkdirSync(source);
  writeFileSync(
    join(source, "index.html"),
    '<html><head><meta name="openiptv-build-version" content="1.2.3"></head><body></body></html>',
  );
  for (const name of ["assets", "fonts", "licenses", "wasm", "remote", "demo"]) {
    mkdirSync(join(source, name));
    writeFileSync(join(source, name, "fixture.txt"), name);
  }
  writeFileSync(join(source, "config.xml"), "<widget/>");
  writeFileSync(join(source, "author-signature.xml"), "<signature/>");
  writeFileSync(join(source, "THIRD-PARTY-NOTICES.md"), "Notices.");
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function stage(target: string, version = "1.2.3") {
  const destination = join(directory, target);
  stageTVApp({ source, destination, target, version });
  return destination;
}

test("LG metadata takes the release version and preserves mandatory licence and asset files", () => {
  const destination = stage("webos");
  const appinfo = JSON.parse(readFileSync(join(destination, "appinfo.json"), "utf8"));
  expect(appinfo).toMatchObject({
    id: "io.github.shayanline.openiptv",
    version: "1.2.3",
    requiredACG: [],
    main: "index.html",
    disableBackHistoryAPI: true,
    icon: "icon-80.png",
  });
  expect(readFileSync(join(destination, "licenses/fixture.txt"), "utf8")).toBe("licenses");
  expect(readFileSync(join(destination, "fonts/fixture.txt"), "utf8")).toBe("fonts");
  expect(readFileSync(join(destination, "THIRD-PARTY-NOTICES.md"), "utf8")).toBe("Notices.");
});

test.each(["titan", "vidaa", "vizio", "vega"])(
  "%s has explicit candidate identity without Samsung sockets, signatures or demo content",
  (target) => {
    const destination = stage(target);
    expect(readFileSync(join(destination, "index.html"), "utf8")).toContain(
      `<meta name="openiptv-platform" content="${target}">`,
    );
    const identity = JSON.parse(
      readFileSync(join(destination, "platform-release.json"), "utf8"),
    );
    expect(identity).toMatchObject({
      target,
      version: "1.2.3",
      status: "candidate",
      hardwareVerified: false,
      storePublished: false,
    });
    for (const excluded of ["config.xml", "wasm", "remote", "demo", "author-signature.xml"]) {
      expect(existsSync(join(destination, excluded))).toBe(false);
    }
  },
);

test("stale builds and unknown targets fail before creating a package", () => {
  expect(() => stage("webos", "2.0.0")).toThrow("missing or stale");
  expect(() => stage("__proto__")).toThrow("Unknown TV target");
});

test("staging refuses an existing output instead of mixing releases", () => {
  stage("titan");
  expect(() => stage("titan")).toThrow("already exists");
});

test("a platform package cannot become the source of another package", () => {
  const first = stage("titan");
  expect(() =>
    stageTVApp({
      source: first,
      destination: join(directory, "second"),
      target: "webos",
      version: "1.2.3",
    }),
  ).toThrow("shared browser build");
});
