/** WGSL visibility lookup for body and element ownership. */
export const ownerVisibilityBindings = /* wgsl */ `
@group(1) @binding(3) var<storage, read> elementHighlights: ElementHighlights;

fn bodyOwnerVisible(slot: u32, bodyPickId: u32) -> bool {
  if (bodyPickId == 0u || elementHighlights.bucketCount == 0u || !instanceHasPrimitiveEmphasis(instances[slot].selected)) { return true; }
  let bucket = highlightHash(slot, bodyPickId, 0xffffffffu, 0u, elementHighlights.seed) & (elementHighlights.bucketCount - 1u);
  let base = bucket * 4u;
  for (var offset = 0u; offset < 4u; offset++) {
    let highlight = elementHighlightAt(base + offset);
    if (highlight.slot == slot && highlight.elementPickId == bodyPickId && highlight.facePickId == 0xffffffffu) {
      return highlight.hidden == 0u;
    }
  }
  return true;
}

fn elementOwnerVisible(slot: u32, elementPickId: u32) -> bool {
  if (elementPickId == 0u || elementHighlights.bucketCount == 0u || !instanceHasPrimitiveEmphasis(instances[slot].selected)) { return true; }
  let bucket = highlightHash(slot, elementPickId, 0u, 0u, elementHighlights.seed) & (elementHighlights.bucketCount - 1u);
  let base = bucket * 4u;
  for (var offset = 0u; offset < 4u; offset++) {
    let highlight = elementHighlightAt(base + offset);
    if (highlight.slot == slot && highlight.elementPickId == elementPickId && highlight.facePickId == 0u) {
      return highlight.hidden == 0u;
    }
  }
  return true;
}

fn ownerVisible(slot: u32, bodyPickId: u32, elementPickId: u32) -> bool {
  return bodyOwnerVisible(slot, bodyPickId) && elementOwnerVisible(slot, elementPickId);
}
`;

/** WGSL visibility lookup for per-primitive and per-topology ownership data. */
export const pickDataBindings = /* wgsl */ `
@group(1) @binding(2) var<storage, read> primitiveElementOrdinals: array<u32>;
// Header: face-record count, topology range count, and condition count. Face
// records use five words; ownership conditions use four words.
@group(1) @binding(5) var<storage, read> topologyData: array<u32>;

${ownerVisibilityBindings}

fn topologyConditionCount() -> u32 {
  return topologyData[2];
}

fn primitiveFaceBase(index: u32) -> u32 {
  return 3u + index * 5u;
}

fn primitiveFaceBodyPickIds(index: u32) -> vec3<u32> {
  let base = primitiveFaceBase(index);
  return vec3<u32>(topologyData[base], topologyData[base + 1u], topologyData[base + 2u]);
}

fn primitiveFaceElementPickIds(index: u32) -> vec2<u32> {
  let base = primitiveFaceBase(index);
  return vec2<u32>(topologyData[base + 3u], topologyData[base + 4u]);
}

fn primitiveElementId(index: u32) -> u32 {
  return primitiveFaceElementPickIds(index).x;
}

fn primitiveElementOrdinal(index: u32) -> u32 {
  return primitiveElementOrdinals[index];
}

fn topologyBodyRange(index: u32) -> vec2<u32> {
  if (index >= topologyData[1]) { return vec2<u32>(0u, 0u); }
  let base = 3u + topologyData[0] * 5u + index * 2u;
  return vec2<u32>(topologyData[base], topologyData[base + 1u]);
}

fn topologyConditionBase() -> u32 {
  return 3u + topologyData[0] * 5u + topologyData[1] * 2u;
}

fn topologyBodyId(index: u32) -> u32 {
  return topologyData[topologyConditionBase() + index * 2u];
}

fn topologyBodyNeighborId(index: u32) -> u32 {
  return topologyData[topologyConditionBase() + index * 2u + 1u];
}

fn topologyElementId(index: u32) -> u32 {
  return topologyData[topologyConditionBase() + topologyConditionCount() * 2u + index * 2u];
}

fn topologyElementNeighborId(index: u32) -> u32 {
  return topologyData[topologyConditionBase() + topologyConditionCount() * 2u + index * 2u + 1u];
}

fn topologyPrimitiveId(index: u32) -> u32 {
  let base = topologyConditionBase() + topologyConditionCount() * 4u;
  return topologyData[base + 1u + index];
}

fn topologyEdgeId(index: u32) -> u32 {
  let base = topologyConditionBase() + topologyConditionCount() * 4u;
  return topologyData[base + 1u + topologyData[base] + index];
}

fn primitiveVisible(slot: u32, primitiveIndex: u32) -> bool {
  let bodyIds = primitiveFaceBodyPickIds(primitiveIndex);
  let elementIds = primitiveFaceElementPickIds(primitiveIndex);
  return ownerVisible(slot, bodyIds.y, elementIds.x) &&
    ((bodyIds.z == 0u && elementIds.y == 0u) ||
      !ownerVisible(slot, bodyIds.z, elementIds.y));
}

fn primitiveSelectionVisible(slot: u32, primitiveIndex: u32, exactSelection: bool) -> bool {
  let bodyIds = primitiveFaceBodyPickIds(primitiveIndex);
  let elementIds = primitiveFaceElementPickIds(primitiveIndex);
  if (!ownerVisible(slot, bodyIds.y, elementIds.x)) { return false; }
  return exactSelection ||
    ((bodyIds.z == 0u && elementIds.y == 0u) ||
      !ownerVisible(slot, bodyIds.z, elementIds.y));
}

fn topologyOwnersVisible(slot: u32, topologyIndex: u32) -> bool {
  let range = topologyBodyRange(topologyIndex);
  if (range.y == 0u) { return true; }
  for (var condition = 0u; condition < range.y; condition++) {
    let index = range.x + condition;
    let owner = topologyBodyId(index);
    let neighbor = topologyBodyNeighborId(index);
    let element = topologyElementId(index);
    let neighborElement = topologyElementNeighborId(index);
    let ownerIsVisible = ownerVisible(slot, owner, element);
    var neighborIsVisible = ownerVisible(slot, neighbor, neighborElement);
    if (neighbor == 0u && neighborElement == 0u) {
      neighborIsVisible = false;
    }
    if (ownerIsVisible && !neighborIsVisible) {
      return true;
    }
  }
  return false;
}

// Shared authored edges and nodes remain visible while at least one incident
// owner is visible, including when hiding an element exposes interior topology.
fn topologyAnyOwnerVisible(slot: u32, topologyIndex: u32) -> bool {
  let range = topologyBodyRange(topologyIndex);
  if (range.y == 0u) { return true; }
  for (var condition = 0u; condition < range.y; condition++) {
    let index = range.x + condition;
    if (ownerVisible(slot, topologyBodyId(index), topologyElementId(index))) {
      return true;
    }
    let neighbor = topologyElementNeighborId(index);
    if (neighbor != 0u && ownerVisible(slot, topologyBodyNeighborId(index), neighbor)) {
      return true;
    }
  }
  return false;
}

`;
