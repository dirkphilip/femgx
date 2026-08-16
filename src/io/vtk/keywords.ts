/** VTK section keywords shared by parser dispatch and writer name validation. */
export const VTK_KEYWORDS: ReadonlySet<string> = new Set([
  "DATASET",
  "POINTS",
  "CELLS",
  "CELL_TYPES",
  "POINT_DATA",
  "CELL_DATA",
  "SCALARS",
  "VECTORS",
  "NORMALS",
  "TENSORS",
  "FIELD",
  "LOOKUP_TABLE",
  "COLOR_SCALARS",
  "METADATA",
]);
