import type { ResolvedStyle } from "../../interaction/interaction";

/** Byte size of one instance record in the per-part storage buffer. */
export const INSTANCE_STRIDE = 96;

/** Selection and overlay-membership flags packed into one instance word. */
export const INSTANCE_SELECTED_FLAG = 1;
export const INSTANCE_EMPHASIS_FLAG = 2;
export const INSTANCE_EDGE_EMPHASIS_FLAG = 4;
export const INSTANCE_EDGE_OVERLAY_FLAG = 8;

/** Byte offset of the `emissive` scalar within an instance record. */
export const EMISSIVE_BYTE_OFFSET = 84;
/** Byte offset of the resolved authored line width in CSS pixels. */
export const LINE_WIDTH_BYTE_OFFSET = 92;

/** Reusable typed views for allocation-free writes into instance records. */
export interface InstanceRecordTarget {
  readonly floats: Float32Array;
  readonly words: Uint32Array;
}

/** Style and identity fields written alongside one instance transform. */
export interface InstanceRecordValues {
  readonly style: ResolvedStyle;
  pickId: number;
  readonly selected: boolean;
}

/** Creates reusable typed views over an instance-record mirror. */
export function createInstanceRecordTarget(data: ArrayBuffer): InstanceRecordTarget {
  return { floats: new Float32Array(data), words: new Uint32Array(data) };
}

/** Writes one complete record without allocating per-record views or arrays. */
export function writeInstanceRecord(
  target: InstanceRecordTarget,
  recordIndex: number,
  transforms: Float32Array,
  transformOffset: number,
  values: InstanceRecordValues,
): void {
  const offset = (recordIndex * INSTANCE_STRIDE) / Float32Array.BYTES_PER_ELEMENT;
  for (let word = 0; word < 16; word += 1) {
    target.floats[offset + word] = transforms[transformOffset + word] ?? 0;
  }
  const style = values.style;
  target.floats[offset + 16] = style.color.r;
  target.floats[offset + 17] = style.color.g;
  target.floats[offset + 18] = style.color.b;
  target.floats[offset + 19] = style.color.a * style.opacity;
  target.words[offset + 20] = values.pickId;
  target.floats[offset + 21] = style.emissive;
  target.words[offset + 22] =
    (values.selected ? INSTANCE_SELECTED_FLAG : 0) | (style.edge ? INSTANCE_EDGE_OVERLAY_FLAG : 0);
  target.floats[offset + 23] = style.lineWidthPixels;
}

/** Encodes one detached instance record through the same in-place writer. */
export function encodeInstanceRecord(
  transform: Float32Array,
  style: ResolvedStyle,
  pickId: number,
  selected = false,
): ArrayBuffer {
  const data = new ArrayBuffer(INSTANCE_STRIDE);
  writeInstanceRecord(createInstanceRecordTarget(data), 0, transform, 0, {
    style,
    pickId,
    selected,
  });
  return data;
}
