import { afterEach, beforeEach, expect, test } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { Onboarding } from "../src/components/Onboarding";
import { useSettings } from "../src/stores/settings";

beforeEach(() => {
  localStorage.clear();
  useSettings.getState().set("locale", "en");
});

afterEach(() => {
  cleanup();
});

test("the first run screen lets the viewer change language before adding a playlist", () => {
  render(<Onboarding onAdd={() => {}} onExit={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "Language, English" }));
  fireEvent.click(screen.getByRole("option", { name: "فارسی Persian" }));

  expect(useSettings.getState().locale).toBe("fa");
  expect(screen.getByText("زبان")).toBeTruthy();
});
