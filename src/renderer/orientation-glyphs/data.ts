import type { ElementalOrientationRecords } from "../../results/orientation-records";

/** Byte stride of the aligned GPU orientation record. */
export const ORIENTATION_GLYPH_RECORD_STRIDE = 64;

/** Float stride of one padded column-major occurrence normal matrix. */
export const ORIENTATION_GLYPH_NORMAL_MATRIX_FLOATS = 12;

/** Array identities that determine whether a packed record upload is reusable. */
export interface OrientationGlyphRecordSource {
  readonly elementIds: Uint32Array;
  readonly bodyIds: Uint32Array;
  readonly anchors: Float32Array;
  readonly referenceLengths: Float32Array;
  readonly directions: Float32Array;
  readonly axisIndices?: Uint32Array;
  readonly glyphModes?: Uint32Array;
  readonly transformModes?: Uint32Array;
  readonly lengthScales?: Float32Array;
  readonly anchorDeltas: Float32Array | undefined;
}

/** Builds the aligned GPU record layout from CPU structure-of-arrays data. */
export function packOrientationRecords(
  records: ElementalOrientationRecords,
): Uint8Array<ArrayBuffer> {
  const packed = new ArrayBuffer(records.elementIds.length * ORIENTATION_GLYPH_RECORD_STRIDE);
  const floats = new Float32Array(packed);
  const ids = new Uint32Array(packed);
  for (let index = 0; index < records.elementIds.length; index += 1) {
    const source = index * 3;
    const target = index * (ORIENTATION_GLYPH_RECORD_STRIDE / 4);
    floats[target] = records.anchors[source] ?? 0;
    floats[target + 1] = records.anchors[source + 1] ?? 0;
    floats[target + 2] = records.anchors[source + 2] ?? 0;
    floats[target + 3] =
      (records.referenceLengths[index] ?? 0) * (records.lengthScales?.[index] ?? 1);
    floats[target + 4] = records.directions[source] ?? 0;
    floats[target + 5] = records.directions[source + 1] ?? 0;
    floats[target + 6] = records.directions[source + 2] ?? 0;
    const delta = records.anchorDeltas;
    floats[target + 8] = delta?.[source] ?? 0;
    floats[target + 9] = delta?.[source + 1] ?? 0;
    floats[target + 10] = delta?.[source + 2] ?? 0;
    ids[target + 12] = records.elementIds[index] ?? 0;
    ids[target + 13] = records.bodyIds[index] ?? 0;
    ids[target + 14] = records.axisIndices?.[index] ?? 0;
    const mode = records.glyphModes?.[index];
    const transform = records.transformModes?.[index];
    ids[target + 15] =
      mode === undefined && transform === undefined
        ? 0xffffffff
        : (mode ?? 0) | ((transform ?? 0) << 8);
  }
  return new Uint8Array(packed);
}

/** Returns the immutable array-identity signature used by the upload cache. */
export function orientationGlyphRecordSource(
  records: ElementalOrientationRecords,
): OrientationGlyphRecordSource {
  return {
    elementIds: records.elementIds,
    bodyIds: records.bodyIds,
    anchors: records.anchors,
    referenceLengths: records.referenceLengths,
    directions: records.directions,
    ...(records.axisIndices === undefined ? {} : { axisIndices: records.axisIndices }),
    ...(records.glyphModes === undefined ? {} : { glyphModes: records.glyphModes }),
    ...(records.transformModes === undefined ? {} : { transformModes: records.transformModes }),
    ...(records.lengthScales === undefined ? {} : { lengthScales: records.lengthScales }),
    anchorDeltas: records.anchorDeltas,
  };
}

/** Compares the source arrays without scanning the packed record bytes. */
export function sameOrientationGlyphRecordSource(
  source: OrientationGlyphRecordSource | undefined,
  records: ElementalOrientationRecords,
): boolean {
  return (
    source?.elementIds === records.elementIds &&
    source.bodyIds === records.bodyIds &&
    source.anchors === records.anchors &&
    source.referenceLengths === records.referenceLengths &&
    source.directions === records.directions &&
    source.axisIndices === records.axisIndices &&
    source.glyphModes === records.glyphModes &&
    source.transformModes === records.transformModes &&
    source.lengthScales === records.lengthScales &&
    source.anchorDeltas === records.anchorDeltas
  );
}

/** Computes a column-major inverse-transpose 3x3 matrix for normal mode. */
export function normalMatrix3(transform: ArrayLike<number>): Float32Array {
  const a00 = valueAt(transform, 0);
  const a01 = valueAt(transform, 4);
  const a02 = valueAt(transform, 8);
  const a10 = valueAt(transform, 1);
  const a11 = valueAt(transform, 5);
  const a12 = valueAt(transform, 9);
  const a20 = valueAt(transform, 2);
  const a21 = valueAt(transform, 6);
  const a22 = valueAt(transform, 10);
  const determinant =
    a00 * (a11 * a22 - a12 * a21) - a01 * (a10 * a22 - a12 * a20) + a02 * (a10 * a21 - a11 * a20);
  if (!Number.isFinite(determinant) || determinant === 0) {
    throw new Error("Occurrence transform has a singular linear component");
  }
  const inverse = [
    (a11 * a22 - a12 * a21) / determinant,
    (a02 * a21 - a01 * a22) / determinant,
    (a01 * a12 - a02 * a11) / determinant,
    (a12 * a20 - a10 * a22) / determinant,
    (a00 * a22 - a02 * a20) / determinant,
    (a02 * a10 - a00 * a12) / determinant,
    (a10 * a21 - a11 * a20) / determinant,
    (a01 * a20 - a00 * a21) / determinant,
    (a00 * a11 - a01 * a10) / determinant,
  ];
  const normal = new Float32Array(9);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const component = inverse[column * 3 + row];
      if (component === undefined || !Number.isFinite(component)) {
        throw new Error("Occurrence transform has a non-finite normal matrix");
      }
      normal[column * 3 + row] = component;
    }
  }
  return normal;
}

function valueAt(values: ArrayLike<number>, index: number): number {
  const value = values[index];
  if (value === undefined || !Number.isFinite(value)) {
    throw new Error(`Occurrence transform component ${index} is not finite`);
  }
  return value;
}
