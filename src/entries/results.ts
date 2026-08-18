/** Authored scalar/vector fields, ranges, color mapping, and deformation. */
export {
  FRAME_COMPONENT_COUNT,
  LOAD_COMPONENT_COUNT,
  createElementFrameField,
  createNodalLoadField,
  FIELD_COMPONENT_COUNT,
  createResultField,
  frameAt,
  scalarAt,
  vectorAt,
  type AnyResultField,
  type ElementFrameField,
  type ElementFrameFieldOptions,
  type NodalLoadField,
  type NodalLoadFieldOptions,
  type FieldLocation,
  type FieldShape,
  type ResultField,
  type ResultFieldOptions,
  type ScalarField,
  type VectorField,
} from "../results/fields";
export { finiteRange, scalarRange, type ValueRange } from "../results/range";
export {
  createScalarColorMap,
  mapScalar,
  type ColorStop,
  type ScalarColorMap,
  type ScalarColorMapOptions,
} from "../results/mapping";
export {
  deformGeometry,
  deformPositions,
  nodalDisplacements,
  type DeformationState,
} from "../results/deform";
