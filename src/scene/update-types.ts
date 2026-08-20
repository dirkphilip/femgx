import type { Part, PartId } from "../geometry/part";
import type { AssemblyDefinition, Placement } from "./assembly";
import type { AssemblyId } from "./types";

/** Authored placement with the explicit stable identity required for live scene edits. */
export type ExplicitPlacement = Placement & {
  /** Non-empty identity unique within the owning assembly definition. */
  readonly placementId: string;
};

/** Controls how definition removal handles authored placement references. */
export interface DefinitionRemovalOptions {
  /** Reject by default; `remove` deletes every direct authoring reference atomically. */
  readonly placements?: "reject" | "remove";
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
  /** Adds one explicitly identified placement to a reusable assembly definition. */
  addPlacement(ownerAssemblyId: AssemblyId, placement: ExplicitPlacement): void;
  /** Replaces one complete authored placement while retaining its stable identity. */
  replacePlacement(ownerAssemblyId: AssemblyId, placement: ExplicitPlacement): void;
  /** Removes one authored placement by its stable identity. */
  removePlacement(ownerAssemblyId: AssemblyId, placementId: string): void;
}
