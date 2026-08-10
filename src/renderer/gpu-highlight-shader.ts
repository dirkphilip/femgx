/** Hashes one emphasis key; constants mirror gpu-highlight-table.ts. */
export const emphasisHash = /* wgsl */ `
fn highlightHash(slot: u32, elementPickId: u32, facePickId: u32, nodePickId: u32, seed: u32) -> u32 {
  var hash = seed;
  hash = hash ^ (slot * 0x9E3779B9u);
  hash = hash ^ (elementPickId * 0x85EBCA6Bu);
  hash = hash ^ (facePickId * 0xC2B2AE35u);
  hash = hash ^ (nodePickId * 0x27D4EB2Fu);
  hash = hash ^ (hash >> 16u);
  hash = hash * 0x7FEB352Du;
  hash = hash ^ (hash >> 15u);
  hash = hash * 0x846CA68Bu;
  return hash ^ (hash >> 16u);
}
`;
