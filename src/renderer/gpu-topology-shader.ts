/** WGSL visibility lookup for per-primitive and per-topology ownership data. */
export const pickDataBindings = /* wgsl */ `
@group(1) @binding(2) var<storage, read> primitiveElementPickIds: array<u32>;
@group(1) @binding(3) var<storage, read> elementHighlights: ElementHighlights;
// Packed header: face-record count, topology range count, condition count,
// then five-word face records, topology ranges, body pairs, and element pairs.
@group(1) @binding(5) var<storage, read> topologyData: array<u32>;

fn primitiveFaceBodyPickIds(index: u32) -> vec3<u32> {
  let base = 3u + index * 5u;
  return vec3<u32>(topologyData[base], topologyData[base + 1u], topologyData[base + 2u]);
}

fn primitiveFaceElementPickIds(index: u32) -> vec2<u32> {
  let base = 3u + index * 5u;
  return vec2<u32>(topologyData[base + 3u], topologyData[base + 4u]);
}

fn topologyBodyRange(index: u32) -> vec2<u32> {
  if (index >= topologyData[1]) {
    return vec2<u32>(0u, 0u);
  }
  let base = 3u + topologyData[0] * 5u + index * 2u;
  return vec2<u32>(topologyData[base], topologyData[base + 1u]);
}

fn topologyBodyId(index: u32) -> u32 {
  let base = 3u + topologyData[0] * 5u + topologyData[1] * 2u;
  return topologyData[base + index * 2u];
}

fn topologyBodyNeighborId(index: u32) -> u32 {
  let base = 3u + topologyData[0] * 5u + topologyData[1] * 2u;
  return topologyData[base + index * 2u + 1u];
}

fn topologyElementId(index: u32) -> u32 {
  let base = 3u + topologyData[0] * 5u + topologyData[1] * 2u + topologyData[2] * 2u;
  return topologyData[base + index * 2u];
}

fn topologyElementNeighborId(index: u32) -> u32 {
  let base = 3u + topologyData[0] * 5u + topologyData[1] * 2u + topologyData[2] * 2u;
  return topologyData[base + index * 2u + 1u];
}

fn topologyPrimitiveId(index: u32) -> u32 {
  let base = 3u + topologyData[0] * 5u + topologyData[1] * 2u + topologyData[2] * 4u;
  return topologyData[base + 1u + index];
}

fn topologyEdgeId(index: u32) -> u32 {
  let base = 3u + topologyData[0] * 5u + topologyData[1] * 2u + topologyData[2] * 4u;
  return topologyData[base + 1u + topologyData[base] + index];
}

fn bodyOwnerVisible(slot: u32, bodyPickId: u32) -> bool {
  if (bodyPickId == 0u || elementHighlights.bucketCount == 0u) {
    return true;
  }
  let bucket = highlightHash(slot, bodyPickId, 0xffffffffu, 0u, elementHighlights.seed) & (elementHighlights.bucketCount - 1u);
  let base = bucket * 4u;
  for (var offset = 0u; offset < 4u; offset++) {
    let highlight = elementHighlights.records[base + offset];
    if (highlight.slot == slot && highlight.elementPickId == bodyPickId && highlight.facePickId == 0xffffffffu) {
      return highlight.hidden == 0u;
    }
  }
  return true;
}

fn elementOwnerVisible(slot: u32, elementPickId: u32) -> bool {
  if (elementPickId == 0u || elementHighlights.bucketCount == 0u) {
    return true;
  }
  let bucket = highlightHash(slot, elementPickId, 0u, 0u, elementHighlights.seed) & (elementHighlights.bucketCount - 1u);
  let base = bucket * 4u;
  for (var offset = 0u; offset < 4u; offset++) {
    let highlight = elementHighlights.records[base + offset];
    if (highlight.slot == slot && highlight.elementPickId == elementPickId && highlight.facePickId == 0u) {
      return highlight.hidden == 0u;
    }
  }
  return true;
}

fn ownerVisible(slot: u32, bodyPickId: u32, elementPickId: u32) -> bool {
  return bodyOwnerVisible(slot, bodyPickId) && elementOwnerVisible(slot, elementPickId);
}

fn primitiveVisible(slot: u32, primitiveIndex: u32) -> bool {
  let bodyIds = primitiveFaceBodyPickIds(primitiveIndex);
  let elementIds = primitiveFaceElementPickIds(primitiveIndex);
  return ownerVisible(slot, bodyIds.y, elementIds.x) &&
    ((bodyIds.z == 0u && elementIds.y == 0u) || !ownerVisible(slot, bodyIds.z, elementIds.y));
}

fn primitiveSelectionVisible(slot: u32, primitiveIndex: u32, exactSelection: bool) -> bool {
  let bodyIds = primitiveFaceBodyPickIds(primitiveIndex);
  let elementIds = primitiveFaceElementPickIds(primitiveIndex);
  if (!ownerVisible(slot, bodyIds.y, elementIds.x)) {
    return false;
  }
  return exactSelection ||
    ((bodyIds.z == 0u && elementIds.y == 0u) || !ownerVisible(slot, bodyIds.z, elementIds.y));
}

fn topologyOwnersVisible(slot: u32, topologyIndex: u32) -> bool {
  let range = topologyBodyRange(topologyIndex);
  if (range.y == 0u) {
    return true;
  }
  for (var condition = 0u; condition < range.y; condition++) {
    let owner = topologyBodyId(range.x + condition);
    let neighbor = topologyBodyNeighborId(range.x + condition);
    let element = topologyElementId(range.x + condition);
    let neighborElement = topologyElementNeighborId(range.x + condition);
    if (ownerVisible(slot, owner, element) &&
      ((neighbor == 0u && neighborElement == 0u) || !ownerVisible(slot, neighbor, neighborElement))) {
      return true;
    }
  }
  return false;
}

// Unlike exposed edges, a node annotation belongs to every incident topology
// item and disappears as soon as any owning body or element is hidden.
fn topologyOwnersAllVisible(slot: u32, topologyIndex: u32) -> bool {
  let range = topologyBodyRange(topologyIndex);
  for (var condition = 0u; condition < range.y; condition++) {
    let owner = topologyBodyId(range.x + condition);
    let element = topologyElementId(range.x + condition);
    if (!ownerVisible(slot, owner, element)) {
      return false;
    }
  }
  return true;
}
`;
