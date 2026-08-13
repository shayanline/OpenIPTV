/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf8"));

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // The TV loads the app from the filesystem inside the widget, so every asset
  // reference has to be relative. An absolute /assets/... path resolves to the
  // device root and 404s.
  base: "./",
  build: {
    outDir: "dist",
    // 2020 and 2021 sets still run Chromium 76, which predates optional chaining
    // and nullish coalescing. Targeting es2019 keeps the bundle parseable there.
    target: "es2019",
    // The stylesheet needs the same treatment and does not inherit it: `target` above
    // governs JavaScript only, and left unset the CSS is minified for a modern browser.
    // This lowers what can be lowered, such as modern colour syntax and nesting.
    //
    // It does not, and cannot, do anything about flex gap, which is a layout behaviour
    // rather than a syntax: nothing can rewrite it into something Chromium 76 understands.
    // That is handled at the foot of styles/app.css against a measured capability class.
    cssTarget: "chrome69",
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 5173, host: true },

  /*
   * Tests run through Vite rather than through node --test.
   *
   * The previous arrangement leaned on Node's own type stripping and on Node resolving the
   * imports, and the second of those quietly decided what could be tested at all: everything
   * under src/ imports its neighbours without a file extension, which Node's ESM resolver
   * refuses, so only modules whose every relative import was a type import could be loaded.
   * The four that had tests qualified by luck rather than by design, and player.ts, the
   * stores and the logo cache could not have been tested without rewriting their imports.
   *
   * Vite resolves the same way the application does, so a test can import anything the app
   * can. jsdom is there for the modules that touch the document, which on a browser and a
   * television is most of the interesting ones.
   */
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
    restoreMocks: true,
  },
});
