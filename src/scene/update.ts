import { validatePartId, type Part, type PartId } from "../geometry/part";
import type { AssemblyDefinition, Placement } from "./assembly";
import { validatePlacementTransform, validateScene, type Scene } from "./scene";
import type { AssemblyId } from "./types";
import { explicitPlacementIndex } from "./assembly-index";
import {
  definitionChanges,
  isTransformOnlyChanges,
  type PlacementChange,
  type PreparedSceneUpdate,
} from "./update-changes";
import { equalAssembly, equalPlacement, sameSceneStorage } from "./update-equality";
import {
  hasOnlyTransformChanges,
  normalizedMap,
  normalizedSet,
  restoresSourcePlacements,
} from "./update-normalization";
import type { DefinitionRemovalOptions, ExplicitPlacement, SceneUpdate } from "./update-types";
import { hasOnlyDirectPartRuntimeChanges, validateExplicitPlacementId } from "./update-validation";
import { ScenePlacementDrafts } from "./update-placements";

export type { DefinitionRemovalOptions, ExplicitPlacement, SceneUpdate } from "./update-types";

/** Builds and validates one atomic scene revision, or returns nothing for a semantic no-op. */
export function prepareSceneUpdate(
  scene: Scene,
  operation: (update: SceneUpdate) => unknown,
): Scene | undefined {
  return prepareSceneTransition(scene, operation)?.scene;
}

/** Prepares the private structural changes consumed by a live viewport update. */
export function prepareSceneTransition(
  scene: Scene,
  operation: (update: SceneUpdate) => unknown,
): PreparedSceneUpdate | undefined {
  const draft = new SceneUpdateDraft(scene);
  let result: unknown;
  try {
    result = operation(draft);
  } catch (error) {
    draft.close();
    throw error;
  }
  draft.close();
  if (isPromiseLike(result)) {
    void Promise.resolve(result).catch(() => undefined);
    throw new TypeError("Scene update operation must be synchronous");
  }
  return draft.finish();
}

class SceneUpdateDraft implements SceneUpdate {
  private active = true;
  private parts: Map<PartId, Part> | undefined;
  private assemblies: Map<AssemblyId, AssemblyDefinition> | undefined;
  private visibleParts: Set<PartId> | undefined;
  private visibleAssemblies: Set<AssemblyId> | undefined;
  private readonly touchedParts = new Set<PartId>();
  private readonly touchedAssemblies = new Set<AssemblyId>();
  private readonly placementChanges: PlacementChange[] = [];
  private readonly placementDrafts: ScenePlacementDrafts;

  constructor(private readonly source: Scene) {
    this.placementDrafts = new ScenePlacementDrafts((id, assembly) => {
      this.mutableAssemblies().set(id, assembly);
    });
  }

  close(): void {
    this.active = false;
  }

  addPart(part: Part): void {
    this.ensureActive();
    validatePartId(part.id);
    if (this.currentParts().has(part.id)) throw new Error(`Part ${part.id} is already registered`);
    this.mutableParts().set(part.id, part);
    this.mutableVisibleParts().add(part.id);
    this.touchedParts.add(part.id);
  }

  replacePart(part: Part): void {
    this.ensureActive();
    const previous = this.currentParts().get(part.id);
    if (previous === undefined) throw new Error(`Part ${part.id} is not registered`);
    if (previous !== part) {
      this.mutableParts().set(part.id, part);
      this.touchedParts.add(part.id);
    }
  }

  removePart(partId: PartId, options?: DefinitionRemovalOptions): void {
    this.ensureActive();
    if (!this.currentParts().has(partId)) throw new Error(`Part ${partId} is not registered`);
    const references = this.partReferences(partId);
    if (references > 0 && options?.placements !== "remove") {
      throw new Error(`Part ${partId} is still referenced by ${references} placement(s)`);
    }
    if (references > 0)
      this.removePlacements(
        (placement) => placement.kind === "part" && placement.partId === partId,
      );
    this.mutableParts().delete(partId);
    this.mutableVisibleParts().delete(partId);
    this.touchedParts.add(partId);
  }

  addAssembly(assembly: AssemblyDefinition): void {
    this.ensureActive();
    if (this.currentAssemblies().has(assembly.id)) {
      throw new Error(`AssemblyDefinition ${assembly.id} is already registered`);
    }
    this.mutableAssemblies().set(assembly.id, assembly);
    this.placementDrafts.discard(assembly.id);
    this.mutableVisibleAssemblies().add(assembly.id);
    this.touchedAssemblies.add(assembly.id);
  }

  replaceAssembly(assembly: AssemblyDefinition): void {
    this.ensureActive();
    const previous = this.currentAssemblies().get(assembly.id);
    if (previous === undefined)
      throw new Error(`AssemblyDefinition ${assembly.id} is not registered`);
    if (!equalAssembly(previous, assembly)) {
      this.mutableAssemblies().set(assembly.id, assembly);
      this.placementDrafts.discard(assembly.id);
      this.touchedAssemblies.add(assembly.id);
    }
  }

  removeAssembly(assemblyId: AssemblyId, options?: DefinitionRemovalOptions): void {
    this.ensureActive();
    if (!this.currentAssemblies().has(assemblyId)) {
      throw new Error(`AssemblyDefinition ${assemblyId} is not registered`);
    }
    if (assemblyId === this.source.rootAssemblyId)
      throw new Error("Cannot remove the root assembly");
    const references = this.assemblyReferences(assemblyId);
    if (references > 0 && options?.placements !== "remove") {
      throw new Error(
        `AssemblyDefinition ${assemblyId} is still referenced by ${references} placement(s)`,
      );
    }
    if (references > 0)
      this.removePlacements(
        (placement) => placement.kind === "assembly" && placement.assemblyId === assemblyId,
      );
    this.mutableAssemblies().delete(assemblyId);
    this.placementDrafts.discard(assemblyId);
    this.mutableVisibleAssemblies().delete(assemblyId);
    this.touchedAssemblies.add(assemblyId);
  }

  addPlacement(ownerAssemblyId: AssemblyId, placement: ExplicitPlacement): void {
    this.ensureActive();
    this.requirePlacementTarget(placement);
    this.appendPlacement(ownerAssemblyId, placement);
  }

  replacePlacement(ownerAssemblyId: AssemblyId, placement: ExplicitPlacement): void {
    this.ensureActive();
    this.requirePlacementTarget(placement);
    const assembly = this.requireAssembly(ownerAssemblyId);
    const index = explicitPlacementIndex(assembly, placement.placementId);
    if (index < 0) {
      throw new Error(
        `AssemblyDefinition ${ownerAssemblyId} has no placement ${placement.placementId}`,
      );
    }
    const previous = assembly.placements[index];
    if (previous === undefined || equalPlacement(previous, placement)) return;
    validatePlacementTransform(placement.transform, ownerAssemblyId, index);
    this.placementDrafts.edit(ownerAssemblyId, assembly, index, placement.placementId, placement);
    this.placementChanges.push({ ownerAssemblyId, before: previous, after: placement });
  }

  removePlacement(ownerAssemblyId: AssemblyId, placementId: string): void {
    this.ensureActive();
    const assembly = this.requireAssembly(ownerAssemblyId);
    const index = explicitPlacementIndex(assembly, placementId);
    if (index < 0) {
      throw new Error(`AssemblyDefinition ${ownerAssemblyId} has no placement ${placementId}`);
    }
    const previous = assembly.placements[index];
    if (previous === undefined) throw new Error(`Placement ${placementId} is missing`);
    this.placementDrafts.edit(ownerAssemblyId, assembly, index, placementId, undefined);
    this.placementChanges.push({ ownerAssemblyId, before: previous, after: undefined });
  }

  finish(): PreparedSceneUpdate | undefined {
    const transformOnly = hasOnlyTransformChanges(
      this.touchedParts,
      this.touchedAssemblies,
      this.placementChanges,
    );
    const candidate: Scene = {
      rootAssemblyId: this.source.rootAssemblyId,
      parts: normalizedMap(this.source.parts, this.parts, (left, right) => left === right),
      assemblies: transformOnly
        ? (this.assemblies ?? this.source.assemblies)
        : normalizedMap(this.source.assemblies, this.assemblies, equalAssembly),
      visiblePartIds: normalizedSet(this.source.visiblePartIds, this.visibleParts),
      visibleAssemblyIds: normalizedSet(this.source.visibleAssemblyIds, this.visibleAssemblies),
    };
    if (
      sameSceneStorage(candidate, this.source) ||
      (transformOnly && restoresSourcePlacements(this.source, candidate, this.placementChanges))
    )
      return undefined;
    const changes = {
      parts: definitionChanges(this.source.parts, candidate.parts, this.touchedParts),
      assemblies: definitionChanges(
        this.source.assemblies,
        candidate.assemblies,
        this.touchedAssemblies,
      ),
      placements: this.placementChanges,
    };
    if (!isTransformOnlyChanges(changes) && !hasOnlyDirectPartRuntimeChanges(changes)) {
      validateScene(candidate);
    }
    return { scene: candidate, changes };
  }

  private appendPlacement(assemblyId: AssemblyId, placement: ExplicitPlacement): void {
    const assembly = this.requireAssembly(assemblyId);
    const { placementId } = placement;
    validateExplicitPlacementId(placementId, assemblyId, assembly.placements.length);
    validatePlacementTransform(placement.transform, assemblyId, assembly.placements.length);
    if (explicitPlacementIndex(assembly, placementId) >= 0) {
      throw new Error(`AssemblyDefinition ${assemblyId} already has placement ${placementId}`);
    }
    this.placementDrafts.append(assemblyId, assembly, placementId, placement);
    this.placementChanges.push({
      ownerAssemblyId: assemblyId,
      before: undefined,
      after: placement,
    });
  }

  private removePlacements(matches: (placement: Placement) => boolean): void {
    for (const [id, assembly] of this.currentAssemblies()) {
      const placements = assembly.placements.filter((placement) => {
        if (!matches(placement)) return true;
        this.placementChanges.push({ ownerAssemblyId: id, before: placement, after: undefined });
        return false;
      });
      if (placements.length !== assembly.placements.length) {
        this.placementDrafts.replaceAll(id, assembly, placements);
      }
    }
  }

  private partReferences(partId: PartId): number {
    return countReferences(
      this.currentAssemblies(),
      (placement) => placement.kind === "part" && placement.partId === partId,
    );
  }

  private assemblyReferences(assemblyId: AssemblyId): number {
    return countReferences(
      this.currentAssemblies(),
      (placement) => placement.kind === "assembly" && placement.assemblyId === assemblyId,
    );
  }

  private requirePart(partId: PartId): Part {
    const part = this.currentParts().get(partId);
    if (part === undefined) throw new Error(`Part ${partId} is not registered`);
    return part;
  }

  private requireAssembly(assemblyId: AssemblyId): AssemblyDefinition {
    const assembly = this.currentAssemblies().get(assemblyId);
    if (assembly === undefined)
      throw new Error(`AssemblyDefinition ${assemblyId} is not registered`);
    return assembly;
  }

  private requirePlacementTarget(placement: Placement): void {
    if (placement.kind === "part") this.requirePart(placement.partId);
    else this.requireAssembly(placement.assemblyId);
  }

  private ensureActive(): void {
    if (!this.active) throw new Error("Scene update is no longer active");
  }

  private currentParts(): ReadonlyMap<PartId, Part> {
    return this.parts ?? this.source.parts;
  }

  private currentAssemblies(): ReadonlyMap<AssemblyId, AssemblyDefinition> {
    return this.assemblies ?? this.source.assemblies;
  }

  private mutableParts(): Map<PartId, Part> {
    return (this.parts ??= new Map(this.source.parts));
  }

  private mutableAssemblies(): Map<AssemblyId, AssemblyDefinition> {
    return (this.assemblies ??= new Map(this.source.assemblies));
  }

  private mutableVisibleParts(): Set<PartId> {
    return (this.visibleParts ??= new Set(this.source.visiblePartIds));
  }

  private mutableVisibleAssemblies(): Set<AssemblyId> {
    return (this.visibleAssemblies ??= new Set(this.source.visibleAssemblyIds));
  }
}

function countReferences(
  assemblies: ReadonlyMap<AssemblyId, AssemblyDefinition>,
  matches: (placement: Placement) => boolean,
): number {
  let count = 0;
  for (const assembly of assemblies.values()) {
    for (const placement of assembly.placements) if (matches(placement)) count++;
  }
  return count;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && "then" in value;
}
