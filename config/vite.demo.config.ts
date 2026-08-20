import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { sourceAlias } from "./source-alias.ts";

/** Vite configuration for the static demo site, including GitHub Pages. */
export default defineConfig({
  resolve: { alias: sourceAlias },
  plugins: [svelte()],
  base: process.env["PAGES_BASE_PATH"] ?? "/",
  define: {
    __FEMGX_BUILD_TIMESTAMP__: JSON.stringify(
      process.env["FEMGX_PAGES_BUILD_TIME"] || new Date().toISOString(),
    ),
    __FEMGX_BUILD_SHA__: JSON.stringify(process.env["FEMGX_PAGES_BUILD_SHA"] || ""),
  },
  build: {
    outDir: "dist-demo",
    emptyOutDir: true,
  },
});
