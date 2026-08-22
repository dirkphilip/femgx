import type { Camera } from "../camera/camera";
import { protectCameraWithinBounds } from "../camera/navigation";
import { boundsCorners, isFiniteBounds, type Bounds, type PartId } from "../geometry/part";
import { selectedTargets } from "../interaction/targets";
import type { InteractionState } from "../interaction/interaction";
import type { InteractionTarget } from "../interaction/target-types";
import { transformPoint } from "../math/mat4";
import type { DeformationState } from "../results/deform";
import { resultBindingValue } from "../results/bindings";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import { instanceMatchesAssemblyTarget } from "../scene-runtime/interaction-hierarchy";
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

interface SelectedBoundsTargets {
  readonly instances: Map<
    string,
    Exclude<InteractionTarget, { kind: "part" | "assembly" | "assemblyOccurrence" }>[]
  >;
  readonly partIds: ReadonlySet<number>;
  readonly assemblyIds: ReadonlySet<number>;
  readonly assemblyOccurrenceIds: ReadonlySet<string>;
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

  /** Protects a camera using the same cached bounds consumed by camera fitting. */
  protect(
    camera: Camera,
    scene: Scene,
    runtime: PackedSceneRuntime,
    deformation?: DeformationState,
  ): Camera {
    const bounds = this.get(scene, runtime, deformation);
    return protectCameraWithinBounds(camera, bounds.bounds, bounds.protectedBounds);
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
    const occurrenceId = runtime.getInstanceId(slot);
    const transform = runtime.getTransform(slot);
    const part = partId === undefined ? undefined : scene.parts.get(partId);
    let partBounds: Bounds | undefined;
    if (part !== undefined && partId !== undefined) {
      const occurrenceOverride =
        occurrenceId !== undefined && deformation?.displacements.has(occurrenceId) === true;
      if (!occurrenceOverride && partBoundsById.has(partId)) {
        partBounds = partBoundsById.get(partId);
      } else {
        partBounds = displayedPartBounds(
          part,
          occurrenceDeformation(deformation, partId, occurrenceId),
        );
        if (!occurrenceOverride) partBoundsById.set(partId, partBounds);
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
  const selected = collectSelectedBoundsTargets(interaction);
  const bounds = emptyBounds();
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    if (!runtime.isInstanceVisible(slot)) continue;
    const partOccurrenceId = runtime.getInstanceId(slot);
    const partId = runtime.instancePartIds[slot];
    const transform = runtime.getTransform(slot);
    const part = partId === undefined ? undefined : scene.parts.get(partId);
    if (part === undefined || transform === undefined) continue;
    const localDeformation =
      partId === undefined
        ? deformation
        : occurrenceDeformation(deformation, partId, partOccurrenceId);
    if (
      instanceMatchesAssemblyTarget(
        runtime,
        slot,
        selected.assemblyIds,
        selected.assemblyOccurrenceIds,
      )
    ) {
      const partBounds = displayedPartBounds(part, localDeformation);
      if (partBounds !== undefined) includeBounds(bounds, partBounds, transform);
      continue;
    }
    if (partId !== undefined && selected.partIds.has(partId)) {
      const partBounds = displayedPartBounds(part, localDeformation);
      if (partBounds !== undefined) includeBounds(bounds, partBounds, transform);
    }
    const targets =
      partOccurrenceId === undefined ? undefined : selected.instances.get(partOccurrenceId);
    if (targets === undefined) continue;
    if (targets.some((target) => target.kind === "partOccurrence")) {
      const partBounds = displayedPartBounds(part, localDeformation);
      if (partBounds !== undefined) includeBounds(bounds, partBounds, transform);
      continue;
    }
    for (const target of targets) {
      if (target.kind === "partOccurrence") continue;
      const targetBounds = selectedGeometryBounds(part, target, localDeformation);
      if (targetBounds !== undefined) includeBounds(bounds, targetBounds, transform);
    }
  }
  return isFiniteBounds(bounds) ? bounds : undefined;
}

function collectSelectedBoundsTargets(interaction: InteractionState): SelectedBoundsTargets {
  const instances = new Map<
    string,
    Exclude<InteractionTarget, { kind: "part" | "assembly" | "assemblyOccurrence" }>[]
  >();
  const partIds = new Set<number>();
  const assemblyIds = new Set<number>();
  const assemblyOccurrenceIds = new Set<string>();
  for (const target of selectedTargets(interaction)) {
    if (target.kind === "part") {
      partIds.add(target.partId);
    } else if (target.kind === "assembly") {
      assemblyIds.add(target.assemblyId);
    } else if (target.kind === "assemblyOccurrence") {
      assemblyOccurrenceIds.add(target.assemblyOccurrenceId);
    } else {
      const targets = instances.get(target.partOccurrenceId) ?? [];
      targets.push(target);
      instances.set(target.partOccurrenceId, targets);
    }
  }
  return { instances, partIds, assemblyIds, assemblyOccurrenceIds };
}

function occurrenceDeformation(
  deformation: DeformationState | undefined,
  partId: PartId,
  occurrenceId: string | undefined,
): DeformationState | undefined {
  if (deformation === undefined || occurrenceId === undefined) return deformation;
  const values = resultBindingValue(deformation.displacements, partId, occurrenceId);
  return values === undefined
    ? undefined
    : { scale: deformation.scale, displacements: new Map([[partId, values]]) };
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
