import { afterEach, beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { act, cleanup, renderHook } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import { useChrome } from "../src/hooks/useChrome";
import { mountApp, press, settle } from "./support/app";

/**
 * The banner names the channel and then goes away, and this is about the second half.
 *
 * A viewer reported it staying up for ever, occasionally, with no reproduction, and going away only
 * on right or back, which clear every overlay at once and so hide a fault rather than fix one. The
 * mechanism turned out to be exact. While a channel is joining the banner is held with no countdown,
 * deliberately, because a stream that takes fifteen seconds to arrive should keep saying which
 * channel it is. The countdown was then restarted by the picture arriving, and an arrival is
 * announced once per channel, also deliberately. So anything that made the app busy again on a
 * channel it had already announced left the banner held with nothing left to lower it.
 */

const PLAYLIST = `#EXTM3U
#EXTINF:-1 group-title="News",First Channel
http://example.invalid/1.m3u8
#EXTINF:-1 group-title="News",Second Channel
http://example.invalid/2.m3u8
`;

const FARSI_PLAYLIST = `#EXTM3U
#EXTINF:-1 group-title="شبکه ها",شبکه سه
http://example.invalid/farsi.m3u8
`;
const appCss = readFileSync("src/styles/app.css", "utf8");
const style = document.createElement("style");
style.textContent = appCss.replace('@import "./tokens.css";', "");
document.head.append(style);

/**
 * The banner is in the document while it is up, and gone when it is not.
 *
 * `.pb-stack` because that is what App renders it as. Worth stating since the hook calls the state
 * `banner` and there is no element by that name, which cost a first run of this file.
 */
const bannerUp = () => !!document.querySelector(".pb-stack");

/**
 * Skip past the banner's own eight seconds, which is not the panel's setting: the viewer chooses how long
 * the channel list stays open, and the banner has always had its own eight.
 */
const past = async () => {
  await act(async () => { await vi.advanceTimersByTimeAsync(8600); });
};

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });

// ---- the contract, at the hook ----------------------------------------------------------

test("a raised banner counts itself down", () => {
  const { result } = renderHook(() => useChrome());
  act(() => { result.current.raiseBanner(); });
  assert.equal(result.current.banner, true);

  act(() => { vi.advanceTimersByTime(8600); });
  assert.equal(result.current.banner, false);
});

test("a held banner stays up, because a channel still joining should keep saying which it is", () => {
  const { result } = renderHook(() => useChrome());
  act(() => { result.current.holdBanner(); });

  act(() => { vi.advanceTimersByTime(30000); });
  assert.equal(result.current.banner, true, "a held banner must not time out while it is holding");
});

test("settling a held banner gives it the count it never had", () => {
  // The fix. Whatever ends the waiting starts the five seconds, rather than only a picture arriving.
  const { result } = renderHook(() => useChrome());
  act(() => { result.current.holdBanner(); });
  act(() => { result.current.settleBanner(); });

  assert.equal(result.current.banner, true, "settling must not hide it immediately");
  act(() => { vi.advanceTimersByTime(8600); });
  assert.equal(result.current.banner, false, "a settled banner stayed up for ever");
});

test("settling does not raise a banner that is down", () => {
  /*
   * The other half of the same problem, and why this refuses to raise rather than simply restarting
   * the count. A stall recovering used to be treated as an arrival, the banner rose from the dead,
   * and since OK dismisses an arrival, OK could not get past it to open the channel list.
   */
  const { result } = renderHook(() => useChrome());
  act(() => { result.current.lowerBanner(); });
  act(() => { result.current.settleBanner(); });
  assert.equal(result.current.banner, false, "it resurrected a banner the viewer had dismissed");
});

// ---- and in the application, on a channel that takes a moment to arrive -----------------

test("a Farsi category heading stays aligned with the LTR list", async () => {
  await mountApp(FARSI_PLAYLIST);

  const heading = document.querySelector(".list .panel-title");
  assert.ok(heading);
  assert.equal(heading.textContent, "شبکه ها");
  assert.equal(heading.getAttribute("dir"), "auto");
  assert.equal(getComputedStyle(heading).textAlign, "left");
});

test("a Farsi only channel title stays aligned with the LTR banner", async () => {
  await mountApp(FARSI_PLAYLIST);
  press(KEY.ENTER);

  const title = document.querySelector(".pb-title");
  assert.ok(title);
  assert.equal(title.textContent, "شبکه سه");
  assert.equal(title.getAttribute("dir"), "auto");
  assert.equal(getComputedStyle(title).textAlign, "left");
});

test("the banner goes away on its own after a channel starts", async () => {
  await mountApp(PLAYLIST, { slowPicture: 300 });
  press(KEY.ENTER);
  await settle(500);
  assert.equal(bannerUp(), true, "the channel was never named");

  await past();
  assert.equal(bannerUp(), false, "the banner stayed up past its eight seconds");
});

test("the banner still goes away after pausing and playing the same channel", async () => {
  /*
   * The reported fault, pressed as the viewer pressed it. Play, wait for the banner to go, then pause
   * and play: the app is busy again on a channel whose arrival was already announced, so before the
   * fix nothing was left to start the countdown and the banner stayed until something cleared it.
   */
  await mountApp(PLAYLIST, { slowPicture: 300 });
  press(KEY.ENTER);
  await settle(500);
  await past();
  assert.equal(bannerUp(), false, "the banner had not gone before the interesting part began");

  press(KEY.PAUSE);
  await settle();
  press(KEY.PLAY);
  await settle(500);

  await past();
  assert.equal(bannerUp(), false, "the banner stayed up for ever after pause then play");
});

test("the banner goes away while a channel remains paused", async () => {
  await mountApp(PLAYLIST, { slowPicture: 300 });
  press(KEY.ENTER);
  await settle(500);
  await past();
  assert.equal(bannerUp(), false, "the banner had not gone before pausing");

  press(KEY.PAUSE);
  assert.equal(bannerUp(), true, "pausing did not show the channel banner");
  await past();
  assert.equal(bannerUp(), false, "paused state kept the expired banner visible");
});
