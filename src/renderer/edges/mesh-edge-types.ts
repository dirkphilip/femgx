/** Expanded edge endpoints plus the body owners of each logical edge. */
export interface MeshEdgeData {
  /** Sequential indices into the expanded endpoint arrays. */
  readonly indices: Uint32Array;
  /** Original geometry vertex index for each expanded endpoint. */
  readonly sourceVertexIndices: Uint32Array;
  /** Logical edge index for each expanded endpoint. */
  readonly edgeIds: Uint32Array;
  /** Expanded endpoint positions, in the same order as `sourceVertexIndices`. */
  readonly positions: Float32Array;
  /** Interleaved owner-array start/count for each logical edge. */
  readonly bodyRanges: Uint32Array;
  /** 1-based owner/neighbor body pick-id pairs referenced by `bodyRanges`. */
  readonly bodyIds: Uint32Array;
  /** 1-based owner/neighbor element pick-id pairs referenced by `bodyRanges`. */
  readonly elementIds: Uint32Array;
  /** Stable authored identities, present only when geometry declares edges. */
  readonly edgeKeys?: readonly string[];
  /** Canonical authored node sequences parallel to `edgeKeys`. */
  readonly edgeNodeIds?: readonly (readonly number[])[];
}
