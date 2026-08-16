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
} from "../io/fem-model";
export { createModelBuilder, type FemModelBuilder } from "../io/model-builder";
export { createElementModelFromFemModel } from "../io/conversions/element-model";
export {
  createResultFieldFromModelResult,
  type ModelResultFieldConversionOptions,
} from "../io/conversions/result-field";
export { parseVtk } from "../io/vtk/parser";
export { writeVtk } from "../io/vtk/writer";
export type { ParseOptions, ParseResult } from "../io/vtk/parser-session";
export { validateModel } from "../io/model-validation";
