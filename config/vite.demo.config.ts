import { resolve } from "node:path";
import { defineConfig } from "vite";
import angular from "@analogjs/vite-plugin-angular";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { sourceAlias } from "./source-alias.ts";

/** Vite configuration for the static demo site, including GitHub Pages. */
export default defineConfig({
  resolve: { alias: sourceAlias, mainFields: ["module"] },
  plugins: [
    angular({
      tsconfig: "tsconfig.app.json",
      include: ["/demo/angular/**/*.ts"],
      transformFilter: (_code, id) => id.includes("/demo/angular/"),
    }),
    svelte(),
  ],
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
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "../index.html"),
        angularApp: resolve(import.meta.dirname, "../angular/index.html"),
      },
    },
  },
});
