/** Builds one self-contained GLB containing many independent triangle primitives. */
export function makeManyPrimitiveGlb(primitiveCount: number): Uint8Array {
  const positions = new Float32Array(primitiveCount * 9);
  for (let primitive = 0; primitive < primitiveCount; primitive += 1) {
    positions.set([primitive, 0, 0, primitive, 1, 0, primitive, 0, 1], primitive * 9);
  }
  const binary = new Uint8Array(positions.buffer);
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        name: "Many primitives",
        primitives: Array.from({ length: primitiveCount }, (_, index) => ({
          attributes: { POSITION: index },
        })),
      },
    ],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: Array.from({ length: primitiveCount }, (_, index) => ({
      buffer: 0,
      byteOffset: index * 9 * Float32Array.BYTES_PER_ELEMENT,
      byteLength: 9 * Float32Array.BYTES_PER_ELEMENT,
    })),
    accessors: Array.from({ length: primitiveCount }, (_, index) => ({
      bufferView: index,
      componentType: 5126,
      count: 3,
      type: "VEC3",
    })),
  };
  return makeGlb(json, binary);
}

function makeGlb(json: object, binary: Uint8Array): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = (jsonBytes.byteLength + 3) & ~3;
  const binaryLength = (binary.byteLength + 3) & ~3;
  const totalLength = 12 + 8 + jsonLength + 8 + binaryLength;
  const result = new Uint8Array(totalLength);
  const view = new DataView(result.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  result.set(jsonBytes, 20);
  result.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonLength);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binaryLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  result.set(binary, binaryHeader + 8);
  return result;
}
