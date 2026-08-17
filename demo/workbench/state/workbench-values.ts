import type { ViewportBackground } from "../../../src/entries/root";
import type { SelectionGranularity } from "../selection/pick";

/** Parses the supported background choices from DOM input. */
export function parseViewportBackground(value: string): ViewportBackground | undefined {
  if (value === "studio" || value === "white" || value === "dark") return value;
  return undefined;
}

/** Parses the supported selection granularities from DOM input. */
export function parseSelectionGranularity(value: string): SelectionGranularity | undefined {
  return value === "body" ||
    value === "element" ||
    value === "face" ||
    value === "node" ||
    value === "edge"
    ? value
    : undefined;
}

/** Identifies the expected teardown error from a renderer callback race. */
export function isDestroyedViewportError(error: unknown): boolean {
  return error instanceof Error && error.message === "Viewport has been destroyed";
}
