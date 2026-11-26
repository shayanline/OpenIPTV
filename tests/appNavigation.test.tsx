import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import {
  AppNavigation,
  type AppNavigationAction,
  appNavigationItems,
} from "../src/components/AppNavigation";
import { KEY } from "../src/hooks/useRemote";
import { translate } from "../src/services/locale";
import {
  mountApp,
  panelOpen,
  played,
  press,
  settle,
  XTREAM_SOURCE,
  xtreamFetch,
} from "./support/app";

const PLAYLIST = `#EXTM3U
#EXTINF:-1 group-title="News",First Channel
http://example.invalid/1.m3u8
`;

const mountXtream = () => {
  localStorage.removeItem("app:last-mode:pl-1");
  return mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: xtreamFetch(
      [{ category_id: "10", category_name: "News" }],
      [{ stream_id: "1", name: "Provider One", category_id: "10", stream_type: "live" }],
    ),
  });
};

/*
 * The readiness barrier runs on real animation frames, so one long timer advance
 * cannot carry a transition past settling. Split it the way the screen does.
 */
const finishPageTransition = async () => {
  await settle(300);
  await settle(10);
  await settle(60);
  await settle(300);
};

const navigationItemsFor = (sourceKind: "m3u" | "xtream") =>
  appNavigationItems(sourceKind === "xtream" ? ["live", "movie", "series"] : ["live"], (key) =>
    translate("en", key),
  );

const renderNavigation = (
  sourceKind: "m3u" | "xtream",
  focused = false,
  onActivate = vi.fn(),
  onFocusChange = vi.fn(),
  activeMode: "live" | "movie" | "series" = "live",
  focusedAction?: AppNavigationAction,
) =>
  render(
    <AppNavigation
      activeMode={activeMode}
      items={navigationItemsFor(sourceKind)}
      focused={focused}
      focusedAction={focusedAction}
      onActivate={onActivate}
      onFocusChange={onFocusChange}
    />,
  );

type NavigationMotionRecord = {
  node: HTMLElement;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
  animation: Animation;
};

function mockNavigationMotion(duration = 180) {
  const root = document.documentElement.style;
  const oldDuration = root.getPropertyValue("--t-navigation");
  const oldEasing = root.getPropertyValue("--ease-enter");
  root.setProperty("--t-navigation", `${duration}ms`);
  root.setProperty("--ease-enter", "linear");
  const geometry = document.createElement("style");
  geometry.textContent = `
    .app-navigation-action {
      height: 64px;
      flex-basis: 64px;
      margin-bottom: 0px;
      opacity: 1;
    }
    .app-navigation-actions { row-gap: 8px; }
  `;
  document.head.append(geometry);
  const oldAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
  const oldHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  const records: NavigationMotionRecord[] = [];
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("app-navigation-icon")
        ? 64
        : (oldHeight?.get?.call(this) ?? 0);
    },
  });
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    writable: true,
    value(this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
      const animation = { onfinish: null, cancel: vi.fn() } as unknown as Animation;
      records.push({ node: this, frames, options, animation });
      return animation;
    },
  });
  return {
    records,
    finish(record: NavigationMotionRecord) {
      act(() => record.animation.onfinish?.({} as AnimationPlaybackEvent));
    },
    restore() {
      cleanup();
      geometry.remove();
      if (oldAnimate) Object.defineProperty(HTMLElement.prototype, "animate", oldAnimate);
      else Reflect.deleteProperty(HTMLElement.prototype, "animate");
      if (oldHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", oldHeight);
      else Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
      if (oldDuration) root.setProperty("--t-navigation", oldDuration);
      else root.removeProperty("--t-navigation");
      if (oldEasing) root.setProperty("--ease-enter", oldEasing);
      else root.removeProperty("--ease-enter");
    },
  };
}

const presenceId = (record: NavigationMotionRecord) =>
  record.node.dataset.navigationPresence ??
  record.node.closest("[data-navigation-presence]")?.getAttribute("data-navigation-presence") ??
  null;
const isLayoutChannel = (record: NavigationMotionRecord) =>
  Boolean(record.node.dataset.navigationPresence);
const isVisualChannel = (record: NavigationMotionRecord) =>
  record.node.classList.contains("app-navigation-action-visual");
const channelFor = (records: NavigationMotionRecord[], id: string, visual: boolean) =>
  records.find((record) => presenceId(record) === id && isVisualChannel(record) === visual)!;

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.style.removeProperty("--t-panel");
  document.documentElement.style.removeProperty("--t-med");
});

test("M3U sources place Search after Live in rail order", () => {
  renderNavigation("m3u");

  expect(
    screen.getAllByRole("button").map((button) => button.getAttribute("aria-label")),
  ).toEqual(["Live", "Search Live", "Settings"]);
});

test("Xtream sources place Search after Series in rail order", () => {
  renderNavigation("xtream");

  expect(
    screen.getAllByRole("button").map((button) => button.getAttribute("aria-label")),
  ).toEqual(["Live", "Movies", "Series", "Search Live", "Settings"]);
});

test("Playlist support changes animate only changing content destinations.", () => {
  const motion = mockNavigationMotion();
  try {
    const onActivate = vi.fn();
    const onFocusChange = vi.fn();
    const renderRail = (source: "m3u" | "xtream", focused = false) => (
      <StrictMode>
        <AppNavigation
          activeMode="live"
          items={navigationItemsFor(source)}
          focused={focused}
          focusedAction="live"
          onActivate={onActivate}
          onFocusChange={onFocusChange}
        />
      </StrictMode>
    );
    const view = render(renderRail("m3u"));
    const live = screen.getByRole("button", { name: "Live" });
    const search = screen.getByRole("button", { name: "Search Live" });
    const settings = screen.getByRole("button", { name: "Settings" });
    expect(motion.records).toHaveLength(0);

    view.rerender(renderRail("xtream"));
    expect(motion.records.map(presenceId)).toEqual(["movie", "movie", "series", "series"]);
    for (const record of motion.records.filter(isLayoutChannel)) {
      expect(record.options).toMatchObject({ duration: 180, fill: "forwards" });
      expect(record.frames[0]).toMatchObject({
        height: "0px",
        flexBasis: "0px",
        marginBottom: "-8px",
      });
      expect(record.frames[0]).not.toHaveProperty("opacity");
      expect(record.frames[1]).toMatchObject({
        height: "64px",
        flexBasis: "64px",
        marginBottom: "0px",
      });
      expect(record.frames[1]).not.toHaveProperty("opacity");
    }
    for (const record of motion.records.filter(isVisualChannel)) {
      expect(record.options).toMatchObject({ duration: 180, fill: "forwards" });
      expect(record.frames[0]).toMatchObject({ opacity: 0, transform: "scale(0)" });
      expect(record.frames[1]).toMatchObject({ opacity: 1, transform: "scale(1)" });
    }
    motion.records.slice().forEach((record) => {
      motion.finish(record);
    });
    view.rerender(renderRail("xtream", true));
    expect(motion.records).toHaveLength(4);
    expect(document.activeElement).toBe(live);
    view.rerender(
      <StrictMode>
        <AppNavigation
          activeMode="live"
          items={navigationItemsFor("xtream").map((item) => ({
            ...item,
            label: `${item.label}!`,
          }))}
          focused={false}
          onActivate={onActivate}
          onFocusChange={onFocusChange}
        />
      </StrictMode>,
    );
    expect(motion.records).toHaveLength(4);
    expect(document.querySelector('[data-navigation-action="live"]')).toBe(live);
    expect(document.querySelector('[data-navigation-action="search"]')).toBe(search);
    expect(document.querySelector('[data-navigation-action="settings"]')).toBe(settings);

    const movie = document.querySelector<HTMLElement>('[data-navigation-action="movie"]')!;
    const series = document.querySelector<HTMLElement>('[data-navigation-action="series"]')!;
    view.rerender(renderRail("m3u"));
    expect(motion.records).toHaveLength(8);
    expect(movie.isConnected).toBe(true);
    expect(series.isConnected).toBe(true);
    expect(movie.hasAttribute("disabled")).toBe(true);
    expect(movie.getAttribute("aria-hidden")).toBe("true");
    expect(movie.getAttribute("tabindex")).toBe("-1");
    expect(movie.hasAttribute("data-navigation-action")).toBe(false);
    expect(movie.hasAttribute("aria-current")).toBe(false);
    expect(screen.queryByRole("button", { name: /^Movies/ })).toBeNull();
    fireEvent.click(movie);
    expect(onActivate).not.toHaveBeenCalled();
    expect(
      [...view.container.querySelectorAll("[data-navigation-action]")].map(
        (node) => (node as HTMLElement).dataset.navigationAction,
      ),
    ).toEqual(["live", "search", "settings"]);
    const exits = motion.records.slice(4);
    for (const id of ["movie", "series"]) {
      const layout = channelFor(exits, id, false);
      const visual = channelFor(exits, id, true);
      vi.mocked(visual.animation.cancel).mockImplementation(() => {
        expect(visual.node.style.opacity).toBe("0");
        expect(visual.node.style.transform).toBe("scale(0)");
        expect(layout.node.style.height).toBe("0px");
      });
      motion.finish(layout);
      expect(document.querySelector(`[data-navigation-presence="${id}"]`)).toBeTruthy();
      motion.finish(visual);
      expect(document.querySelector(`[data-navigation-presence="${id}"]`)).toBeNull();
    }
    expect(movie.isConnected).toBe(false);
    expect(series.isConnected).toBe(false);
  } finally {
    motion.restore();
  }
});

test("A reversed exit keeps its node and samples its current frame before cancellation.", () => {
  const motion = mockNavigationMotion();
  try {
    const rail = (source: "m3u" | "xtream") => (
      <AppNavigation
        activeMode="live"
        items={navigationItemsFor(source)}
        focused={false}
        onActivate={() => undefined}
        onFocusChange={() => undefined}
      />
    );
    const view = render(rail("xtream"));
    const movie = screen.getByRole("button", { name: "Movies" });
    const visual = movie.querySelector<HTMLElement>(".app-navigation-action-visual")!;
    view.rerender(rail("m3u"));
    const exiting = motion.records.filter((record) => presenceId(record) === "movie");
    const exitingLayout = exiting.find(isLayoutChannel)!;
    const exitingVisual = exiting.find(isVisualChannel)!;
    const obsoleteFinishLayout = exitingLayout.animation.onfinish;
    const obsoleteFinishVisual = exitingVisual.animation.onfinish;
    Object.assign(movie.style, {
      height: "32px",
      flexBasis: "32px",
      marginBottom: "-4px",
    });
    Object.assign(visual.style, { opacity: "0.5", transform: "scale(0.5)" });
    vi.mocked(exitingLayout.animation.cancel).mockImplementation(() => {
      Object.assign(movie.style, {
        height: "64px",
        flexBasis: "64px",
        marginBottom: "0px",
      });
    });
    vi.mocked(exitingVisual.animation.cancel).mockImplementation(() => {
      Object.assign(visual.style, { opacity: "1", transform: "scale(1)" });
    });
    view.rerender(rail("xtream"));
    const restored = motion.records.filter((record) => presenceId(record) === "movie").slice(2);
    const restoredLayout = restored.find(isLayoutChannel)!;
    const restoredVisual = restored.find(isVisualChannel)!;
    expect(screen.getByRole("button", { name: "Movies" })).toBe(movie);
    expect(movie.hasAttribute("disabled")).toBe(false);
    expect(exitingLayout.animation.cancel).toHaveBeenCalledOnce();
    expect(exitingVisual.animation.cancel).toHaveBeenCalledOnce();
    expect(restoredLayout.frames[0]).toMatchObject({
      height: "32px",
      flexBasis: "32px",
      marginBottom: "-4px",
    });
    expect(restoredLayout.frames[0]).not.toHaveProperty("opacity");
    expect(restoredVisual.frames[0]).toMatchObject({ opacity: "0.5" });
    expect(String(restoredVisual.frames[0].transform)).toContain("0.5");
    act(() =>
      obsoleteFinishLayout?.call(exitingLayout.animation, {} as AnimationPlaybackEvent),
    );
    act(() =>
      obsoleteFinishVisual?.call(exitingVisual.animation, {} as AnimationPlaybackEvent),
    );
    expect(movie.isConnected).toBe(true);
    expect(movie.dataset.navigationAction).toBe("movie");
    view.unmount();
    expect(restoredLayout.animation.cancel).toHaveBeenCalledOnce();
    expect(restoredVisual.animation.cancel).toHaveBeenCalledOnce();
    act(() =>
      obsoleteFinishLayout?.call(exitingLayout.animation, {} as AnimationPlaybackEvent),
    );
    expect(view.container.childElementCount).toBe(0);
  } finally {
    motion.restore();
  }
});

test("Zero motion duration settles availability immediately without animation objects.", () => {
  const motion = mockNavigationMotion(0);
  try {
    const rail = (source: "m3u" | "xtream") => (
      <AppNavigation
        activeMode="live"
        items={navigationItemsFor(source)}
        focused={false}
        onActivate={() => undefined}
        onFocusChange={() => undefined}
      />
    );
    const view = render(rail("xtream"));
    view.rerender(rail("m3u"));
    expect(view.container.querySelector("[data-navigation-exiting]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Movies" })).toBeNull();
    view.rerender(rail("xtream"));
    expect(screen.getByRole("button", { name: "Movies" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Series" })).toBeTruthy();
    expect(motion.records).toHaveLength(0);
  } finally {
    motion.restore();
  }
});

test("A reduced motion preference change settles both presence channels at once.", () => {
  const listeners: Array<() => void> = [];
  let reduced = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return reduced;
      },
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: (listener: () => void) => {
        listeners.push(listener);
      },
      removeListener: (listener: () => void) => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return true;
      },
    })),
  );
  const motion = mockNavigationMotion();
  try {
    const rail = (source: "m3u" | "xtream") => (
      <AppNavigation
        activeMode="live"
        items={navigationItemsFor(source)}
        focused={false}
        onActivate={() => undefined}
        onFocusChange={() => undefined}
      />
    );
    const view = render(rail("xtream"));
    view.rerender(rail("m3u"));
    const exiting = motion.records.filter((record) => presenceId(record));
    expect(exiting).toHaveLength(4);
    expect(listeners.length).toBeGreaterThan(0);

    reduced = true;
    act(() => {
      for (const listener of [...listeners]) listener();
    });
    for (const record of exiting) {
      expect(record.animation.cancel).toHaveBeenCalled();
    }
    expect(document.querySelector("[data-navigation-exiting]")).toBeNull();
    expect(document.querySelector('[data-navigation-presence="movie"]')).toBeNull();
    expect(document.querySelector('[data-navigation-presence="series"]')).toBeNull();
    const live = screen.getByRole("button", { name: "Live" });
    expect(live.hasAttribute("disabled")).toBe(false);
  } finally {
    motion.restore();
    vi.unstubAllGlobals();
  }
});

test("the decorative divider sits between Series and Search", () => {
  renderNavigation("xtream");

  const divider = document.querySelector(".app-navigation-divider");
  expect(divider).toBeTruthy();
  expect(divider?.getAttribute("aria-hidden")).toBe("true");
  expect(divider?.getAttribute("tabindex")).toBeNull();
  expect(divider?.previousElementSibling?.getAttribute("data-navigation-action")).toBe(
    "series",
  );
  expect(divider?.nextElementSibling?.getAttribute("data-navigation-action")).toBe("search");
  const styles = readFileSync("src/styles/app.css", "utf8");
  expect(styles).toMatch(
    /\.app-navigation-divider \{[^}]*width:\s*100%;[^}]*height:\s*1px;[^}]*margin:\s*var\(--s1\)\s*0;/,
  );
  expect(styles).toMatch(
    /\.no-flex-gap \.app-navigation-actions > \* \+ \* \{\s*margin-top:\s*var\(--s1\);/,
  );
  expect(styles).toMatch(
    /\.no-flex-gap \.app-navigation-actions > \.app-navigation-divider \{\s*margin-top:\s*calc\(var\(--s1\) \* 2\);/,
  );
});

test("Search names and scope badge follow active Movies mode", () => {
  renderNavigation("xtream", false, vi.fn(), vi.fn(), "movie", "search");

  const search = screen.getByRole("button", { name: "Search Movies" });
  const scope = search.querySelector("[data-navigation-scope]");
  const movies = document.querySelector('[data-navigation-action="movie"]');

  expect(scope?.getAttribute("aria-hidden")).toBe("true");
  expect(scope?.querySelector(".icon-movie")?.outerHTML).toBe(
    movies?.querySelector(".icon-movie")?.outerHTML,
  );
  expect(search.classList.contains("cursor")).toBe(true);
  expect(search.classList.contains("active")).toBe(false);
  expect(movies?.classList.contains("active")).toBe(true);
  expect(movies?.classList.contains("cursor")).toBe(false);
});

test("M3U Search shows the Live scope and omits VOD destinations", () => {
  renderNavigation("m3u", false, vi.fn(), vi.fn(), "live", "search");

  const search = screen.getByRole("button", { name: "Search Live" });
  expect(search.querySelector(".icon-live")).toBeTruthy();
  expect(search.querySelector(".icon-movie")).toBeNull();
  expect(search.querySelector(".icon-series")).toBeNull();
  expect(screen.queryByRole("button", { name: "Movies" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Series" })).toBeNull();
});

test("Search uses a stable three area layout and hides its scope cleanly when collapsed", () => {
  const onActivate = vi.fn();
  const onFocusChange = vi.fn();
  const view = renderNavigation("xtream", false, onActivate, onFocusChange, "movie", "search");
  const scope = document.querySelector("[data-navigation-scope]");
  const styles = readFileSync("src/styles/app.css", "utf8");
  const tokens = readFileSync("src/styles/tokens.css", "utf8");

  expect(scope?.querySelector(".app-navigation-scope-label")?.textContent).toBe("Movies");
  expect(styles).toMatch(/\.app-navigation-scope-badge \{[^}]*display:\s*none;/);

  view.rerender(
    <AppNavigation
      activeMode="movie"
      items={navigationItemsFor("xtream")}
      focused
      focusedAction="search"
      onActivate={onActivate}
      onFocusChange={onFocusChange}
    />,
  );

  expect(document.querySelectorAll("[data-navigation-scope]")).toHaveLength(1);
  expect(document.querySelector(".app-navigation.expanded [data-navigation-scope]")).toBe(
    scope,
  );
  const searchContent = document.querySelector(".app-navigation-search-content");
  expect(
    searchContent?.closest<HTMLElement>("[data-navigation-action]")?.dataset.navigationAction,
  ).toBe("search");
  expect(searchContent?.querySelectorAll(":scope > span")).toHaveLength(3);
  expect(searchContent?.querySelector(".app-navigation-icon")).toBeTruthy();
  expect(searchContent?.querySelector(".app-navigation-label")).toBeTruthy();
  expect(searchContent?.querySelector("[data-navigation-scope]")).toBe(scope);
  expect(styles).toMatch(
    /\.app-navigation\.expanded \.app-navigation-search-content \{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*var\(--s6\) minmax\(0, 1fr\) auto;/,
  );
  const expandedBadge =
    styles.match(/\.app-navigation\.expanded \.app-navigation-scope-badge \{([^}]*)\}/)?.[1] ??
    "";
  expect(expandedBadge).toContain("display: flex");
  expect(expandedBadge).not.toMatch(/width:\s*104px/);
  expect(expandedBadge).not.toMatch(/position:\s*absolute/);
  expect(styles).toMatch(
    /\.app-navigation\.expanded \.app-navigation-scope-label \{[^}]*-webkit-line-clamp:\s*2;[^}]*white-space:\s*normal;/,
  );
  expect(tokens).toMatch(/--app-nav-gutter:\s*var\(--safe-x\);/);
  expect(tokens).toMatch(
    /--app-nav-collapsed-w:\s*calc\(var\(--app-nav-gutter\) \* 2 \+ var\(--s6\)\);/,
  );
});

test("Settings remains selected while the rail owns a different active content mode", () => {
  render(
    <AppNavigation
      activeMode="movie"
      activeAction="settings"
      items={navigationItemsFor("xtream")}
      focused={false}
      onActivate={() => undefined}
      onFocusChange={() => undefined}
    />,
  );

  expect(
    document.querySelector('[data-navigation-action="settings"]')?.getAttribute("aria-current"),
  ).toBe("page");
  expect(
    document.querySelector('[data-navigation-action="movie"]')?.getAttribute("aria-current"),
  ).toBeNull();
});

test("the application rail uses an opaque flat surface with no raised shadow", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  const tokens = readFileSync("src/styles/tokens.css", "utf8");
  const rail = styles.slice(
    styles.indexOf(".app-navigation {"),
    styles.indexOf(".app-navigation.expanded"),
  );
  expect(rail).toContain("background: var(--app-navigation-surface)");
  expect(rail).toContain("box-shadow: none");
  expect(rail).toContain("border-inline-end: 1px solid var(--line)");
  expect(tokens).toMatch(/--app-navigation-surface:\s*#[0-9a-f]{6};/i);
  expect(styles).toMatch(/\.app-navigation-action\.active \{[^}]*color:\s*var\(--text\);/);
  expect(styles).toMatch(
    /\.app-navigation-action\.active > \.app-navigation-action-visual \{[^}]*background:\s*var\(--accent-dim\);/,
  );
  expect(styles).toMatch(
    /html\[data-input-mode="remote"\] \.app-navigation-action\.cursor[\s\S]*background:\s*var\(--target-bg\);[\s\S]*color:\s*var\(--target-text\);/,
  );
});

test("native browser scrollbars and their reserved gutters stay hidden", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  const tokens = readFileSync("src/styles/tokens.css", "utf8");
  expect(styles).toMatch(/\.app \*::-webkit-scrollbar \{[\s\S]*display:\s*none;/);
  expect(styles).toMatch(/\.app \* \{[\s\S]*scrollbar-width:\s*none;/);
  expect(styles).toMatch(/\.scrollbar \{[\s\S]*display:\s*none;/);
  expect(tokens).toMatch(/--scroll-gutter:\s*0px;/);
});

test("the navigation rail and page content share a shifting sibling shell", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  expect(styles).toMatch(
    /\.app-content \{[^}]*position:\s*absolute;[^}]*transition:\s*left var\(--t-navigation\) var\(--ease-enter\);/,
  );
  expect(styles).toMatch(
    /\.app-navigation-visible \.app-content \{[^}]*left:\s*var\(--app-nav-collapsed-w\);/,
  );
  expect(styles).toMatch(
    /\.app-navigation-expanded \.app-content \{[^}]*left:\s*var\(--app-nav-expanded-w\);/,
  );
  expect(styles).toMatch(
    /\.sheet \{[^}]*transition:\s*transform var\(--t-navigation\) var\(--ease-enter\);/,
  );
  expect(styles).not.toMatch(/\.app-navigation-visible \.panel \{/);
  expect(styles).not.toMatch(/\.app-navigation-visible \.vod-host \{/);
});

test("the application mark is decorative and is not focusable", () => {
  renderNavigation("m3u");

  const mark = document.querySelector("[data-app-mark]");
  expect(mark).toBeTruthy();
  expect(mark?.closest("button")).toBeNull();
  expect(mark?.getAttribute("tabindex")).toBeNull();
});

test("the expanded brand pairs the application icon with a bold OpenIPTV label", () => {
  renderNavigation("m3u", true);

  const brand = document.querySelector(".app-navigation-brand");
  expect(brand?.querySelector("img")).toBeTruthy();
  expect(brand?.querySelector(".app-navigation-brand-label")?.textContent).toBe("OpenIPTV");
  expect(brand?.querySelector("strong.app-navigation-brand-label")).toBeTruthy();
});

test("collapsed actions use centred square geometry without moving their icons when expanded", () => {
  renderNavigation("xtream");
  expect(document.querySelectorAll(".app-navigation-action .app-navigation-icon")).toHaveLength(
    5,
  );
  const styles = readFileSync("src/styles/app.css", "utf8");
  expect(styles).toMatch(
    /\.app-navigation-action \{[^}]*width:\s*var\(--s6\);[^}]*height:\s*var\(--s6\);/,
  );
  expect(styles).toMatch(
    /\.app-navigation-icon \{[^}]*width:\s*var\(--s6\);[^}]*height:\s*var\(--s6\);[^}]*justify-content:\s*center;/,
  );
  expect(styles).toMatch(
    /\.app-navigation-brand img \{[^}]*width:\s*36px;[^}]*height:\s*36px;/,
  );
  expect(styles).toMatch(/\.app-navigation-mark-gap \{[^}]*min-height:\s*var\(--s3\);/);
});

test("Search shares the top action group while only the Settings spacer grows", () => {
  renderNavigation("xtream");
  const navigation = document.querySelector(".app-navigation");

  expect(navigation?.querySelector(".app-navigation-mark-gap")).toBeTruthy();
  expect(navigation?.querySelector(".app-navigation-footer-spacer")).toBeTruthy();
  expect(navigation?.querySelectorAll(".app-navigation-spacer")).toHaveLength(1);
});

test("collapsed rail actions keep accessible names", () => {
  renderNavigation("xtream");

  expect(
    screen.getAllByRole("button").every((button) => !!button.getAttribute("aria-label")),
  ).toBe(true);
});

test("pointer focus does not expand the rail or claim remote ownership", () => {
  const onFocusChange = vi.fn();
  document.documentElement.dataset.inputMode = "pointer";
  renderNavigation("m3u", false, vi.fn(), onFocusChange);
  const navigation = document.querySelector(".app-navigation");
  const search = screen.getByRole("button", { name: /^Search/ });

  fireEvent.focus(search);

  expect(navigation?.classList.contains("expanded")).toBe(false);
  expect(onFocusChange).not.toHaveBeenCalled();
  delete document.documentElement.dataset.inputMode;
});

test("a pointerenter cannot move the remote navigation cursor", () => {
  const onHover = vi.fn();
  document.documentElement.dataset.inputMode = "remote";
  render(
    <AppNavigation
      activeMode="live"
      items={navigationItemsFor("xtream")}
      focused
      focusedAction="live"
      onActivate={() => undefined}
      onHover={onHover}
      onFocusChange={() => undefined}
    />,
  );

  fireEvent.pointerEnter(screen.getByRole("button", { name: "Movies" }));

  expect(onHover).not.toHaveBeenCalled();
  expect(
    document.querySelector('[data-navigation-action="live"]')?.classList.contains("cursor"),
  ).toBe(true);
  delete document.documentElement.dataset.inputMode;
});

test("application navigation never leaves the browser focus outline after pointer exit", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  expect(styles).toMatch(/\.app-navigation-action:focus \{[^}]*outline:\s*none;/);
});

test("mounted pointer hover expands the rail and becomes the arrow origin", async () => {
  await mountApp(PLAYLIST);
  const settings = screen.getByRole("button", { name: "Settings" });
  fireEvent.pointerMove(settings);
  fireEvent.pointerEnter(settings);
  await settle(0);

  expect(document.querySelector(".app-navigation.expanded")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Settings" }).classList.contains("cursor")).toBe(
    true,
  );
  expect(screen.getByRole("button", { name: "Live" }).getAttribute("aria-current")).toBe(
    "page",
  );

  press(KEY.UP);
  expect(screen.getByRole("button", { name: "Search Live" }).classList.contains("cursor")).toBe(
    true,
  );

  fireEvent.click(settings);
  await settle(0);
  expect(document.querySelector(".settings-host:not(.hidden) .sheet")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Appearance" }));
});

test("clicking the active Live action returns focus to the content", async () => {
  await mountApp(PLAYLIST);
  press(KEY.LEFT);
  press(KEY.LEFT);
  await settle(0);

  fireEvent.click(screen.getByRole("button", { name: "Live" }));
  await settle(0);

  expect(document.querySelector(".app-navigation.expanded")).toBeNull();
  expect(document.querySelector(".panel .cursor")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Live" }).getAttribute("aria-current")).toBe(
    "page",
  );
});

test("right selects an inactive navigation destination", async () => {
  await mountXtream();
  press(KEY.LEFT);
  press(KEY.LEFT);
  press(KEY.DOWN);
  press(KEY.RIGHT);
  await settle(300);

  expect(document.querySelector(".vod-screen[data-mode='movie']")).toBeTruthy();
  expect(document.querySelector(".app-navigation.expanded")).toBeNull();
});

test("right from Settings navigation returns focus to the Settings rail", async () => {
  await mountApp(PLAYLIST);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await settle(0);

  press(KEY.LEFT);
  await settle(0);
  expect(document.querySelector(".app-navigation.expanded")).toBeTruthy();

  press(KEY.RIGHT);
  await settle(0);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Appearance" }));
  expect(document.querySelector(".sheet-rail .cursor")).toBeTruthy();
});

test.each(["click", "enter"] as const)(
  "reselecting the active Settings rail opens its root (%s)",
  async (mode) => {
    await mountApp(PLAYLIST);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await settle(0);
    fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
    await settle(0);
    fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
    await settle(0);
    expect(screen.getByRole("heading", { name: "Saved playlists" })).toBeTruthy();

    const settings = screen.getByRole("button", { name: "Settings" });
    fireEvent.pointerMove(settings);
    fireEvent.pointerEnter(settings);
    await settle(0);
    expect(document.querySelector(".app-navigation.expanded")).toBeTruthy();

    if (mode === "click") {
      fireEvent.click(settings);
    } else {
      press(KEY.ENTER);
    }
    await settle(0);

    expect(screen.getByRole("heading", { name: "Appearance" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Appearance" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.queryByRole("heading", { name: "Saved playlists" })).toBeNull();
    expect(document.querySelector(".settings-detail-appbar")).toBeNull();
    expect(document.querySelector(".settings-breadcrumbs")).toBeNull();
  },
);

test("Right from the expanded app rail resumes the suspended Settings detail", async () => {
  await mountApp(PLAYLIST);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  const savedHeading = screen.getByRole("heading", { name: "Saved playlists" });
  const firstRow = document.querySelector(".pl-line .pl-open");
  expect(firstRow).toBeTruthy();

  const settings = screen.getByRole("button", { name: "Settings" });
  fireEvent.pointerMove(settings);
  fireEvent.pointerEnter(settings);
  await settle(0);
  expect(document.querySelector(".app-navigation.expanded")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Saved playlists" })).toBe(savedHeading);

  press(KEY.RIGHT);
  await settle(0);

  expect(document.querySelector(".app-navigation.expanded")).toBeNull();
  expect(screen.getByRole("heading", { name: "Saved playlists" })).toBe(savedHeading);
  expect(document.querySelector(".pl-line .pl-open")).toBe(firstRow);
  expect(document.querySelector("[data-settings-edge-back]")).toBeTruthy();
});

test("clicking empty space keeps the current remote focus target", async () => {
  await mountApp(PLAYLIST);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await settle(0);

  const appearance = screen.getByRole("button", { name: "Appearance" });
  const emptyBody = document.querySelector<HTMLElement>(".sheet-body");
  if (!emptyBody) throw new Error("Settings body missing");
  fireEvent.pointerDown(emptyBody);
  appearance.blur();
  await settle(0);

  expect(document.activeElement).toBe(appearance);
  press(KEY.DOWN);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Playback" }));
});

test("rail actions report the existing navigation action when activated", () => {
  const onActivate = vi.fn();
  renderNavigation("xtream", false, onActivate);

  for (const name of ["Search Live", "Live", "Movies", "Series", "Settings"]) {
    fireEvent.click(screen.getByRole("button", { name }));
  }

  expect(onActivate.mock.calls.map(([item]) => item.id)).toEqual([
    "search",
    "live",
    "movie",
    "series",
    "settings",
  ]);
});

test("the M3U application mounts one rail without the old Live header", async () => {
  await mountApp(PLAYLIST);

  expect(document.querySelectorAll(".app-navigation")).toHaveLength(1);
  expect(
    [...document.querySelectorAll(".app-navigation button")].map((button) =>
      button.getAttribute("aria-label"),
    ),
  ).toEqual(["Live", "Search Live", "Settings"]);
  expect(document.querySelector(".panel-bar")).toBeNull();
});

test("Settings keeps the application rail visible and offsets the sheet", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  await settle();

  expect(document.querySelector(".settings-host:not(.hidden) .sheet")).toBeTruthy();
  expect(document.querySelector(".app-navigation")).toBeTruthy();
  const styles = readFileSync("src/styles/app.css", "utf8");
  expect(styles).toMatch(/\.settings-host \{[^}]*background: var\(--sheet\);/);
  expect(styles).toMatch(/\.sheet \{[^}]*left: var\(--app-nav-collapsed-w\);/);
});

test("Search selected from Settings opens a fresh scoped Live search", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Search Live" }));
  await settle();

  expect(document.querySelector(".settings-host:not(.hidden) .sheet")).toBeNull();
  expect(document.querySelector(".search-field")).toBeTruthy();
});

test("remote focus enters and leaves the shared rail from Live categories", async () => {
  await mountApp(PLAYLIST);
  const panel = document.querySelector(".panel");

  press(KEY.LEFT);
  await settle();
  press(KEY.LEFT);
  await settle();
  expect(document.querySelector(".app-navigation")?.classList.contains("expanded")).toBe(true);
  expect(document.querySelector(".app")?.classList.contains("app-navigation-expanded")).toBe(
    true,
  );
  expect(document.querySelector(".panel")).toBe(panel);

  press(KEY.RIGHT);
  await settle();
  expect(document.querySelector(".app-navigation")?.classList.contains("expanded")).toBe(false);
  expect(document.querySelector(".app")?.classList.contains("app-navigation-expanded")).toBe(
    false,
  );
});

test.each([KEY.BACK, KEY.ESC])(
  "navigation key %s leaves the rail without activating its focused action",
  async (code) => {
    await mountXtream();
    press(KEY.LEFT);
    press(KEY.LEFT);
    press(KEY.DOWN);
    await settle(0);

    expect(document.querySelector(".vod-host:not(.hidden) .vod-screen")).toBeNull();
    press(code);
    await settle(0);

    expect(document.querySelector(".app-navigation.expanded")).toBeNull();
    expect(document.querySelector(".settings-host:not(.hidden) .sheet")).toBeNull();
    expect(document.querySelector(".vod-host:not(.hidden) .vod-screen")).toBeNull();
    expect(screen.getByRole("button", { name: "Live" }).getAttribute("aria-current")).toBe(
      "page",
    );
  },
);

test("hidden sections leave the rail and the last supported switch stays on", async () => {
  await mountXtream();
  press(KEY.YELLOW);
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Show Live" }));
  });
  await settle(0);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Show Series" }));
  });
  await settle(0);

  const movies = screen.getByRole("button", { name: "Show Movies" });
  expect(movies.hasAttribute("disabled")).toBe(true);

  press(KEY.BACK);
  await settle(0);
  expect(document.querySelector(".settings-host:not(.hidden) .sheet")).toBeNull();

  const actions = [...document.querySelectorAll("[data-navigation-action]")].map((element) =>
    element.getAttribute("data-navigation-action"),
  );
  expect(actions).toEqual(["movie", "search", "settings"]);
  expect(screen.getByRole("button", { name: "Search Movies" })).toBeTruthy();
  const rail = document.querySelector(".app-navigation");
  expect(rail?.querySelector('[data-navigation-action="live"]')).toBeNull();
  expect(rail?.querySelector('[data-navigation-action="series"]')).toBeNull();

  const { useSettings } = await import("../src/stores/settings");
  const playlist = useSettings.getState().activePlaylist();
  expect(playlist?.id).toBe("pl-1");
  expect(playlist?.source.kind).toBe("xtream");
  expect(useSettings.getState().showLive).toBe(false);
  expect(useSettings.getState().showSeries).toBe(false);
});

test("Visibility switches animate the rail while Settings keeps focus.", async () => {
  await mountXtream();
  press(KEY.YELLOW);
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  const motion = mockNavigationMotion();
  try {
    const toggle = screen.getByRole("button", { name: "Show Movies" });
    vi.spyOn(toggle, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 120, 40));
    const movie = document.querySelector<HTMLElement>('[data-navigation-action="movie"]')!;
    await act(async () => {
      toggle.focus();
      fireEvent.click(toggle);
    });
    await settle(0);
    const exits = motion.records.filter((record) => presenceId(record) === "movie");
    const exitLayout = exits.find(isLayoutChannel)!;
    const exitVisual = exits.find(isVisualChannel)!;
    expect(exitLayout).toBeTruthy();
    expect(exitVisual).toBeTruthy();
    expect(movie.getAttribute("aria-hidden")).toBe("true");
    expect(document.activeElement).toBe(toggle);
    motion.finish(exitLayout);
    expect(movie.isConnected).toBe(true);
    motion.finish(exitVisual);
    expect(movie.isConnected).toBe(false);
    expect(document.activeElement).toBe(toggle);
    await act(async () => {
      fireEvent.click(toggle);
    });
    await settle(0);
    const restored = document.querySelector<HTMLElement>('[data-navigation-action="movie"]')!;
    expect(restored).toBeTruthy();
    expect(motion.records.some((record) => record.node === restored)).toBe(true);
    expect(document.activeElement).toBe(toggle);
  } finally {
    motion.restore();
  }
});

test("Removing the focused destination reconciles both DOM and keyboard cursor.", async () => {
  await mountXtream();
  press(KEY.LEFT);
  press(KEY.LEFT);
  press(KEY.DOWN);
  await settle(0);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Movies" }));
  const motion = mockNavigationMotion();
  try {
    const { useSettings } = await import("../src/stores/settings");
    await act(async () => {
      useSettings.getState().set("showMovies", false);
    });
    await settle(0);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Live" }));
    expect(document.querySelector('[data-navigation-exiting="movie"]')).toBeTruthy();
    press(KEY.DOWN);
    await settle(0);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Series" }));
    expect(document.querySelector(".vod-host:not(.hidden) .vod-screen")).toBeNull();
  } finally {
    motion.restore();
  }
});

test("a remembered section that was switched off falls back to an enabled one", async () => {
  localStorage.setItem("app:last-mode:pl-1", "series");
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: xtreamFetch(
      [{ category_id: "10", category_name: "News" }],
      [{ stream_id: "1", name: "Provider One", category_id: "10", stream_type: "live" }],
    ),
    appearance: { showSeries: false },
  });
  await settle(0);

  const actions = [...document.querySelectorAll("[data-navigation-action]")].map((element) =>
    element.getAttribute("data-navigation-action"),
  );
  expect(actions).toEqual(["live", "movie", "search", "settings"]);
  const rail = document.querySelector(".app-navigation");
  expect(rail?.querySelector('[data-navigation-action="series"]')).toBeNull();
  expect(
    rail?.querySelector('[data-navigation-action="live"]')?.getAttribute("aria-current"),
  ).toBe("page");
});

test("application navigation owns DOM focus and hides the underlying cursor", async () => {
  await mountApp(PLAYLIST);
  press(KEY.LEFT);
  press(KEY.LEFT);
  await settle(0);

  const live = screen.getByRole("button", { name: "Live" });
  expect(document.activeElement).toBe(live);
  expect(document.querySelectorAll(".app-navigation .cursor")).toHaveLength(1);
  expect(document.querySelectorAll(".panel .cursor")).toHaveLength(0);

  press(KEY.RIGHT);
  await settle(0);
  expect(document.activeElement).not.toBe(live);
  expect(document.querySelectorAll(".panel .cursor")).toHaveLength(1);
});

test("application navigation synchronises DOM focus before paint", () => {
  const source = readFileSync("src/components/AppNavigation.tsx", "utf8");

  expect(source).toMatch(
    /useLayoutEffect\(\(\) => \{\n {4}const element = navigation\.current;/,
  );
});

test("remote navigation changes the focus surface without animating the old action away", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  const action = styles.slice(
    styles.indexOf(".app-navigation-action {"),
    styles.indexOf(".app-navigation-icon {"),
  );
  const badge = styles.slice(
    styles.indexOf(".app-navigation-scope-badge {"),
    styles.indexOf(".app-navigation.expanded .app-navigation-search-content"),
  );

  expect(action).toContain("transition: width var(--t-navigation) var(--ease-enter);");
  expect(action).not.toContain("background var(--t-fast)");
  expect(action).not.toContain("color var(--t-fast)");
  expect(badge).not.toContain("background var(--t-fast)");
  expect(badge).not.toContain("color var(--t-fast)");
});

test("moving through application navigation changes only the focused action", async () => {
  const fetchImplementation = vi.fn(
    xtreamFetch(
      [{ category_id: "10", category_name: "News" }],
      [{ stream_id: "1", name: "Provider One", category_id: "10", stream_type: "live" }],
    ),
  );
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation });
  const initialRequestCount = fetchImplementation.mock.calls.length;
  press(KEY.LEFT);
  press(KEY.LEFT);

  press(KEY.DOWN);
  await settle(0);
  expect(document.querySelector(".vod-host:not(.hidden) .vod-screen")).toBeNull();
  expect(screen.getByRole("button", { name: "Live" }).getAttribute("aria-current")).toBe(
    "page",
  );
  expect(screen.getByRole("button", { name: "Movies" }).classList.contains("cursor")).toBe(
    true,
  );

  press(KEY.DOWN);
  await settle(0);
  expect(document.querySelector(".vod-host:not(.hidden) .vod-screen")).toBeNull();
  expect(screen.getByRole("button", { name: "Series" }).classList.contains("cursor")).toBe(
    true,
  );

  press(KEY.DOWN);
  await settle(0);
  expect(document.querySelector(".vod-host:not(.hidden) .vod-screen")).toBeNull();
  expect(screen.getByRole("button", { name: "Live" }).getAttribute("aria-current")).toBe(
    "page",
  );
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Search/ }));
  expect(fetchImplementation.mock.calls).toHaveLength(initialRequestCount);
});

test("OK on Search from Movies opens Movie search without changing the active mode", async () => {
  await mountXtream();
  press(KEY.LEFT);
  press(KEY.LEFT);
  press(KEY.DOWN);
  press(KEY.ENTER);
  await settle(300);

  expect(document.querySelector(".vod-screen[data-mode='movie']")).toBeTruthy();
  expect(document.querySelector(".app-navigation.expanded")).toBeNull();

  press(KEY.LEFT);
  press(KEY.DOWN);
  press(KEY.DOWN);
  await settle(0);
  expect(screen.getByRole("button", { name: "Movies" }).getAttribute("aria-current")).toBe(
    "page",
  );
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Search Movies" }));

  press(KEY.ENTER);
  await settle(0);
  expect(screen.getByRole("textbox", { name: /Search Movies/ })).toBeTruthy();
  expect(document.querySelector(".app-navigation.expanded")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Search Movies" }).getAttribute("aria-current"),
  ).toBe("page");
  expect(
    screen.getByRole("button", { name: "Movies" }).getAttribute("aria-current"),
  ).toBeNull();
});

test("OK on Search from Series opens Series search without changing the active mode", async () => {
  await mountXtream();
  press(KEY.LEFT);
  press(KEY.LEFT);
  press(KEY.DOWN);
  press(KEY.DOWN);
  press(KEY.ENTER);
  await settle(300);

  expect(document.querySelector(".vod-screen[data-mode='series']")).toBeTruthy();
  expect(document.querySelector(".app-navigation.expanded")).toBeNull();
  press(KEY.LEFT);
  press(KEY.DOWN);
  await settle(0);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Search Series" }));
  expect(screen.getByRole("button", { name: "Series" }).getAttribute("aria-current")).toBe(
    "page",
  );

  press(KEY.ENTER);
  await settle(0);
  expect(screen.getByRole("textbox", { name: /Search Series/ })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Search Series" }).getAttribute("aria-current"),
  ).toBe("page");
  expect(
    screen.getByRole("button", { name: "Series" }).getAttribute("aria-current"),
  ).toBeNull();
});

test.each([
  ["Movies", 1],
  ["Series", 2],
] as const)(
  "OK on inactive %s changes the active mode, collapses navigation, and focuses its category selector",
  async (name, moves) => {
    await mountXtream();
    press(KEY.LEFT);
    press(KEY.LEFT);
    for (let index = 0; index < moves; index += 1) press(KEY.DOWN);
    press(KEY.ENTER);
    await settle(300);

    expect(screen.getByRole("button", { name }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name }).classList.contains("cursor")).toBe(false);
    expect(document.querySelector(".app-navigation.expanded")).toBeNull();
    expect(
      document.querySelector(name === "Live" ? ".panel .rail.focused" : ".vod-rail.focused"),
    ).toBeTruthy();
  },
);

test("destinations switch immediately with one focus owner", async () => {
  await mountXtream();
  const navigation = document.querySelector(".app-navigation");
  const motion = document.querySelector(".app-navigation-motion");
  const host = document.querySelector(".live-panel-host");
  const panel = document.querySelector(".panel");
  expect(navigation?.parentElement).toBe(motion);
  expect(host?.parentElement).toBe(motion);
  const activate = async (name: string, destination: string) => {
    fireEvent.click(screen.getByRole("button", { name }));
    expect(document.querySelector(".app.page-transition-exiting")).toBeNull();
    expect(document.querySelector(".app.page-transition-entering")).toBeNull();
    expect(document.querySelector(destination), destination).toBeTruthy();
    expect(document.querySelector(".app-navigation.expanded")).toBeNull();
    expect(document.querySelector(".app-navigation")).toBe(navigation);
    expect(document.querySelector(".app-navigation-motion")).toBe(motion);
    expect(document.querySelector(".live-panel-host")).toBe(host);
    expect(document.querySelector(".panel")).toBe(panel);
    await settle(0);
    expect(document.querySelector(".app.page-transition-idle")).toBeNull();
  };

  await activate("Settings", ".settings-host:not(.hidden) .sheet");
  await activate(
    "Movies",
    ".vod-host:not(.hidden) .vod-screen[data-mode='movie'] .vod-catalogue",
  );
  await activate(
    "Search Movies",
    ".vod-host:not(.hidden) .vod-screen[data-mode='movie'] .vod-search",
  );
  await activate(
    "Series",
    ".vod-host:not(.hidden) .vod-screen[data-mode='series'] .vod-catalogue",
  );
  await activate("Live", '.live-panel-host[aria-hidden="false"] .panel:not(.away)');
});

test("rapid destination changes settle only on the latest request", async () => {
  document.documentElement.style.setProperty("--t-med", "180ms");
  await mountXtream();

  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  await settle(90);
  fireEvent.click(screen.getByRole("button", { name: "Series" }));
  await settle(180);

  expect(
    document.querySelector(".vod-host:not(.hidden) .vod-screen[data-mode='movie']"),
  ).toBeNull();
  expect(
    document.querySelector(".vod-host:not(.hidden) .vod-screen[data-mode='series']"),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Series" }).getAttribute("aria-current")).toBe(
    "page",
  );
});

test("page destinations do not add a page transition animation", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  expect(styles).not.toContain(".page-transition-entering");
  expect(styles).not.toContain("page-transition-exiting");
  expect(styles).not.toContain("primary-page-enter");
});

test("the side menu shares the Live panel navigation duration", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  const tokens = readFileSync("src/styles/tokens.css", "utf8");

  expect(tokens).toMatch(/--t-panel:\s*180ms;/);
  expect(tokens).toMatch(/--t-navigation:\s*180ms;/);
  expect(styles).toMatch(
    /\.app-navigation \{[^}]*transition: width var\(--t-navigation\) var\(--ease-enter\);/,
  );
  expect(styles).toMatch(
    /\.app-navigation-motion \{[^}]*transition: transform var\(--t-navigation\) var\(--ease-enter\);/,
  );
  expect(styles).toMatch(
    /\.live-panel-host \{[^}]*transition:[^}]*left var\(--t-navigation\) var\(--ease-enter\),[^}]*transform var\(--t-navigation\) var\(--ease-enter\);/,
  );
  expect(styles).toMatch(/\.app-content \{[\s\S]*transition: left var\(--t-navigation\)/);
  expect(styles).toMatch(
    /\.app:not\(\.app-navigation-visible\) \.app-content \{[^}]*transition-timing-function:\s*var\(--ease-exit\);/,
  );
  expect(styles).toMatch(
    /\.app:not\(\.app-navigation-visible\) \.app-navigation-motion \{[^}]*transition-timing-function:\s*var\(--ease-exit\);/,
  );
  expect(styles).toMatch(
    /\.sheet \{[^}]*transition: transform var\(--t-navigation\) var\(--ease-enter\);/,
  );
  expect(styles).not.toMatch(
    /\.app-navigation-visible:not\(\.app-navigation-expanded\) \.sheet \{/,
  );
  expect(styles).toMatch(/\.panel \{[^}]*pointer-events: auto;/);
  expect(styles).not.toMatch(/\.panel \{[^}]*transition:/);
  expect(styles).not.toMatch(/\.panel\.away \{[^}]*transition:/);
  expect(styles).not.toMatch(/\.app-navigation-visible \.panel \{[^}]*transition:/);
  expect(styles).not.toMatch(/\.app-navigation-visible \.sheet \{[^}]*transition:/);
  expect(styles).not.toMatch(/\.app-navigation-visible \.vod-host \{[^}]*transition:/);
});

test("Live list headers and rows keep the VOD grid spacing", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");

  expect(styles).toMatch(
    /\.pane-head \{[\s\S]*position: relative;[\s\S]*margin-bottom: var\(--s2\);[\s\S]*border-bottom: 0;/,
  );
  expect(styles).toMatch(
    /\.pane-head::after \{[\s\S]*left: var\(--content-gutter\);[\s\S]*right: var\(--content-gutter\);[\s\S]*background: var\(--line\);/,
  );
  expect(styles).toMatch(/\.rail,\s*\.list \{[\s\S]*padding: var\(--safe-y\) 0;/);
});

test("the application rail does not move playback surfaces", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");

  for (const selector of [".video", ".pb-stack", ".playback-deck", ".picture-state"]) {
    expect(styles).toMatch(new RegExp(`${selector} \\{[\\s\\S]*position: fixed;`));
  }
});

test("held rail input advances from its latest action without activating crossed destinations", async () => {
  await mountXtream();
  press(KEY.LEFT);
  press(KEY.LEFT);
  act(() => {
    for (let index = 0; index < 2; index += 1) {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        repeat: true,
      });
      Object.defineProperty(event, "keyCode", { get: () => KEY.DOWN });
      window.dispatchEvent(event);
    }
  });
  await settle(0);

  expect(document.querySelector(".vod-host:not(.hidden) .vod-screen")).toBeNull();
  expect(screen.getByRole("button", { name: "Live" }).getAttribute("aria-current")).toBe(
    "page",
  );
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Series" }));
  expect(screen.getByRole("button", { name: "Series" }).classList.contains("cursor")).toBe(
    true,
  );

  press(KEY.ENTER);
  await settle(300);
  expect(document.querySelectorAll(".vod-screen[data-mode='series']")).toHaveLength(1);
  expect(document.querySelector(".app-navigation.expanded")).toBeNull();
  expect(document.querySelector(".vod-rail.focused")).toBeTruthy();
});

test("moving to Settings keeps Settings closed until OK while the rail remains mounted", async () => {
  await mountXtream();
  press(KEY.LEFT);
  press(KEY.LEFT);
  press(KEY.DOWN);
  press(KEY.DOWN);
  press(KEY.DOWN);
  press(KEY.DOWN);
  await settle(0);

  expect(document.querySelector(".settings-host:not(.hidden) .sheet")).toBeNull();
  expect(document.querySelector(".app-navigation")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Live" }).getAttribute("aria-current")).toBe(
    "page",
  );
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Settings" }));

  press(KEY.ENTER);
  await settle(0);
  expect(document.querySelector(".settings-host:not(.hidden) .sheet")).toBeTruthy();
  expect(document.querySelector(".app-navigation")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Appearance" }));
  expect(document.querySelector(".sheet-rail .row.cursor")).toBeTruthy();
});

test("Settings rail keeps remote focus and accepts pointer entry", async () => {
  await mountXtream();
  press(KEY.LEFT);
  press(KEY.LEFT);
  press(KEY.DOWN);
  press(KEY.DOWN);
  press(KEY.DOWN);
  press(KEY.DOWN);
  press(KEY.ENTER);
  await settle(0);

  const appearance = screen.getByRole("button", { name: "Appearance" });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top: 0,
    right: 100,
    bottom: 40,
    left: 0,
    width: 100,
    height: 40,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  act(() => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "keyCode", { get: () => KEY.ENTER });
    event.preventDefault();
    window.dispatchEvent(event);
  });
  fireEvent.click(appearance);
  await settle(0);

  expect(document.activeElement).toBe(appearance);
  expect(appearance.classList.contains("cursor")).toBe(true);
  expect(document.querySelector(".sheet-rail.focused")).toBeTruthy();

  fireEvent.pointerMove(appearance);
  fireEvent.click(appearance);
  await settle(0);

  expect(document.activeElement).toBe(screen.getByRole("button", { name: /Language, System/ }));
});

test("returning from application navigation restores the existing Live Search field", async () => {
  await mountApp(PLAYLIST);
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  const field = screen.getByRole("textbox", { name: /Search channels/ }) as HTMLInputElement;
  field.setSelectionRange(0, 0);

  fireEvent.keyDown(field, { keyCode: KEY.LEFT });
  await settle(0);

  expect(document.querySelector(".search-field")).toBe(field);
  expect(document.querySelector(".app-navigation.expanded")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Search Live" }));

  press(KEY.RIGHT);
  await settle(0);
  expect(document.querySelector(".search-field")).toBe(field);
  expect(document.activeElement).toBe(field);
});

test("the shared Search action opens the existing Live search flow", async () => {
  await mountApp(PLAYLIST);

  press(KEY.LEFT);
  press(KEY.LEFT);
  press(KEY.DOWN);
  press(KEY.ENTER);
  await settle(0);

  expect(document.querySelector(".search-field")).toBeTruthy();
});

test("clicking an already active Search preserves its query and surface", async () => {
  await mountApp(PLAYLIST);
  const search = screen.getByRole("button", { name: "Search Live" });
  fireEvent.click(search);
  const field = screen.getByRole("textbox", { name: /Search channels/ }) as HTMLInputElement;
  fireEvent.change(field, { target: { value: "Alpha" } });
  await settle(200);

  fireEvent.pointerMove(search);
  fireEvent.click(search);
  await settle(0);

  expect(screen.getByRole("textbox", { name: /Search channels/ })).toBe(field);
  expect(field.value).toBe("Alpha");
  expect(search.getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("button", { name: "Live" }).getAttribute("aria-current")).toBeNull();
  expect(document.querySelector(".app-navigation-scope-badge")?.textContent).toContain("Live");
});

test("Live search keeps application navigation and removes the category rail from focus", async () => {
  await mountApp(PLAYLIST);
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle(0);

  expect(document.querySelector(".app-navigation")).toBeTruthy();
  expect(document.querySelector(".panel .rail")).toBeNull();
  expect(document.querySelector(".search-field")).toBeTruthy();
  expect(document.querySelector(".panel .list")).toBeTruthy();
});

test("Settings owns its section input while the application rail remains visible", async () => {
  await mountApp(PLAYLIST);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await settle(0);

  const appearance = screen.getByRole("button", { name: "Appearance" });
  expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
  expect(document.querySelector(".app-navigation")).toBeTruthy();
  expect(document.activeElement).toBe(appearance);
  expect(appearance.classList.contains("cursor")).toBe(true);
  expect(document.querySelectorAll(".sheet .cursor")).toHaveLength(1);
});

test("returning to Live focuses its category rail", async () => {
  await mountXtream();
  fireEvent.click(screen.getByRole("button", { name: "Series" }));
  await settle(300);
  fireEvent.click(screen.getByRole("button", { name: "Live" }));
  await settle(0);

  expect(document.querySelector(".panel .rail.focused")).toBeTruthy();
});

test.each(["Live", "Search Live", "Movies", "Series"])(
  "Settings opens on Appearance from %s",
  async (origin) => {
    await mountXtream();
    fireEvent.click(screen.getByRole("button", { name: origin }));
    await settle(300);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await settle(0);

    const appearance = screen.getByRole("button", { name: "Appearance" });
    expect(appearance.getAttribute("aria-current")).toBe("page");
    expect(document.activeElement).toBe(appearance);
    expect(document.querySelectorAll(".sheet .cursor")).toHaveLength(1);
  },
);

test("reopening Settings focuses Appearance and clears the previous detail", async () => {
  await mountApp(PLAYLIST);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  expect(screen.getByLabelText("Playlist name")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Live" }));
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await settle(0);

  const appearance = screen.getByRole("button", { name: "Appearance" });
  expect(screen.queryByLabelText("Playlist name")).toBeNull();
  expect(appearance.getAttribute("aria-current")).toBe("page");
  expect(document.activeElement).toBe(appearance);
});

test("Settings refocuses Appearance after leaving for Series", async () => {
  await mountXtream();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Series" }));
  await settle(300);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await settle(0);

  const appearance = screen.getByRole("button", { name: "Appearance" });
  expect(document.activeElement).toBe(appearance);
  expect(appearance.classList.contains("cursor")).toBe(true);
});

test("rapid Settings to Series to Settings navigation refocuses the first item", async () => {
  await mountXtream();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Series" }));
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await settle(0);

  const appearance = screen.getByRole("button", { name: "Appearance" });
  expect(document.activeElement).toBe(appearance);
  expect(appearance.classList.contains("cursor")).toBe(true);
});

test("pointer Settings entry clears body focus before selecting the rail", async () => {
  await mountApp(PLAYLIST);
  document.documentElement.dataset.inputMode = "pointer";
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await settle(0);

  const language = screen.getByRole("button", { name: /Language, System/ });
  language.focus();
  fireEvent.click(screen.getByRole("button", { name: "Live" }));
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await settle(0);

  const appearance = screen.getByRole("button", { name: "Appearance" });
  expect(document.activeElement).toBe(appearance);
  expect(language).not.toBe(document.activeElement);
  delete document.documentElement.dataset.inputMode;
});

test("Yellow opens Settings with Appearance focused from Series", async () => {
  await mountXtream();
  fireEvent.click(screen.getByRole("button", { name: "Series" }));
  await settle(300);
  press(KEY.YELLOW);
  await settle(0);

  const appearance = screen.getByRole("button", { name: "Appearance" });
  expect(document.activeElement).toBe(appearance);
  expect(appearance.classList.contains("cursor")).toBe(true);
});

test("right to left Settings entry focuses one selected section row", async () => {
  await mountApp(PLAYLIST, { locale: "ar" });
  press(KEY.YELLOW);
  await settle(0);

  const selected = document.querySelector<HTMLButtonElement>(
    ".sheet-rail .row[aria-current='page']",
  );
  expect(document.documentElement.dir).toBe("rtl");
  expect(document.activeElement).toBe(selected);
  expect(document.querySelectorAll(".sheet .cursor")).toHaveLength(1);
});

test("Settings indices stay unchanged while application navigation owns directions", async () => {
  await mountApp(PLAYLIST);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await settle(0);
  const appearance = screen.getByRole("button", { name: "Appearance" });
  expect(appearance.getAttribute("aria-current")).toBe("page");

  press(KEY.LEFT);
  await settle(0);
  press(KEY.DOWN);
  await settle(0);

  expect(appearance.getAttribute("aria-current")).toBe("page");
  expect(document.querySelectorAll(".app-navigation .cursor")).toHaveLength(1);
  expect(document.querySelectorAll(".sheet .cursor")).toHaveLength(0);
});

test("the Xtream application keeps one rail while switching to VOD", async () => {
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: xtreamFetch(
      [{ category_id: "10", category_name: "News" }],
      [{ stream_id: "1", name: "Provider One", category_id: "10", stream_type: "live" }],
    ),
  });

  expect(
    [...document.querySelectorAll(".app-navigation button")].map((button) =>
      button.getAttribute("aria-label"),
    ),
  ).toEqual(["Live", "Movies", "Series", "Search Live", "Settings"]);
  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  await settle(300);

  expect(document.querySelector(".vod-screen[data-mode='movie']")).toBeTruthy();
  expect(document.querySelectorAll(".app-navigation")).toHaveLength(1);
  expect(document.querySelector(".panel-bar")).toBeNull();
});

test("switching from Live search to Movies opens normal VOD browsing", async () => {
  localStorage.removeItem("app:last-mode:pl-1");
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: xtreamFetch(
      [{ category_id: "10", category_name: "News" }],
      [{ stream_id: "1", name: "Provider One", category_id: "10", stream_type: "live" }],
    ),
  });
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle(0);
  expect(document.querySelector(".search-field")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  await settle(300);

  expect(document.querySelector(".vod-screen[data-mode='movie']")).toBeTruthy();
  expect(document.querySelector(".vod-search")).toBeNull();
  expect(document.querySelector(".vod-catalogue")).toBeTruthy();
});

test("a saved playlist startup failure offers retry and playlist management", async () => {
  await mountApp("", {
    fetchImplementation: async () => {
      throw new Error("offline");
    },
  });

  expect(document.querySelector(".playlist-recovery")?.textContent).toContain(
    "Could not load the playlist: offline",
  );
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Choose another playlist" })).toBeTruthy();
  expect(document.querySelector(".app-navigation")).toBeTruthy();

  press(KEY.LEFT);
  await settle(0);
  expect(document.querySelector(".app-navigation.expanded")).toBeTruthy();
  expect(document.querySelector(".playlist-recovery-actions [data-selected]")).toBeNull();

  press(KEY.RIGHT);
  await settle(0);
  expect(document.querySelector(".app-navigation.expanded")).toBeNull();
});

test("playlist recovery routes Settings to the failed playlist without entering its actions", async () => {
  await mountApp("", {
    fetchImplementation: async () => {
      throw new Error("offline at http://viewer:secret@list.invalid/list.m3u");
    },
  });

  fireEvent.click(screen.getByRole("button", { name: "Choose another playlist" }));
  await vi.waitFor(
    async () => {
      await settle(16);
      expect(document.querySelector(".app")?.getAttribute("data-page-transition")).toBe("idle");
    },
    { interval: 10 },
  );

  const failedRow = document.querySelector(".pl.recovery-owner");
  expect(document.querySelector(".app-navigation")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Saved playlists" })).toBeTruthy();
  expect(document.activeElement?.closest(".sheet")).toBeTruthy();
  expect(failedRow?.textContent).toContain("Unavailable");
  expect(failedRow?.textContent).not.toContain("viewer");
  expect(failedRow?.textContent).not.toContain("secret");
  expect(failedRow?.textContent).not.toContain("list.invalid");
  expect(document.querySelector("[data-settings-action-menu]")).toBeNull();
});

test("the rail shows the configured actions on Live while the first playlist is loading", async () => {
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: () => new Promise(() => undefined),
  });

  expect(document.querySelector(".splash")).toBeTruthy();
  const navigation = document.querySelector(".app-navigation");
  expect(navigation?.classList.contains("visible")).toBe(true);
  const live = navigation?.querySelector<HTMLElement>(
    '.app-navigation-action[data-navigation-action="live"]',
  );
  expect(live?.classList.contains("active")).toBe(true);
  expect(live?.getAttribute("aria-current")).toBe("page");
  for (const id of ["search", "live", "movie", "series", "settings"]) {
    expect(
      navigation?.querySelector(`.app-navigation-action[data-navigation-action="${id}"]`),
    ).toBeTruthy();
  }
});

test("playlist recovery actions use icons, ordinary target styling, and suppress duplicate Retry", async () => {
  let attempts = 0;
  let finish: ((response: { ok: boolean; text: () => Promise<string> }) => void) | undefined;
  await mountApp("", {
    fetchImplementation: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("offline");
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });

  const retry = screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement;
  const choose = screen.getByRole("button", {
    name: "Choose another playlist",
  }) as HTMLButtonElement;
  expect(retry.classList.contains("filled")).toBe(false);
  expect(retry.querySelector(".icon-refresh")).toBeTruthy();
  expect(choose.querySelector(".icon-playlists")).toBeTruthy();

  fireEvent.click(retry);
  fireEvent.click(retry);
  expect(attempts).toBe(2);
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Choose another playlist" })).toBeNull();
  expect(document.querySelector(".splash")?.getAttribute("aria-busy")).toBe("true");

  finish?.({ ok: true, text: async () => PLAYLIST });
  await act(async () => Promise.resolve());
  await settle(0);
  expect(document.querySelector(".playlist-recovery")).toBeNull();
});

test("Xtream startup recovery retries without exposing saved credentials", async () => {
  let offline = true;
  const available = xtreamFetch(
    [{ category_id: "10", category_name: "News" }],
    [{ stream_id: "1", name: "Provider One", category_id: "10", stream_type: "live" }],
  );
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: async (input) => {
      if (offline) throw new Error("offline");
      return available(input);
    },
  });

  const failure = document.querySelector(".playlist-recovery");
  expect(failure?.textContent).toContain("Could not load the playlist: offline");
  expect(failure?.textContent).not.toContain("viewer");
  expect(failure?.textContent).not.toContain("secret");

  offline = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await act(async () => Promise.resolve());
  await settle(0);

  expect(document.querySelector(".playlist-recovery")).toBeNull();
  expect(document.querySelector(".panel .list")?.textContent).toContain("Provider One");
});

test("retrying a saved playlist returns to normal Live browsing", async () => {
  let attempts = 0;
  await mountApp("", {
    fetchImplementation: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("offline");
      return { ok: true, text: async () => PLAYLIST };
    },
  });

  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await act(async () => Promise.resolve());
  await settle(0);

  expect(document.querySelector(".playlist-recovery")).toBeNull();
  expect(document.querySelector(".panel .list")?.textContent).toContain("First Channel");
  expect(attempts).toBe(2);
});

test("a failed playlist refresh keeps cached browsing available with a warning", async () => {
  let attempts = 0;
  await mountApp(PLAYLIST, {
    fetchImplementation: async () => {
      attempts += 1;
      if (attempts > 1) throw new Error("offline");
      return { ok: true, text: async () => PLAYLIST };
    },
  });

  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Actions, Test" }));
  await settle(0);
  fireEvent.click(screen.getByRole("menuitem", { name: "Refresh playlist" }));
  await act(async () => Promise.resolve());
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Live" }));
  await settle(0);

  expect(screen.queryByRole("button", { name: "Choose another playlist" })).toBeNull();
  expect(document.querySelector(".playlist-recovery")).toBeNull();
  expect(document.querySelector(".toast-host .toast")?.textContent).toContain(
    "Showing the last saved copy",
  );
  expect(document.querySelector(".panel .list")?.textContent).toContain("First Channel");
  expect(attempts).toBe(2);

  await settle(5199);
  expect(document.querySelector(".toast-host .toast")).toBeTruthy();
  await settle(1);
  expect(document.querySelector(".toast-host .toast")).toBeNull();
});

test("playlist recovery can replace the failed active address", async () => {
  await mountApp("", {
    fetchImplementation: async (input) => {
      if (String(input).includes("list.invalid")) throw new Error("offline");
      return { ok: true, text: async () => PLAYLIST };
    },
  });

  fireEvent.click(screen.getByRole("button", { name: "Choose another playlist" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Actions, Test" }));
  await settle(0);
  fireEvent.click(screen.getByRole("menuitem", { name: "Edit playlist address" }));
  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: { value: "http://replacement.invalid/list.m3u" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await act(async () => Promise.resolve());
  await settle(0);

  const { useSettings } = await import("../src/stores/settings");
  expect(useSettings.getState().activePlaylist()?.source).toEqual({
    kind: "m3u",
    url: "http://replacement.invalid/list.m3u",
  });
  fireEvent.click(screen.getByRole("button", { name: "Live" }));
  expect(document.querySelector(".panel .list")?.textContent).toContain("First Channel");
});

test("playlist recovery can remove the failed saved playlist", async () => {
  await mountApp("", {
    fetchImplementation: async () => {
      throw new Error("offline");
    },
  });

  fireEvent.click(screen.getByRole("button", { name: "Choose another playlist" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Actions, Test" }));
  await settle(0);
  fireEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await act(async () => Promise.resolve());
  await settle(0);

  const { useSettings } = await import("../src/stores/settings");
  expect(useSettings.getState().playlists).toHaveLength(0);
  expect(document.querySelector(".onboard")).toBeTruthy();
});

test("the Live panel motion scope is styled only for ordinary Live surfaces", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  const app = styles.slice(styles.indexOf(".app {"), styles.indexOf(".app:fullscreen"));
  const navigation = styles.slice(
    styles.indexOf(".app-navigation {"),
    styles.indexOf(".app-navigation-brand"),
  );

  expect(app).toMatch(/--panel-shadow-w:\s*104px;/);
  expect(styles.match(/--panel-shadow-w:\s*104px;/g)).toHaveLength(1);
  expect(navigation).toContain("var(--t-navigation)");
  expect(navigation).toContain("var(--ease-enter)");
  const body = (selector: string) => {
    const at = styles.indexOf(`${selector} {`);
    if (at === -1) return "";
    const open = styles.indexOf("{", at);
    return styles.slice(open + 1, styles.indexOf("}", open));
  };

  const navBase = body(".app-navigation");
  expect(navBase).toMatch(/transition:\s*width var\(--t-navigation\) var\(--ease-enter\);/);
  expect(navBase).not.toMatch(/^\s*transform:/m);
  expect(body(".app-navigation.visible")).not.toMatch(/transform|transition/);
  expect(body(".app-navigation.expanded")).toMatch(/width:\s*var\(--app-nav-expanded-w\);/);
  expect(body(".app-navigation.expanded.visible")).toBe("");
  expect(body(".app-navigation:not(.visible)")).toBe("");

  const motion = body(".app-navigation-motion");
  expect(motion).toMatch(/width:\s*var\(--app-nav-expanded-w\);/);
  expect(motion).toMatch(/pointer-events:\s*none;/);
  expect(motion).toMatch(
    /transform:\s*translateX\(calc\(0px - var\(--app-nav-collapsed-w\)\)\);/,
  );
  expect(motion).toMatch(/transition:\s*transform var\(--t-navigation\) var\(--ease-enter\);/);
  expect(body(".app-navigation-visible .app-navigation-motion")).toMatch(
    /transform:\s*translateX\(0\);/,
  );
  expect(body(".app:not(.app-navigation-visible) .app-navigation-motion")).toMatch(
    /transition-timing-function:\s*var\(--ease-exit\);/,
  );

  const content = body(".live-panel-motion .app-content");
  expect(content).toMatch(/left:\s*0;/);
  expect(content).toMatch(/right:\s*0;/);
  expect(content).toMatch(/overflow:\s*visible;/);
  expect(content).toMatch(/transition:\s*none;/);

  const liveMotion = body(".live-panel-motion .app-navigation-motion");
  expect(liveMotion).toMatch(
    /transform:\s*translateX\(\s*calc\(0px - var\(--app-nav-collapsed-w\) - var\(--panel-w\) - var\(--panel-shadow-w\)\)\s*\);/,
  );
  expect(body(".live-panel-motion.app-navigation-visible .app-navigation-motion")).toMatch(
    /transform:\s*translateX\(0\);/,
  );

  const host = body(".live-panel-host");
  expect(host).toMatch(/left:\s*var\(--app-nav-collapsed-w\);/);
  expect(host).toMatch(/width:\s*var\(--panel-w\);/);
  expect(host).toMatch(/visibility:\s*hidden;/);
  expect(host).toMatch(/pointer-events:\s*none;/);
  expect(host).toMatch(/will-change:\s*transform;/);
  expect(host).toMatch(
    /transition:[^}]*left var\(--t-navigation\) var\(--ease-enter\),[^}]*transform var\(--t-navigation\) var\(--ease-enter\);/,
  );
  expect(body(".app-navigation-expanded .live-panel-host")).toMatch(
    /left:\s*var\(--app-nav-expanded-w\);/,
  );
  expect(body(".live-panel-motion .live-panel-host")).toMatch(/visibility:\s*visible;/);
  expect(body(".live-panel-motion.app-navigation-visible .panel.away")).toMatch(
    /visibility:\s*hidden;/,
  );

  const panel = body(".panel");
  expect(panel).toMatch(/pointer-events:\s*auto;/);
  expect(panel).not.toMatch(/^\s*transform:/m);
  expect(panel).not.toMatch(/^\s*transition:/m);
  expect(body(".panel.away")).toMatch(/pointer-events:\s*none;/);
  expect(body(".panel.away")).not.toMatch(/transform|transition/);

  expect(body(".live-panel-motion .app-navigation")).toBe("");
  expect(body(".live-panel-motion .app-navigation:not(.visible)")).toBe("");
  expect(body(".live-panel-motion .panel:not(.away)")).toBe("");
  expect(body(".live-panel-motion.app-navigation-expanded .panel:not(.away)")).toBe("");
  expect(body(".live-panel-motion.app-navigation-expanded .app-navigation")).toBe("");

  const rtlContent = body('html[dir="rtl"] .live-panel-motion .app-content');
  expect(rtlContent).toMatch(/left:\s*0;/);
  expect(rtlContent).toMatch(/right:\s*0;/);
  expect(rtlContent).toMatch(/width:\s*auto;/);
  expect(rtlContent).toMatch(/transition:\s*none;/);

  const rtlMotion = body('html[dir="rtl"] .app-navigation-motion');
  expect(rtlMotion).toMatch(/right:\s*0;/);
  expect(rtlMotion).toMatch(/left:\s*auto;/);
  expect(rtlMotion).toMatch(/transform:\s*translateX\(var\(--app-nav-collapsed-w\)\);/);
  expect(body('html[dir="rtl"] .app-navigation-visible .app-navigation-motion')).toMatch(
    /transform:\s*translateX\(0\);/,
  );
  const rtlLiveMotion = body('html[dir="rtl"] .live-panel-motion .app-navigation-motion');
  expect(rtlLiveMotion).toMatch(
    /transform:\s*translateX\(\s*calc\(var\(--app-nav-collapsed-w\) \+ var\(--panel-w\) \+ var\(--panel-shadow-w\)\)\s*\);/,
  );
  expect(
    body('html[dir="rtl"] .live-panel-motion.app-navigation-visible .app-navigation-motion'),
  ).toMatch(/transform:\s*translateX\(0\);/);

  const rtlHost = body('html[dir="rtl"] .live-panel-host');
  expect(rtlHost).toMatch(/right:\s*var\(--app-nav-collapsed-w\);/);
  expect(rtlHost).toMatch(/left:\s*auto;/);
  expect(rtlHost).toMatch(
    /transition:[^}]*right var\(--t-navigation\) var\(--ease-enter\),[^}]*transform var\(--t-navigation\) var\(--ease-enter\);/,
  );
  expect(body('html[dir="rtl"] .app-navigation-expanded .live-panel-host')).toMatch(
    /right:\s*var\(--app-nav-expanded-w\);/,
  );

  expect(body('html[dir="rtl"] .app-navigation.visible')).toBe("");
  expect(body('html[dir="rtl"] .app-navigation.expanded.visible')).toBe("");
  expect(body('html[dir="rtl"] .live-panel-motion .app-navigation')).toBe("");
  expect(body('html[dir="rtl"] .live-panel-motion .panel:not(.away)')).toBe("");
  expect(
    body('html[dir="rtl"] .live-panel-motion.app-navigation-expanded .panel:not(.away)'),
  ).toBe("");
  expect(body('html[dir="rtl"] .panel.away')).toBe("");
});

test("the Live panel motion scope marks ordinary Live surfaces only", async () => {
  await mountApp(PLAYLIST);
  const scoped = () =>
    document.querySelector(".app")?.classList.contains("live-panel-motion") === true;

  expect(scoped()).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle(0);
  expect(document.querySelector(".search-field")).toBeTruthy();
  expect(scoped()).toBe(true);

  press(KEY.BACK);
  await settle(0);
  press(KEY.BACK);
  await settle(0);
  expect(document.querySelector(".panel.away")).toBeTruthy();
  expect(scoped()).toBe(true);

  press(KEY.LEFT);
  await settle(0);
  expect(document.querySelector(".panel.away")).toBeNull();
  expect(scoped()).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await settle(0);
  expect(scoped()).toBe(false);
});

test("the Live panel motion scope is absent on VOD surfaces", async () => {
  await mountXtream();
  expect(document.querySelector(".app")?.classList.contains("live-panel-motion")).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  await settle(300);

  expect(document.querySelector(".vod-screen[data-mode='movie']")).toBeTruthy();
  expect(document.querySelector(".app")?.classList.contains("live-panel-motion")).toBe(false);
});

test.each([
  ["Live", "live", false],
  ["Search Live", "search", true],
  ["Settings", "settings", true],
] as const)(
  "native focus into the %s rail fires one focusin and no focusout",
  async (surface, action, open) => {
    await mountApp(PLAYLIST);
    document.documentElement.dataset.inputMode = "remote";
    if (open) {
      fireEvent.click(screen.getByRole("button", { name: surface }));
      await settle(0);
    }
    act(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await settle(0);

    const navigation = document.querySelector<HTMLElement>(".app-navigation");
    const target = navigation?.querySelector<HTMLElement>(
      `[data-navigation-action="${action}"]`,
    );
    const events: string[] = [];
    navigation?.addEventListener("focusin", () => events.push("focusin"));
    navigation?.addEventListener("focusout", () => events.push("focusout"));

    act(() => target?.focus());
    await settle(0);

    expect(target).toBeTruthy();
    expect(document.activeElement).toBe(target);
    expect(navigation?.classList.contains("expanded")).toBe(true);
    expect(document.querySelector(".app")?.classList.contains("app-navigation-expanded")).toBe(
      true,
    );
    expect(target?.classList.contains("cursor")).toBe(true);
    expect(events).toEqual(["focusin"]);

    act(() => target?.focus());
    await settle(0);

    expect(document.activeElement).toBe(target);
    expect(navigation?.classList.contains("expanded")).toBe(true);
    expect(events).toEqual(["focusin"]);

    delete document.documentElement.dataset.inputMode;
  },
);

test("a Settings confirmation marks the popup guard until it is dismissed", async () => {
  await mountApp(PLAYLIST);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await settle(0);

  const app = document.querySelector(".app");
  expect(app?.classList.contains("settings-open")).toBe(true);
  expect(app?.classList.contains("settings-popup-open")).toBe(false);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "About" }));
  });
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Clear cache" }));
  await settle(0);

  expect(document.querySelector(".dialog")).toBeTruthy();
  expect(app?.classList.contains("settings-popup-open")).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await settle(0);

  expect(document.querySelector(".dialog")).toBeNull();
  expect(app?.classList.contains("settings-popup-open")).toBe(false);
  expect(app?.classList.contains("settings-open")).toBe(true);
  expect(screen.getByRole("button", { name: "Clear cache" })).toBeTruthy();

  const { useSettings } = await import("../src/stores/settings");
  expect(useSettings.getState().playlists).toHaveLength(1);
  expect(useSettings.getState().playlists[0]).toMatchObject({ id: "pl-1", name: "Test" });
});

test("a routed activation releases immediately, commits under the shade, and enables the destination", async () => {
  document.documentElement.style.setProperty("--t-navigation", "180ms");
  await mountXtream();
  press(KEY.LEFT);
  press(KEY.LEFT);
  await settle(0);
  expect(document.querySelector(".app-navigation.expanded")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  const app = document.querySelector(".app")!;
  expect(app.classList.contains("page-transition-active")).toBe(true);
  expect(app.getAttribute("data-page-transition")).toBe("leaving");
  expect(document.querySelector(".app-navigation.expanded")).toBeNull();
  expect(document.querySelector(".vod-host:not(.hidden) .vod-screen")).toBeNull();
  expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Movies" }));

  // The outgoing page cannot answer navigation keys while the swap is pending.
  const down = new KeyboardEvent("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(down, "keyCode", { get: () => KEY.DOWN });
  const enter = new KeyboardEvent("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(enter, "keyCode", { get: () => KEY.ENTER });
  act(() => {
    window.dispatchEvent(down);
    window.dispatchEvent(enter);
  });
  expect(down.defaultPrevented).toBe(true);
  expect(enter.defaultPrevented).toBe(true);
  await settle(0);
  expect(app.getAttribute("data-page-transition")).toBe("leaving");
  expect(document.querySelector(".vod-host:not(.hidden) .vod-screen")).toBeNull();

  await settle(300);
  expect(app.getAttribute("data-page-transition")).toBe("settling");
  expect(
    document.querySelector(".vod-host:not(.hidden) .vod-screen[data-mode='movie']"),
  ).toBeTruthy();
  expect(document.querySelector(".app-navigation.expanded")).toBeNull();
  expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Movies" }));
  // The committed destination handles keys while its entrance is still pending.
  expect(document.querySelector(".vod-screen .focused")).toBeTruthy();
  const destinationKey = new KeyboardEvent("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(destinationKey, "keyCode", { get: () => KEY.DOWN });
  act(() => window.dispatchEvent(destinationKey));
  expect(destinationKey.defaultPrevented).toBe(true);

  await settle(10);
  expect(app.getAttribute("data-page-transition")).toBe("settling");

  await settle(60);
  expect(app.getAttribute("data-page-transition")).toBe("entering");

  await settle(300);
  expect(app.classList.contains("page-transition-active")).toBe(false);
  expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Movies" }));
  expect(
    document.querySelector(".vod-host:not(.hidden) .vod-screen[data-mode='movie']"),
  ).toBeTruthy();
});

test.each([
  ["mouse", "Settings"],
  ["remote", "Settings"],
  ["mouse", "Search Movies"],
  ["remote", "Search Movies"],
] as const)(
  "%s activation selects Movies and then %s before outgoing content commits",
  async (input, destination) => {
    document.documentElement.style.setProperty("--t-navigation", "180ms");
    await mountXtream();
    const app = document.querySelector(".app")!;
    const expectSelected = (name: string) => {
      const button = screen.getByRole("button", { name });
      expect(button.getAttribute("aria-current")).toBe("page");
      expect(button.classList.contains("active")).toBe(true);
      expect(document.querySelectorAll(".app-navigation [aria-current='page']")).toHaveLength(
        1,
      );
      expect(document.querySelectorAll(".app-navigation-action.active")).toHaveLength(1);
    };

    if (input === "remote") {
      press(KEY.LEFT);
      press(KEY.LEFT);
      press(KEY.DOWN);
      await settle(0);
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Movies" }));
      expectSelected("Live");
      press(KEY.ENTER);
    } else {
      fireEvent.pointerMove(screen.getByRole("button", { name: "Movies" }));
      fireEvent.pointerEnter(screen.getByRole("button", { name: "Movies" }));
      fireEvent.focus(screen.getByRole("button", { name: "Movies" }));
      expect(screen.getByRole("button", { name: "Movies" }).classList.contains("cursor")).toBe(
        true,
      );
      expectSelected("Live");
      fireEvent.click(screen.getByRole("button", { name: "Movies" }));
    }
    expectSelected("Movies");
    expect(app.getAttribute("data-page-transition")).toBe("leaving");
    expect(app.classList.contains("live-panel-motion")).toBe(true);
    expect(document.querySelector(".vod-host:not(.hidden) .vod-screen")).toBeNull();

    await finishPageTransition();
    expectSelected("Movies");
    const movie = document.querySelector(
      ".vod-host:not(.hidden) .vod-screen[data-mode='movie']",
    );
    expect(movie).toBeTruthy();
    if (input === "remote") {
      press(KEY.LEFT);
      const steps = destination === "Settings" ? 3 : 2;
      for (let index = 0; index < steps; index++) press(KEY.DOWN);
      await settle(0);
      expect(document.activeElement).toBe(screen.getByRole("button", { name: destination }));
      expectSelected("Movies");
      press(KEY.ENTER);
    } else {
      fireEvent.pointerMove(screen.getByRole("button", { name: destination }));
      fireEvent.pointerEnter(screen.getByRole("button", { name: destination }));
      fireEvent.focus(screen.getByRole("button", { name: destination }));
      expectSelected("Movies");
      fireEvent.click(screen.getByRole("button", { name: destination }));
    }

    expectSelected(destination);
    expect(app.getAttribute("data-page-transition")).toBe("leaving");
    expect(
      document.querySelector(".vod-host:not(.hidden) .vod-screen[data-mode='movie']"),
    ).toBe(movie);
    expect(document.querySelector(".settings-host:not(.hidden) .sheet")).toBeNull();
    expect(document.querySelector(".vod-search")).toBeNull();
    // Search scope follows the committed mode while the marker follows the request.
    expect(screen.getByRole("button", { name: "Search Movies" })).toBeTruthy();

    await finishPageTransition();
    expectSelected(destination);
    expect(app.getAttribute("data-page-transition")).toBe("idle");
    expect(
      document.querySelector(
        destination === "Settings"
          ? ".settings-host:not(.hidden) .sheet"
          : ".vod-host:not(.hidden) .vod-search",
      ),
    ).toBeTruthy();
  },
);

test("a newer activation replaces the selected marker while the outgoing page stays mounted", async () => {
  document.documentElement.style.setProperty("--t-navigation", "180ms");
  await mountXtream();
  const selectedActions = () =>
    Array.from(document.querySelectorAll(".app-navigation [aria-current='page']")).map(
      (button) => button.getAttribute("data-navigation-action"),
    );

  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  expect(selectedActions()).toEqual(["movie"]);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(selectedActions()).toEqual(["settings"]);
  fireEvent.pointerMove(screen.getByRole("button", { name: "Series" }));
  fireEvent.pointerEnter(screen.getByRole("button", { name: "Series" }));
  fireEvent.focus(screen.getByRole("button", { name: "Series" }));
  expect(selectedActions()).toEqual(["settings"]);
  expect(document.querySelector(".app")?.getAttribute("data-page-transition")).toBe("leaving");
  expect(document.querySelector(".vod-host:not(.hidden) .vod-screen")).toBeNull();
  expect(document.querySelector(".settings-host:not(.hidden) .sheet")).toBeNull();

  await finishPageTransition();
  expect(selectedActions()).toEqual(["settings"]);
  expect(document.querySelectorAll(".app-navigation-action.active")).toHaveLength(1);
  expect(document.querySelector(".settings-host:not(.hidden) .sheet")).toBeTruthy();
  expect(document.querySelector(".vod-host:not(.hidden) .vod-screen")).toBeNull();
});

test("a Settings destination keeps its own focus when the entrance finishes", async () => {
  document.documentElement.style.setProperty("--t-navigation", "180ms");
  await mountXtream();
  press(KEY.LEFT);
  press(KEY.LEFT);
  press(KEY.DOWN);
  press(KEY.DOWN);
  press(KEY.DOWN);
  press(KEY.DOWN);
  await settle(0);

  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  const app = document.querySelector(".app")!;
  expect(app.getAttribute("data-page-transition")).toBe("leaving");
  expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Settings" }));
  expect(document.querySelector(".settings-host:not(.hidden) .sheet")).toBeNull();

  await settle(300);
  expect(app.getAttribute("data-page-transition")).toBe("settling");
  const appearance = screen.getByRole("button", { name: "Appearance" });
  expect(document.activeElement).toBe(appearance);

  await settle(60);
  expect(app.getAttribute("data-page-transition")).toBe("entering");
  await settle(300);
  expect(app.classList.contains("page-transition-active")).toBe(false);
  // Finishing the transition must not blur the destination's focused control.
  expect(document.activeElement).toBe(appearance);
});

test("Back cancels a pending activation and a newer press retargets the latest destination", async () => {
  document.documentElement.style.setProperty("--t-navigation", "180ms");
  await mountXtream();
  press(KEY.LEFT);
  press(KEY.LEFT);
  await settle(0);

  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  expect(document.querySelector(".app")?.getAttribute("data-page-transition")).toBe("leaving");

  press(KEY.BACK);
  await settle(0);
  const app = document.querySelector(".app")!;
  expect(app.classList.contains("page-transition-active")).toBe(false);
  expect(document.querySelector(".vod-host:not(.hidden) .vod-screen")).toBeNull();
  expect(
    document.querySelector('.live-panel-host[aria-hidden="false"] .panel:not(.away)'),
  ).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  expect(app.getAttribute("data-page-transition")).toBe("leaving");
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await settle(300);
  expect(app.getAttribute("data-page-transition")).toBe("settling");
  await settle(400);
  expect(app.classList.contains("page-transition-active")).toBe(false);
  expect(document.querySelector(".settings-host:not(.hidden) .sheet")).toBeTruthy();
  expect(document.querySelector(".vod-host:not(.hidden) .vod-screen")).toBeNull();
});

test("a zero navigation duration commits and releases in the same batch", async () => {
  document.documentElement.style.setProperty("--t-navigation", "0ms");
  await mountXtream();

  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  const app = document.querySelector(".app")!;
  expect(app.classList.contains("page-transition-active")).toBe(false);
  expect(
    document.querySelector(".vod-host:not(.hidden) .vod-screen[data-mode='movie']"),
  ).toBeTruthy();
});

test("a local Search Back clears the active marker so a fresh Search opens cleanly", async () => {
  await mountXtream();
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle(0);
  expect(document.querySelector(".search-field")).toBeTruthy();
  expect(
    document.querySelector('[data-navigation-action="search"]')?.getAttribute("aria-current"),
  ).toBe("page");

  press(KEY.BACK);
  await settle(0);
  expect(document.querySelector(".search-field")).toBeNull();
  expect(
    document.querySelector('[data-navigation-action="search"]')?.getAttribute("aria-current"),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "Live" }).getAttribute("aria-current")).toBe(
    "page",
  );

  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle(0);
  const field = screen.getByRole("textbox", { name: /Search channels/ });
  expect((field as HTMLInputElement).value).toBe("");
  expect(document.querySelector(".search-field")).toBeTruthy();
});

test("leaving Search for Live never resurrects the old query field", async () => {
  await mountXtream();
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle(0);
  const field = screen.getByRole("textbox", { name: /Search channels/ });
  fireEvent.change(field, { target: { value: "Provider" } });
  await settle();
  expect(document.querySelector(".search-field")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Live" }));
  await settle(300);

  expect(document.querySelector(".search-field")).toBeNull();
  expect(document.querySelector(".panel-cols.searching")).toBeNull();
  expect(document.querySelector(".panel .rail")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle(0);
  expect(
    (screen.getByRole("textbox", { name: /Search channels/ }) as HTMLInputElement).value,
  ).toBe("");
});

test("Live rail legs carry rail motion and swap content only after the exit", async () => {
  document.documentElement.style.setProperty("--t-navigation", "180ms");
  await mountXtream();
  press(KEY.LEFT);
  press(KEY.LEFT);
  await settle(0);

  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  const app = document.querySelector(".app")!;
  expect(app.getAttribute("data-page-transition")).toBe("leaving");
  expect(app.getAttribute("data-page-leave-motion")).toBe("rail");
  expect(app.getAttribute("data-page-enter-motion")).toBe("rail");
  expect(document.querySelector(".search-field")).toBeNull();
  expect(document.querySelector(".panel .rail")).toBeTruthy();

  await settle(300);
  expect(app.getAttribute("data-page-transition")).toBe("settling");
  expect(document.querySelector(".search-field")).toBeTruthy();
  const host = document.querySelector(".live-panel-host");

  await settle(60);
  expect(app.getAttribute("data-page-transition")).toBe("entering");
  expect(document.querySelector(".live-panel-host")).toBe(host);
  expect(app.getAttribute("data-page-enter-motion")).toBe("rail");
  await settle(300);
  expect(app.classList.contains("page-transition-active")).toBe(false);
  expect(document.querySelector(".search-field")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Live" }));
  expect(app.getAttribute("data-page-leave-motion")).toBe("rail");
  expect(app.getAttribute("data-page-enter-motion")).toBe("rail");
  expect(document.querySelector(".search-field")).toBeTruthy();

  await settle(300);
  expect(document.querySelector(".search-field")).toBeNull();
  expect(document.querySelector(".panel .rail")).toBeTruthy();
  await settle(400);
  expect(app.classList.contains("page-transition-active")).toBe(false);
});

test.each(["Movies", "Series"])(
  "%s returns to Live through one parked host and a rail entrance",
  async (name) => {
    document.documentElement.style.setProperty("--t-navigation", "180ms");
    await mountXtream();
    fireEvent.click(screen.getByRole("button", { name }));
    await finishPageTransition();
    const app = document.querySelector(".app")!;
    const host = document.querySelector(".live-panel-host");
    expect(host?.getAttribute("aria-hidden")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Live" }));
    expect(app.getAttribute("data-page-transition")).toBe("leaving");
    expect(app.getAttribute("data-page-leave-motion")).toBe("fade");
    expect(app.getAttribute("data-page-enter-motion")).toBe("rail");
    expect(host?.getAttribute("aria-hidden")).toBe("true");
    await settle(300);
    expect(app.getAttribute("data-page-transition")).toBe("settling");
    expect(host?.getAttribute("aria-hidden")).toBe("false");
    expect(document.querySelector(".live-panel-host")).toBe(host);
    await settle(60);
    expect(app.getAttribute("data-page-transition")).toBe("entering");
    expect(app.getAttribute("data-page-enter-motion")).toBe("rail");
    expect(document.querySelector(".live-panel-host")).toBe(host);
    await settle(300);
    expect(app.getAttribute("data-page-transition")).toBe("idle");
    expect(document.querySelectorAll(".live-panel-host")).toHaveLength(1);
    expect(document.querySelector(".panel .rail")).toBeTruthy();
  },
);

test.each(["ltr", "rtl"])(
  "the %s host parks without a transition only during settling and retains its native entrance",
  (direction) => {
    const styles = readFileSync("src/styles/app.css", "utf8");
    const body = (selector: string) => {
      const at = styles.indexOf(`${selector} {`);
      expect(at).toBeGreaterThanOrEqual(0);
      const open = styles.indexOf("{", at);
      return styles.slice(open + 1, styles.indexOf("}", open));
    };
    const baseSelector =
      direction === "rtl" ? 'html[dir="rtl"] .live-panel-host' : ".live-panel-host";
    const settlingSelector = '.app[data-page-transition="settling"] .live-panel-host';
    const enteringSelector = '.app[data-page-transition="entering"] .live-panel-host';
    expect(body(baseSelector)).toContain("transform var(--t-navigation) var(--ease-enter)");
    expect(body(baseSelector)).toContain(
      `${direction === "rtl" ? "right" : "left"} var(--t-navigation) var(--ease-enter)`,
    );
    expect(body(settlingSelector).trim()).toBe("transition: none;");
    expect(styles.indexOf(settlingSelector)).toBeGreaterThan(styles.indexOf(baseSelector));
    expect(styles).not.toContain(`${enteringSelector} {`);

    // The source selector applies in either direction and stops matching at entrance.
    const app = document.createElement("div");
    app.className = "app";
    app.dir = direction;
    app.dataset.pageTransition = "settling";
    const host = document.createElement("div");
    host.className = "live-panel-host";
    app.appendChild(host);
    expect(host.matches(settlingSelector)).toBe(true);
    app.dataset.pageTransition = "entering";
    expect(host.matches(settlingSelector)).toBe(false);
  },
);

test("external destinations keep fade legs on both sides of the swap", async () => {
  document.documentElement.style.setProperty("--t-navigation", "180ms");
  await mountXtream();
  press(KEY.LEFT);
  press(KEY.LEFT);
  await settle(0);

  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  const app = document.querySelector(".app")!;
  expect(app.getAttribute("data-page-leave-motion")).toBe("rail");
  expect(app.getAttribute("data-page-enter-motion")).toBe("fade");
  await finishPageTransition();
  expect(app.classList.contains("page-transition-active")).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: "Series" }));
  expect(app.getAttribute("data-page-leave-motion")).toBe("fade");
  expect(app.getAttribute("data-page-enter-motion")).toBe("fade");
  await finishPageTransition();
  expect(app.classList.contains("page-transition-active")).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(app.getAttribute("data-page-leave-motion")).toBe("fade");
  expect(app.getAttribute("data-page-enter-motion")).toBe("fade");
  await finishPageTransition();
  expect(app.classList.contains("page-transition-active")).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: "Live" }));
  expect(app.getAttribute("data-page-leave-motion")).toBe("fade");
  expect(app.getAttribute("data-page-enter-motion")).toBe("rail");
  await finishPageTransition();
  expect(app.classList.contains("page-transition-active")).toBe(false);
});

test("transport keys still answer once while a Live rail transition releases navigation focus", async () => {
  document.documentElement.style.setProperty("--t-navigation", "180ms");
  await mountXtream();
  for (let attempt = 0; attempt < 3 && panelOpen(); attempt += 1) {
    press(KEY.BACK);
  }
  await settle(0);
  press(49);
  press(KEY.ENTER);
  await settle(0);
  expect(played.length).toBe(1);
  const { Player } = await import("../src/services/player");
  const pause = vi.spyOn(Player.prototype, "pause");
  press(KEY.LEFT);
  press(KEY.LEFT);
  await settle(0);

  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  const app = document.querySelector(".app")!;
  expect(app.getAttribute("data-page-transition")).toBe("leaving");

  press(KEY.PLAY_PAUSE);
  await settle(0);
  expect(pause).toHaveBeenCalledTimes(1);
  expect(document.querySelector(".playback-deck")).toBeNull();
  const search = screen.getByRole("button", { name: /^Search/ });
  expect(search.classList.contains("cursor")).toBe(false);
  expect(search.getAttribute("aria-current")).toBe("page");
  expect(app.getAttribute("data-page-transition")).not.toBe("idle");
});

test("a VOD screen mounting while its search request is already open still opens it", async () => {
  await mountXtream();
  const { VodScreen } = await import("../src/screens/VodScreen");
  const { useSettings } = await import("../src/stores/settings");
  const playlist = useSettings.getState().activePlaylist();
  if (!playlist) throw new Error("expected an active playlist");

  const { container } = render(
    <VodScreen
      mode="movie"
      playlist={playlist}
      scale={1}
      active
      visible
      playbackPending={false}
      onCancelPending={() => {}}
      onAppNavigationFocus={() => {}}
      searchRequest={{ id: 7, mode: "movie", open: true }}
      onModeChange={() => {}}
      onSettings={() => {}}
      onReturnLive={() => {}}
      onRequestExit={() => {}}
      onPlay={() => {}}
    />,
  );
  await settle(0);

  expect(container.querySelector(".vod-search")).toBeTruthy();
});

test("a scope change closes local Search on both screens without resurrecting it", async () => {
  document.documentElement.style.setProperty("--t-navigation", "0ms");
  await mountXtream();
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle(0);
  expect(document.querySelector(".search-field")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  await settle(0);
  expect(document.querySelector(".search-field")).toBeNull();
  expect(
    document.querySelector(".vod-host:not(.hidden) .vod-screen[data-mode='movie']"),
  ).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle(0);
  expect(document.querySelector(".vod-search")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Live" }));
  await settle(0);
  expect(document.querySelector(".vod-search")).toBeNull();
  expect(document.querySelector(".panel .rail")).toBeTruthy();
});

test("the playlist shortcut restores menu focus and switches only on a different choice", async () => {
  await mountApp(PLAYLIST);
  const { useSettings } = await import("../src/stores/settings");
  expect(useSettings.getState().playlistShortcut).toBe(true);
  expect(screen.queryByRole("button", { name: /^Playlists,/ })).toBeNull();
  act(() =>
    useSettings.getState().addPlaylist("Second", {
      kind: "m3u",
      url: "http://second.invalid/list.m3u",
    }),
  );
  const second = useSettings.getState().playlists.find((item) => item.name === "Second")!;
  const shortcut = () => screen.getByRole("button", { name: /^Playlists,/ });
  expect(shortcut().querySelector(".playlist-avatar-initials")?.textContent).toBe("T");
  expect(shortcut().querySelector(".playlist-avatar-number")?.textContent).toBe("1");
  expect(shortcut().nextElementSibling?.classList.contains("app-navigation-divider")).toBe(
    true,
  );
  fireEvent.click(shortcut());
  await finishPageTransition();
  expect(screen.getByText(/Manage playlists in Settings\./)).toBeTruthy();
  const current = screen.getByRole("menuitemradio", { name: "Test" });
  expect(current.getAttribute("aria-checked")).toBe("true");
  expect(document.activeElement).toBe(current);
  press(KEY.LEFT);
  expect(document.activeElement).toBe(shortcut());
  press(KEY.RIGHT);
  expect(document.activeElement).toBe(current);
  const requests = vi.mocked(fetch).mock.calls.length;
  press(KEY.DOWN);
  expect(useSettings.getState().activePlaylistId).toBe("pl-1");
  expect(vi.mocked(fetch).mock.calls.length).toBe(requests);
  press(KEY.UP);
  fireEvent.click(current);
  expect(screen.getByRole("menu", { name: "Saved playlists" })).toBeTruthy();
  expect(vi.mocked(fetch).mock.calls.length).toBe(requests);
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Second" }));
  await settle(700);
  expect(useSettings.getState().activePlaylistId).toBe(second.id);
  expect(screen.getByRole("menu", { name: "Saved playlists" })).toBeTruthy();
  expect(
    screen.getByRole("menuitemradio", { name: "Second" }).getAttribute("aria-checked"),
  ).toBe("true");
  expect(screen.getByRole("menuitemradio", { name: "Test" }).getAttribute("aria-checked")).toBe(
    "false",
  );
  expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "Second" }));
  expect(shortcut().querySelector(".playlist-avatar-initials")?.textContent).toBe("S");
  expect(shortcut().querySelector(".playlist-avatar-number")?.textContent).toBe("2");
  fireEvent.click(screen.getByRole("button", { name: "Live" }));
  await finishPageTransition();
  expect(screen.queryByRole("menu", { name: "Saved playlists" })).toBeNull();
  act(() => useSettings.getState().set("playlistShortcut", false));
  expect(screen.queryByRole("button", { name: /^Playlists,/ })).toBeNull();
  expect(screen.getByRole("button", { name: "Search Live" })).toBeTruthy();
});

test("saved playlist numbers retain their full order when the management list is filtered", async () => {
  await mountApp(PLAYLIST);
  const { useSettings } = await import("../src/stores/settings");
  act(() => {
    useSettings
      .getState()
      .addPlaylist("Other", { kind: "m3u", url: "http://other.invalid/a.m3u" });
    useSettings
      .getState()
      .addPlaylist("Target", { kind: "m3u", url: "http://target.invalid/a.m3u" });
  });
  const target = useSettings.getState().playlists.find((item) => item.name === "Target")!;
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  press(KEY.ENTER);
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  fireEvent.click(document.querySelector('[data-settings-focus="playlist-search-toggle"]')!);
  fireEvent.change(screen.getByRole("textbox", { name: "Search playlists" }), {
    target: { value: "Target" },
  });
  expect(document.querySelectorAll("[data-playlist-number]")).toHaveLength(1);
  expect(document.querySelector(`[data-playlist-number="${target.id}"]`)?.textContent).toBe(
    "3",
  );
});

test.each([false, true])(
  "the playlist page covers the Live browser and search: %s",
  async (searching) => {
    await mountApp(PLAYLIST);
    const { useSettings } = await import("../src/stores/settings");
    act(() =>
      useSettings.getState().addPlaylist("Second", {
        kind: "m3u",
        url: "http://second.invalid/list.m3u",
      }),
    );
    let field: HTMLInputElement | undefined;
    if (searching) {
      fireEvent.click(screen.getByRole("button", { name: "Search Live" }));
      await settle(0);
      field = screen.getByRole("textbox", { name: /Search channels/ }) as HTMLInputElement;
      fireEvent.change(field, { target: { value: "First" } });
      await settle(200);
    }
    const host = document.querySelector<HTMLElement>(".live-panel-host")!;
    const panel = document.querySelector(".panel");
    expect(host.hidden).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /^Playlists,/ }));
    await finishPageTransition();
    expect(host.hidden).toBe(true);
    expect(host.getAttribute("aria-hidden")).toBe("true");
    const plays = played.length;
    press(KEY.CH_DOWN);
    await settle(500);
    expect(played.length).toBe(plays);
    expect(screen.getByRole("menu", { name: "Saved playlists" })).toBeTruthy();

    press(KEY.LEFT);
    const current = screen.getByRole("menuitemradio", { name: "Test" });
    fireEvent.pointerMove(current);
    fireEvent.pointerDown(current);
    fireEvent.click(current);
    expect(document.querySelector(".app-navigation.expanded")).toBeNull();
    expect(screen.getByRole("menu", { name: "Saved playlists" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: searching ? "Search Live" : "Live" }));
    await finishPageTransition();
    expect(host.hidden).toBe(false);
    expect(document.querySelector(".panel")).toBe(panel);
    if (field) {
      expect(screen.getByRole("textbox", { name: /Search channels/ })).toBe(field);
      expect(field.value).toBe("First");
    }
  },
);

test("the playlist shortcut focuses a distant active playlist without rendering every row", async () => {
  const clientHeight = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!.get!;
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function () {
    return this.classList.contains("playlist-shortcut-list") ? 320 : clientHeight.call(this);
  });
  await mountApp(PLAYLIST);
  const { useSettings } = await import("../src/stores/settings");
  const base = useSettings.getState().playlists[0];
  const playlists = Array.from({ length: 250 }, (_, index) => ({
    ...base,
    id: index === 249 ? base.id : `shortcut-${index}`,
    name: `Playlist ${index + 1}`,
  }));
  act(() => useSettings.setState({ playlists }));
  fireEvent.click(screen.getByRole("button", { name: /^Playlists,/ }));
  await finishPageTransition();
  expect(screen.getAllByRole("menuitemradio").length).toBeLessThanOrEqual(5);
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Playlist 250");
  const pagination = screen.getByRole("navigation", { name: "Saved playlists" });
  expect(pagination.textContent).toContain("50 / 50");
  press(KEY.UP);
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Playlist 249");
  press(KEY.RIGHT);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Previous" }));
  fireEvent.keyDown(document.activeElement!, { keyCode: KEY.ENTER });
  expect(pagination.textContent).toContain("49 / 50");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Playlist 241");
  fireEvent.keyDown(document.activeElement!, { keyCode: KEY.ENTER, repeat: true });
  fireEvent.keyUp(document.activeElement!, { keyCode: KEY.ENTER });
  expect(useSettings.getState().activePlaylistId).toBe(base.id);
  expect(screen.queryByRole("menuitemradio", { name: "Playlist 250" })).toBeNull();
  for (let index = 0; index < 5; index += 1) press(KEY.DOWN);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next" }));
  press(KEY.ENTER);
  expect(pagination.textContent).toContain("50 / 50");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Playlist 246");
  expect(useSettings.getState().activePlaylistId).toBe(base.id);
  press(KEY.BACK);
  expect(document.querySelector(".dialog")).toBeTruthy();
  expect(screen.getByRole("menu", { name: "Saved playlists" })).toBeTruthy();
});

test("playlist search resets pagination while preserving saved numbers and input focus", async () => {
  await mountApp(PLAYLIST);
  const { useSettings } = await import("../src/stores/settings");
  const base = useSettings.getState().playlists[0];
  const playlists = Array.from({ length: 14 }, (_, index) => ({
    ...base,
    id: index === 12 ? base.id : `search-playlist-${index}`,
    name: `Library ${String(index + 1).padStart(2, "0")}`,
  }));
  act(() => useSettings.setState({ playlists }));
  fireEvent.click(screen.getByRole("button", { name: /^Playlists,/ }));
  await finishPageTransition();
  expect(screen.getByRole("navigation", { name: "Saved playlists" }).textContent).toContain(
    "3 / 3",
  );

  press(KEY.UP);
  const field = screen.getByRole("textbox", { name: "Search playlists" }) as HTMLInputElement;
  press(KEY.UP);
  press(KEY.UP);
  expect(document.activeElement).toBe(field);
  fireEvent.change(field, { target: { value: "Library 1" } });
  expect(screen.queryByRole("navigation", { name: "Saved playlists" })).toBeNull();
  const first = screen.getByRole("menuitemradio", { name: "Library 10" });
  expect(first.querySelector(".playlist-avatar-number")?.textContent).toBe("10");
  field.setSelectionRange(3, 3);
  press(KEY.LEFT);
  expect(document.activeElement).toBe(field);
  expect(document.querySelector(".app-navigation.expanded")).toBeNull();
  press(KEY.DOWN);
  expect(document.activeElement).toBe(first);
  press(KEY.BACK);
  expect(field.value).toBe("");
  expect(document.querySelector(".dialog")).toBeNull();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Library 10");
  expect(screen.getByRole("navigation", { name: "Saved playlists" }).textContent).toContain(
    "2 / 3",
  );
  for (let index = 0; index < 5; index += 1) press(KEY.UP);
  expect(document.activeElement).toBe(field);

  fireEvent.change(field, { target: { value: "missing" } });
  expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
  expect(screen.getByRole("menu", { name: "Saved playlists" }).textContent).toContain(
    translate("en", "lineup.noMatches"),
  );
  field.setSelectionRange(field.value.length, field.value.length);
  press(KEY.RIGHT);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Clear" }));
  press(KEY.ENTER);
  expect(field.value).toBe("");
  expect(document.activeElement).toBe(field);
  expect(screen.getByRole("navigation", { name: "Saved playlists" }).textContent).toContain(
    "1 / 3",
  );
  press(KEY.DOWN);
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Library 01");
  expect(useSettings.getState().activePlaylistId).toBe(base.id);
});

test("Playlists preserves the content type and closes when only one playlist remains", async () => {
  await mountXtream();
  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  await finishPageTransition();
  const { useSettings } = await import("../src/stores/settings");
  const { write } = await import("../src/services/store");
  act(() => useSettings.getState().addPlaylist("Second", XTREAM_SOURCE));
  const second = useSettings.getState().playlists.find((item) => item.name === "Second")!;
  write(`app:last-mode:${second.id}`, "series");
  fireEvent.click(screen.getByRole("button", { name: /^Playlists,/ }));
  await finishPageTransition();
  expect(screen.getByRole("heading", { name: "Playlists" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  expect(screen.getByRole("button", { name: "Search Movies" })).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Second" }));
  await settle(700);
  expect(screen.getByRole("button", { name: "Search Movies" })).toBeTruthy();
  expect(screen.getByRole("menu", { name: "Saved playlists" })).toBeTruthy();
  await act(async () => {
    expect(await useSettings.getState().removePlaylist("pl-1")).toBe(true);
  });
  await settle(0);
  expect(useSettings.getState().activePlaylistId).toBe(second.id);
  expect(useSettings.getState().playlists).toHaveLength(1);
  expect(screen.queryByRole("button", { name: /^Playlists,/ })).toBeNull();
  expect(screen.queryByRole("menu", { name: "Saved playlists" })).toBeNull();
  expect(document.querySelector(".vod-host:not(.hidden) [data-mode='movie']")).toBeTruthy();
});
