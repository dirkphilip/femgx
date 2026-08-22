import { defineConfig } from "vitest/config";
import angular from "@analogjs/vite-plugin-angular";
import { sourceAlias } from "./source-alias.ts";

export default defineConfig({
  resolve: { alias: sourceAlias, mainFields: ["module"] },
  plugins: [angular({ tsconfig: "tsconfig.app.json" })],
  test: {
    environment: "happy-dom",
    include: ["test/angular/**/*.test.ts"],
    server: { deps: { inline: ["@angular/core", "@angular/compiler"] } },
  },
});
