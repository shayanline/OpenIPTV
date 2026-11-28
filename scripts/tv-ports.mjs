#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isTVTarget, TV_TARGETS } from "../src/services/tvTargets.ts";
import { withBrowser } from "./tv/browser.mjs";
import { findChrome } from "./tv/cdp.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXCLUDED = new Set(["config.xml", "wasm", "remote", "demo"]);

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} failed. ${result.error?.message ?? `Exit code: ${result.status}`}`,
    );
  }
}

export function stageTVApp({ source, destination, target, version, root = ROOT }) {
  if (!isTVTarget(target)) throw new Error(`Unknown TV target: ${target}`);
  if (existsSync(destination)) throw new Error(`Staging directory already exists: ${destination}`);
  const html = readFileSync(join(source, "index.html"), "utf8");
  const builtVersion = /<meta\s+name="openiptv-build-version"\s+content="([^"]+)"/.exec(html)?.[1];
  if (builtVersion !== version) {
    throw new Error("The browser build is missing or stale. Run npm run build first.");
  }
  if (html.includes('name="openiptv-platform"')) {
    throw new Error("Use the shared browser build as the source, not another platform package.");
  }
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source)) {
    if (
      EXCLUDED.has(entry) ||
      entry.startsWith(".") ||
      entry === "author-signature.xml" ||
      /^signature.*\.xml$/.test(entry)
    )
      continue;
    cpSync(join(source, entry), join(destination, entry), { recursive: true });
  }
  writeFileSync(
    join(destination, "index.html"),
    html.replace(
      "</head>",
      `<meta name="openiptv-platform" content="${target}">\n</head>`,
    ),
  );
  const profile = TV_TARGETS[target];
  writeFileSync(
    join(destination, "platform-release.json"),
    `${JSON.stringify(
      {
        format: 1,
        target,
        name: profile.name,
        version,
        delivery: profile.delivery,
        integration: profile.integration,
        status: "candidate",
        hardwareVerified: false,
        storePublished: false,
      },
      null,
      2,
    )}\n`,
  );
  if (target === "webos") {
    const appinfo = JSON.parse(
      readFileSync(join(root, "platforms/webos/appinfo.json"), "utf8"),
    );
    writeFileSync(
      join(destination, "appinfo.json"),
      `${JSON.stringify({ ...appinfo, version }, null, 2)}\n`,
    );
  }
  if (target === "vega") {
    cpSync(join(root, "platforms/vega"), join(destination, "vega-wrapper"), {
      recursive: true,
    });
  }
  copyFileSync(join(root, "LICENSE"), join(destination, "LICENSE"));
  copyFileSync(join(root, "docs/tv-platforms.md"), join(destination, "TV-INSTALLATION.md"));
  return destination;
}

async function webOSIcons(destination, root) {
  const chrome = findChrome();
  if (!chrome) throw new Error("Chrome or Chromium is required to generate LG launcher icons.");
  await withBrowser(
    chrome,
    [
      "--headless=new",
      "--no-sandbox",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--no-first-run",
      "--no-default-browser-check",
    ],
    "openiptv-webos-icons-",
    async (cdp) => {
      await cdp.send("Page.enable");
      await cdp.send("Emulation.setDefaultBackgroundColorOverride", {
        color: { r: 0, g: 0, b: 0, a: 0 },
      });
      const loaded = new Promise((done) => cdp.on("Page.loadEventFired", done));
      await cdp.send("Page.navigate", {
        url: pathToFileURL(join(root, "public/icon.svg")).href,
      });
      await loaded;
      const { result } = await cdp.send("Runtime.evaluate", {
        expression: "document.documentElement.tagName",
        returnByValue: true,
      });
      if (result.value !== "svg") throw new Error("The launcher icon source is not a valid SVG.");
      for (const size of [80, 130, 400]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width: size,
          height: size,
          deviceScaleFactor: 1,
          mobile: false,
        });
        const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(destination, `icon-${size}.png`), Buffer.from(data, "base64"));
      }
    },
  );
}

export async function packagePorts({
  targets = Object.keys(TV_TARGETS),
  source = join(ROOT, "dist"),
  output = join(ROOT, "build/ports"),
  ipk = false,
  root = ROOT,
} = {}) {
  if (!targets.length || targets.some((target) => !isTVTarget(target))) {
    throw new Error("Select at least one known TV target.");
  }
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  mkdirSync(output, { recursive: true });
  const temporary = mkdtempSync(join(output, ".ports-"));
  const artifacts = [];
  try {
    for (const target of targets) {
      const app = join(temporary, target);
      stageTVApp({ source, destination: app, target, version, root });
      if (target === "webos") await webOSIcons(app, root);
      const suffix =
        TV_TARGETS[target].integration === "partner-required"
          ? "-candidate"
          : target === "vega"
            ? "-kit"
            : "";
      const name = `OpenIPTV-${target}${suffix}.zip`;
      run("zip", ["-qr", join(temporary, name), "."], { cwd: app });
      artifacts.push({ target, name, installable: false });

      if (target === "webos" && ipk) {
        const packages = join(temporary, "ipk");
        mkdirSync(packages);
        // Vite already owns minification and hashed module imports.
        run("ares-package", [app, "--no-minify", "--outdir", packages]);
        const files = readdirSync(packages).filter((file) => file.endsWith(".ipk"));
        if (files.length !== 1) throw new Error("LG packaging did not produce exactly one IPK.");
        copyFileSync(join(packages, files[0]), join(temporary, "OpenIPTV-webos.ipk"));
        artifacts.push({ target, name: "OpenIPTV-webos.ipk", installable: true });
      }
    }

    const entries = artifacts.map((artifact) => {
      const bytes = readFileSync(join(temporary, artifact.name));
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      writeFileSync(
        join(temporary, `${artifact.name}.sha256`),
        `${sha256}  ${artifact.name}\n`,
      );
      return { ...artifact, bytes: bytes.length, sha256 };
    });
    const manifest = "OpenIPTV-ports.json";
    writeFileSync(
      join(temporary, manifest),
      `${JSON.stringify({ format: 1, version, status: "candidate", artifacts: entries }, null, 2)}\n`,
    );
    for (const name of [
      ...artifacts.flatMap(({ name }) => [name, `${name}.sha256`]),
      manifest,
    ]) {
      renameSync(join(temporary, name), join(output, name));
    }
    console.log(`Prepared ${targets.length} TV candidates in ${output}. Hardware approval is pending.`);
    return entries;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [selection = "all", ...flags] = process.argv.slice(2);
  if (flags.some((flag) => flag !== "--ipk")) throw new Error("Only --ipk is supported.");
  const targets =
    selection === "all"
      ? Object.keys(TV_TARGETS)
      : selection === "hosted"
        ? Object.keys(TV_TARGETS).filter((key) => TV_TARGETS[key].delivery === "hosted")
        : [selection];
  try {
    await packagePorts({ targets, ipk: flags.includes("--ipk") });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
