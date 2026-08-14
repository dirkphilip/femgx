import type { Mat4 } from "../math/mat4";
import type { PartId } from "../geometry/part";
import type { AssemblyId } from "./types";

/**
 * A placement of a part inside an assembly.
 * @category Scene and geometry
 */
export interface PartPlacement {
  readonly kind: "part";
  readonly partId: PartId;
  /** Optional stable identity within the owning assembly. */
  readonly placementId?: string;
  /** Local transform relative to the owning assembly. */
  readonly transform: Mat4;
}

/**
 * A placement of a nested assembly inside an assembly.
 * @category Scene and geometry
 */
export interface SubAssemblyPlacement {
  readonly kind: "assembly";
  readonly assemblyId: AssemblyId;
  /** Optional stable identity within the owning assembly. */
  readonly placementId?: string;
  /** Local transform relative to the owning assembly. */
  readonly transform: Mat4;
}

/**
 * A node in an assembly hierarchy.
 * @category Scene and geometry
 */
export type Placement = PartPlacement | SubAssemblyPlacement;

/**
 * A hierarchical composition of parts and other assemblies.
 * @category Scene and geometry
 */
export interface Assembly {
  readonly id: AssemblyId;
  readonly placements: readonly Placement[];
}

/**
 * A named assembly that carries its own hide/show state.
 * @category Scene and geometry
 */
export interface NamedAssembly extends Assembly {
  readonly name: string;
}
