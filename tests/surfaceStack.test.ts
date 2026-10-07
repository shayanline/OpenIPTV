import { expect, test } from "vitest";
import { activeSurface } from "../src/services/surfaceStack";

const stack = (overrides = {}) => ({
  picture: "picture" as const,
  primary: null,
  drawer: null,
  modal: null,
  popup: null,
  ...overrides,
});

test("the highest open surface owns input", () => {
  expect(
    activeSurface({
      picture: "picture",
      primary: "panel",
      drawer: "guide",
      modal: "settings",
      popup: "confirmation",
    }),
  ).toBe("confirmation");

  expect(
    activeSurface({
      picture: "picture",
      primary: "panel",
      drawer: "guide",
      modal: "settings",
      popup: null,
    }),
  ).toBe("settings");
  expect(
    activeSurface({
      picture: "picture",
      primary: "panel",
      drawer: "guide",
      modal: null,
      popup: null,
    }),
  ).toBe("guide");
  expect(
    activeSurface({
      picture: "picture",
      primary: "panel",
      drawer: null,
      modal: null,
      popup: null,
    }),
  ).toBe("panel");
  expect(
    activeSurface({
      picture: "picture",
      primary: null,
      drawer: null,
      modal: null,
      popup: null,
    }),
  ).toBe("picture");
});

test("the playback deck is a primary surface alongside the panel", () => {
  expect(activeSurface(stack({ primary: "playback-deck" }))).toBe("playback-deck");
});

test.each(["guide", "audio", "subtitles", "more"] as const)(
  "the %s drawer owns input above the deck",
  (drawer) => {
    expect(activeSurface(stack({ primary: "playback-deck", drawer }))).toBe(drawer);
    expect(activeSurface(stack({ primary: "panel", drawer }))).toBe(drawer);
  },
);

test("a modal owns input above each drawer", () => {
  for (const drawer of ["guide", "audio", "subtitles", "more"] as const) {
    expect(activeSurface(stack({ primary: "playback-deck", drawer, modal: "settings" }))).toBe(
      "settings",
    );
  }
});

test("a confirmation owns input above the complete stack", () => {
  expect(
    activeSurface(
      stack({
        primary: "playback-deck",
        drawer: "more",
        modal: "settings",
        popup: "confirmation",
      }),
    ),
  ).toBe("confirmation");
});
