/**
 * The handful of browser APIs jsdom does not implement.
 *
 * Each is stubbed rather than emulated. Nothing here is under test: they exist so that a
 * component which observes its own size, or asks to be scrolled into view, can be mounted at
 * all. jsdom has no layout engine, so a faithful implementation is not available in any case.
 */

if (!("ResizeObserver" in globalThis)) {
  // The app measures the panel to decide how many rows fit. With no layout there is nothing
  // to report, and the hook already copes with a height of zero by claiming one row.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// createImageBitmap is used to shrink logos. Nothing in the tests draws one, and the logo
// cache has its own tests where this is stubbed deliberately.
if (!("createImageBitmap" in globalThis)) {
  globalThis.createImageBitmap = (() =>
    Promise.reject(new Error("no decoder in jsdom"))) as unknown as typeof createImageBitmap;
}
