import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import { applyDocumentLocale, type Locale, LOCALES } from "../src/services/locale";
import { mountApp, panelOpen, press } from "./support/app";
import "../src/styles/app.css";

const fontStyle = document.createElement("style");
fontStyle.textContent = readFileSync("src/styles/tokens.css", "utf8");
document.head.append(fontStyle);

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News",Alpha
http://example.invalid/a.m3u8`;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

test("each locale uses the font designed for its writing system", () => {
  const families: [string, Locale[]][] = [
    ["Google Sans", ["bn", "de", "en", "es", "fr", "hi", "id", "it", "nl", "pt", "ru", "tr"]],
    ["Vazirmatn", ["ar", "fa"]],
    ["Noto Sans SC", ["zh-CN"]],
    ["Noto Sans JP", ["ja"]],
    ["Noto Sans KR", ["ko"]],
  ];

  expect(families.flatMap(([, locales]) => locales).sort()).toEqual([...LOCALES].sort());
  for (const [family, locales] of families) {
    for (const locale of locales) {
      applyDocumentLocale(locale);
      expect(getComputedStyle(document.documentElement).getPropertyValue("--font")).toContain(
        `"${family}"`,
      );
    }
  }
});

test("the Persian system language applies RTL and opens the panel with Right", async () => {
  await mountApp(PLAYLIST, { locale: "fa", resume: "a" });

  expect(document.documentElement.lang).toBe("fa");
  expect(document.documentElement.dir).toBe("rtl");
  expect(panelOpen()).toBe(false);
  expect(document.querySelector<HTMLElement>(".pb-number")?.textContent).toBe("1");

  press(KEY.RIGHT);

  expect(panelOpen()).toBe(true);

  press(KEY.YELLOW);

  expect(screen.getByRole("heading", { name: "ظاهر" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "زبان, فارسی" })).toBeTruthy();
});
