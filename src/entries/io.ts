/** Serializable finite-element models, validation, and result conversion. */
export {
  IoError,
  type Issue,
  type IssueCode,
  type IssueSeverity,
  type SourcePosition,
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
export {
  createElementModelFromFemModel,
  type ElementModelConversionOptions,
} from "../io/conversions/element-model";
export {
  createResultFieldFromModelResult,
  type ModelResultFieldConversionOptions,
} from "../io/conversions/result-field";
export { validateModel } from "../io/model-validation";
