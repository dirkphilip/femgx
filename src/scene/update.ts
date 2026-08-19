import type { Part, PartId } from "../geometry/part";
import type { AssemblyDefinition, AssemblyPlacement, PartPlacement, Placement } from "./assembly";
import { validatePlacementTransform, validateScene, type Scene } from "./scene";
import type { AssemblyId } from "./types";
import { explicitPlacementIndex, retainPlacementIndex } from "./assembly-index";
import {
  definitionChanges,
  isTransformOnlyChanges,
  type PlacementChange,
  type PreparedSceneUpdate,
} from "./update-changes";
import { equalAssembly, equalTransform, sameSceneStorage } from "./update-equality";
import {
  hasOnlyTransformChanges,
  normalizedMap,
  normalizedSet,
  restoresSourcePlacements,
} from "./update-normalization";
import type {
  AddAssemblyOccurrenceInput,
  AddPartOccurrenceInput,
  AssemblyOccurrenceAddress,
  DefinitionRemovalOptions,
  PartOccurrenceAddress,
  RebindAssemblyOccurrenceInput,
  RebindPartOccurrenceInput,
  SceneUpdate,
  TransformAssemblyOccurrenceInput,
  TransformPartOccurrenceInput,
} from "./update-types";

export type {
  AddAssemblyOccurrenceInput,
  AddPartOccurrenceInput,
  AssemblyOccurrenceAddress,
  DefinitionRemovalOptions,
  PartOccurrenceAddress,
  RebindAssemblyOccurrenceInput,
  RebindPartOccurrenceInput,
  SceneUpdate,
  TransformAssemblyOccurrenceInput,
  TransformPartOccurrenceInput,
} from "./update-types";

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

  constructor(private readonly source: Scene) {}

  close(): void {
    this.active = false;
  }

  addPart(part: Part): void {
    this.ensureActive();
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
    if (references > 0 && options?.occurrences !== "remove") {
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
    if (references > 0 && options?.occurrences !== "remove") {
      throw new Error(
        `AssemblyDefinition ${assemblyId} is still referenced by ${references} placement(s)`,
      );
    }
    if (references > 0)
      this.removePlacements(
        (placement) => placement.kind === "assembly" && placement.assemblyId === assemblyId,
      );
    this.mutableAssemblies().delete(assemblyId);
    this.mutableVisibleAssemblies().delete(assemblyId);
    this.touchedAssemblies.add(assemblyId);
  }

  addPartOccurrence(input: AddPartOccurrenceInput): void {
    this.ensureActive();
    this.requirePart(input.partId);
    this.appendPlacement(input.assemblyId, input.placementId, {
      kind: "part",
      placementId: input.placementId,
      partId: input.partId,
      transform: input.transform,
    });
  }

  removePartOccurrence(input: PartOccurrenceAddress): void {
    this.editPlacement(input.assemblyId, input.placementId, {
      kind: "part",
      apply: () => undefined,
    });
  }

  rebindPartOccurrence(input: RebindPartOccurrenceInput): void {
    this.ensureActive();
    this.requirePart(input.partId);
    this.editPlacement(input.assemblyId, input.placementId, {
      kind: "part",
      apply: (placement) =>
        placement.partId === input.partId ? placement : { ...placement, partId: input.partId },
    });
  }

  setPartOccurrenceTransform(input: TransformPartOccurrenceInput): void {
    this.editPlacement(input.assemblyId, input.placementId, {
      kind: "part",
      apply: (placement) =>
        equalTransform(placement.transform, input.transform)
          ? placement
          : { ...placement, transform: input.transform },
    });
  }

  addAssemblyOccurrence(input: AddAssemblyOccurrenceInput): void {
    this.ensureActive();
    this.requireAssembly(input.assemblyId);
    this.appendPlacement(input.parentAssemblyId, input.placementId, {
      kind: "assembly",
      placementId: input.placementId,
      assemblyId: input.assemblyId,
      transform: input.transform,
    });
  }

  removeAssemblyOccurrence(input: AssemblyOccurrenceAddress): void {
    this.editPlacement(input.parentAssemblyId, input.placementId, {
      kind: "assembly",
      apply: () => undefined,
    });
  }

  rebindAssemblyOccurrence(input: RebindAssemblyOccurrenceInput): void {
    this.ensureActive();
    this.requireAssembly(input.assemblyId);
    this.editPlacement(input.parentAssemblyId, input.placementId, {
      kind: "assembly",
      apply: (placement) =>
        placement.assemblyId === input.assemblyId
          ? placement
          : { ...placement, assemblyId: input.assemblyId },
    });
  }

  setAssemblyOccurrenceTransform(input: TransformAssemblyOccurrenceInput): void {
    this.editPlacement(input.parentAssemblyId, input.placementId, {
      kind: "assembly",
      apply: (placement) =>
        equalTransform(placement.transform, input.transform)
          ? placement
          : { ...placement, transform: input.transform },
    });
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
    if (!isTransformOnlyChanges(changes)) validateScene(candidate);
    return { scene: candidate, changes };
  }

  private editPlacement(assemblyId: AssemblyId, placementId: string, edit: PlacementEdit): void {
    this.ensureActive();
    const assembly = this.requireAssembly(assemblyId);
    const index = explicitPlacementIndex(assembly, placementId);
    if (index < 0)
      throw new Error(`AssemblyDefinition ${assemblyId} has no placement ${placementId}`);
    const placement = assembly.placements[index];
    let replacement: Placement | undefined;
    if (edit.kind === "part") {
      if (placement?.kind !== "part")
        throw new Error(`Placement ${placementId} is not a part occurrence`);
      replacement = edit.apply(placement);
    } else {
      if (placement?.kind !== "assembly") {
        throw new Error(`Placement ${placementId} is not an assembly occurrence`);
      }
      replacement = edit.apply(placement);
    }
    if (replacement === placement) return;
    if (replacement !== undefined) {
      validatePlacementTransform(replacement.transform, assemblyId, index);
    }
    const placements = assembly.placements.slice();
    if (replacement === undefined) placements.splice(index, 1);
    else placements[index] = replacement;
    const revision = { ...assembly, placements };
    if (replacement !== undefined) retainPlacementIndex(assembly, revision);
    this.mutableAssemblies().set(assemblyId, revision);
    this.placementChanges.push({
      ownerAssemblyId: assemblyId,
      before: placement,
      after: replacement,
    });
  }

  private appendPlacement(assemblyId: AssemblyId, placementId: string, placement: Placement): void {
    const assembly = this.requireAssembly(assemblyId);
    if (explicitPlacementIndex(assembly, placementId) >= 0) {
      throw new Error(`AssemblyDefinition ${assemblyId} already has placement ${placementId}`);
    }
    this.mutableAssemblies().set(assemblyId, {
      ...assembly,
      placements: [...assembly.placements, placement],
    });
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
        this.mutableAssemblies().set(id, { ...assembly, placements });
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

type PlacementEdit =
  | { readonly kind: "part"; readonly apply: (placement: PartPlacement) => Placement | undefined }
  | {
      readonly kind: "assembly";
      readonly apply: (placement: AssemblyPlacement) => Placement | undefined;
    };

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
