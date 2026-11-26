import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Confirm } from "../src/components/Confirm";
import { KEY } from "../src/hooks/useRemote";

function pressKey(code: number) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "keyCode", { get: () => code });
  Object.defineProperty(event, "which", { get: () => code });
  window.dispatchEvent(event);
  return event;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("a busy confirmation cannot be dismissed, re-answered or timed out", async () => {
  vi.useFakeTimers();
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const dialog = (busy: boolean) => (
    <Confirm
      title="Remove Test?"
      body="This cannot be undone."
      confirmLabel="Remove"
      cancelLabel="Keep it"
      destructive
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
  const view = render(dialog(false));

  const box = () => document.querySelector<HTMLElement>(".dialog")!;
  const buttons = () => [
    ...document.querySelectorAll<HTMLButtonElement>(".dialog-actions .btn"),
  ];
  const cancel = () => buttons()[0];
  const confirm = () => buttons()[1];

  // The safe answer takes focus and the destructive slot is already mounted.
  expect(document.activeElement).toBe(cancel());
  const slot = confirm().querySelector(".confirm-action-icon");
  expect(slot).toBeTruthy();
  const label = confirm().textContent;

  view.rerender(dialog(true));
  await act(async () => {});
  expect(document.activeElement).toBe(box());
  expect(box().getAttribute("aria-busy")).toBe("true");
  expect(cancel().disabled).toBe(true);
  expect(confirm().disabled).toBe(true);
  expect(confirm().querySelector(".confirm-action-icon")).toBe(slot);
  expect(confirm().textContent).toBe(label);

  // No dismissal route answers while the write is in flight.
  fireEvent.click(document.querySelector<HTMLElement>(".dialog-scrim")!);
  cancel().click();
  confirm().click();
  pressKey(KEY.BACK);
  pressKey(KEY.ESC);
  pressKey(KEY.ENTER);
  act(() => {
    vi.advanceTimersByTime(60000);
  });
  await act(async () => {});
  expect(onCancel).not.toHaveBeenCalled();
  expect(onConfirm).not.toHaveBeenCalled();
  expect(document.querySelector(".dialog")).toBeTruthy();

  // Tab is trapped on the box and focus cannot escape.
  const tab = new KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
    cancelable: true,
  });
  box().dispatchEvent(tab);
  expect(tab.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(box());

  // Physical transport keys belong to playback, not the dialog.
  const play = pressKey(KEY.PLAY);
  expect(play.defaultPrevented).toBe(false);

  view.rerender(dialog(false));
  await act(async () => {});
  expect(document.activeElement).toBe(cancel());
  cancel().click();
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
});
