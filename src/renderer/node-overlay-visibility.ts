/**
 * CPU mirror of the node-overlay visibility contract used in WGSL.
 *
 * This module is for unit tests and documentation of the math only. The
 * renderer never runs it per node on the CPU — glyph classification stays in
 * the GPU fragment shader and scales with draw call coverage, not with a CPU
 * loop over millions of nodes.
 */

/** Projection mode flag matching the camera uniform `ortho` field. */
export type NodeOverlayProjection = "perspective" | "orthographic";

/** Inputs for one center-depth node glyph visibility decision. */
export interface NodeOverlayVisibilityInput {
  readonly nodeDepth: number;
  /** One or more MSAA scene-depth samples at the glyph center. */
  readonly sceneDepths: readonly number[];
  readonly near: number;
  readonly far: number;
  readonly projection: NodeOverlayProjection;
  readonly slack: number;
}

/**
 * Converts WebGPU NDC depth in `[0, 1]` to positive eye-space distance, matching
 * {@link unprojectPoint} in `camera/camera.ts`.
 */
export function eyeDepth(
  z: number,
  near: number,
  far: number,
  projection: NodeOverlayProjection,
): number {
  if (projection === "orthographic") {
    return near + z * (far - near);
  }
  return (near * far) / Math.max(far - z * (far - near), 1e-8);
}

/**
 * View-space occlusion slack from a scene/camera length scale. Coplanar
 * face-vs-vertex sample error stays under this; front/back of a solid of
 * similar size stays well above it.
 */
export function nodeOverlaySlack(sceneScale: number): number {
  return Math.max(1e-5, 2e-3 * Math.max(sceneScale, 0));
}

/**
 * Center-depth visibility for one FE node glyph.
 *
 * A sample occludes when it is nearer than the node by more than `slack`. The
 * glyph is hidden only when **every** MSAA sample occludes — matching the WGSL
 * unanimous test so coplanar / silhouette subsample noise cannot blink a front
 * glyph off.
 */
export function isNodeOverlayVisible(input: NodeOverlayVisibilityInput): boolean {
  if (input.sceneDepths.length === 0) return true;
  const nodeEye = eyeDepth(input.nodeDepth, input.near, input.far, input.projection);
  for (const sceneDepth of input.sceneDepths) {
    const sceneEye = eyeDepth(sceneDepth, input.near, input.far, input.projection);
    if (sceneEye + input.slack >= nodeEye) return true;
  }
  return false;
}
