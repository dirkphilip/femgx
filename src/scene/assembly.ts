import type { Mat4 } from "../math/mat4";
import type { PartId } from "../geometry/part";
import type { AssemblyId } from "./types";

/** A placement of a part inside an assembly. */
export interface PartPlacement {
  readonly kind: "part";
  readonly partId: PartId;
  /** Local transform relative to the owning assembly. */
  readonly transform: Mat4;
}

/** A placement of a nested assembly inside an assembly. */
export interface SubAssemblyPlacement {
  readonly kind: "assembly";
  readonly assemblyId: AssemblyId;
  /** Local transform relative to the owning assembly. */
  readonly transform: Mat4;
}

/** A node in an assembly hierarchy. */
export type Placement = PartPlacement | SubAssemblyPlacement;

/** A hierarchical composition of parts and other assemblies. */
export interface Assembly {
  readonly id: AssemblyId;
  readonly placements: readonly Placement[];
}

/** A named assembly that carries its own hide/show state. */
export interface NamedAssembly extends Assembly {
  readonly name: string;
}
