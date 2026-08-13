import { defineConfig } from "vite";

/** Vite configuration for the static demo site, including GitHub Pages. */
export default defineConfig({
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
