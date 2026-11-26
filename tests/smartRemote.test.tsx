import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { SmartRemote } from "../src/components/SmartRemote";

const originalUrl = window.location.href;
const originalHistoryState = window.history.state;

const setSearch = (search: string) => {
  window.history.replaceState({}, "", `/${search}`);
};

afterEach(() => {
  cleanup();
  window.history.replaceState(originalHistoryState, "", originalUrl);
});

test("the Smart Remote stays a launcher without the remote flag", () => {
  setSearch("");
  render(<SmartRemote />);
  expect(screen.getByRole("button", { name: "Show Smart Remote" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Volume up" })).toBeNull();
});

test.each(["?remote", "?remote=1"])(
  "the Smart Remote stays collapsed even with %s",
  (search) => {
    setSearch(search);
    render(<SmartRemote />);
    expect(screen.getByRole("button", { name: "Show Smart Remote" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Volume up" })).toBeNull();
  },
);

test.each(["?remotely=1", "?source=remote"])(
  "the Smart Remote ignores unrelated parameters like %s",
  (search) => {
    setSearch(search);
    render(<SmartRemote />);
    expect(screen.getByRole("button", { name: "Show Smart Remote" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Volume up" })).toBeNull();
  },
);

test("an explicitly opened Smart Remote still hides and reopens", () => {
  setSearch("?remote");
  render(<SmartRemote />);
  fireEvent.click(screen.getByRole("button", { name: "Show Smart Remote" }));
  expect(screen.getByRole("button", { name: "Select" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Hide the remote" }));
  expect(screen.getByRole("button", { name: "Show Smart Remote" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Volume up" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Show Smart Remote" }));
  expect(screen.getByRole("button", { name: "Select" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Volume up" })).toBeTruthy();
});
