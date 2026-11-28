import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Logo } from "../src/components/Logo";
import { PlaybackBanner, PlaybackIdentity } from "../src/components/PlaybackBanner";
import { DEFAULT_MARQUEE_DWELL_MS } from "../src/components/Text";
import { useChrome } from "../src/hooks/useChrome";
import { KEY } from "../src/hooks/useRemote";
import { emitPlayback, mountApp, press, settle } from "./support/app";

/**
 * The banner names an explicit selection and expires on its own schedule.
 * Engine readiness and recovery must not keep it open or raise it again.
 */

const PLAYLIST = `#EXTM3U
#EXTINF:-1 group-title="News",First Channel
http://example.invalid/1.m3u8
#EXTINF:-1 group-title="News",Second Channel
http://example.invalid/2.m3u8
`;

const FARSI_PLAYLIST = `#EXTM3U
#EXTINF:-1 group-title="شبکه ها",شبکه سه
http://example.invalid/farsi.m3u8
`;
const appCss = readFileSync("src/styles/app.css", "utf8");
const style = document.createElement("style");
style.textContent = appCss.replace('@import "./tokens.css";', "");
document.head.append(style);

/**
 * The banner is in the document while it is up, and gone when it is not.
 *
 * `.pb-stack` because that is what App renders it as. Worth stating since the hook calls the state
 * `banner` and there is no element by that name, which cost a first run of this file.
 */
const bannerUp = () => !!document.querySelector(".pb-stack");

test("dismissed banners leave accessibility immediately and retire after their own exit", () => {
  const root = document.documentElement.style;
  const previous = root.getPropertyValue("--t-med");
  root.setProperty("--t-med", "250ms");
  try {
    const channel = {
      id: "one",
      name: "First Channel",
      number: 1,
      group: "News",
      url: "http://example.invalid/1.m3u8",
    };
    const view = render(<PlaybackBanner channel={channel} />);
    view.rerender(<PlaybackBanner channel={channel} visible={false} />);
    const banner = document.querySelector(".pb-stack")!;
    expect(banner.getAttribute("aria-hidden")).toBe("true");
    expect(banner.classList.contains("playback-closing")).toBe(true);

    const ended = () => {
      const event = new Event("animationend", { bubbles: true });
      Object.defineProperty(event, "animationName", { value: "pb-out" });
      return event;
    };
    fireEvent(banner.firstElementChild!, ended());
    expect(bannerUp()).toBe(true);
    fireEvent(banner, ended());
    expect(bannerUp()).toBe(false);
  } finally {
    if (previous) root.setProperty("--t-med", previous);
    else root.removeProperty("--t-med");
  }
});

/**
 * Skip past the banner's own eight seconds, which is not the panel's setting: the viewer chooses how long
 * the channel list stays open, and the banner has always had its own eight.
 */
const past = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8600);
  });
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---- the contract, at the hook ----------------------------------------------------------

test("a raised banner counts itself down", () => {
  const { result } = renderHook(() => useChrome());
  act(() => {
    result.current.raiseBanner();
  });
  assert.equal(result.current.banner, true);

  act(() => {
    vi.advanceTimersByTime(8600);
  });
  assert.equal(result.current.banner, false);
});

test.each([
  ["precision", "900719925474099", "2", 900719925474099],
  ["length", "9007199254740991", "0", 9007199254740991],
  ["leading zero length", "0000000000000000", "0", 0],
] as const)(
  "the keypad rejects a digit beyond its %s limit without losing the accepted prefix",
  (_limit, prefix, rejected, expected) => {
    const { result } = renderHook(() => useChrome());
    const settled = vi.fn();
    act(() => {
      for (const digit of prefix) result.current.dial(Number(digit), settled);
      result.current.dial(Number(rejected), settled);
    });
    assert.equal(result.current.digits, prefix);
    act(() => vi.advanceTimersByTime(2000));
    assert.deepEqual(settled.mock.calls, [[expected]]);
    assert.equal(result.current.digits, "");
  },
);

// ---- and in the application, on a channel that takes a moment to arrive -----------------

test("a Farsi category heading stays aligned with the LTR list", async () => {
  await mountApp(FARSI_PLAYLIST);

  const heading = document.querySelector(".list .panel-title");
  assert.ok(heading);
  assert.equal(heading.textContent, "شبکه ها");
  assert.equal(heading.getAttribute("dir"), null);
  assert.equal(getComputedStyle(heading).textAlign, "left");
});

test("a Farsi only channel title stays aligned with the LTR banner", async () => {
  await mountApp(FARSI_PLAYLIST);
  press(KEY.ENTER);

  const title = document.querySelector(".pb-title");
  assert.ok(title);
  assert.equal(title.textContent, "شبکه سه");
  assert.equal(title.getAttribute("dir"), null);
  assert.equal(getComputedStyle(title).textAlign, "left");
});

test.each([
  ["en", "ltr", FARSI_PLAYLIST, "شبکه ها"],
  ["fa", "rtl", PLAYLIST, "News"],
] as const)(
  "%s keeps banner and control categories in the app direction",
  async (locale, direction, playlist, categoryName) => {
    await mountApp(playlist, { locale });
    press(KEY.ENTER);
    const bannerCategory = document.querySelector('.pb-stack [data-playback-part="category"]');
    expect(bannerCategory?.textContent).toBe(categoryName);
    expect(bannerCategory?.closest("[dir]")?.getAttribute("dir")).toBe(direction);

    press(direction === "ltr" ? KEY.RIGHT : KEY.LEFT);
    const controlCategory = document.querySelector(
      '.playback-deck [data-playback-part="category"]',
    );
    expect(controlCategory?.textContent).toBe(categoryName);
    expect(controlCategory?.closest("[dir]")?.getAttribute("dir")).toBe(direction);
  },
);

test("the live banner shows only the category name", async () => {
  await mountApp(PLAYLIST);
  press(KEY.ENTER);

  assert.equal(document.querySelector(".pb-group")?.textContent, "News");
});

test("the banner goes away on its own after a channel starts", async () => {
  await mountApp(PLAYLIST, { slowPicture: 300 });
  press(KEY.ENTER);
  await settle(500);
  assert.equal(bannerUp(), true, "the channel was never named");

  await past();
  assert.equal(bannerUp(), false, "the banner stayed up past its eight seconds");
});

test("the selection banner expires while loading and stays down when the first picture arrives", async () => {
  await mountApp(PLAYLIST, { slowPicture: 12000, strict: true });
  press(KEY.ENTER);
  await settle(0);
  expect(bannerUp()).toBe(true);
  await past();
  expect(bannerUp()).toBe(false);
  expect(document.querySelector(".picture-state .spinner")).toBeTruthy();
  await settle(4000);
  expect(document.querySelector(".picture-state .spinner")).toBeNull();
  expect(bannerUp()).toBe(false);
});

test("buffering, recovery and retuning do not reopen the selection banner", async () => {
  await mountApp(PLAYLIST, { slowPicture: 300, strict: true });
  press(KEY.ENTER);
  await settle(500);
  await past();
  expect(bannerUp()).toBe(false);
  emitPlayback({ type: "buffering-start" });
  await settle(1600);
  expect(document.querySelector(".recovery-status")).toBeTruthy();
  expect(bannerUp()).toBe(false);
  emitPlayback({ type: "buffering-complete" });
  emitPlayback({ type: "playing" });
  expect(bannerUp()).toBe(false);
  press(KEY.FORWARD);
  await settle(500);
  expect(bannerUp()).toBe(false);
});

test("returning from the channel list does not repeat the selection banner", async () => {
  await mountApp(PLAYLIST, { strict: true });
  press(KEY.ENTER);
  await settle(0);
  await past();
  press(KEY.LEFT);
  await settle(500);
  press(KEY.BACK);
  await settle(0);
  expect(bannerUp()).toBe(false);
});

test.each(["SD", "HD"])(
  "the %s badge keeps the same identity in the banner and controls",
  (quality) => {
    const view = render(
      <PlaybackIdentity variant="banner" title="Channel" group="News" quality={quality} />,
    );
    const badge = view.container.querySelector<HTMLElement>('[data-playback-part="quality"]');
    expect(badge?.dataset.playbackValue).toBe(quality);
    expect(badge?.classList.contains("pb-quality")).toBe(true);
    view.rerender(
      <PlaybackIdentity variant="deck" title="Channel" group="News" quality={quality} />,
    );
    const destination = view.container.querySelector<HTMLElement>(
      '.deck-tags [data-playback-part="quality"]',
    );
    expect(destination?.dataset.playbackValue).toBe(quality);
    expect(destination?.textContent).toBe(quality);
  },
);

test("the banner still goes away after pausing and playing the same channel", async () => {
  /*
   * The reported fault, pressed as the viewer pressed it. Play, wait for the banner to go, then pause
   * and play: the app is busy again on a channel whose arrival was already announced, so before the
   * fix nothing was left to start the countdown and the banner stayed until something cleared it.
   */
  await mountApp(PLAYLIST, { slowPicture: 300 });
  press(KEY.ENTER);
  await settle(500);
  await past();
  assert.equal(bannerUp(), false, "the banner had not gone before the interesting part began");

  press(KEY.PAUSE);
  await settle();
  press(KEY.PLAY);
  await settle(500);

  await past();
  assert.equal(bannerUp(), false, "the banner stayed up for ever after pause then play");
});

test("the banner goes away while a channel remains paused", async () => {
  await mountApp(PLAYLIST, { slowPicture: 300 });
  press(KEY.ENTER);
  await settle(500);
  await past();
  assert.equal(bannerUp(), false, "the banner had not gone before pausing");

  press(KEY.PAUSE);
  assert.ok(document.querySelector(".playback-deck"), "pausing did not open the deck");
  assert.equal(bannerUp(), false, "the deck left the Live banner visible");
  await past();
  assert.equal(bannerUp(), false, "paused state raised the Live banner after the deck closed");
});

test("the banner reports the channel number, name and group only", () => {
  render(
    <PlaybackBanner
      channel={{
        id: "channel-1",
        name: "News",
        logo: "",
        group: "News",
        url: "http://example.invalid/live.m3u8",
        quality: "",
        number: 7,
      }}
    />,
  );

  const banner = document.querySelector(".pb");
  assert.ok(banner);
  assert.equal(banner.querySelector(".pb-number")?.textContent, "7");
  assert.equal(banner.querySelector(".pb-title")?.textContent, "News");
  assert.equal(banner.querySelector(".pb-group")?.textContent, "News");
});

test("the banner reserves a visible TV logo placeholder", () => {
  render(
    <PlaybackBanner
      channel={{
        id: "channel-1",
        name: "News",
        logo: "",
        group: "News",
        url: "http://example.invalid/live.m3u8",
        quality: "HD",
        number: 7,
      }}
    />,
  );

  const placeholder = document.querySelector<HTMLElement>(".pb-logo.placeholder");
  expect(placeholder?.getAttribute("aria-label")).toBe("News");
  expect(placeholder?.querySelector(".icon-tv")).toBeTruthy();
  expect(getComputedStyle(placeholder!).display).toBe("flex");
  expect(appCss).not.toMatch(/\.pb-logo\.placeholder\s*\{[^}]*display:\s*none/);
  expect(appCss).not.toMatch(/\.logo-artwork\s*\{[^}]*background:/);
  expect(appCss).toMatch(/\.logo-artwork\.placeholder\s*\{[^}]*background:\s*var\(--tonal\)/);
});

test("failed and absent channel logos keep the same accessible placeholder", async () => {
  vi.useRealTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("missing");
    }),
  );
  const view = render(
    <Logo
      src="https://images.example.invalid/failed-logo.png"
      alt="Failed channel"
      width={132}
      height={68}
    />,
  );
  await waitFor(() => expect(fetch).toHaveBeenCalled());

  const failed = view.container.querySelector(".ch-logo.placeholder");
  expect(failed?.getAttribute("aria-label")).toBe("Failed channel");
  expect(failed?.querySelector(".icon-tv")).toBeTruthy();
  view.rerender(<Logo src="" alt="Missing channel" width={132} height={68} />);
  expect(view.container.querySelector(".ch-logo.placeholder")?.getAttribute("aria-label")).toBe(
    "Missing channel",
  );
});

test("valid channel logos keep the requested footprint and accessible name", async () => {
  vi.useRealTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["logo"]))),
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 132, height: 68, close: vi.fn() }) as unknown as ImageBitmap),
  );
  render(
    <Logo
      src="https://images.example.invalid/valid-logo.png"
      alt="Valid channel"
      width={132}
      height={68}
    />,
  );

  await waitFor(() => expect(document.querySelector("canvas.ch-logo")).toBeTruthy());
  const logo = document.querySelector<HTMLCanvasElement>("canvas.ch-logo")!;
  expect(logo.width).toBe(132);
  expect(logo.height).toBe(68);
  expect(logo.getAttribute("aria-label")).toBe("Valid channel");
});

test("the banner opens the deck with a light entrance and one identity surface", async () => {
  await mountApp(PLAYLIST);
  fireEvent.click(screen.getByRole("button", { name: /First Channel/ }));
  await settle(0);
  const identity = document.querySelector("[data-playback-identity]");
  expect(identity).toBeTruthy();
  expect(identity?.textContent).toContain("First Channel");

  press(KEY.RIGHT);

  expect(document.querySelector(".pb-stack")).toBeNull();
  expect(document.querySelectorAll("[data-playback-identity]")).toHaveLength(1);
  expect(document.querySelector("[data-playback-identity]")?.textContent).toContain(
    "First Channel",
  );
  expect(document.querySelector(".playback-deck")?.getAttribute("data-entrance")).toBe(
    "ordinary",
  );
  expect(appCss).toMatch(
    /\.pb-stack,\s*\.playback-deck \{[^}]*animation:\s*pb-in var\(--t-med\) var\(--ease-enter\)/,
  );
});

test("the deck uses an ordinary entrance after the banner was dismissed", async () => {
  await mountApp(PLAYLIST);
  fireEvent.click(screen.getByRole("button", { name: /First Channel/ }));
  press(KEY.BACK);

  press(KEY.RIGHT);

  expect(document.querySelector(".playback-deck")?.getAttribute("data-entrance")).toBe(
    "ordinary",
  );
});

test("the banner hides beneath the deck", async () => {
  await mountApp(PLAYLIST);
  press(KEY.ENTER);
  await settle(500);
  assert.equal(bannerUp(), true, "the channel was never named");

  press(KEY.RIGHT);
  assert.equal(bannerUp(), false, "the banner stayed up under the deck");
  assert.ok(document.querySelector(".playback-deck"));
});

test("a live banner shows only the current programme after its category and quality", () => {
  render(
    <PlaybackBanner
      channel={{
        id: "channel-1",
        name: "News",
        logo: "",
        group: "News",
        url: "http://example.invalid/live.m3u8",
        quality: "HD",
        number: 1,
      }}
      programme={{ current: "News at Noon" }}
    />,
  );

  assert.ok(screen.getByText("Now: News at Noon"));
  expect(screen.queryByText(/^Next:/)).toBeNull();
  expect(document.querySelector(".pb-quality")?.textContent).toBe("HD");
  const fields = document.querySelectorAll(
    ".pb-group.teleprompter.active, .pb-programme.teleprompter.active",
  );
  expect(Array.from(fields, (field) => field.textContent)).toEqual([
    "News",
    "Now: News at Noon",
  ]);
  expect(fields[0].classList.contains("pb-group")).toBe(true);
  expect(fields[1].classList.contains("pb-programme")).toBe(true);
  const row = document.querySelector(".pb-meta");
  expect(row?.querySelector(":scope > .pb-group")).toBe(fields[0]);
  expect(fields[1].previousElementSibling).toBe(row);
});

test("the deck identity retains category and tags without programme information", () => {
  render(
    <PlaybackIdentity
      variant="deck"
      title="News"
      group="World news"
      quality="HD"
      year="2024"
      rating="8.5"
      currentProgramme="News at Noon"
    />,
  );

  const fields = document.querySelectorAll(".deck-context .teleprompter.active");
  expect(Array.from(fields, (field) => field.textContent)).toEqual(["World news"]);
  expect(fields[0].classList.contains("deck-group")).toBe(true);
  expect(screen.queryByText(/Now:/)).toBeNull();
  expect(document.querySelector(".playback-programme-row")).toBeNull();
  expect(document.querySelector(".deck-context > .deck-tags")?.textContent).toBe("HD20248.5");
  expect(document.querySelector(".deck-tags .deck-rating .icon-star")).toBeTruthy();
});

test.each(["banner", "deck"] as const)(
  "the %s metadata fields use measured teleprompter overflow",
  async (variant) => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(260);
    render(
      <PlaybackIdentity
        variant={variant}
        title="News"
        group="World news and current affairs"
        currentProgramme="A long programme title"
      />,
    );
    const fields = document.querySelectorAll<HTMLElement>(
      '[data-playback-part="category"], [data-playback-part="now"]',
    );
    expect(fields.length).toBe(variant === "banner" ? 2 : 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_MARQUEE_DWELL_MS - 1);
    });
    for (const field of fields) {
      expect(field.classList.contains("overflowing")).toBe(false);
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(17);
    });
    for (const field of fields) {
      expect(field.classList.contains("active")).toBe(true);
      expect(field.classList.contains("overflowing")).toBe(true);
      expect(field.style.getPropertyValue("--teleprompter-shift")).toBe("-160px");
    }
  },
);

test.each(["banner", "deck"] as const)(
  "the %s metadata row omits absent group and programme fields",
  (variant) => {
    const view = render(<PlaybackIdentity variant={variant} title="News" quality="HD" />);
    const row = variant === "banner" ? ".pb-meta" : ".deck-context";
    expect(view.container.querySelectorAll(`${row} .teleprompter`).length).toBe(0);
    expect(view.container.querySelector(".playback-programmes")).toBeNull();
    expect(view.container.querySelector(".playback-programme-row")).toBeNull();

    view.rerender(
      <PlaybackIdentity variant={variant} title="News" currentProgramme="Weather" />,
    );
    const fields = view.container.querySelectorAll(
      '[data-playback-part="category"], [data-playback-part="now"]',
    );
    expect(Array.from(fields, (field) => field.textContent)).toEqual(
      variant === "banner" ? ["Now: Weather"] : [],
    );
  },
);

test("metadata that fits does not start the teleprompter", () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(260);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(100);
  render(
    <PlaybackIdentity variant="banner" title="News" group="News" currentProgramme="Weather" />,
  );

  const fields = document.querySelectorAll<HTMLElement>(
    ".pb-group.teleprompter, .pb-programme.teleprompter",
  );
  expect(fields.length).toBe(2);
  for (const field of fields) {
    expect(field.classList.contains("overflowing")).toBe(false);
    expect(field.style.getPropertyValue("--teleprompter-shift")).toBe("0px");
  }
});

test.each(["banner", "deck"] as const)(
  "the %s identity keeps category and quality when programme information changes",
  (variant) => {
    const view = render(
      <PlaybackIdentity variant={variant} title="News" group="World news" quality="HD" />,
    );
    const row = view.container.querySelector(
      variant === "banner" ? ".pb-meta" : ".deck-context",
    );
    expect(row?.classList.contains("playback-programme-row")).toBe(false);
    expect(row?.querySelector(".playback-programmes")).toBeNull();

    view.rerender(
      <PlaybackIdentity
        variant={variant}
        title="News"
        group="World news"
        quality="HD"
        currentProgramme="Weather"
      />,
    );
    expect(view.container.querySelector(".pb-programme")?.textContent).toBe(
      variant === "banner" ? "Now: Weather" : undefined,
    );
    expect(row?.querySelector(".pb-programme")).toBeNull();
    expect(
      row?.querySelector(variant === "banner" ? ".pb-quality" : ".deck-tags")?.textContent,
    ).toBe("HD");
  },
);

test("an empty current title leaves the banner category and quality intact", () => {
  const view = render(
    <PlaybackIdentity
      variant="banner"
      title="News"
      group="World news"
      quality="HD"
      currentProgramme=""
    />,
  );
  expect(view.container.querySelector(".pb-programme")).toBeNull();
  expect(view.container.querySelector(".playback-programme-row")).toBeNull();
  expect(view.container.querySelector(".pb-group")?.textContent).toBe("World news");
  expect(view.container.querySelector(".pb-quality")?.textContent).toBe("HD");
});
