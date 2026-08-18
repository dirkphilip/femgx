import type { Mat4 } from "../math/mat4";
import type { PartId } from "../geometry/part";
import type { AssemblyId } from "./types";

/**
 * A placement of a reusable {@link Part} inside an assembly.
 *
 * The placement owns only occurrence-specific state: a reference to a part
 * definition, a local transform, and optionally a stable `placementId` within
 * its owning assembly. It never copies geometry. The compiled runtime expands
 * each placement into an `instanceId`, which is the identity used for
 * occurrence-scoped visibility, interaction, and picking.
 * @category Scene and geometry
 */
export interface PartPlacement {
  /** Discriminator identifying a direct part placement. */
  readonly kind: "part";
  /** Reusable part definition referenced by this occurrence. */
  readonly partId: PartId;
  /** Optional stable identity within the owning assembly. */
  readonly placementId?: string;
  /** Local transform relative to the owning assembly. */
  readonly transform: Mat4;
}

/**
 * A placement of a nested assembly inside an assembly.
 *
 * `transform` is relative to the owning assembly; the runtime composes it with
 * ancestor transforms. Reusing one child definition under two placements
 * therefore shares its parts while producing two distinct assembly occurrences.
 * @category Scene and geometry
 */
export interface SubAssemblyPlacement {
  /** Discriminator identifying a nested assembly placement. */
  readonly kind: "assembly";
  /** Child assembly definition referenced by this occurrence. */
  readonly assemblyId: AssemblyId;
  /** Optional stable identity within the owning assembly. */
  readonly placementId?: string;
  /** Local transform relative to the owning assembly. */
  readonly transform: Mat4;
}

/**
 * A node in an assembly hierarchy.
 *
 * A placement is an authored reference in the immutable scene registry. Its
 * optional `placementId` should be explicit when a host will reconcile scene
 * updates; if omitted, the validated sibling index is the deterministic
 * fallback identity.
 * @category Scene and geometry
 */
export type Placement = PartPlacement | SubAssemblyPlacement;

/**
 * A hierarchical composition of part and child-assembly placements.
 *
 * Assembly definitions are reusable registry entries. They describe hierarchy
 * and local transforms, but do not own expanded runtime slots or GPU resources.
 * @category Scene and geometry
 */
export interface Assembly {
  /** Stable assembly-definition identifier. */
  readonly id: AssemblyId;
  /** Direct part and child-assembly placements in local order. */
  readonly placements: readonly Placement[];
}

/**
 * A named assembly definition registered with a {@link Scene}.
 *
 * The name is host-facing display metadata. Visibility is tracked by the scene
 * registry and can be changed for the whole definition or one expanded
 * occurrence through {@link Viewport}.
 * @category Scene and geometry
 */
export interface NamedAssembly extends Assembly {
  /** Host-facing display name. */
  readonly name: string;
}
