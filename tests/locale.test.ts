import { describe, expect, test, vi } from "vitest";
import {
  directionFor,
  detectSystemLocale,
  formatNumber,
  LOCALE_OPTIONS,
  LOCALES,
  resolveLocale,
  translate,
  untranslatedKeys,
} from "../src/services/locale";

describe("locale selection", () => {
  test("uses the TV browser language for the System preference", () => {
    expect(resolveLocale("system", "fa-IR")).toBe("fa");
  });

  test("falls back to English for an unsupported system language", () => {
    expect(detectSystemLocale("sv-SE")).toBe("en");
  });

  test("reads the browser language when System has no override", () => {
    const original = navigator.language;
    Object.defineProperty(navigator, "language", { configurable: true, value: "fa-IR" });
    try {
      expect(resolveLocale("system")).toBe("fa");
    } finally {
      Object.defineProperty(navigator, "language", { configurable: true, value: original });
    }
  });

  test("keeps an explicit locale when the system language differs", () => {
    expect(resolveLocale("fa", "en-GB")).toBe("fa");
  });

  test("marks Persian as right to left", () => {
    expect(directionFor("fa")).toBe("rtl");
  });

  test("detects a newly supported European system language", () => {
    expect(resolveLocale("system", "de-DE")).toBe("de");
  });

  test("marks Arabic as right to left", () => {
    expect(directionFor("ar")).toBe("rtl");
  });

  test("translates a message with a count", () => {
    expect(translate("fa", "playlist.loadedActive", { count: 2 })).toContain("۲");
  });

  test("translates newly added locale catalogs at runtime", () => {
    expect(translate("de", "settings.title")).toBe("Einstellungen");
    expect(translate("zh-CN", "common.search")).toBe("搜索");
  });

  test("formats generated numbers with the selected locale", () => {
    expect(formatNumber("fa", 1234)).toBe("۱٬۲۳۴");
  });

  test("channel and category numbers reuse one formatter per locale", async () => {
    vi.resetModules();
    const numbers = vi.spyOn(Intl, "NumberFormat");
    try {
      const locale = await import("../src/services/locale");
      expect(locale.formatNumber("en", 1234)).toBe("1,234");
      expect(locale.formatNumber("en", 5001)).toBe("5,001");
      locale.formatNumber("fa", 1234);
      locale.formatNumber("fa", 5001);
      expect(numbers).toHaveBeenCalledTimes(2);
      expect(numbers.mock.calls.map(([id]) => id)).toEqual(["en", "fa"]);
    } finally {
      numbers.mockRestore();
    }
  });

  test("number formatting retains its fallback when the engine rejects a formatter", async () => {
    vi.resetModules();
    const numbers = vi.spyOn(Intl, "NumberFormat").mockImplementation(() => {
      throw new Error("Unavailable formatter");
    });
    try {
      const locale = await import("../src/services/locale");
      expect(locale.formatNumber("en", 1234)).toBe("1234");
    } finally {
      numbers.mockRestore();
    }
  });

  test.each(LOCALES)("ships a translation for every interface message in %s", (locale) => {
    expect(untranslatedKeys(locale)).toEqual([]);
  });

  test("offers fifteen additional locales sorted by English name", () => {
    const languages = LOCALE_OPTIONS.filter((option) => option.id !== "system");
    expect(languages).toHaveLength(17);
    expect(LOCALE_OPTIONS[0].id).toBe("system");
    const names = languages.map((option) => option.englishName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});
