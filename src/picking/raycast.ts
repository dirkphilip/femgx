import type { PickRequest, PickScene } from "./pick-scene";
import { faceOwnership, requestRay, createPickScene, type FaceOwnershipResult } from "./pick-scene";
import { pickElement, type ElementPick } from "./element-pick";
import { resolveFacePick, type FacePick } from "./face-pick";
import { pickNode, type NodePick } from "./node-pick";

/**
 * The unified CPU pick path for the demo's interaction model. Resolves the
 * most specific available target: a node near the pointer wins over the face
 * the ray hits first, which wins over the element. The caller can promote or
 * narrow to another granularity with modifier keys.
 */

/** The most specific resolved pick available: node over face over element. */
export type ResolvedPick = NodePick | FacePick | ElementPick;

/** Resolves the most specific pick for a pointer position. */
export function pick(
  scene: PickScene,
  request: PickRequest,
  nodeRadius: number,
): ResolvedPick | undefined {
  const nodeHit = pickNode(scene, request, nodeRadius);
  if (nodeHit !== undefined) return nodeHit;
  const elementHit = pickElement(scene, request);
  if (elementHit === undefined) return undefined;
  const faceHit = resolveFacePick(scene, request, elementHit);
  return faceHit ?? elementHit;
}

export { createPickScene, faceOwnership, requestRay, type FaceOwnershipResult };
export type { PickRequest, PickScene } from "./pick-scene";
export { pickElement, type ElementPick } from "./element-pick";
export { resolveFacePick, type FacePick } from "./face-pick";
export { pickNode, type NodePick } from "./node-pick";
