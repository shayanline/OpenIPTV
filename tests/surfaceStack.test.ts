import { expect, test } from "vitest";
import { activeSurface } from "../src/services/surfaceStack";

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
