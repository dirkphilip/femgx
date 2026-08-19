import type { Part, PartId } from "../geometry/part";
import type { Mat4 } from "../math/mat4";
import type { AssemblyDefinition } from "./assembly";
import type { AssemblyId } from "./types";

/** Stable authoring address of a direct part placement. */
export interface PartOccurrenceAddress {
  /** Reusable assembly definition that directly owns the placement. */
  readonly assemblyId: AssemblyId;
  /** Explicit stable placement identity within the owning assembly. */
  readonly placementId: string;
}

/** Input for adding one authored part occurrence to an assembly definition. */
export interface AddPartOccurrenceInput extends PartOccurrenceAddress {
  /** Registered reusable part definition to place. */
  readonly partId: PartId;
  /** Local transform relative to the owning assembly definition. */
  readonly transform: Mat4;
}

/** Input for rebinding one authored part occurrence to another reusable part. */
export interface RebindPartOccurrenceInput extends PartOccurrenceAddress {
  /** Registered reusable part definition that replaces the current target. */
  readonly partId: PartId;
}

/** Input for replacing one authored part occurrence's local transform. */
export interface TransformPartOccurrenceInput extends PartOccurrenceAddress {
  /** Replacement local transform relative to the owning assembly definition. */
  readonly transform: Mat4;
}

/** Stable authoring address of a direct child-assembly placement. */
export interface AssemblyOccurrenceAddress {
  /** Reusable assembly definition that directly owns the child placement. */
  readonly parentAssemblyId: AssemblyId;
  /** Explicit stable placement identity within the parent assembly. */
  readonly placementId: string;
}

/** Input for adding one authored child-assembly occurrence. */
export interface AddAssemblyOccurrenceInput extends AssemblyOccurrenceAddress {
  /** Registered reusable child-assembly definition to place. */
  readonly assemblyId: AssemblyId;
  /** Local transform relative to the parent assembly definition. */
  readonly transform: Mat4;
}

/** Input for rebinding one authored child-assembly occurrence. */
export interface RebindAssemblyOccurrenceInput extends AssemblyOccurrenceAddress {
  /** Registered child-assembly definition that replaces the current target. */
  readonly assemblyId: AssemblyId;
}

/** Input for replacing one child-assembly occurrence's local transform. */
export interface TransformAssemblyOccurrenceInput extends AssemblyOccurrenceAddress {
  /** Replacement local transform relative to the parent assembly definition. */
  readonly transform: Mat4;
}

/** Controls how definition removal handles authored placement references. */
export interface DefinitionRemovalOptions {
  /** Reject by default; `remove` deletes every direct authoring reference atomically. */
  readonly occurrences?: "reject" | "remove";
}

/**
 * Transaction-local editor for one immutable {@link Scene} revision.
 *
 * The editor is valid only during the synchronous callback passed to
 * `Viewport.updateScene`. Definitions and placement arrays are copied only
 * when changed; untouched definitions retain their object identity.
 * @category Scene and geometry
 */
export interface SceneUpdate {
  /** Registers a reusable part definition, visible by default. */
  addPart(part: Part): void;
  /** Replaces the registered part with the same stable id. */
  replacePart(part: Part): void;
  /** Removes a part definition, optionally cascading through direct placements. */
  removePart(partId: PartId, options?: DefinitionRemovalOptions): void;
  /** Registers a reusable assembly definition, visible by default. */
  addAssembly(assembly: AssemblyDefinition): void;
  /** Replaces the registered assembly definition with the same stable id. */
  replaceAssembly(assembly: AssemblyDefinition): void;
  /** Removes a non-root assembly, optionally cascading through direct placements. */
  removeAssembly(assemblyId: AssemblyId, options?: DefinitionRemovalOptions): void;
  /** Appends one explicitly identified direct part placement. */
  addPartOccurrence(input: AddPartOccurrenceInput): void;
  /** Removes one explicitly identified direct part placement. */
  removePartOccurrence(input: PartOccurrenceAddress): void;
  /** Rebinds one direct part placement without changing its identity. */
  rebindPartOccurrence(input: RebindPartOccurrenceInput): void;
  /** Replaces one direct part placement's local transform. */
  setPartOccurrenceTransform(input: TransformPartOccurrenceInput): void;
  /** Appends one explicitly identified direct child-assembly placement. */
  addAssemblyOccurrence(input: AddAssemblyOccurrenceInput): void;
  /** Removes one explicitly identified direct child-assembly placement. */
  removeAssemblyOccurrence(input: AssemblyOccurrenceAddress): void;
  /** Rebinds one child-assembly placement without changing its identity. */
  rebindAssemblyOccurrence(input: RebindAssemblyOccurrenceInput): void;
  /** Replaces one child-assembly placement's local transform. */
  setAssemblyOccurrenceTransform(input: TransformAssemblyOccurrenceInput): void;
}
