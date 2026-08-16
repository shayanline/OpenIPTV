import type HlsType from "hls.js";
import { needsRepair, renderPlaylist, windowOf } from "./manifest";
import { readJSON, write } from "./store";

/**
 * Serving a repaired playlist to the set's or browser's player, from inside the application.
 *
 * Only one channel plays at a time, so there is one server, one socket and one manifest. It is
 * started when a channel needs it and stopped when nothing does, because a listening socket and a
 * refresh loop are not things to leave running for a viewer who never meets a broken channel.
 *
 * Nothing here is reached unless the viewer has turned compatibility on. That is deliberate:
 * every part of this is a workaround for one firmware defect, and an application should not carry
 * a workaround into the path of channels that work.
 */

/**
 * How often to refetch the upstream playlist.
 *
 * The window this publishes is 150 seconds, and the player is watching the middle of it, so being
 * a few seconds stale costs nothing. What it saves is real: these playlists can be 650KB, and
 * that is the television's own bandwidth. Six seconds against a two second segment is about a
 * megabit rather than three.
 */
const REFRESH_MS = 6000;

/**
 * How long to wait for the worker to bind before giving up on it.
 *
 * Generous, because it includes compiling a WebAssembly module on a television. A failure here is
 * reported once and remembered for the session: a set without the socket bindings must not be
 * asked again on every channel.
 */
const READY_MS = 8000;

export interface Repair {
  /** Where the player should be pointed instead of upstream. */
  url: string;
  /** The address this stands in for, so a second request for the same stream is free. */
  upstream: string;
  /** Whether the browser player should repair manifests through its hls.js loader. */
  browser: boolean;
}

/**
 * How long to give the worker to close the socket before killing it.
 *
 * It only has to answer one message and make one call, so this is generous. It exists because the
 * alternative is worse in a way that took a viewer to notice: see teardown.
 */
const STOP_ACK_MS = 1500;

/**
 * idle means the worker is up and the port is bound with nothing being served, which is where a
 * channel that needs no repair leaves it. ready would be a better word for it, except that the
 * distinction that matters to everything outside this file is whether a stream is being served.
 */
type State = "idle" | "starting" | "serving" | "listening" | "unavailable";

let worker: Worker | null = null;
let state: State = "idle";
let port = 0;
let serving = "";                       // the upstream currently being repaired
let published: string[] = [];           // the addresses in the window last served, in order
let sequence = 0;                       // the number given to the first of them
let refresh: number | undefined;
let waiting: ((port: number) => void)[] = [];
let why = "";                           // why it is unavailable, for Diagnostics
let generation = 0;                     // which tune the answer in flight belongs to
const browserRepairs = new Set<string>();

const onTizen = (): boolean =>
  typeof window !== "undefined" && !!window.webapis?.avplay;

/** Whether this television can do it at all, once it has been asked. */
export const repairState = () => ({ state, port, why, upstream: serving, hosts: [...hosts] });

/**
 * The hosts already known to defeat this television, kept across launches.
 *
 * Without this, every launch pays the twelve second stall again on the first channel from a
 * source it has already diagnosed, which for somebody who watches the same channels every
 * evening is the whole difference between a workaround and a working television.
 *
 * By host rather than by channel, because a packager numbers every one of its streams the same
 * way: one diagnosis covers the sixty odd channels behind it. Capped, because this is a hint
 * rather than a record, and an unbounded list in localStorage is a leak with a long fuse.
 */
const HOSTS_KEY = "openiptv.repair.hosts";
const HOSTS_MAX = 32;

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

let hosts = new Set<string>(readJSON<string[]>(HOSTS_KEY, []));

export function knownToNeedRepair(url: string): boolean {
  const host = hostOf(url);
  return !!host && hosts.has(host);
}

export function rememberNeedsRepair(url: string): void {
  const host = hostOf(url);
  if (!host || hosts.has(host)) return;
  const kept = [...hosts, host].slice(-HOSTS_MAX);
  hosts = new Set(kept);
  write(HOSTS_KEY, JSON.stringify(kept));
}

/** Part of resetting everything to defaults: a diagnosis is personal to one television. */
export function forgetRepairHosts(): void {
  hosts = new Set();
  browserRepairs.clear();
  write(HOSTS_KEY, JSON.stringify([]));
}

/**
 * Fetch a playlist as text, or nothing.
 *
 * The Tizen widget is not subject to CORS. A browser can do this only when the playlist host
 * allows the page's origin. Failure is not an error worth reporting: the channel is about to fail
 * anyway and the player will say so in its own words.
 */
async function read(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function post(message: unknown) {
  worker?.postMessage(message);
}

/**
 * Close everything, and wait for the socket to actually be closed before killing the worker.
 *
 * The first version of this posted "stop" and called terminate() on the next line, which does not
 * work and produced the fault a viewer found by changing channel quickly: postMessage is delivered
 * asynchronously, terminate() is immediate, so the worker died before it ever dequeued the message
 * and stop_server() was never called.
 *
 * That would be harmless if the socket belonged to the worker, and it does not. The descriptor is
 * held by the platform on behalf of the whole application, because tizentvwasm's bindings run
 * outside the worker's memory, so killing the worker leaks a listening socket for the life of the
 * app. Do that on every channel change and a viewer walking down a list of channels eventually
 * exhausts what the platform will give out, at which point start_server fails, compatibility
 * reports itself unavailable, and the repair stops working until the app is restarted.
 *
 * So the worker acknowledges the stop and is killed when it does, or after a timeout if it has
 * stopped answering, which is the only case where killing it blind is the best available answer.
 */
function teardown(reason: string) {
  window.clearInterval(refresh);
  refresh = undefined;

  const dying = worker;
  worker = null;
  if (dying) {
    let killed = false;
    const kill = () => {
      if (killed) return;
      killed = true;
      dying.terminate();
    };
    dying.onmessage = ({ data }) => {
      if (data?.type === "stopped") kill();
    };
    dying.onerror = kill;
    dying.postMessage({ type: "stop" });
    window.setTimeout(kill, STOP_ACK_MS);
  }

  port = 0;
  serving = "";
  published = [];
  sequence = 0;
  if (reason) {
    state = "unavailable";
    why = reason;
  } else {
    state = "idle";
  }
  const held = waiting;
  waiting = [];
  for (const resolve of held) resolve(0);
}

/**
 * Start the worker and wait for a port.
 *
 * The worker is created here rather than at launch so that an application nobody has asked to
 * repair anything never compiles a WebAssembly module at all.
 */
function begin(): Promise<number> {
  // Already listening, whether or not anything is being served, so there is nothing to start: this
  // is what makes a switch back to a repaired channel immediate rather than another module compile.
  if (state === "serving" || state === "listening") return Promise.resolve(port);
  if (state === "unavailable") return Promise.resolve(0);
  if (state === "starting") return new Promise((resolve) => waiting.push(resolve));

  state = "starting";
  return new Promise((resolve) => {
    waiting.push(resolve);
    const timer = window.setTimeout(() => {
      if (state === "starting") teardown("the socket did not answer in time");
    }, READY_MS);

    try {
      worker = new Worker("./wasm/manifest-socket.worker.js");
    } catch (e) {
      window.clearTimeout(timer);
      teardown(`the worker would not start: ${(e as Error)?.name ?? e}`);
      return;
    }

    worker.onerror = (event) => {
      window.clearTimeout(timer);
      teardown(event.message || "the worker failed");
    };
    worker.onmessage = ({ data }) => {
      if (data?.type === "listening") {
        window.clearTimeout(timer);
        port = Number(data.port);
        // Bound, with nothing being served yet. The caller sets serving once it has published a
        // manifest, so a socket that came up and was never given anything cannot claim otherwise.
        state = "listening";
        why = "";
        const held = waiting;
        waiting = [];
        for (const answer of held) answer(port);
        return;
      }
      if (data?.type === "error") {
        window.clearTimeout(timer);
        teardown(String(data.reason));
      }
    };
    post({ type: "start" });
  });
}

/**
 * Repair a stream, and answer with where to play it from.
 *
 * Returns null whenever this cannot help, which includes a playlist that is not damaged in the
 * one way this repairs. The caller then reports the original fault, because a viewer told "this
 * is being fixed" about a channel that is simply off the air has been told a lie.
 */
export async function repair(upstream: string): Promise<Repair | null> {
  /*
   * A television that cannot do this is asked once, and the answer is kept for the session.
   *
   * Checked before the playlist is fetched, not after: diagnosing a stream costs a download of up
   * to 650KB, and there is no point paying it to reach a conclusion nothing can act on.
   */
  if (state === "unavailable") return null;

  if (serving === upstream && state === "serving") {
    return { url: local(), upstream, browser: false };
  }

  /*
   * Which tune this belongs to, so that a slow answer for a channel nobody is watching any more
   * cannot take over the socket.
   *
   * Both awaits below are long enough for a viewer to have moved on: the playlist can be 650KB and
   * starting the worker compiles a WebAssembly module. Without this, two channels from the same
   * source in quick succession raced, and whichever fetch happened to finish last decided what the
   * socket served, which could be the previous channel while the player was asking for the new one.
   */
  generation += 1;
  const mine = generation;
  const stale = () => mine !== generation;

  const text = await read(upstream);
  if (stale() || text === null || !needsRepair(text)) return null;

  if (!onTizen()) {
    if (!browserRepairs.has(upstream)) {
      try {
        const { default: Hls } = await import("hls.js") as { default: typeof HlsType };
        if (stale() || !Hls.isSupported()) return null;
      } catch {
        return null;
      }
      browserRepairs.add(upstream);
    }
    return { url: upstream, upstream, browser: true };
  }

  const bound = await begin();
  if (!bound || stale()) return null;

  /*
   * The base is taken once, from the first playlist seen for this stream, and every later refresh
   * is renumbered against it. Taken per refresh instead, the numbers would restart on each fetch
   * and the player would see the window jump backwards.
   */
  serving = upstream;
  published = [];
  sequence = 0;
  publish(text);
  state = "serving";

  window.clearInterval(refresh);
  refresh = window.setInterval(() => void update(), REFRESH_MS);

  return { url: local(), upstream, browser: false };
}

/** The address the player is given. */
const local = () => `http://127.0.0.1:${port}/live.m3u8`;

/**
 * Keep the served window sliding.
 *
 * A failed refresh is ignored rather than reported: the last window is still valid for another
 * couple of minutes, and a playlist host that blinks is not a reason to interrupt a picture. If it
 * keeps failing the player runs off the end of the window and reports it as any other stall.
 */
async function update() {
  if (state !== "serving" || !serving) return;
  const text = await read(serving);
  if (text === null) return;
  publish(text);
}

/**
 * Serve a window, numbered by counting segments rather than by trusting the upstream's field.
 *
 * How far the window has slid is worked out by looking for its new first segment in the window
 * served last time: if it was three from the front then three have dropped off, so the number
 * advances by three. That keeps the promise HLS actually makes, one per segment, from a source
 * whose own numbering is a microsecond clock advancing two million at a time.
 *
 * A first segment that is nowhere in the previous window means the stream slid further than the
 * window in one refresh, so there is a genuine discontinuity and nothing to do but step past the
 * whole of it. That happens when a refresh has failed for longer than the window, at which point
 * the player has already run out of segments and will resynchronise anyway.
 */
function publish(text: string) {
  const window = windowOf(text, serving);
  const addresses = window.segments.map((segment) => segment.uri);
  if (published.length && addresses.length) {
    const slid = published.indexOf(addresses[0]);
    sequence += slid >= 0 ? slid : published.length;
  }
  published = addresses;
  post({ type: "manifest", text: renderPlaylist(window, sequence) });
}

/**
 * Stop refetching while nobody is watching, and start again on the way back.
 *
 * The socket stays open across this on purpose. The refresh is what costs something, up to 650KB
 * of the television's bandwidth every few seconds, and a hidden application has no business
 * spending that. The port is nearly free, and keeping it means the player finds its source exactly
 * where it left it when the viewer returns: closing it would turn every return from the home
 * screen into a connection failure.
 */
export function pauseRepair(): void {
  window.clearInterval(refresh);
  refresh = undefined;
}

export function resumeRepair(): void {
  if (state !== "serving" || !serving || refresh !== undefined) return;
  // Refreshed at once as well as on the interval, because the window has been sliding without us
  // and the player is about to ask for whatever we are holding.
  void update();
  refresh = window.setInterval(() => void update(), REFRESH_MS);
}

/**
 * Stop serving this stream, and keep the socket.
 *
 * What a channel that needs no repair leaves behind, and the difference between this and stopping
 * altogether is the whole fix for changing channel quickly. Tearing the worker down meant closing a
 * socket and killing a WebAssembly module on every switch away from a repaired channel, then
 * compiling that module again on every switch back, and a viewer walking up and down a list crosses
 * that boundary once per press.
 *
 * A bound socket that nobody is polling costs nothing measurable: the worker stops looking for
 * connections when this is called, and there is no timer left running on either side.
 */
export function idleRepair(): void {
  if (state !== "serving") return;
  window.clearInterval(refresh);
  refresh = undefined;
  post({ type: "idle" });
  serving = "";
  published = [];
  sequence = 0;
  // Any answer still in flight now belongs to nobody.
  generation += 1;
  state = "listening";
}

/**
 * Stop serving, and let go of the socket.
 *
 * Called when the channel changes to one that does not need this, when playback stops, and when
 * the application is hidden. A socket left listening past its usefulness is the one failure of
 * this design that looks like a network fault: the next attempt cannot bind, and the player
 * reports a connection failure against a server that appears healthy.
 */
export function stopRepair() {
  if (state === "unavailable") return;      // remember the verdict, drop everything else
  teardown("");
}
