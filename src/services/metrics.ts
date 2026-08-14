import { LOGO_BOX } from "./logos";
import { ROW_BASE } from "../hooks/useWindowed";

/**
 * The measurements the code and the stylesheet both need, published from the code.
 *
 * A few numbers are genuinely shared. How tall a row is decides both which rows the
 * windowing arithmetic puts in the DOM and how tall the rule draws them. How big a logo box
 * is decides both the size a bitmap is reduced to and the space reserved for it.
 *
 * Written twice, once in TypeScript and once in CSS, they are kept level only by a comment
 * beside each asking that they be. A comment is not a mechanism: changing the row height in
 * one place and not the other does not fail loudly, it means the list quietly renders a
 * different number of rows than it draws room for.
 *
 * So the code owns them and hands them to CSS at startup, and the stylesheet multiplies them
 * by the viewer's text scale rather than restating them.
 */
export function applyMetrics(): void {
  const root = document.documentElement.style;
  root.setProperty("--row-base", `${ROW_BASE}px`);
  root.setProperty("--logo-w", `${LOGO_BOX.width}px`);
  root.setProperty("--logo-h", `${LOGO_BOX.height}px`);
}

/**
 * A duration token, read out of the stylesheet, in milliseconds.
 *
 * The other direction to applyMetrics, and deliberately so rather than for symmetry. Sizes
 * belong to the code because the code computes with them; motion belongs to CSS because the
 * reduced motion query rewrites it. Publishing a duration from here would set it as an
 * inline style on <html>, which outranks every stylesheet rule including that query, so the
 * one viewer who asked for no motion would get it anyway.
 *
 * So where the code has to know how long something takes, it asks rather than restates. The
 * panel's dormancy is the case: rows stop being drawn once the panel has finished leaving,
 * and "finished leaving" is whatever the stylesheet says it is, including zero.
 */
export function cssMs(name: string): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return 0;
  return raw.endsWith("ms") ? value : raw.endsWith("s") ? value * 1000 : 0;
}
