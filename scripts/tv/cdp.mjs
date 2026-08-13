/**
 * Just enough Chrome DevTools Protocol to drive a browser, and the same wire is used to
 * reach the TV over sdb. One tiny client rather than a browser automation framework,
 * because everything here is "open a socket, send a command, read the replies".
 */
import { existsSync } from "node:fs";

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

/** The debugger takes a moment to start listening, so poll rather than guess a delay. */
async function firstPage(port, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const pages = (await res.json()).filter((p) => p.type === "page");
      if (pages.length) return pages[0].webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`No debuggable page on port ${port}`);
}

export async function connect(portOrUrl) {
  const wsUrl = typeof portOrUrl === "number" ? await firstPage(portOrUrl) : portOrUrl;
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  // Chrome closing is how this normally ends, so a socket error on the way out is
  // noise rather than news.
  let closing = false;
  ws.onclose = () => { closing = true; };
  ws.onerror = (e) => { if (!closing) console.error("cdp socket error:", e?.message ?? e); };

  let id = 0;
  const pending = new Map();
  const handlers = new Map();

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
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params }));
    }),
    on(method, fn) {
      if (!handlers.has(method)) handlers.set(method, []);
      handlers.get(method).push(fn);
    },
    close: () => ws.close(),
  };
}
