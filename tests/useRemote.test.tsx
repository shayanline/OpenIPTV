import { cleanup, fireEvent, render } from "@testing-library/react";
import { flushSync } from "react-dom";
import { afterEach, expect, test, vi } from "vitest";
import { KEY, sendKey, useRemote } from "../src/hooks/useRemote";

type Handler = (code: number, event: KeyboardEvent) => void;

function Listener({ handler }: { handler: Handler }) {
  useRemote(handler);
  return null;
}

afterEach(cleanup);

test("a transport key reaches the latest handler when an earlier listener commits an update", () => {
  const previous = vi.fn();
  const latest = vi.fn((_code: number, event: KeyboardEvent) => event.preventDefault());
  let view: ReturnType<typeof render> | null = null;
  const before = () => flushSync(() => view?.rerender(<Listener handler={latest} />));
  window.addEventListener("keydown", before);
  try {
    view = render(<Listener handler={previous} />);
    const delivered = fireEvent.keyDown(window, { keyCode: KEY.PLAY_PAUSE });
    expect(latest).toHaveBeenCalledOnce();
    expect(latest.mock.calls[0][0]).toBe(KEY.PLAY_PAUSE);
    expect(previous).not.toHaveBeenCalled();
    expect(delivered).toBe(false);
  } finally {
    window.removeEventListener("keydown", before);
    view?.unmount();
  }
});

test("an unmounted remote handler no longer receives transport keys", () => {
  const handler = vi.fn();
  const view = render(<Listener handler={handler} />);
  sendKey(KEY.PAUSE);
  expect(handler).toHaveBeenCalledOnce();
  expect(handler.mock.calls[0][0]).toBe(KEY.PAUSE);
  view.unmount();
  sendKey(KEY.PAUSE);
  expect(handler).toHaveBeenCalledOnce();
});
