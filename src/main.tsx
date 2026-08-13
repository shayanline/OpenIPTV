import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { markCapabilities } from "./services/capabilities";
import { applyMetrics } from "./services/metrics";
import "./styles/app.css";

/**
 * Mark the document before anything paints.
 *
 * On a Samsung TV the picture is on a hardware plane beneath the browser, and the page has
 * to be transparent for it to show. Setting that from a class here rather than from an
 * effect means there is never a frame where the app paints black over the video.
 */
if (typeof window !== "undefined" && "webapis" in window) {
  document.documentElement.classList.add("tizen");
}

// Whether flex gap works, which decides how the interface is spaced. Measured here, before
// the first render, so nothing is ever drawn with the wrong spacing and corrected after.
markCapabilities();

// The measurements the stylesheet shares with the code, published from the code.
applyMetrics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
