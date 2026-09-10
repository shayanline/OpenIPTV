import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "./cdp.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function devToolsPort(profile, browser, stderr, tries = 120) {
  for (let i = 0; i < tries; i++) {
    if (browser.exitCode !== null) {
      throw new Error(`Chrome exited with code ${browser.exitCode} before opening DevTools:\n${stderr().trim()}`);
    }
    try {
      const port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n", 1)[0]);
      if (Number.isInteger(port) && port > 0) return port;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (i + 1 < tries) await sleep(250);
  }
  throw new Error(`Chrome did not open DevTools:\n${stderr().trim()}`);
}

export async function stopBrowser(browser, timeout = 5000) {
  if (browser.exitCode !== null || browser.pid === undefined) return;
  const exited = new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      browser.off("exit", done);
      resolve(false);
    }, timeout);
    browser.once("exit", done);
  });
  browser.kill();
  if (await exited || browser.exitCode !== null) return;
  const forced = once(browser, "exit");
  browser.kill("SIGKILL");
  await forced;
}

export function removeProfile(profile, remove = rmSync, warn = console.warn) {
  try {
    remove(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    return true;
  } catch (error) {
    const code = error?.code ?? error;
    warn(`Could not remove Chrome profile ${profile}: ${code}`);
    return false;
  }
}

export async function closeBrowser(cdp, browser) {
  if (cdp) {
    try {
      await cdp.send("Browser.close", {}, 5000);
    } catch {}
    cdp.close();
  }
  await stopBrowser(browser);
}

export async function withBrowser(binary, args, prefix, run) {
  const profile = mkdtempSync(join(tmpdir(), prefix));
  let stderr = "";
  const browser = spawn(binary, [
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    ...args,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  browser.stderr.setEncoding("utf8");
  browser.stderr.on("data", (chunk) => { stderr += chunk; });

  let cdp;
  try {
    try {
      const failed = new Promise((_, reject) => browser.once("error", reject));
      const port = await Promise.race([devToolsPort(profile, browser, () => stderr), failed]);
      cdp = await connect(port);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const output = stderr.trim();
      throw Object.assign(new Error(output && !message.includes(output) ? `${message}\n${output}` : message),
        { launch: true });
    }
    return await run(cdp);
  } finally {
    try {
      await closeBrowser(cdp, browser);
    } finally {
      removeProfile(profile);
    }
  }
}
