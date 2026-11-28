import { expect, test } from "vitest";
import {
  automaticTrack,
  normalizeAvPlayTracks,
  trackIdentity,
} from "../src/services/playbackTracks";
import type { MediaTrack } from "../src/types";

const audio = (engineIndex: number, extra_info: string) => ({
  index: engineIndex,
  type: "AUDIO" as const,
  extra_info,
});

const text = (engineIndex: number, extra_info: string) => ({
  index: engineIndex,
  type: "TEXT" as const,
  extra_info,
});

test("track identity excludes the target local engine index", () => {
  const first = trackIdentity({
    kind: "audio",
    language: "EN",
    label: " Main  ",
    accessibility: undefined,
  });
  const second = trackIdentity({
    kind: "audio",
    language: "en",
    label: "main",
    accessibility: undefined,
  });
  expect(first).toBe(second);
});

test("AVPlay tracks normalize labels, languages, selection and malformed metadata", () => {
  expect(
    normalizeAvPlayTracks([
      audio(
        4,
        JSON.stringify({ track_lang: "EN-gb", title: "  Main   Audio ", isSelected: true }),
      ),
      audio(8, "not json"),
      text(11, JSON.stringify({ language: "FR", label: "  " })),
    ]),
  ).toEqual([
    {
      id: "audio|en-gb|main audio||0",
      identity: "audio|en-gb|main audio|",
      engineIndex: 4,
      kind: "audio",
      label: "Main Audio",
      language: "en-gb",
      selected: true,
      accessibility: undefined,
    },
    {
      id: "audio||audio 2||0",
      identity: "audio||audio 2|",
      engineIndex: 8,
      kind: "audio",
      label: "Audio 2",
      language: "",
      selected: false,
      accessibility: undefined,
    },
    {
      id: "subtitle|fr|fr||0",
      identity: "subtitle|fr|fr|",
      engineIndex: 11,
      kind: "subtitle",
      /* No provider label, so the language names the row before the numbered fallback. */
      label: "fr",
      language: "fr",
      selected: false,
      accessibility: undefined,
    },
  ]);
});

test("duplicate metadata receives stable occurrence ids while retaining engine indices", () => {
  const tracks = normalizeAvPlayTracks([
    audio(2, JSON.stringify({ language: "en", label: "Main" })),
    audio(7, JSON.stringify({ language: "EN", label: " main " })),
  ]);

  expect(tracks.map(({ id, engineIndex }) => ({ id, engineIndex }))).toEqual([
    { id: "audio|en|main||0", engineIndex: 2 },
    { id: "audio|en|main||1", engineIndex: 7 },
  ]);
});

test("SDH and descriptions participate in track identity", () => {
  const tracks = normalizeAvPlayTracks([
    text(1, JSON.stringify({ language: "en", label: "English SDH" })),
    audio(2, JSON.stringify({ language: "en", label: "English", role: "audio description" })),
  ]);

  expect(tracks[0].accessibility).toBe("sdh");
  expect(tracks[0].identity).toBe("subtitle|en|english sdh|sdh");
  expect(tracks[1].accessibility).toBe("descriptions");
  expect(tracks[1].identity).toBe("audio|en|english|descriptions");
});

test("Automatic exists only for one unambiguous device language match", () => {
  const english: MediaTrack = {
    id: "english",
    identity: "audio|en|english|",
    engineIndex: 1,
    kind: "audio",
    label: "English",
    language: "en",
    selected: false,
  };
  const french = { ...english, id: "french", language: "fr", engineIndex: 2 };
  const anotherEnglish = { ...english, id: "another", language: "en-US", engineIndex: 3 };

  expect(automaticTrack([english, french], "en-GB")?.id).toBe(english.id);
  expect(automaticTrack([english, anotherEnglish], "en-GB")).toBeNull();
  expect(automaticTrack([{ ...english, language: "zh-Hant" }], "zh-Hant-TW")?.id).toBe(
    "english",
  );
});
