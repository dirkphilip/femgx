export type {
  Assembly,
  NamedAssembly,
  PartPlacement,
  Placement,
  SubAssemblyPlacement,
} from "./assembly";
export { computeBounds, type Bounds, type Geometry, type Part } from "./part";
export { flattenAssembly, type FlattenOptions } from "./flatten";
export { createScene, type Scene, type SceneBuilder } from "./scene";
export { identity, multiply, translation, type Mat4 } from "./mat4";
export { instanceToTarget, resolvePick } from "./pick";
export type { AssemblyId, Instance, PartId, PickTarget } from "./types";
