/** WGSL storage layout and lookup helpers for sparse and dense emphasis. */
export const emphasisStructs = /* wgsl */ `
// Field layout must match encodeEmphasisRecord in resources/element-resources.ts:
// slot 0, elementPickId 4, facePickId 8, nodePickId 12, color 16, emissive 32,
// hidden 36, selected 40, keepsResultColor 44.
// The struct has no trailing member so its size stays 48 bytes (vec3 members
// would force 16-byte alignment and a 64-byte stride that would not match the
// encoder).
struct ElementHighlight {
  slot: u32,
  elementPickId: u32,
  facePickId: u32,
  nodePickId: u32,
  color: vec4<f32>,
  emissive: f32,
  hidden: u32,
  selected: u32,
  keepsResultColor: bool,
};

// The fixed header is followed by a u32 payload. Sparse records occupy the
// first bucketCount * 4 * 12 words. Element and node selection offset tables
// and compact per-occurrence bitsets follow it; their relative word offsets are
// in the header. Keeping all private representations in this existing binding
// avoids fixed selection bindings and leaves the no-selection payload empty.
struct ElementHighlights {
  count: u32,
  bucketCount: u32,
  seed: u32,
  selectionWords: u32,
  selectionOffsetWord: u32,
  selectionBitsWord: u32,
  selectionRecordCount: u32,
  selectionSlotCapacity: u32,
  selectionFlags: u32,
  selectedColorR: u32,
  selectedColorG: u32,
  selectedColorB: u32,
  selectedColorA: u32,
  selectedEmissive: u32,
  selectedOpacity: u32,
  nodeSelectionWords: u32,
  nodeSelectionOffsetWord: u32,
  nodeSelectionBitsWord: u32,
  nodeSelectionRecordCount: u32,
  nodeSelectionSlotCapacity: u32,
  _reserved0: u32,
  _reserved1: u32,
  _reserved2: u32,
  _reserved3: u32,
  data: array<u32>,
};

fn elementHighlightAt(index: u32) -> ElementHighlight {
  let base = index * 12u;
  return ElementHighlight(
    elementHighlights.data[base],
    elementHighlights.data[base + 1u],
    elementHighlights.data[base + 2u],
    elementHighlights.data[base + 3u],
    vec4<f32>(
      bitcast<f32>(elementHighlights.data[base + 4u]),
      bitcast<f32>(elementHighlights.data[base + 5u]),
      bitcast<f32>(elementHighlights.data[base + 6u]),
      bitcast<f32>(elementHighlights.data[base + 7u]),
    ),
    bitcast<f32>(elementHighlights.data[base + 8u]),
    elementHighlights.data[base + 9u],
    elementHighlights.data[base + 10u],
    elementHighlights.data[base + 11u] != 0u,
  );
}

fn denseElementSelected(slot: u32, ordinal: u32) -> bool {
  if (ordinal == 0u || slot >= elementHighlights.selectionSlotCapacity ||
      elementHighlights.selectionRecordCount == 0u || elementHighlights.selectionWords == 0u) {
    return false;
  }
  let record = elementHighlights.data[elementHighlights.selectionOffsetWord + slot];
  if (record == 0xffffffffu || record >= elementHighlights.selectionRecordCount) {
    return false;
  }
  let bit = ordinal - 1u;
  let word = bit / 32u;
  if (word >= elementHighlights.selectionWords) { return false; }
  let mask = 1u << (bit % 32u);
  return (elementHighlights.data[
    elementHighlights.selectionBitsWord + record * elementHighlights.selectionWords + word
  ] & mask) != 0u;
}

fn denseNodeSelected(slot: u32, nodePickId: u32) -> bool {
  if (nodePickId == 0u || slot >= elementHighlights.nodeSelectionSlotCapacity ||
      elementHighlights.nodeSelectionRecordCount == 0u ||
      elementHighlights.nodeSelectionWords == 0u) {
    return false;
  }
  let record = elementHighlights.data[elementHighlights.nodeSelectionOffsetWord + slot];
  if (record == 0xffffffffu || record >= elementHighlights.nodeSelectionRecordCount) {
    return false;
  }
  let bit = nodePickId - 1u;
  let word = bit / 32u;
  if (word >= elementHighlights.nodeSelectionWords) { return false; }
  let mask = 1u << (bit % 32u);
  return (elementHighlights.data[
    elementHighlights.nodeSelectionBitsWord + record * elementHighlights.nodeSelectionWords + word
  ] & mask) != 0u;
}

fn applyDenseSelectionColor(base: vec4<f32>) -> vec4<f32> {
  var color = base;
  if ((elementHighlights.selectionFlags & 1u) != 0u) {
    color = vec4<f32>(
      bitcast<f32>(elementHighlights.selectedColorR),
      bitcast<f32>(elementHighlights.selectedColorG),
      bitcast<f32>(elementHighlights.selectedColorB),
      bitcast<f32>(elementHighlights.selectedColorA) * color.a,
    );
  }
  if ((elementHighlights.selectionFlags & 2u) != 0u) {
    color.a = color.a * bitcast<f32>(elementHighlights.selectedOpacity);
  }
  return color;
}

fn applyDenseSelectionEmissive(base: f32) -> f32 {
  return select(base, bitcast<f32>(elementHighlights.selectedEmissive),
    (elementHighlights.selectionFlags & 4u) != 0u);
}
`;
