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
