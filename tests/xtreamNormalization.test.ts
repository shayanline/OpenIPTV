import { describe, expect, test } from "vitest";
import {
  directSourceFingerprint,
  normalizeBackdrops,
  normalizeCast,
  normalizeDirector,
  normalizeDurationSeconds,
  normalizeEpisodeTitle,
  normalizeExtension,
  normalizeProviderText,
  normalizeReleaseDate,
  normalizeXtreamRating,
} from "../src/services/xtream";

describe("normalizeProviderText", () => {
  test("trims and never splits a grapheme cluster", () => {
    expect(normalizeProviderText("  A film  ")).toBe("A film");
    expect(normalizeProviderText("Family 👨‍👩‍👧‍👦 night", 14)).toBe("Family");
    const flag = "News 🇩🇪 today";
    expect(normalizeProviderText(flag, 9)).toBe("News 🇩🇪");
  });

  test("omits a string with no whitespace boundary inside the limit", () => {
    expect(normalizeProviderText("Supercalifragilisticexpialidocious", 10)).toBe("");
    expect(normalizeProviderText("long ".repeat(40), 120)).toBe("long ".repeat(23) + "long");
  });

  test("decodes base64 only when it round trips to valid UTF-8", () => {
    expect(normalizeProviderText(btoa("Hello"))).toBe("Hello");
    expect(normalizeProviderText("not base64 at all")).toBe("not base64 at all");
    expect(normalizeProviderText("A===")).toBe("A===");
    expect(normalizeProviderText("!!!invalid")).toBe("!!!invalid");
  });
});

describe("normalizeEpisodeTitle", () => {
  test("extracts common season and episode codes and removes repeated series prefixes", () => {
    expect(normalizeEpisodeTitle("Show - S2:E1 - Pilot", "Show")).toEqual({
      name: "Pilot",
      season: 2,
      episode: 1,
    });
    expect(normalizeEpisodeTitle("S02E03 Return", "Show")).toEqual({
      name: "Return",
      season: 2,
      episode: 3,
    });
    expect(normalizeEpisodeTitle("2x04 - Finale", "Show")).toEqual({
      name: "Finale",
      season: 2,
      episode: 4,
    });
    expect(normalizeEpisodeTitle("Season 2 Episode 5: Arrival", "Show")).toEqual({
      name: "Arrival",
      season: 2,
      episode: 5,
    });
    expect(normalizeEpisodeTitle("(Show) [S01 EP02] - Pilot", "Show")).toEqual({
      name: "Pilot",
      season: 1,
      episode: 2,
    });
    expect(normalizeEpisodeTitle("Show S1E6 Return", "Show")).toEqual({
      name: "Return",
      season: 1,
      episode: 6,
    });
    expect(normalizeEpisodeTitle("E07 - Arrival", "Show", 3)).toEqual({
      name: "Arrival",
      season: 3,
      episode: 7,
    });
    expect(
      normalizeEpisodeTitle(
        "S01E01.Match.01.England.vs.New.Zealand.05-10-2023",
        "ICC Cricket World Cup 2023 Highlights",
        1,
        1,
      ),
    ).toEqual({
      name: "Match 01 England vs New Zealand 05-10-2023",
      season: 1,
      episode: 1,
    });
    expect(normalizeEpisodeTitle("Alborada - S01E01 - Episode 1", "Alborada", 1, 2)).toEqual({
      name: "Episode 1",
      season: 1,
      episode: 1,
    });
    expect(normalizeEpisodeTitle("Sabaat - S01 EP:08", "Sabaat", 1, 8)).toEqual({
      name: "",
      season: 1,
      episode: 8,
    });
    expect(
      normalizeEpisodeTitle(
        "The Marked Heart (2022) S01 EP: 01 TO 07",
        "The Marked Heart (2022)",
        1,
        1,
      ),
    ).toEqual({
      name: "The Marked Heart (2022) S01 EP: 01 TO 07",
      season: 1,
      episode: 1,
    });
    expect(
      normalizeEpisodeTitle(
        "Como defender a un asesino - 1x06 (Elitetorrent.net)",
        "ES - Cómo defender a un asesino",
        1,
        6,
      ),
    ).toEqual({ name: "", season: 1, episode: 6 });
  });

  test("preserves conflicts and genuine episode titles matching the series", () => {
    expect(normalizeEpisodeTitle("S3:E1 - Pilot", "Show", 2)).toEqual({
      name: "S3:E1 - Pilot",
      season: 2,
    });
    expect(normalizeEpisodeTitle("Show", "Show", 1, 2)).toEqual({
      name: "Show",
      season: 1,
      episode: 2,
    });
    expect(normalizeEpisodeTitle("Show - Show", "Show", 1, 3)).toEqual({
      name: "Show",
      season: 1,
      episode: 3,
    });
    expect(
      normalizeEpisodeTitle(
        "Dance Deewane (Colors Hindi) - S04E02 - Episode 2",
        "Dance Deewane (Colors Hindi)",
        4,
        2,
      ),
    ).toEqual({ name: "Episode 2", season: 4, episode: 2 });
    expect(normalizeEpisodeTitle("Pilot (Show)", "Show", 1, 4)).toEqual({
      name: "Pilot",
      season: 1,
      episode: 4,
    });
    expect(normalizeEpisodeTitle("(Show)", "Show", 1, 5)).toEqual({
      name: "(Show)",
      season: 1,
      episode: 5,
    });
    expect(normalizeEpisodeTitle("Pilot (Another Show)", "Show", 1, 6)).toEqual({
      name: "Pilot (Another Show)",
      season: 1,
      episode: 6,
    });
  });
});

describe("normalizeXtreamRating", () => {
  test.each([
    [7.5, "7.5"],
    ["8.25", "8.3"],
    [3.6, "3.6"],
    ["4.0", "4.0"],
    [10, "10.0"],
  ])("accepts %o as %s", (given, expected) => {
    expect(normalizeXtreamRating(given)).toBe(expected);
  });

  test.each([[0], [-1], [11], ["twelve"], [NaN], [undefined], [{}], [null], [""]])(
    "drops %o",
    (given) => {
      expect(normalizeXtreamRating(given)).toBe("");
    },
  );

  test("falls back to the five point field and converts it", () => {
    expect(normalizeXtreamRating("impossible", "4.1")).toBe("8.2");
    expect(normalizeXtreamRating(0, "4.1")).toBe("8.2");
    expect(normalizeXtreamRating(undefined, 3)).toBe("6.0");
    expect(normalizeXtreamRating("x", 0)).toBe("");
    expect(normalizeXtreamRating("7.4", "1.0")).toBe("7.4");
    expect(normalizeXtreamRating("x", 6)).toBe("");
    expect(normalizeXtreamRating("x", -1)).toBe("");
  });
});

describe("normalizeReleaseDate", () => {
  test("accepts plausible years and rejects everything else", () => {
    expect(normalizeReleaseDate(["2024"], 2026)).toBe("2024");
    expect(normalizeReleaseDate(["2024-03-02"], 2026)).toBe("2024-03-02");
    expect(normalizeReleaseDate(["2026"], 2026)).toBe("2026");
    expect(normalizeReleaseDate(["2029"], 2026)).toBe("2029");
    expect(normalizeReleaseDate(["2030"], 2026)).toBe("");
    expect(normalizeReleaseDate(["1888"], 2026)).toBe("1888");
    expect(normalizeReleaseDate(["1887"], 2026)).toBe("");
    expect(normalizeReleaseDate(["not a year", "2024"], 2026)).toBe("2024");
    expect(normalizeReleaseDate([1850, "2022-11-30"], 2026)).toBe("2022-11-30");
    expect(normalizeReleaseDate([2024], 2026)).toBe("2024");
  });
});

describe("normalizeDurationSeconds", () => {
  test("reads duration_secs first, then the written duration", () => {
    expect(normalizeDurationSeconds({ duration_secs: "5400" })).toBe(5400);
    expect(normalizeDurationSeconds({ duration_secs: 5400.9 })).toBe(5400);
    expect(normalizeDurationSeconds({ duration_secs: 0, duration: "90" })).toBe(90);
    expect(normalizeDurationSeconds({ duration: "90:30" })).toBe(5430);
    expect(normalizeDurationSeconds({ duration: "1:30:25" })).toBe(5425);
    expect(normalizeDurationSeconds({ duration: "1:30:99:12" })).toBeUndefined();
    expect(normalizeDurationSeconds({ duration: "90:" })).toBeUndefined();
    expect(normalizeDurationSeconds({ duration: "90:99" })).toBeUndefined();
    expect(normalizeDurationSeconds({ duration: "1:60:00" })).toBeUndefined();
    expect(normalizeDurationSeconds({ duration: "abc" })).toBeUndefined();
    expect(normalizeDurationSeconds({ duration_secs: -4 })).toBeUndefined();
    expect(normalizeDurationSeconds({})).toBeUndefined();
  });
});

describe("normalizeExtension", () => {
  test("normalises or drops the container extension", () => {
    expect(normalizeExtension(".MKV")).toBe("mkv");
    expect(normalizeExtension("mp4")).toBe("mp4");
    expect(normalizeExtension(" mp4 ")).toBe("mp4");
    expect(normalizeExtension("")).toBeUndefined();
    expect(normalizeExtension(undefined)).toBeUndefined();
    expect(normalizeExtension("mp4?x")).toBeUndefined();
    expect(normalizeExtension("toolongextension")).toBeUndefined();
  });
});

describe("normalizeBackdrops", () => {
  test("accepts an array, a string or an encoded array and keeps at most three", () => {
    expect(normalizeBackdrops(["http://a/1.jpg", "ftp://a/2.jpg"], "http://x")).toEqual([
      "http://a/1.jpg",
    ]);
    expect(normalizeBackdrops("http://a/1.jpg", "http://x")).toEqual(["http://a/1.jpg"]);
    expect(normalizeBackdrops('["http://a/1.jpg","http://a/2.jpg"]', "http://x")).toEqual([
      "http://a/1.jpg",
      "http://a/2.jpg",
    ]);
    expect(normalizeBackdrops('["http://a/1.jpg"', "http://x")).toEqual([]);
    expect(normalizeBackdrops(undefined, "http://x")).toEqual([]);
    expect(normalizeBackdrops(5, "http://x")).toEqual([]);
    expect(
      normalizeBackdrops(["http://a/1", "http://a/2", "http://a/3", "http://a/4"], "http://x"),
    ).toEqual(["http://a/1", "http://a/2", "http://a/3"]);
    expect(normalizeBackdrops(["https://u:p@a/1.jpg"], "http://x")).toEqual([]);
  });
});

describe("normalizeCast and normalizeDirector", () => {
  test("cast keeps at most ten names, cut to one hundred twenty code points", () => {
    expect(normalizeCast("A, B ,C")).toEqual(["A", "B", "C"]);
    expect(normalizeCast(["A", 5, "B"])).toEqual(["A", "B"]);
    expect(normalizeCast(Array.from({ length: 15 }, (_, i) => `P${i}`))).toHaveLength(10);
    expect(normalizeCast(undefined)).toEqual([]);
  });

  test("director accepts a string or an array", () => {
    expect(normalizeDirector("A, B")).toBe("A, B");
    expect(normalizeDirector(["A", "B"])).toBe("A, B");
    expect(normalizeDirector(undefined)).toBe("");
  });
});

describe("directSourceFingerprint", () => {
  test("is stable, credential free and only defined for http addresses", () => {
    const first = directSourceFingerprint("http://files.example/a.mkv");
    expect(first).toBe(directSourceFingerprint("http://files.example/a.mkv"));
    expect(first).toMatch(/^[0-9a-z]+$/);
    expect(first).not.toContain("files.example");
    expect(directSourceFingerprint("ftp://files.example/a.mkv")).toBeUndefined();
    expect(directSourceFingerprint("https://u:p@files.example/a.mkv")).toBeUndefined();
    expect(directSourceFingerprint("")).toBeUndefined();
  });
});
