import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import {
  PlaybackDrawer,
  type PlaybackDrawerOrigin,
} from "../src/components/playback/PlaybackDrawer";
import { KeyGuide } from "../src/components/KeyGuide";
import { KEY } from "../src/hooks/useRemote";
import { translate } from "../src/services/locale";
import { press } from "./support/app";

afterEach(cleanup);

test("a contextual drawer keeps its accessible label and puts hints after its body", () => {
  render(
    <PlaybackDrawer
      title="Provider One"
      icon="guide"
      subtitle="Programme Guide"
      ariaLabel="Programme guide: Provider One"
      origin="guide"
      onBack={() => {}}
      footer={
        <KeyGuide
          className="guide-drawer-hints ruled"
          items={[{ keys: ["RETURN"], label: "Close" }]}
        />
      }
    >
      <div>Programmes</div>
    </PlaybackDrawer>,
  );

  const drawer = screen.getByRole("complementary", {
    name: "Programme guide: Provider One",
  });
  expect(screen.getByRole("heading", { level: 2, name: "Provider One" })).toBeTruthy();
  expect(screen.getByText("Programme Guide").className).toBe("playback-drawer-subtitle");
  expect(drawer.querySelector(".icon-guide")?.getAttribute("aria-hidden")).toBe("true");
  const body = drawer.querySelector(".playback-drawer-body");
  const footer = drawer.querySelector(".playback-drawer-footer");
  expect(body?.nextElementSibling).toBe(footer);
  expect(footer?.textContent).toBe("RETURNClose");
  expect(footer?.querySelector("button, [tabindex]")).toBeNull();
});

test.each(["audio", "subtitles", "live-browser"] as const)(
  "a plain drawer preserves its title, body and %s origin on Return",
  (origin: PlaybackDrawerOrigin) => {
    const onBack = vi.fn();
    render(
      <PlaybackDrawer title="Options" origin={origin} onBack={onBack}>
        <div>Original options</div>
      </PlaybackDrawer>,
    );
    const drawer = screen.getByRole("complementary", { name: "Options" });
    expect(screen.getByRole("heading", { level: 2, name: "Options" }).parentElement).toBe(
      drawer.querySelector(".playback-drawer-head"),
    );
    expect(drawer.querySelector(".playback-drawer-body")?.textContent).toBe("Original options");
    expect(
      drawer.querySelector(".playback-drawer-subtitle, .playback-drawer-footer, svg"),
    ).toBeNull();
    press(KEY.BACK);
    expect(onBack).toHaveBeenCalledExactlyOnceWith(origin);
  },
);

test("a closing rail ignores more close keys and finishes only its own exit animation", () => {
  const onBack = vi.fn();
  const onClosed = vi.fn();
  render(
    <PlaybackDrawer title="Options" origin="audio" closing onBack={onBack} onClosed={onClosed}>
      <div>Tracks</div>
    </PlaybackDrawer>,
  );
  const drawer = screen.getByRole("complementary", { name: "Options" });
  press(KEY.LEFT);
  press(KEY.BACK);
  expect(onBack).not.toHaveBeenCalled();
  const end = (target: Element, name: string) => {
    const event = new Event("animationend", { bubbles: true });
    Object.defineProperty(event, "animationName", { value: name });
    fireEvent(target, event);
  };
  end(screen.getByText("Tracks"), "playback-drawer-out");
  end(drawer, "playback-drawer-in");
  expect(onClosed).not.toHaveBeenCalled();
  end(drawer, "playback-drawer-out");
  expect(onClosed).toHaveBeenCalledOnce();
});

test("guide layout removes only its nested gutter and reserves flow space for hints", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  const rule = (selector: string) => {
    const start = styles.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    return styles.slice(start, styles.indexOf("}", start) + 1);
  };

  expect(rule(".list .window")).toContain("left: var(--content-gutter)");
  expect(rule(".list .window")).toContain("right: var(--content-gutter)");
  expect(rule(".rail .window")).toContain("left: var(--content-gutter)");
  expect(rule(".rail .window")).toContain("right: var(--content-gutter)");
  const guideWindow = rule(".playback-drawer.guide-drawer .guide-list .window");
  expect(guideWindow).toContain("left: 0");
  expect(guideWindow).toContain("right: 0");
  expect(rule(".window .row")).toContain("width: 100%");
  const body = rule(".playback-drawer-body");
  expect(body).toContain("display: flex");
  expect(body).toContain("flex-direction: column");
  expect(rule(".playback-drawer-body")).toContain("min-height: 0");
  const list = rule(".playback-drawer.guide-drawer .guide-list");
  expect(list).toContain("height: auto");
  expect(list).toContain("min-height: 0");
  expect(list).toContain("flex: 1 1 auto");
  const footer = rule(".playback-drawer-footer");
  expect(footer).toContain("flex: 0 0 auto");
  expect(footer).toContain("min-width: 0");
  expect(footer).not.toMatch(/position:|padding|border/);
  expect(rule(".hints.ruled")).toContain("border-top: 1px solid var(--line)");
  expect(rule(".playback-drawer-head > .icon")).toContain("margin-right: var(--s2)");
  const rtlIcon = rule('html[dir="rtl"] .playback-drawer-head > .icon');
  expect(rtlIcon).toContain("margin-right: 0");
  expect(rtlIcon).toContain("margin-left: var(--s2)");
  expect(rule(".playback-drawer-heading")).toContain("min-width: 0");
  expect(rule(".playback-drawer-heading .playback-drawer-title")).toContain(
    "text-overflow: ellipsis",
  );
});

test("the guide subtitle is translated without changing the accessible label", () => {
  expect(translate("en", "guide.subtitle")).toBe("Programme Guide");
  expect(translate("fa", "guide.subtitle")).toBe(
    "\u0631\u0627\u0647\u0646\u0645\u0627\u06cc \u0628\u0631\u0646\u0627\u0645\u0647",
  );
  expect(translate("en", "guide.title", { category: "Provider One" })).toBe(
    "Programme guide: Provider One",
  );
});
