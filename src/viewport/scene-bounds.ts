import type { Camera } from "../camera/camera";
import { protectCameraWithinBounds } from "../camera/navigation";
import { boundsCorners, isFiniteBounds, type Bounds, type PartId } from "../geometry/part";
import { selectedTargets } from "../interaction/targets";
import type { InteractionState } from "../interaction/interaction";
import type { InteractionTarget } from "../interaction/target-types";
import { transformPoint } from "../math/mat4";
import type { DeformationState } from "../results/deform";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { Scene } from "../scene/scene";
import {
  displayedPartBounds,
  emptyBounds,
  include,
  selectedGeometryBounds,
  type MutableBounds,
} from "./geometry-bounds";

/** Complete and per-occurrence bounds consumed by camera navigation. */
export interface SceneNavigationBounds {
  readonly bounds: Bounds;
  readonly protectedBounds: readonly Bounds[];
}

interface SceneNavigationBoundsSnapshot extends SceneNavigationBounds {
  readonly scene: Scene;
  readonly runtime: PackedSceneRuntime;
  readonly deformation: DeformationState | undefined;
}

/** Caches geometry-derived navigation bounds between authoritative scene changes. */
export class SceneNavigationBoundsCache {
  private snapshot: SceneNavigationBoundsSnapshot | undefined;

  /** Returns one shared bounds calculation for zoom and close-camera protection. */
  get(
    scene: Scene,
    runtime: PackedSceneRuntime,
    deformation?: DeformationState,
  ): SceneNavigationBounds {
    const current = this.snapshot;
    if (
      current !== undefined &&
      current.scene === scene &&
      current.runtime === runtime &&
      current.deformation === deformation
    ) {
      return current;
    }
    const protectedBounds = sceneWorldBoundsList(scene, runtime, deformation);
    const snapshot: SceneNavigationBoundsSnapshot = {
      scene,
      runtime,
      deformation,
      protectedBounds,
      bounds: sceneBoundsFromList(protectedBounds),
    };
    this.snapshot = snapshot;
    return snapshot;
  }

  /** Invalidates bounds after mutable runtime visibility changes. */
  invalidate(): void {
    this.snapshot = undefined;
  }
}

/** Keeps an externally positioned camera in front of every placed part bound. */
export function protectSceneCamera(
  camera: Camera,
  scene: Scene,
  runtime: PackedSceneRuntime,
  deformation?: DeformationState,
): Camera {
  const boundsList = sceneWorldBoundsList(scene, runtime, deformation);
  return protectCameraWithinBounds(camera, sceneBoundsFromList(boundsList), boundsList);
}

/** Returns the union of every placed part bound in displayed world space. */
export function sceneWorldBounds(
  scene: Scene,
  runtime: PackedSceneRuntime,
  deformation?: DeformationState,
): Bounds {
  return sceneBoundsFromList(sceneWorldBoundsList(scene, runtime, deformation));
}

/** Returns the union of every placed part bound, regardless of visibility. */
export function scenePlacedBounds(scene: Scene, runtime: PackedSceneRuntime): Bounds {
  return sceneBoundsFromList(sceneWorldBoundsList(scene, runtime, undefined, true));
}

/** Returns each placed part bound separately in displayed world space. */
export function sceneWorldBoundsList(
  scene: Scene,
  runtime: PackedSceneRuntime,
  deformation?: DeformationState,
  includeHidden = false,
): readonly Bounds[] {
  const bounds: Bounds[] = [];
  const partBoundsById = new Map<PartId, Bounds | undefined>();
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    if (!includeHidden && !runtime.isInstanceVisible(slot)) continue;
    const partId = runtime.instancePartIds[slot];
    const transform = runtime.getTransform(slot);
    const part = partId === undefined ? undefined : scene.parts.get(partId);
    let partBounds: Bounds | undefined;
    if (part !== undefined && partId !== undefined) {
      if (partBoundsById.has(partId)) {
        partBounds = partBoundsById.get(partId);
      } else {
        partBounds = displayedPartBounds(part, deformation);
        partBoundsById.set(partId, partBounds);
      }
    }
    if (partBounds === undefined || transform === undefined || !isFiniteBounds(partBounds))
      continue;
    bounds.push(transformedBounds(partBounds, transform));
  }
  return bounds;
}

function sceneBoundsFromList(boundsList: readonly Bounds[]): Bounds {
  const bounds = emptyBounds();
  for (const partBounds of boundsList) {
    for (const corner of boundsCorners(partBounds)) include(bounds, corner);
  }
  return isFiniteBounds(bounds)
    ? bounds
    : { minX: -0.5, minY: -0.5, minZ: -0.5, maxX: 0.5, maxY: 0.5, maxZ: 0.5 };
}

/** Returns occurrence bounds for the currently selected visible targets. */
export function selectedSceneBounds(
  scene: Scene,
  runtime: PackedSceneRuntime,
  interaction: InteractionState,
  deformation?: DeformationState,
): Bounds | undefined {
  const selectedInstances = new Map<string, Exclude<InteractionTarget, { kind: "part" }>[]>();
  const selectedParts = new Set<number>();
  for (const target of selectedTargets(interaction)) {
    if (target.kind === "part") {
      selectedParts.add(target.partId);
      continue;
    }
    const targets = selectedInstances.get(target.partOccurrenceId) ?? [];
    targets.push(target);
    selectedInstances.set(target.partOccurrenceId, targets);
  }
  const bounds = emptyBounds();
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    if (!runtime.isInstanceVisible(slot)) continue;
    const partOccurrenceId = runtime.getInstanceId(slot);
    const partId = runtime.instancePartIds[slot];
    const transform = runtime.getTransform(slot);
    const part = partId === undefined ? undefined : scene.parts.get(partId);
    if (part === undefined || transform === undefined) continue;
    if (partId !== undefined && selectedParts.has(partId)) {
      const partBounds = displayedPartBounds(part, deformation);
      if (partBounds !== undefined) includeBounds(bounds, partBounds, transform);
    }
    const targets =
      partOccurrenceId === undefined ? undefined : selectedInstances.get(partOccurrenceId);
    if (targets === undefined) continue;
    if (targets.some((target) => target.kind === "partOccurrence")) {
      const partBounds = displayedPartBounds(part, deformation);
      if (partBounds !== undefined) includeBounds(bounds, partBounds, transform);
      continue;
    }
    for (const target of targets) {
      if (target.kind === "partOccurrence") continue;
      const targetBounds = selectedGeometryBounds(part, target, deformation);
      if (targetBounds !== undefined) includeBounds(bounds, targetBounds, transform);
    }
  }
  return isFiniteBounds(bounds) ? bounds : undefined;
}

function transformedBounds(
  bounds: Bounds,
  transform: Parameters<typeof transformPoint>[0],
): Bounds {
  const transformed = emptyBounds();
  includeBounds(transformed, bounds, transform);
  return transformed;
}

function includeBounds(
  target: MutableBounds,
  bounds: Bounds,
  transform: Parameters<typeof transformPoint>[0],
): void {
  for (const corner of boundsCorners(bounds)) {
    include(target, transformPoint(transform, corner[0], corner[1], corner[2]));
  }
}
