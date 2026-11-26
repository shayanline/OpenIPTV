#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./tv-ports.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { id } = JSON.parse(readFileSync(resolve(root, "platforms/webos/appinfo.json"), "utf8"));
const args = process.argv.slice(2);
const device = args.find((arg) => arg.startsWith("--device="))?.slice("--device=".length);
const packagePath =
  args.find((arg) => arg.startsWith("--package="))?.slice("--package=".length) ??
  resolve(root, "build/ports/OpenIPTV-webos.ipk");

if (
  !device ||
  args.some((arg) => !arg.startsWith("--device=") && !arg.startsWith("--package="))
) {
  console.error(
    "Usage: npm run deploy:webos -- --device=<registered-tv> [--package=/path/OpenIPTV-webos.ipk]\n" +
      "Register the TV with ares-setup-device, then retrieve its Developer Mode key with " +
      "ares-novacom --device <registered-tv> --getkey. See docs/tv-platforms.md.",
  );
  process.exitCode = 1;
} else if (!existsSync(resolve(packagePath))) {
  console.error(`Package not found: ${packagePath}. Download it or run npm run package:webos.`);
  process.exitCode = 1;
} else {
  try {
    run("ares-install", ["--device", device, resolve(packagePath)]);
    run("ares-launch", ["--device", device, id]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
