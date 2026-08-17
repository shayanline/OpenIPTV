import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import { mountApp, panelOpen, press } from "./support/app";
import "../src/styles/app.css";

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News",Alpha
http://example.invalid/a.m3u8`;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

test("the Persian system language applies RTL and opens the panel with Right", async () => {
  await mountApp(PLAYLIST, { locale: "fa", resume: "a" });

  expect(document.documentElement.lang).toBe("fa");
  expect(document.documentElement.dir).toBe("rtl");
  expect(panelOpen()).toBe(false);
  expect(document.querySelector<HTMLElement>(".pb-number")?.textContent).toBe("۱");

  press(KEY.RIGHT);

  expect(panelOpen()).toBe(true);

  press(KEY.YELLOW);

  expect(screen.getByRole("heading", { name: "ظاهر" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "زبان, فارسی" })).toBeTruthy();
});
