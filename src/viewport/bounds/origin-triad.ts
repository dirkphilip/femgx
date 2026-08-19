import { originTriadNominalScale } from "../../renderer/gpu-renderer";
import type { Bounds } from "../../geometry/part";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { Scene } from "../../scene/scene";
import { scenePlacedBounds } from "../scene-bounds";

/** Validates the construction-time world-origin triad option. */
export function assertOriginTriad(value: unknown): asserts value is boolean | undefined {
  if (value === undefined || typeof value === "boolean") return;
  throw new Error("Invalid originTriad; expected a boolean");
}

/** Resolves the triad's stable nominal scale from complete placed bounds. */
export function sceneOriginTriadScale(scene: Scene, runtime: PackedSceneRuntime): number {
  return originTriadScaleFromBounds(scenePlacedBounds(scene, runtime));
}

/** Resolves the triad scale from an already maintained complete placed bound. */
export function originTriadScaleFromBounds(bounds: Bounds): number {
  return originTriadNominalScale(bounds);
}
