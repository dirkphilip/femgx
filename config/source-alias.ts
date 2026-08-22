import { resolve } from "node:path";

/** Resolves source and published-package aliases in Vite and Vitest. */
export const sourceAlias = {
  "@": resolve(import.meta.dirname, "../src"),
  fixtures: resolve(import.meta.dirname, "../fixtures"),
  "femgx/model": resolve(import.meta.dirname, "../src/entries/model.ts"),
  femgx: resolve(import.meta.dirname, "../src/entries/root.ts"),
};
