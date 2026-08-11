import Hls from "hls.js";

/**
 * One play/stop interface over two very different engines.
 *
 * On the TV, webapis.avplay drives the hardware decoder directly. That matters beyond
 * performance: it is markedly more tolerant of awkward manifests than the browser engine
 * in the same firmware. Several Iranian broadcasters publish a media sequence of sixteen
 * digits and an hour long window of two second segments, which the built in browser
 * player cannot follow, and AVPlay generally can.
 *
 * In a desktop browser there is no AVPlay, so hls.js drives a plain <video>. Safari plays
 * HLS natively and needs neither.
 */

interface AVPlayListener {
  onbufferingstart?: () => void;
  onbufferingcomplete?: () => void;
  onstreamcompleted?: () => void;
  onerror?: (code: string) => void;
}

interface AVPlay {
  open(url: string): void;
  close(): void;
  setDisplayRect(x: number, y: number, w: number, h: number): void;
  setListener(l: AVPlayListener): void;
  prepareAsync(ok: () => void, fail: (e: unknown) => void): void;
  play(): void;
  stop(): void;
  getState(): string;
  setStreamingProperty?(key: string, value: string): void;
}

declare global {
  interface Window {
    webapis?: { avplay?: AVPlay };
    tizen?: unknown;
  }
}

export type PlayerEvent =
  | { type: "buffering" }
  | { type: "playing" }
  | { type: "ended" }
  | { type: "error"; message: string };

export const onTizen = (): boolean =>
  typeof window !== "undefined" && !!window.webapis?.avplay;

export class Player {
  private hls: Hls | null = null;
  private video: HTMLVideoElement | null = null;
  private emit: (e: PlayerEvent) => void;

  constructor(emit: (e: PlayerEvent) => void) {
    this.emit = emit;
  }

  attach(video: HTMLVideoElement) {
    this.video = video;
  }

  play(url: string) {
    this.stop();
    if (onTizen()) this.playAVPlay(url);
    else this.playBrowser(url);
  }

  private playAVPlay(url: string) {
    const av = window.webapis!.avplay!;
    try {
      av.open(url);
      // Full screen at 1080p. The TV scales to the panel, so a 4K set is fine.
      av.setDisplayRect(0, 0, 1920, 1080);
      av.setStreamingProperty?.("ADAPTIVE_INFO", "BITRATES=1000000|STARTBITRATE=HIGHEST");
      av.setListener({
        onbufferingstart: () => this.emit({ type: "buffering" }),
        onbufferingcomplete: () => this.emit({ type: "playing" }),
        onstreamcompleted: () => this.emit({ type: "ended" }),
        onerror: (code) => this.emit({ type: "error", message: `AVPlay ${code}` }),
      });
      this.emit({ type: "buffering" });
      av.prepareAsync(
        () => {
          av.play();
          this.emit({ type: "playing" });
        },
        (e) => this.emit({ type: "error", message: `prepare failed: ${String(e)}` }),
      );
    } catch (e) {
      this.emit({ type: "error", message: String(e) });
    }
  }

  private playBrowser(url: string) {
    const video = this.video;
    if (!video) return;
    this.emit({ type: "buffering" });

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.play().then(
        () => this.emit({ type: "playing" }),
        (e) => this.emit({ type: "error", message: String(e) }),
      );
      return;
    }
    if (!Hls.isSupported()) {
      this.emit({ type: "error", message: "HLS is not supported in this browser" });
      return;
    }
    // A live window of 1800 segments is common here, so cap what is held in memory.
    const hls = new Hls({ liveSyncDurationCount: 3, backBufferLength: 30 });
    this.hls = hls;
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
      else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      else this.emit({ type: "error", message: data.details });
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().then(
        () => this.emit({ type: "playing" }),
        (e) => this.emit({ type: "error", message: String(e) }),
      );
    });
    hls.loadSource(url);
    hls.attachMedia(video);
  }

  stop() {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.video) {
      this.video.removeAttribute("src");
      this.video.load();
    }
    if (onTizen()) {
      const av = window.webapis!.avplay!;
      try {
        if (av.getState() !== "NONE") {
          av.stop();
          av.close();
        }
      } catch {
        // Closing an already closed player throws, which is not worth reporting.
      }
    }
  }
}
