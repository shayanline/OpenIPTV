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
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 5173, host: true },
});
