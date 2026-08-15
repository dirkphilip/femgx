/** Serializable finite-element models and VTK interchange. */
export {
  IoError,
  type Issue,
  type IssueCode,
  type IssueSeverity,
  type SourcePosition,
  VtkWriteError,
  type VtkWriteErrorCode,
} from "../io/diagnostics";
export {
  FEMGX_FORMAT_VERSION,
  type FemModel,
  type MetadataValue,
  type ModelElementShapeBlock,
  type ModelMetadata,
  type ModelNodes,
  type ModelResultField,
  type ModelSet,
  type ModelSetKind,
} from "../io/model";
export { createModelBuilder, type FemModelBuilder } from "../io/build";
export { createElementModelFromFemModel } from "../io/element-model";
export {
  createResultFieldFromModelResult,
  type ModelResultFieldConversionOptions,
} from "../io/result-field";
export { parseVtk } from "../io/vtk";
export { writeVtk } from "../io/vtk-write";
export type { ParseOptions, ParseResult } from "../io/session";
export { validateModel } from "../io/validate";
