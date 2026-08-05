import { defineConfig } from "vite";

/** Vite configuration for the static demo site, including GitHub Pages. */
export default defineConfig({
  base: process.env["PAGES_BASE_PATH"] ?? "/",
  build: {
    outDir: "dist-demo",
    emptyOutDir: true,
  },
});
