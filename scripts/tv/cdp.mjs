/**
 * Just enough Chrome DevTools Protocol to drive a browser, and the same wire is used to
 * reach the TV over sdb. One tiny client rather than a browser automation framework,
 * because everything here is "open a socket, send a command, read the replies".
 */
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Node has had a global WebSocket since 22, so this needs no dependency at all.

const CHROMES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

export const findChrome = () => CHROMES.find((p) => existsSync(p));

/** `--name=value` from argv. */
export const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

/** A bare `--name` flag. */
export const has = (name) => process.argv.includes(`--${name}`);

/** `--name` or `--name=N`, returning the number or a default when bare. */
export const factor = (name, whenBare) => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return 1;
  const value = hit.includes("=") ? Number(hit.split("=")[1]) : whenBare;
  return Number.isFinite(value) && value > 0 ? value : whenBare;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

export async function stopBrowser(browser) {
  if (browser.exitCode !== null) return;
  const exited = once(browser, "exit");
  browser.kill();
  await exited;
}

/**
 * Ask the browser to open a tab.
 *
 * The verb changed: /json/new was a GET and became a PUT in Chromium 111, and this has to
 * reach engines on both sides of that, from the M69 a 2020 television runs to whatever is
 * current. So it tries both rather than deciding from a version string.
 *
 * GET first, and every attempt on a timeout, both because of the old engines. M69's
 * debugging server never answers a PUT that Node's fetch sends, and never closes the
 * connection either, so waiting on it is waiting forever: this hung indefinitely against a
 * 2020 engine until the timeout was added, which is a fitting way to discover that the
 * point of the exercise is that old engines are different.
 */
async function openPage(port) {
  for (const method of ["GET", "PUT"]) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,
        { method, signal: AbortSignal.timeout(2000) });
      if (!res.ok) continue;
      const page = await res.json();
      if (page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* try the other one */ }
  }
  return null;
}

/**
 * The debugger takes a moment to start listening, so poll rather than guess a delay.
 *
 * A page is opened when the browser has not brought one of its own. Old headless Chrome
 * does not turn a URL on the command line into a target the way the new one does, so
 * against a 2020 set's engine the target list is simply empty and this used to wait the
 * full fifteen seconds and then give up with nothing useful to say.
 */
async function firstPage(port, tries = 60) {
  let asked = false;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`,
        { signal: AbortSignal.timeout(2000) });
      const pages = (await res.json()).filter((p) => p.type === "page");
      if (pages.length) return pages[0].webSocketDebuggerUrl;
      if (!asked) {
        asked = true;
        const opened = await openPage(port);
        if (opened) return opened;
      }
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`No debuggable page on port ${port}, and none could be opened`);
}

export async function connect(portOrUrl) {
  const wsUrl = typeof portOrUrl === "number" ? await firstPage(portOrUrl) : portOrUrl;
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  // Chrome closing is how this normally ends, so a socket error on the way out is noise
  // rather than news. The flag is set by close() before the socket is touched, not only in
  // onclose, because a deliberate shutdown reports the error first and the close after, so
  // reacting to onclose alone printed "cdp socket error:" with an empty message on every
  // single tidy exit.
  let closing = false;
  ws.onclose = () => { closing = true; };
  ws.onerror = (e) => { if (!closing) console.error("cdp socket error:", e?.message ?? e); };

  let id = 0;
  const pending = new Map();
  const handlers = new Map();

  /**
   * Nothing may wait forever on a browser that has gone.
   *
   * Every command was a promise with a reject that was never called. The socket closing only
   * set a flag, so if the renderer or the browser died mid run, the `await cdp.send(...)` in
   * flight simply never settled and the process hung. That is not an exotic case here: the
   * simulator caps V8's old space to the set's real heap ceiling precisely so that overrunning
   * it kills the renderer, and the old engines the parity gate downloads have their own ways
   * of dying. CI has no per job timeout either, so a hang there costs the six hour default
   * rather than a failure.
   */
  const abandon = (why) => {
    for (const { reject } of pending.values()) reject(new Error(why));
    pending.clear();
  };
  ws.addEventListener("close", () => abandon("the browser closed the debugging connection"));

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
    if (msg.method) {
      for (const fn of handlers.get(msg.method) ?? []) fn(msg.params);
    }
  };

  return {
    /**
     * A command, with a deadline.
     *
     * Generous, because some of these legitimately take a while on an engine throttled sixty
     * times: a navigation, or an evaluate that walks the whole document. It is a backstop
     * against silence rather than a performance assertion, so it only has to be shorter than
     * somebody's patience.
     */
    send: (method, params = {}, timeout = 60000) => new Promise((resolve, reject) => {
      const i = ++id;
      const timer = setTimeout(() => {
        pending.delete(i);
        reject(new Error(`${method} did not answer within ${timeout}ms`));
      }, timeout);
      const settle = (fn) => (value) => { clearTimeout(timer); fn(value); };
      pending.set(i, { resolve: settle(resolve), reject: settle(reject) });
      try {
        ws.send(JSON.stringify({ id: i, method, params }));
      } catch (e) {
        pending.delete(i);
        clearTimeout(timer);
        reject(e);
      }
    }),
    on(method, fn) {
      if (!handlers.has(method)) handlers.set(method, []);
      handlers.get(method).push(fn);
    },
    close: () => { closing = true; ws.close(); },
  };
}
