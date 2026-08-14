import type { StyleOverride } from "../interaction/state";
import type { PartId } from "../geometry/part";
import type { Scene } from "../scene/scene";
import type { Issue } from "./diagnostics";

/**
 * Options controlling diagnostics while importing a GLB display scene.
 * @category Import and export
 */
export interface GlbImportOptions {
  /** Reject the import when a recoverable warning would otherwise be returned. */
  readonly strict?: boolean;
}

/**
 * A deterministic display-scene import result using the canonical femgx Scene.
 * @category Import and export
 */
export interface GlbSceneImport {
  readonly scene: Scene;
  readonly partNames: ReadonlyMap<PartId, string>;
  readonly partStyles: ReadonlyMap<PartId, StyleOverride>;
  readonly issues: readonly Issue[];
}

/**
 * Stable diagnostic codes emitted by the GLB adapter.
 * @category Import and export
 */
export type GlbIssueCode =
  | "glb-invalid-header"
  | "glb-invalid-version"
  | "glb-invalid-container"
  | "glb-parse-failure"
  | "glb-no-scene"
  | "glb-default-scene-fallback"
  | "glb-no-supported-geometry"
  | "glb-invalid-transform"
  | "glb-missing-position"
  | "glb-invalid-position"
  | "glb-unsupported-primitive-mode"
  | "glb-invalid-index"
  | "glb-invalid-primitive"
  | "glb-unsupported-required-extension"
  | "glb-ignored-extension"
  | "glb-ignored-texture"
  | "glb-ignored-material-feature"
  | "glb-mask-alpha-approximation";
