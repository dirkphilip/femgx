import { resolve } from "node:path";

/** Resolves the source-root alias in Vite and Vitest. */
export const sourceAlias = {
  "@": resolve(import.meta.dirname, "../src"),
};
