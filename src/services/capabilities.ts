/**
 * What the engine underneath can actually do, measured rather than assumed.
 *
 * There is exactly one thing here, and it earns its place because CSS cannot answer it.
 */

/**
 * Whether `gap` does anything on a flex container.
 *
 * It arrived for grid in Chromium 66 and for flex only in 84. The televisions this app is
 * built for sit between those two: Chromium 76 on the 2020 and 2021 sets, and 69 at the
 * floor the simulator measures against. On those, every flex gap in the stylesheet is parsed,
 * accepted and then ignored, so the interface draws with no spacing anywhere.
 *
 * `@supports (gap: 1px)` cannot tell them apart, because it asks whether the property and
 * value are understood and they are, for grid. The only honest test is to lay two things out
 * and measure whether the gap appeared.
 *
 * Two empty children with no width and a one pixel gap: a scroll width of one means the gap
 * was applied, zero means it was dropped.
 */
export function supportsFlexGap(): boolean {
  const probe = document.createElement("div");
  probe.style.cssText =
    "display:flex;gap:1px;position:absolute;visibility:hidden;width:auto;height:0";
  probe.appendChild(document.createElement("i"));
  probe.appendChild(document.createElement("i"));

  document.body.appendChild(probe);
  const applied = probe.scrollWidth === 1;
  probe.parentNode?.removeChild(probe);
  return applied;
}

/**
 * Measure once and record it on <html>, before the app paints.
 *
 * A class rather than a media query or a runtime branch, so the fallback spacing is ordinary
 * CSS that costs a modern engine nothing: it never matches the selector and goes on using
 * gap. See the "old engine gaps" section at the foot of styles/app.css.
 */
export function markCapabilities(): void {
  if (!supportsFlexGap()) document.documentElement.classList.add("no-flex-gap");
}
